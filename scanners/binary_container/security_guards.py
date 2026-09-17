"""
ECDAT Container Security Guards (Phase 4.3)
Prevents:
- Registry SSRF (private IPs, loopback, link-local, cloud metadata)
- Credential leakage (environment variables, tokens, keys)
- Untrusted registry access (allowlist enforcement)
- Oversized layers and decompression bombs (tar bombs, path traversal)
"""

import ipaddress
import os
import re
import socket
import tarfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Set, Tuple

# Default trusted public registries
DEFAULT_TRUSTED_REGISTRIES = {
    "docker.io",
    "registry-1.docker.io",
    "index.docker.io",
    "ghcr.io",
    "quay.io",
    "gcr.io",
    "mcr.microsoft.com",
    "public.ecr.aws",
}

# Cloud metadata services and sensitive endpoints
BLOCKED_HOSTS_AND_IPS = {
    "169.254.169.254",  # AWS / GCP / Azure IMDS
    "metadata.google.internal",  # GCP
    "100.100.100.200",  # Alibaba IMDS
    "169.254.169.253",  # AWS DNS
    "instance-data",
    "localhost",
}

# Sensitive credential keywords for environment and config sanitization
SENSITIVE_KEY_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"password",
        r"secret",
        r"token",
        r"api[_-]?key",
        r"auth",
        r"cred(?:ential)?",
        r"private[_-]?key",
        r"cert(?:ificate)?",
        r"access[_-]?key",
        r"signing[_-]?key",
        r"jwt",
        r"bearer",
        r"ssh[_-]?key",
        r"passphrase",
    ]
]


class SecurityGuardError(ValueError):
    """Raised when a security guard invariant is violated."""

    pass


class RegistrySSRFError(SecurityGuardError):
    """Raised when an image registry attempts SSRF against private or metadata endpoints."""

    pass


class UntrustedRegistryError(SecurityGuardError):
    """Raised when an image registry is not in the trusted registry allowlist."""

    pass


class DecompressionBombError(SecurityGuardError):
    """Raised when an archive exceeds expansion ratio, layer size, or file count limits."""

    pass


class PathTraversalError(SecurityGuardError):
    """Raised when an archive member attempts directory traversal (TarSlip)."""

    pass


def is_private_or_blocked_ip(host_or_ip: str) -> bool:
    """
    Checks if a host or IP is private, loopback, link-local, multicast, or reserved.
    """
    clean_host = host_or_ip.split(":")[0].strip("[]")
    if clean_host.lower() in BLOCKED_HOSTS_AND_IPS:
        return True

    def _check_ip(ip_obj: ipaddress._BaseAddress) -> bool:
        if isinstance(ip_obj, ipaddress.IPv6Address):
            # RFC 6052 Well-Known Prefix for NAT64 (IPv4/IPv6 translation)
            nat64_prefix = ipaddress.IPv6Network("64:ff9b::/96")
            if ip_obj in nat64_prefix:
                embedded_v4 = ipaddress.IPv4Address(int(ip_obj) & 0xFFFFFFFF)
                return (
                    embedded_v4.is_private
                    or embedded_v4.is_loopback
                    or embedded_v4.is_link_local
                    or embedded_v4.is_multicast
                    or embedded_v4.is_reserved
                    or embedded_v4.is_unspecified
                )
        return (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        )

    try:
        ip = ipaddress.ip_address(clean_host)
        return _check_ip(ip)
    except ValueError:
        # Not an IP address literal, resolve hostname safely
        try:
            addr_info = socket.getaddrinfo(clean_host, None)
            for item in addr_info:
                resolved_ip_str = item[4][0]
                resolved_ip = ipaddress.ip_address(resolved_ip_str)
                if _check_ip(resolved_ip):
                    return True
        except (socket.gaierror, Exception):
            pass
        return False


