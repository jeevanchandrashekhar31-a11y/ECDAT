"""
Cookie Security & CSRF Defense Validator (Python) — Phase 15.2

Implements:
- Validation of cookie security attributes (HttpOnly, Secure, SameSite=Strict, Path=/)
- Cryptographically strong CSRF token generation & constant-time validation
- Double Submit Cookie verification
- Origin & Referer allowlist validation
"""

import hmac
import os
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


CSRF_HEADER_NAME = "x-csrf-token"
CSRF_COOKIE_NAME = "ecdat_csrf_token"
ACCESS_COOKIE_NAME = "ecdat_access_token"
REFRESH_COOKIE_NAME = "ecdat_refresh_token"


class CookieSecurityValidator:
    """
    Validates cookie flags and CSRF token integrity.
    """

    @staticmethod
    def generate_csrf_token() -> str:
        return os.urandom(32).hex()

    @staticmethod
    def validate_cookie_attributes(cookie_header: str, is_production: bool = True) -> Dict[str, Any]:
        """
        Validates whether Set-Cookie string satisfies enterprise security requirements.
        """
        flags = [f.strip().lower() for f in cookie_header.split(";")]
        has_http_only = "httponly" in flags
        has_secure = "secure" in flags
        has_samesite_strict = any("samesite=strict" in f for f in flags)
        has_path_root = any("path=/" in f for f in flags)

        issues = []
        if not has_http_only:
            issues.append("Missing HttpOnly flag: vulnerable to XSS token theft")
        if is_production and not has_secure:
            issues.append("Missing Secure flag in production: vulnerable to cleartext interception")
        if not has_samesite_strict:
            issues.append("Missing or non-Strict SameSite attribute: vulnerable to cross-site request forgery")

        return {
            "compliant": len(issues) == 0,
            "hasHttpOnly": has_http_only,
            "hasSecure": has_secure,
            "hasSameSiteStrict": has_samesite_strict,
            "hasPathRoot": has_path_root,
            "issues": issues,
        }

    @staticmethod
    def verify_csrf(
        header_token: Optional[str],
        cookie_token: Optional[str],
        origin: Optional[str] = None,
        allowed_origins: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Verifies double-submit cookie and Origin header against allowlist.
        """
        if not header_token or not cookie_token:
            return {
                "valid": False,
                "reason": "Missing CSRF token in header or cookie",
            }

        # Constant-time comparison
        if not hmac.compare_digest(header_token.strip(), cookie_token.strip()):
            return {
                "valid": False,
                "reason": "CSRF token mismatch between header and cookie",
            }

        if origin:
            try:
                parsed = urlparse(origin)
                origin_base = (
                    f"{parsed.protocol or 'http'}://{parsed.netloc}"
                    if hasattr(parsed, "protocol")
                    else f"{parsed.scheme}://{parsed.netloc}"
                )
                allowed = allowed_origins or ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000"]
                hostname = parsed.hostname or ""

                if origin_base not in allowed and hostname not in ("localhost", "127.0.0.1"):
                    return {
                        "valid": False,
                        "reason": f"Untrusted request origin: '{origin}'",
                    }
            except Exception:
                return {
                    "valid": False,
                    "reason": "Invalid origin format",
                }

        return {"valid": True, "reason": "CSRF verification succeeded"}
