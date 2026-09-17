"""
OWASP API Security & Hardening Module (Python) — Phase 15.1

Provides validation, sanitization, and security invariant checks:
- SSRF defense (private IP, cloud metadata, scheme verification)
- Path traversal defense (null byte rejection, base directory confinement)
- Injection defense (SQL, NoSQL, OS command, prototype pollution)
- BOPLA & Mass Assignment protection
- BOLA / IDOR object-level and tenant-level authorization
- Excessive data exposure sanitization
"""

import os
import re
import ipaddress
import urllib.parse
from typing import Dict, Any, Optional, Tuple, List, Set

PROTOTYPE_POLLUTION_KEYS = frozenset({"__proto__", "constructor", "prototype"})

DANGEROUS_NOSQL_KEYS = frozenset(
    {
        "$where",
        "$gt",
        "$gte",
        "$lt",
        "$lte",
        "$ne",
        "$in",
        "$nin",
        "$regex",
        "$expr",
        "$function",
    }
)

SQLI_PATTERNS = [
    re.compile(r"(\b(UNION(\s+ALL)?)\b\s+SELECT\b)", re.IGNORECASE),
    re.compile(r"(\bDROP\b\s+(TABLE|DATABASE|VIEW)\b)", re.IGNORECASE),
    re.compile(r"(\bDELETE\b\s+FROM\b\s+\w+\s+WHERE\b)", re.IGNORECASE),
    re.compile(r"(\bINSERT\b\s+INTO\b\s+\w+.*VALUES\b)", re.IGNORECASE),
    re.compile(r"(\bOR\b\s+['\"]?(\d+|true)['\"]?\s*=\s*['\"]?\2['\"]?)", re.IGNORECASE),
    re.compile(r"(\bOR\b\s+'[^']+'\s*=\s*'[^']+)", re.IGNORECASE),
    re.compile(r"(;\s*--)"),
    re.compile(r"(\bSLEEP\s*\(\s*\d+\s*\))", re.IGNORECASE),
]

COMMAND_INJECTION_PATTERNS = [
    re.compile(
        r"[;&|`$]\s*(cat|rm|wget|curl|nc|bash|sh|powershell|cmd\.exe|netcat|whoami|id|uname|dir|ls)\b", re.IGNORECASE
    ),
    re.compile(r"\$\((?:whoami|id|uname|dir|ls|cat|rm|wget|curl|[^\)]+)\)", re.IGNORECASE),
    re.compile(r"`\s*(?:whoami|id|uname|dir|ls|cat|rm|wget|curl|[^`]+)\s*`", re.IGNORECASE),
]

FORBIDDEN_HOSTNAMES = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "metadata.google.internal",
        "instance-data",
        "169.254.169.254",
    }
)

DEFAULT_BLOCKED_MASS_ASSIGNMENT_FIELDS = frozenset(
    {
        "role",
        "roles",
        "isadmin",
        "admin",
        "tenantid",
        "tenant_id",
        "permissions",
        "isverified",
        "verified",
        "internalhash",
        "ownerid",
        "owner_id",
    }
)

SENSITIVE_RESPONSE_FIELDS = frozenset(
    {
        "password",
        "secret",
        "privatekey",
        "private_key",
        "secretbytes",
        "secret_bytes",
        "privatekeybytes",
        "rawkey",
        "d",
        "p",
        "q",
        "dp",
        "dq",
        "qi",
        "seed",
        "internaltoken",
    }
)

EXEMPT_CODE_FIELDS = frozenset(
    {
        "evidence",
        "diff",
        "unifieddiff",
        "patchcontent",
        "sourcecode",
        "rawcontent",
        "rawmetadata",
        "code",
        "annotatedbom",
        "components",
        "cbom",
    }
)


def is_private_ip(ip_str: str) -> bool:
    """Checks whether an IP address belongs to private or loopback ranges."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return False


def validate_safe_url(
    raw_url: str, allowed_protocols=("http", "https"), allow_localhost: bool = False
) -> Tuple[bool, Optional[str]]:
    """Validates an outbound target URL against SSRF attacks."""
    if not raw_url or not isinstance(raw_url, str):
        return False, "URL must be a non-empty string"

    try:
        parsed = urllib.parse.urlparse(raw_url.strip())
    except Exception:
        return False, "Malformed URL format"

    scheme = parsed.scheme.lower()
    if scheme not in allowed_protocols:
        return False, f"Protocol '{scheme}' is not permitted. Allowed: {', '.join(allowed_protocols)}"

    if parsed.username or parsed.password:
        return False, "Embedded credentials in URLs are prohibited"

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False, "URL missing valid hostname"

    if not allow_localhost and hostname in FORBIDDEN_HOSTNAMES:
        return False, f"Hostname '{hostname}' is a forbidden target"

    if not allow_localhost and is_private_ip(hostname):
        return False, f"IP address '{hostname}' belongs to a private/link-local network"

    return True, None


def validate_safe_path(input_path: str, base_dir: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Validates a path against Path Traversal attacks, ensuring it stays within base_dir."""
    if not input_path or not isinstance(input_path, str):
        return False, None, "Path must be a non-empty string"

    if "\0" in input_path or "%00" in input_path:
        return False, None, "Null byte injection detected in path"

    if ".." in input_path or "%2e%2e" in input_path.lower():
        return False, None, "Directory traversal token ('..') detected in path"

    root = os.path.abspath(base_dir)
    resolved = os.path.abspath(os.path.join(root, input_path))

    if not resolved.startswith(root + os.sep) and resolved != root:
        return False, None, "Resolved path escapes base directory boundary"

    return True, resolved, None