def parse_image_reference(image_ref: str) -> Tuple[Optional[str], str, Optional[str], Optional[str]]:
    """
    Parses a container image reference into: (registry, repository, tag, digest).
    Example:
      'nginx:latest' -> (None, 'nginx', 'latest', None)
      'docker.io/library/nginx:1.21' -> ('docker.io', 'library/nginx', '1.21', None)
      'ghcr.io/org/repo@sha256:abcd...' -> ('ghcr.io', 'org/repo', None, 'sha256:abcd...')
    """
    # Prevent credentials in image reference (e.g. user:pass@host)
    if "@" in image_ref:
        parts = image_ref.split("@")
        # Check if @ precedes sha256 or if it's a URL userinfo attempt
        if not parts[-1].startswith("sha256:"):
            raise SecurityGuardError(f"Credentials or invalid delimiter '@' in image reference: {image_ref}")
        ref_without_digest = parts[0]
        digest = parts[1]
    else:
        ref_without_digest = image_ref
        digest = None

    # Check for tag
    if ":" in ref_without_digest.split("/")[-1]:
        repo_part, tag = ref_without_digest.rsplit(":", 1)
    else:
        repo_part = ref_without_digest
        tag = None

    # Check for registry
    parts = repo_part.split("/")
    if len(parts) > 1 and ("." in parts[0] or ":" in parts[0] or parts[0] == "localhost"):
        registry = parts[0]
        repository = "/".join(parts[1:])
    else:
        registry = None
        repository = repo_part

    return registry, repository, tag, digest


def validate_registry_security(
    image_reference: str,
    allowed_registries: Optional[Set[str]] = None,
    enforce_allowlist: bool = False,
) -> Tuple[str, str]:
    """
    Validates an image reference against:
    1. Embedded credentials or URL schemes (http://, file://, etc.)
    2. Registry SSRF (loopback, private network, cloud metadata service)
    3. Untrusted registry policy
    Returns: (resolved_registry, repository)
    """
    # Reject URL schemes
    if any(
        image_reference.lower().startswith(scheme)
        for scheme in ["http://", "https://", "file://", "ftp://", "gopher://"]
    ):
        raise RegistrySSRFError(f"URL schemes are forbidden in container image references: {image_reference}")

    registry, repo, tag, digest = parse_image_reference(image_reference)
    effective_registry = registry or "docker.io"

    # SSRF Check: Is effective registry a private IP or cloud metadata service?
    if is_private_or_blocked_ip(effective_registry):
        raise RegistrySSRFError(
            f"Blocked Registry SSRF: '{effective_registry}' resolves to a private, loopback, or cloud metadata endpoint."
        )

    # Trust policy check
    trusted = allowed_registries if allowed_registries is not None else DEFAULT_TRUSTED_REGISTRIES
    clean_reg_host = effective_registry.split(":")[0].lower()

    if enforce_allowlist and clean_reg_host not in {r.lower() for r in trusted}:
        raise UntrustedRegistryError(
            f"Untrusted registry '{effective_registry}'. Allowed registries: {', '.join(sorted(trusted))}"
        )

    return effective_registry, repo


def sanitize_config_env(env_list_or_dict: Any) -> Dict[str, str]:
    """
    Sanitizes container environment variables, redacting passwords, secrets, and private keys.
    """
    sanitized: Dict[str, str] = {}

    if isinstance(env_list_or_dict, list):
        for item in env_list_or_dict:
            if not isinstance(item, str) or "=" not in item:
                continue
            key, val = item.split("=", 1)
            sanitized[key] = redact_secret_value(key, val)
    elif isinstance(env_list_or_dict, dict):
        for key, val in env_list_or_dict.items():
            sanitized[str(key)] = redact_secret_value(str(key), str(val))

    return sanitized


def redact_secret_value(key: str, value: str) -> str:
    """
    Redacts the value if the key matches sensitive patterns or looks like a secret.
    """
    for pat in SENSITIVE_KEY_PATTERNS:
        if pat.search(key):
            return "[REDACTED_SECRET]"

    # If raw PEM private key is in value
    if "-----BEGIN" in value and "PRIVATE KEY" in value:
        return "[REDACTED_PRIVATE_KEY]"

    return value


