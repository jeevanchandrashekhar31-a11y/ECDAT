"""
Input Validation & External Data Sanitization Engine — Phase 19 / P1

Comprehensive validator enforcing:
- Strict schemas & unknown field rejection
- Type validation
- Length limits
- Enum validation
- URL validation (SSRF blocklist, scheme allowlist)
- Hostname validation (RFC 1123, forbidden domains)
- IP validation (IPv4/IPv6, private/reserved ranges)
- File validation (path traversal, size limits, extension check)
- MIME validation (executable/dangerous MIME rejection)
- Content validation (JSON structure, CBOM conformance, private key rejection)
- Numeric bounds (finite, non-NaN, integer-only, ranges)
- Pagination bounds (page >= 1, 1 <= pageSize <= 100, offset >= 0)

Never trust frontend validation.
"""

from __future__ import annotations

import ipaddress
import json
import math
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from urllib.parse import urlparse


class InputValidationError(ValueError):
    """Base exception for external input validation failures."""
    pass


class TypeValidationError(InputValidationError):
    """Raised when an external input violates strict type expectations."""
    pass


class BoundsValidationError(InputValidationError):
    """Raised when numeric bounds or pagination bounds are exceeded."""
    pass


class SchemaValidationError(InputValidationError):
    """Raised when an unknown field or schema mismatch is detected in security-sensitive payloads."""
    pass


# ============================================================================
# 1. CANONICAL ENUMS & ALLOWLISTS
# ============================================================================

ALLOWED_ROLES: Set[str] = {
    "viewer",
    "analyst",
    "developer",
    "auditor",
    "admin",
    "security admin",
    "security administrator",
    "platform_admin",
    "platform administrator",
    "secops",
}

ALLOWED_SEVERITIES: Set[str] = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"}

ALLOWED_ASSET_TYPES: Set[str] = {
    "service",
    "database",
    "endpoint",
    "library",
    "hardware",
    "application",
    "component",
    "microservice",
}

ALLOWED_DATA_SENSITIVITIES: Set[str] = {"public", "internal", "confidential", "restricted"}

ALLOWED_BUSINESS_CRITICALITIES: Set[str] = {"low", "medium", "high", "critical"}

ALLOWED_KMS_PROVIDERS: Set[str] = {
    "aws_kms",
    "gcp_kms",
    "azure_keyvault",
    "hashicorp_vault",
    "pkcs11_hsm",
}

ALLOWED_TICKETING_TYPES: Set[str] = {
    "jira",
    "servicenow",
    "github",
    "github_issues",
    "gitlab",
    "gitlab_issues",
    "webhook",
    "generic_webhook",
}

ALLOWED_EXPORT_FORMATS: Set[str] = {"json", "cef", "syslog", "sarif", "cyclonedx", "spdx"}

ALLOWED_UPLOAD_MIMES: Set[str] = {
    "application/json",
    "application/vnd.cyclonedx+json",
    "application/spdx+json",
    "text/plain",
}

ALLOWED_FILE_EXTENSIONS: Set[str] = {".json", ".cdx.json", ".cbom.json", ".spdx.json", ".txt"}

DANGEROUS_MIMES: Set[str] = {
    "application/x-msdownload",
    "application/x-sh",
    "application/x-bat",
    "text/html",
    "application/javascript",
    "text/javascript",
    "application/octet-stream",
}

FORBIDDEN_HOSTNAMES: Set[str] = {
    "localhost",
    "127.0.0.1",
    "::1",
    "metadata.google.internal",
    "169.254.169.254",
    "instance-data",
    "vault.internal",
    "kubernetes.default.svc",
}


# ============================================================================
# 2. PRIMITIVE VALIDATORS (URL, HOSTNAME, IP, NUMERIC, LENGTH, ENUM)
# ============================================================================

