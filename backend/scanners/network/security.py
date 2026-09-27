"""
ECDAT Network Security Controls (Phase 5.1)
Enforces:
- Rate limiting (token bucket per target host and global)
- Concurrency limiting
- Timeout bounds
- DNS rebinding protection (IP pinning & single resolution)
- SSRF protection (loopback, link-local, cloud metadata)
- Deployment policy private-network restrictions
"""

import ipaddress
import socket
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple, List


class SecurityControlError(ValueError):
    """Raised when a security guard or network policy invariant is violated."""

    pass


class SSRFProtectionError(SecurityControlError):
    """Raised when a target attempts to access loopback, link-local, or cloud metadata."""

    pass


class DNSRebindingError(SecurityControlError):
    """Raised when a target resolution changes or attempts DNS rebinding."""

    pass


@dataclass
class DeploymentPolicy:
    allow_private_networks: bool = False
    max_concurrency: int = 5
    default_timeout_seconds: int = 15
    max_rate_per_host_rps: float = 5.0
    max_global_rps: float = 25.0


class RateLimiter:
    """
    Token-bucket rate limiter for controlling scan rate per host and globally.
    """

    def __init__(self, host_rate_rps: float = 5.0, global_rate_rps: float = 25.0):
        self.host_rate_rps = max(0.1, host_rate_rps)
        self.global_rate_rps = max(0.1, global_rate_rps)
        self.global_tokens = self.global_rate_rps
        self.last_global_update = time.monotonic()
        self.host_tokens: Dict[str, float] = {}
        self.last_host_update: Dict[str, float] = {}
        self._lock = threading.Lock()

    def acquire(self, host: str, timeout: float = 5.0) -> bool:
        """
        Blocks until a token is available or until timeout expires.
        Returns True if acquired, False if timed out.
        """
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            with self._lock:
                now = time.monotonic()

                # 1. Refill global tokens
                elapsed_global = now - self.last_global_update
                self.last_global_update = now
                self.global_tokens = min(
                    self.global_rate_rps, self.global_tokens + elapsed_global * self.global_rate_rps
                )

                # 2. Refill host tokens
                elapsed_host = now - self.last_host_update.get(host, now)
                self.last_host_update[host] = now
                current_host_tokens = min(
                    self.host_rate_rps,
                    self.host_tokens.get(host, self.host_rate_rps) + elapsed_host * self.host_rate_rps,
                )
                self.host_tokens[host] = current_host_tokens

                # 3. Check availability
                if self.global_tokens >= 1.0 and self.host_tokens[host] >= 1.0:
                    self.global_tokens -= 1.0
                    self.host_tokens[host] -= 1.0
                    return True

            time.sleep(0.05)

        return False


class DNSRebindingGuard:
    """
    Guards against DNS rebinding, SSRF, and unauthorized private network access.
    Enforces IP pinning.
    """

    BLOCKED_IPS_AND_RANGES = [
        ipaddress.ip_network("127.0.0.0/8"),  # Loopback IPv4
        ipaddress.ip_network("::1/128"),  # Loopback IPv6
        ipaddress.ip_network("169.254.0.0/16"),  # Link-local / Cloud metadata
        ipaddress.ip_network("fe80::/10"),  # Link-local IPv6
        ipaddress.ip_network("224.0.0.0/4"),  # Multicast IPv4
        ipaddress.ip_network("ff00::/8"),  # Multicast IPv6
        ipaddress.ip_network("0.0.0.0/8"),  # This host on this network
        ipaddress.ip_network("100.100.100.200/32"),  # Alibaba IMDS
        ipaddress.ip_network("100.64.0.0/10"),  # Carrier-Grade NAT
    ]

    PRIVATE_IPV4_RANGES = [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
    ]

    PRIVATE_IPV6_RANGES = [
        ipaddress.ip_network("fc00::/7"),  # Unique local addresses
    ]

    CLOUD_METADATA_IPS = {
        "169.254.169.254",
        "169.254.169.253",
        "169.254.170.2",
        "100.100.100.200",
        "fd00:ec2::254",
    }

    @classmethod
    def validate_ip_address(
        cls, ip_str: str, allow_private: bool = False
    ) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
        """
        Validates an IP against SSRF and private network policies.
        Supports decimal, hex, octal, dotted numeric, and IPv4-mapped IPv6.
        """
        from scanners.network.target_validation import parse_numeric_or_special_ip

        ip = parse_numeric_or_special_ip(ip_str)
        if ip is None:
            raise SecurityControlError(f"Invalid IP address literal: '{ip_str}'")

        clean_ip_str = str(ip)

        # Cloud metadata endpoints check
        if clean_ip_str in cls.CLOUD_METADATA_IPS:
            raise SSRFProtectionError(f"Blocked SSRF: '{ip_str}' ({clean_ip_str}) is a cloud metadata endpoint.")

        # SSRF checks
        for net in cls.BLOCKED_IPS_AND_RANGES:
            if ip in net:
                raise SSRFProtectionError(f"Blocked SSRF: '{ip_str}' belongs to restricted network {net}.")

        # Check private networks
        is_private = any(ip in net for net in cls.PRIVATE_IPV4_RANGES + cls.PRIVATE_IPV6_RANGES) or ip.is_private
        if is_private and not allow_private:
            raise SSRFProtectionError(
                f"Blocked Private Network: '{ip_str}' is a private address and deployment policy prohibits private network scanning."
            )

        return ip

    @classmethod
    def resolve_and_pin(
        cls,
        hostname: str,
        port: int,
        allow_private: bool = False,
    ) -> Tuple[str, List[str]]:
        """
        Validates hostname before DNS resolution, resolves hostname to IP addresses once,
        validates all resolved addresses against SSRF, and returns the pinned IP address.
        """
        from scanners.network.target_validation import check_target_pre_dns

        # Step 1: Pre-DNS validation to reject forbidden hostnames and numeric IP literals
        rejected, reason = check_target_pre_dns(hostname, allow_private=allow_private)
        if rejected:
            raise SSRFProtectionError(f"Pre-DNS SSRF Blocked: {reason}")

        # Step 2: DNS Resolution
        try:
            addr_info = socket.getaddrinfo(hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except socket.gaierror as e:
            raise SecurityControlError(f"DNS resolution failed for '{hostname}': {e}") from e

        if not addr_info:
            raise SecurityControlError(f"No IP addresses returned for '{hostname}'")

        resolved_ips = list(dict.fromkeys(info[4][0] for info in addr_info))

        # Step 3: Validate EVERY resolved IP address to prevent mixed public/private rebinding
        for ip in resolved_ips:
            cls.validate_ip_address(ip, allow_private=allow_private)

        # Pin the first valid IP
        pinned_ip = resolved_ips[0]
        return pinned_ip, resolved_ips