class SafeArchiveExtractor:
    """
    Safely inspects and extracts container layer tarballs preventing:
    - Zip / Tar bombs (decompression bombs via expansion ratio limits)
    - Oversized layers (max layer size limit)
    - Path traversal / TarSlip (members escaping extraction root)
    - Unsafe symlinks / device nodes
    """

    def __init__(
        self,
        max_layer_size_bytes: int = 1024 * 1024 * 1024,  # 1 GB
        max_total_size_bytes: int = 5 * 1024 * 1024 * 1024,  # 5 GB
        max_expansion_ratio: float = 100.0,
        max_files_count: int = 50_000,
    ):
        self.max_layer_size_bytes = max_layer_size_bytes
        self.max_total_size_bytes = max_total_size_bytes
        self.max_expansion_ratio = max_expansion_ratio
        self.max_files_count = max_files_count
        self.total_extracted_bytes = 0

    def inspect_and_extract_layer(self, layer_tar_path: Path, extract_to: Path) -> List[str]:
        """
        Safely inspects and extracts a container layer archive.
        Returns the list of relative file paths extracted.
        """
        if not layer_tar_path.exists():
            raise FileNotFoundError(f"Layer archive not found: {layer_tar_path}")

        compressed_size = layer_tar_path.stat().st_size
        if compressed_size > self.max_layer_size_bytes:
            raise DecompressionBombError(
                f"Layer archive size ({compressed_size} bytes) exceeds limit ({self.max_layer_size_bytes} bytes)."
            )

        extract_to_resolved = extract_to.resolve()
        extract_to_resolved.mkdir(parents=True, exist_ok=True)

        extracted_paths: List[str] = []
        layer_uncompressed_bytes = 0
        file_count = 0

        with tarfile.open(layer_tar_path, mode="r:*") as tar:
            for member in tar:
                file_count += 1
                if file_count > self.max_files_count:
                    raise DecompressionBombError(
                        f"Layer exceeds maximum file count limit ({self.max_files_count} files)."
                    )

                # Path traversal / TarSlip protection
                target_path = (extract_to_resolved / member.name).resolve()
                try:
                    target_path.relative_to(extract_to_resolved)
                except ValueError:
                    raise PathTraversalError(f"Blocked TarSlip path traversal attempt in archive member: {member.name}")

                # Block special device nodes or FIFOs
                if member.isdev() or member.ischr() or member.isblk() or member.isfifo():
                    continue

                # Symlink / Hardlink target validation
                if member.issym() or member.islnk():
                    link_target = (target_path.parent / member.linkname).resolve()
                    try:
                        link_target.relative_to(extract_to_resolved)
                    except ValueError:
                        # Symlink points outside target directory, skip extracting for safety
                        continue

                # Expansion size check
                layer_uncompressed_bytes += member.size
                self.total_extracted_bytes += member.size

                if layer_uncompressed_bytes > self.max_layer_size_bytes:
                    raise DecompressionBombError(
                        f"Decompressed layer size ({layer_uncompressed_bytes} bytes) exceeds limit ({self.max_layer_size_bytes} bytes)."
                    )

                if self.total_extracted_bytes > self.max_total_size_bytes:
                    raise DecompressionBombError(
                        f"Total extracted container size ({self.total_extracted_bytes} bytes) exceeds limit ({self.max_total_size_bytes} bytes)."
                    )

                # Expansion ratio check (protect against zero/tiny compressed files that expand huge)
                if compressed_size > 0:
                    ratio = layer_uncompressed_bytes / compressed_size
                    if ratio > self.max_expansion_ratio and layer_uncompressed_bytes > 10 * 1024 * 1024:
                        raise DecompressionBombError(
                            f"Abnormal decompression expansion ratio {ratio:.1f}:1 exceeds maximum {self.max_expansion_ratio}:1."
                        )

                # Safe extraction of regular files and directories
                if member.isdir():
                    target_path.mkdir(parents=True, exist_ok=True)
                elif member.isreg():
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(target_path, "wb") as f_out:
                        f_in = tar.extractfile(member)
                        if f_in:
                            while chunk := f_in.read(64 * 1024):
                                f_out.write(chunk)

                extracted_paths.append(member.name)

        return extracted_paths
