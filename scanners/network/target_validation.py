import socket
import ipaddress
import urllib.parse
from dataclasses import dataclass
from typing import Tuple, Optional


@dataclass
class NormalizedTarget:
    original_input: str
    hostname: str
    port: int
    resolved_ip: Optional[str] = None


def normalize_target(target: str, default_port: int = 443) -> Tuple[str, int]:
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
    return hostname, port


def is_ip_allowed(ip_str: str, allow_private: bool) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False

    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        return False

    if ip.is_private:
        return allow_private
    return ip.is_global


def validate_and_resolve(target: str, allow_private: bool = False, default_port: int = 443) -> NormalizedTarget:
    hostname, port = normalize_target(target, default_port)

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