def validate_url(
    raw_url: Any,
    require_https: bool = False,
    allow_localhost: bool = False,
    max_length: int = 2048,
) -> str:
    """
    Validates a URL ensuring strict scheme (http/https), valid parsing, and SSRF safety.
    """
    if not isinstance(raw_url, str):
        raise TypeValidationError(f"URL must be a string, got {type(raw_url).__name__}")

    trimmed = raw_url.strip()
    if not trimmed:
        raise InputValidationError("URL cannot be empty")
    if len(trimmed) > max_length:
        raise BoundsValidationError(f"URL exceeds maximum allowed length of {max_length} characters")

    # Reject dangerous pseudo-protocols
    lower = trimmed.lower()
    for proto in ("javascript:", "data:", "vbscript:", "file:", "ftp:", "about:"):
        if lower.startswith(proto):
            raise InputValidationError(f"Dangerous or forbidden URL protocol: {proto}")

    try:
        parsed = urlparse(trimmed)
    except Exception as exc:
        raise InputValidationError(f"Malformed URL: {exc}") from exc

    if parsed.scheme.lower() not in ("http", "https"):
        raise InputValidationError(f"Invalid URL protocol '{parsed.scheme}'. Only HTTP/HTTPS allowed.")

    if require_https and parsed.scheme.lower() != "https":
        raise InputValidationError("HTTPS protocol is strictly required")

    hostname = parsed.hostname
    if not hostname:
        raise InputValidationError("URL must include a valid hostname")

    # Check forbidden hostnames
    if not allow_localhost:
        if hostname.lower() in FORBIDDEN_HOSTNAMES:
            raise InputValidationError(f"SSRF violation: Prohibited destination hostname '{hostname}'")

        # IP check if hostname is an IP literal (including hex/octal/dword obfuscation)
        ip_obj = None
        clean_host = hostname.lower()
        if clean_host.startswith("0x") or re.match(r"^\d+$", clean_host):
            try:
                ip_obj = ipaddress.ip_address(int(clean_host, 0))
            except Exception:
                raise InputValidationError(f"SSRF violation: Prohibited numeric or hex IP destination '{hostname}'")
        elif re.match(r"^[\d\.]+$", clean_host):
            parts = clean_host.split(".")
            if len(parts) == 4 and any(p.startswith("0") and len(p) > 1 for p in parts):
                try:
                    octal_val = sum(int(p, 8) << (8 * (3 - i)) for i, p in enumerate(parts))
                    ip_obj = ipaddress.ip_address(octal_val)
                except Exception:
                    raise InputValidationError(f"SSRF violation: Prohibited octal IP destination '{hostname}'")
            else:
                try:
                    ip_obj = ipaddress.ip_address(hostname)
                except ValueError:
                    pass
        else:
            try:
                ip_obj = ipaddress.ip_address(hostname)
            except ValueError:
                pass  # Normal hostname

        if ip_obj is not None:
            if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_reserved or ip_obj.is_multicast:
                raise InputValidationError(f"SSRF violation: Prohibited private or loopback IP destination '{ip_obj}'")

    return trimmed


