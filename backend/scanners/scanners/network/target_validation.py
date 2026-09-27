import socket
import ipaddress
import urllib.parse
from dataclasses import dataclass
from typing import Tuple, Optional, Union


@dataclass
class NormalizedTarget:
    original_input: str
    hostname: str
    port: int
    resolved_ip: Optional[str] = None


FORBIDDEN_HOSTNAMES_PRE_DNS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "instance-data",
    "metadata.azure.com",
    "metadata",
    "vault.internal",
    "kubernetes.default.svc",
}

CLOUD_METADATA_IPS = {
    "169.254.169.254",
    "169.254.169.253",
    "169.254.170.2",
    "100.100.100.200",
    "fd00:ec2::254",
}


def parse_numeric_or_special_ip(raw_str: str) -> Optional[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """
    Parses decimal, hex, octal, dotted numeric, or IPv4-mapped IPv6 strings into an IP address object.
    Returns None if raw_str is not an IP representation.
    """
    if not raw_str or not isinstance(raw_str, str):
        return None
    s = raw_str.strip().lower()
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]

    # 1. IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if s.startswith("::ffff:"):
        rest = s[7:]
        if "." in rest:
            try:
                v4 = ipaddress.IPv4Address(rest)
                return v4
            except ValueError:
                pass
        elif ":" in rest:
            parts = rest.split(":")
            if len(parts) == 2:
                try:
                    hi = int(parts[0], 16)
                    lo = int(parts[1], 16)
                    if 0 <= hi <= 0xFFFF and 0 <= lo <= 0xFFFF:
                        return ipaddress.IPv4Address((hi << 16) | lo)
                except ValueError:
                    pass

    # 2. Hex integer representation (e.g. 0x7f000001)
    if s.startswith("0x"):
        try:
            val = int(s, 16)
            if 0 <= val <= 0xFFFFFFFF:
                return ipaddress.IPv4Address(val)
        except ValueError:
            return None

    # 3. Single decimal integer representation (e.g. 2130706433)
    if s.isdigit():
        try:
            val = int(s, 10)
            if 0 <= val <= 0xFFFFFFFF:
                return ipaddress.IPv4Address(val)
        except ValueError:
            return None

    # 4. Dotted representations with decimal, hex, or octal parts (1 to 4 parts, e.g. 127.1, 0177.0.0.1, 0x7f.1)
    if "." in s:
        parts = s.split(".")
        if 1 <= len(parts) <= 4:
            nums = []
            valid_parts = True
            for p in parts:
                try:
                    if p.startswith("0x"):
                        num = int(p, 16)
                    elif p.startswith("0") and len(p) > 1 and p.isdigit() and not any(c in "89" for c in p):
                        num = int(p, 8)
                    elif p.isdigit():
                        num = int(p, 10)
                    else:
                        valid_parts = False
                        break
                    if num < 0:
                        valid_parts = False
                        break
                    nums.append(num)
                except ValueError:
                    valid_parts = False
                    break

            if valid_parts and len(nums) == 4:
                if all(n <= 255 for n in nums):
                    return ipaddress.IPv4Address((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3])
            elif valid_parts and len(nums) == 2:
                if nums[0] <= 255 and nums[1] <= 0xFFFFFF:
                    return ipaddress.IPv4Address((nums[0] << 24) | nums[1])
            elif valid_parts and len(nums) == 3:
                if nums[0] <= 255 and nums[1] <= 255 and nums[2] <= 0xFFFF:
                    return ipaddress.IPv4Address((nums[0] << 24) | (nums[1] << 16) | nums[2])

    # 5. Standard IPv4 or IPv6
    try:
        return ipaddress.ip_address(s)
    except ValueError:
        return None


def is_ip_allowed(ip_val: Union[str, ipaddress.IPv4Address, ipaddress.IPv6Address], allow_private: bool) -> bool:
    if isinstance(ip_val, str):
        ip = parse_numeric_or_special_ip(ip_val)
        if ip is None:
            return False
    else:
        ip = ip_val

    # Cloud metadata check
    if str(ip) in CLOUD_METADATA_IPS:
        return False

    # IPv4 / IPv6 common forbidden attributes
    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        return False

    # 0.0.0.0/8 and 127.0.0.0/8 checks for IPv4
    if isinstance(ip, ipaddress.IPv4Address):
        if ip in ipaddress.ip_network("0.0.0.0/8") or ip in ipaddress.ip_network("127.0.0.0/8"):
            return False
        if ip in ipaddress.ip_network("169.254.0.0/16") or ip in ipaddress.ip_network("100.64.0.0/10"):
            return False

    # IPv6 link-local and unique local
    if isinstance(ip, ipaddress.IPv6Address):
        if ip in ipaddress.ip_network("fe80::/10") or ip in ipaddress.ip_network("fc00::/7"):
            if not allow_private:
                return False
        if str(ip) == "::1" or str(ip) == "::":
            return False

    if ip.is_private:
        return allow_private

    return ip.is_global