def inspect_for_injection(value: Any, current_path: str = "") -> Optional[Dict[str, Any]]:
    """Recursively checks for SQL, NoSQL, OS command, and prototype pollution injection."""
    if value is None:
        return None

    if isinstance(value, dict):
        for k, v in value.items():
            lower_k = str(k).lower()
            if lower_k in PROTOTYPE_POLLUTION_KEYS:
                return {
                    "type": "PROTOTYPE_POLLUTION",
                    "path": f"{current_path}.{k}" if current_path else str(k),
                    "message": f"Attempted prototype pollution via key '{k}'",
                }
            if str(k) in DANGEROUS_NOSQL_KEYS:
                return {
                    "type": "NOSQL_INJECTION",
                    "path": f"{current_path}.{k}" if current_path else str(k),
                    "message": f"Forbidden NoSQL operator '{k}' detected",
                }

            normalized_leaf = lower_k.replace("-", "").replace("_", "")
            if normalized_leaf not in EXEMPT_CODE_FIELDS:
                res = inspect_for_injection(v, f"{current_path}.{k}" if current_path else str(k))
                if res:
                    return res
        return None

    if isinstance(value, (list, tuple)):
        for idx, item in enumerate(value):
            res = inspect_for_injection(item, f"{current_path}[{idx}]")
            if res:
                return res
        return None

    if isinstance(value, str):
        if len(value) > 2000 and " " not in value:
            return None

        for pat in SQLI_PATTERNS:
            if pat.search(value):
                return {
                    "type": "SQL_INJECTION",
                    "path": current_path,
                    "message": "SQL injection pattern detected in input value",
                }

        for pat in COMMAND_INJECTION_PATTERNS:
            if pat.search(value):
                return {
                    "type": "COMMAND_INJECTION",
                    "path": current_path,
                    "message": "OS command injection pattern detected in input value",
                }

    return None


def sanitize_response_data(obj: Any) -> Any:
    """Recursively redacts sensitive cryptographic material and credentials."""
    if not isinstance(obj, dict):
        if isinstance(obj, list):
            return [sanitize_response_data(item) for item in obj]
        return obj

    cleaned = {}
    for k, v in obj.items():
        normalized = str(k).lower().replace("-", "").replace("_", "")
        if normalized in SENSITIVE_RESPONSE_FIELDS:
            cleaned[k] = "[REDACTED_SENSITIVE_DATA]"
        elif isinstance(v, (dict, list)):
            cleaned[k] = sanitize_response_data(v)
        else:
            cleaned[k] = v
    return cleaned


def validate_mass_assignment(
    data: Dict[str, Any],
    blocked_fields: Set[str] = DEFAULT_BLOCKED_MASS_ASSIGNMENT_FIELDS,
    is_admin: bool = False,
) -> Tuple[bool, List[str]]:
    """Checks whether non-admin request attempts to mutate protected fields."""
    if is_admin or not isinstance(data, dict):
        return True, []

    violations = []
    for k in data.keys():
        norm = str(k).lower().replace("-", "").replace("_", "")
        if norm in blocked_fields:
            violations.append(str(k))

    return len(violations) == 0, violations


def validate_object_authorization(
    caller_user_id: Optional[str],
    caller_tenant_id: Optional[str],
    resource_owner_id: Optional[str],
    resource_tenant_id: Optional[str],
    is_admin: bool = False,
) -> Tuple[bool, Optional[str]]:
    """Evaluates Object-Level Authorization (BOLA/IDOR) and tenant boundary."""
    if is_admin:
        return True, None

    if resource_tenant_id and caller_tenant_id and resource_tenant_id != caller_tenant_id:
        return False, "TENANT_ACCESS_DENIED: Cross-tenant access to this resource is prohibited"

    if resource_owner_id and caller_user_id and resource_owner_id != caller_user_id:
        return False, "OBJECT_AUTHORIZATION_FAILED: You do not have authorization to view or mutate this object"

    return True, None