def validate_hostname(raw_hostname: Any) -> str:
    """
    Validates an RFC 1123 compliant hostname.
    """
    if not isinstance(raw_hostname, str):
        raise TypeValidationError(f"Hostname must be a string, got {type(raw_hostname).__name__}")

    h = raw_hostname.strip().lower()
    if not h or len(h) > 253:
        raise BoundsValidationError("Hostname length must be between 1 and 253 characters")

    if any(c in h for c in ("\0", " ", "\r", "\n", "\t")):
        raise InputValidationError("Hostname contains illegal whitespace or control characters")

    if h in FORBIDDEN_HOSTNAMES:
        raise InputValidationError(f"Forbidden internal or loopback hostname '{h}'")

    labels = h.split(".")
    for label in labels:
        if not label or len(label) > 63:
            raise BoundsValidationError("Hostname label length must be between 1 and 63 characters")
        if not re.match(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", label):
            raise InputValidationError(f"Invalid hostname label format: '{label}'")

    return h


def validate_ip_address(raw_ip: Any, allow_private: bool = False) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """
    Validates an IPv4 or IPv6 address and enforces public/private boundary checks.
    """
    if not isinstance(raw_ip, str):
        raise TypeValidationError(f"IP address must be a string, got {type(raw_ip).__name__}")

    ip_str = raw_ip.strip()
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError as exc:
        raise InputValidationError(f"Invalid IP address syntax: '{ip_str}'") from exc

    if not allow_private:
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise InputValidationError(f"Prohibited private, loopback, or reserved IP address: '{ip_str}'")

    return ip


def validate_length(value: Any, min_len: int = 0, max_len: int = 255, field_name: str = "field") -> str:
    """
    Validates string length limits.
    """
    if not isinstance(value, str):
        raise TypeValidationError(f"{field_name} must be a string, got {type(value).__name__}")

    length = len(value)
    if length < min_len:
        raise BoundsValidationError(f"{field_name} length ({length}) is less than minimum ({min_len})")
    if length > max_len:
        raise BoundsValidationError(f"{field_name} length ({length}) exceeds maximum ({max_len})")

    return value


def validate_enum(value: Any, allowed_values: Set[str] | List[str], field_name: str = "field") -> str:
    """
    Validates closed enum sets case-insensitively.
    """
    if not isinstance(value, str):
        raise TypeValidationError(f"{field_name} must be a string, got {type(value).__name__}")

    normalized = value.strip().lower()
    allowed_lower = {str(v).strip().lower(): v for v in allowed_values}

    if normalized not in allowed_lower:
        raise InputValidationError(
            f"Invalid value '{value}' for {field_name}. Allowed: {sorted(list(allowed_values))}"
        )

    return allowed_lower[normalized]


def validate_numeric_bounds(
    value: Any,
    min_val: float = float("-inf"),
    max_val: float = float("inf"),
    integer_only: bool = True,
    field_name: str = "number",
) -> Union[int, float]:
    """
    Validates numeric bounds (min, max, integer-only, finite).
    """
    if isinstance(value, bool):
        raise TypeValidationError(f"{field_name} cannot be a boolean")

    try:
        num = float(value)
    except (ValueError, TypeError) as exc:
        raise TypeValidationError(f"{field_name} must be a valid number") from exc

    if math.isnan(num) or math.isinf(num):
        raise BoundsValidationError(f"{field_name} must be a finite number")

    if integer_only:
        if not num.is_integer():
            raise TypeValidationError(f"{field_name} must be an integer")
        int_val = int(num)
        if int_val < min_val:
            raise BoundsValidationError(f"{field_name} ({int_val}) is less than minimum ({min_val})")
        if int_val > max_val:
            raise BoundsValidationError(f"{field_name} ({int_val}) exceeds maximum ({max_val})")
        return int_val

    if num < min_val:
        raise BoundsValidationError(f"{field_name} ({num}) is less than minimum ({min_val})")
    if num > max_val:
        raise BoundsValidationError(f"{field_name} ({num}) exceeds maximum ({max_val})")

    return num


def validate_pagination(query: Dict[str, Any]) -> Dict[str, int]:
    """
    Validates pagination query parameters (page, pageSize/limit, offset).
    """
    page = 1
    page_size = 25
    offset = 0

    if "page" in query and query["page"] is not None:
        page = validate_numeric_bounds(query["page"], min_val=1, max_val=100000, integer_only=True, field_name="page")

    raw_size = query.get("pageSize") if "pageSize" in query else query.get("limit")
    if raw_size is not None:
        page_size = validate_numeric_bounds(raw_size, min_val=1, max_val=100, integer_only=True, field_name="pageSize/limit")

    if "offset" in query and query["offset"] is not None:
        offset = validate_numeric_bounds(query["offset"], min_val=0, max_val=1000000, integer_only=True, field_name="offset")
    else:
        offset = (page - 1) * page_size

    return {"page": page, "pageSize": page_size, "limit": page_size, "offset": offset}


# ============================================================================
# 3. FILE, MIME, AND CONTENT VALIDATORS
# ============================================================================

def validate_file(
    filename: Any,
    content: Optional[bytes] = None,
    mime_type: Optional[str] = None,
    max_size_bytes: int = 10 * 1024 * 1024,
    allowed_extensions: Optional[Set[str]] = None,
    allowed_mimes: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    """
    Validates uploaded or processed files (filename traversal, extensions, MIME, size).
    """
    if not isinstance(filename, str):
        raise TypeValidationError(f"Filename must be a string, got {type(filename).__name__}")

    name = filename.strip()
    if not name:
        raise InputValidationError("Filename cannot be empty")

    # Reject path traversal or illegal characters
    if "\0" in name or ".." in name or "/" in name or "\\" in name:
        raise InputValidationError("Filename contains path traversal sequences or illegal separator characters")

    ext_set = allowed_extensions or ALLOWED_FILE_EXTENSIONS
    _, ext = os.path.splitext(name.lower())
    # Handle composite extensions like .cdx.json
    has_allowed_ext = any(name.lower().endswith(allowed_ext) for allowed_ext in ext_set)
    if not has_allowed_ext:
        raise InputValidationError(f"File extension '{ext}' is not permitted. Allowed: {sorted(list(ext_set))}")

    if mime_type:
        mime = mime_type.strip().lower()
        if mime in DANGEROUS_MIMES:
            raise InputValidationError(f"Dangerous MIME type '{mime}' is prohibited")
        mime_allowed_set = allowed_mimes or ALLOWED_UPLOAD_MIMES
        if mime_allowed_set and mime not in mime_allowed_set and mime != "application/octet-stream":
            raise InputValidationError(f"MIME type '{mime}' is not permitted. Allowed: {sorted(list(mime_allowed_set))}")

    size = len(content) if content is not None else 0
    if content is not None:
        if size <= 0:
            raise InputValidationError("Uploaded file is empty (0 bytes)")
        if size > max_size_bytes:
            raise BoundsValidationError(f"File size ({size} bytes) exceeds maximum limit ({max_size_bytes} bytes)")

    return {"filename": name, "size": size, "mime": mime_type, "extension": ext}


def validate_cbom_content(content: Union[str, bytes]) -> Dict[str, Any]:
    """
    Validates CBOM document syntax, structure, and ensures zero private key leakage.
    """
    if isinstance(content, bytes):
        try:
            content_str = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise InputValidationError("File content is not valid UTF-8 text") from exc
    elif isinstance(content, str):
        content_str = content
    else:
        raise TypeValidationError("Content must be bytes or string")

    trimmed = content_str.strip()
    if not (trimmed.startswith("{") or trimmed.startswith("[")):
        raise InputValidationError("Content does not start with valid JSON object or array syntax")

    # Detect raw private keys in document
    if re.search(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----", trimmed):
        raise InputValidationError("Uploaded document contains raw private key material. Ingestion rejected.")

    try:
        parsed = json.loads(trimmed)
    except json.JSONDecodeError as exc:
        raise InputValidationError(f"JSON syntax error: {exc}") from exc

    if not isinstance(parsed, (dict, list)):
        raise InputValidationError("JSON document must resolve to an object or array")

    return parsed


def validate_strict_schema(
    payload: Any,
    required_fields: List[str],
    allowed_fields: Set[str],
    field_types: Optional[Dict[str, type | Tuple[type, ...]]] = None,
) -> Dict[str, Any]:
    """
    Enforces strict dictionary schema:
    - Rejects unknown fields where security-sensitive (mass-assignment defense)
    - Enforces mandatory fields
    - Enforces expected types
    """
    if not isinstance(payload, dict):
        raise TypeValidationError(f"Payload must be a dictionary/object, got {type(payload).__name__}")

    # Check for unknown fields
    payload_keys = set(payload.keys())
    unknown_keys = payload_keys - allowed_fields
    if unknown_keys:
        raise SchemaValidationError(f"Security violation: Unknown fields {sorted(list(unknown_keys))} are prohibited.")

    # Check required fields
    for req in required_fields:
        if req not in payload:
            raise SchemaValidationError(f"Missing mandatory field: '{req}'")

    if field_types:
        for field, expected_type in field_types.items():
            if field in payload and payload[field] is not None:
                if not isinstance(payload[field], expected_type):
                    type_name = getattr(expected_type, "__name__", str(expected_type))
                    raise TypeValidationError(
                        f"Field '{field}' must be of type {type_name}, got {type(payload[field]).__name__}"
                    )

    return payload


SHELL_METACHARACTERS: Set[str] = set(";|&`$><\n\r\0()\\")


def validate_cli_argument(raw_arg: Any, max_length: int = 255, field_name: str = "CLI argument") -> str:
    """
    Validates CLI parameters and target identifiers, strictly blocking command injection metacharacters.
    """
    if not isinstance(raw_arg, str):
        raise TypeValidationError(f"{field_name} must be a string, got {type(raw_arg).__name__}")

    trimmed = raw_arg.strip()
    if not trimmed:
        raise InputValidationError(f"{field_name} cannot be empty")

    if len(trimmed) > max_length:
        raise BoundsValidationError(f"{field_name} exceeds maximum length of {max_length} characters")

    for char in SHELL_METACHARACTERS:
        if char in trimmed:
            raise InputValidationError(
                f"Command injection violation: Prohibited shell metacharacter '{char}' in {field_name}"
            )

    return trimmed