def check_target_pre_dns(hostname: str, allow_private: bool = False) -> Tuple[bool, Optional[str]]:
    """
    Inspects target hostname BEFORE DNS resolution to detect forbidden IP literals or hostnames.
    Returns (is_rejected, reason).
    """
    clean_host = hostname.strip().lower()
    if clean_host.startswith("[") and clean_host.endswith("]"):
        clean_host = clean_host[1:-1]

    if clean_host in FORBIDDEN_HOSTNAMES_PRE_DNS:
        return True, f"Target '{hostname}' matches forbidden hostnames allowlist."

    # Internal DNS suffixes
    for suffix in (".local", ".internal", ".corp", ".lan", ".home", ".home.arpa", ".intranet", ".priv", ".private", ".test", ".invalid", ".onion", ".localhost"):
        if clean_host == suffix[1:] or clean_host.endswith(suffix):
            return True, f"Target '{hostname}' belongs to forbidden internal DNS domain '{suffix}'."

    # Parse potential IP literal
    parsed_ip = parse_numeric_or_special_ip(clean_host)
    if parsed_ip is not None:
        if not is_ip_allowed(parsed_ip, allow_private):
            return True, f"Target IP '{hostname}' ({parsed_ip}) belongs to a restricted, loopback, metadata, or private range."

    return False, None


def normalize_target(target: str, default_port: int = 443, allow_private: bool = False) -> Tuple[str, int]:
    if not isinstance(target, str) or not target.strip() or len(target) > 255 or "\x00" in target:
        raise ValueError("Target must be a non-empty hostname, IP address, or URL of at most 255 characters.")
    target = target.strip()
    if target.startswith("http://") or target.startswith("https://"):
        parsed = urllib.parse.urlparse(target)
        if parsed.username or parsed.password:
            raise ValueError("URL credentials are not allowed in scan targets.")
        hostname = parsed.hostname
        try:
            port = parsed.port or default_port
        except ValueError as e:
            raise ValueError("Invalid URL port.") from e
        if not hostname:
            raise ValueError(f"Invalid URL target: {target}")
    elif target.startswith("["):
        closing = target.find("]")
        if closing == -1:
            raise ValueError("Invalid bracketed IPv6 target.")
        hostname = target[1:closing]
        suffix = target[closing + 1 :]
        if suffix and (not suffix.startswith(":") or not suffix[1:].isdigit()):
            raise ValueError("Invalid port in target.")
        port = int(suffix[1:]) if suffix else default_port
    elif target.count(":") == 1:
        hostname, port_text = target.rsplit(":", 1)
        if not hostname or not port_text.isdigit():
            raise ValueError("Invalid port in target.")
        port = int(port_text)
    else:
        hostname, port = target, default_port
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535.")

    # Pre-DNS validation
    rejected, reason = check_target_pre_dns(hostname, allow_private=allow_private)
    if rejected:
        raise ValueError(f"SSRF violation: {reason}")

    return hostname, port


def validate_and_resolve(target: str, allow_private: bool = False, default_port: int = 443) -> NormalizedTarget:
    hostname, port = normalize_target(target, default_port, allow_private=allow_private)

    try:
        addr_info = socket.getaddrinfo(hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ValueError(f"DNS resolution failed for {hostname}: {e}")

    if not addr_info:
        raise ValueError(f"No IP addresses found for {hostname}")

    resolved_ips = list(dict.fromkeys(info[4][0] for info in addr_info))
    if any(not is_ip_allowed(ip, allow_private) for ip in resolved_ips):
        raise ValueError("Target resolution includes a restricted or non-global address.")
    # The scanner connects to this resolved address directly rather than asking
    # DNS again, limiting DNS-rebinding exposure for the individual scan.
    resolved_ip = resolved_ips[0]

    return NormalizedTarget(original_input=target, hostname=hostname, port=port, resolved_ip=resolved_ip)

