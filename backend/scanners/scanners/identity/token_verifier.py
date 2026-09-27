"""
Token Verifier (Python) — Phase 14.2

Verifies short-lived OIDC and ECDAT tokens locally or against identity provider keys.
Supports short-lived token invariants and zero password storage.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, List, Optional


def base64url_decode(input_str: str) -> bytes:
    rem = len(input_str) % 4
    if rem > 0:
        input_str += "=" * (4 - rem)
    return base64.urlsafe_b64decode(input_str)


class TokenVerifier:
    def __init__(
        self,
        issuer: str = "https://ecdat.internal/auth",
        audience: str = "ecdat-api",
        secret_keys: Optional[Dict[str, str]] = None,
    ):
        self.issuer = issuer
        self.audience = audience
        self.secret_keys = dict(secret_keys or {})

    def add_key(self, kid: str, secret: str) -> None:
        self.secret_keys[kid] = secret

    def verify_token(self, token_str: str, default_secret: Optional[str] = None) -> Dict[str, Any]:
        if not token_str or not isinstance(token_str, str):
            raise ValueError("Invalid token string")

        parts = token_str.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed JWT token: expected 3 segments")

        header_b64, payload_b64, sig_b64 = parts

        header = json.loads(base64url_decode(header_b64).decode("utf-8"))
        payload = json.loads(base64url_decode(payload_b64).decode("utf-8"))

        # 1. Check expiration
        now = int(time.time())
        exp = payload.get("exp")
        if exp and now >= exp:
            raise ValueError(f"Token expired at {exp} (current time: {now})")

        nbf = payload.get("nbf")
        if nbf and now < nbf:
            raise ValueError(f"Token not valid before {nbf} (current time: {now})")

        # 2. Check audience and issuer if configured
        if self.issuer and payload.get("iss") and payload.get("iss") != self.issuer:
            raise ValueError(f"Issuer mismatch: expected '{self.issuer}', got '{payload.get('iss')}'")

        if self.audience and payload.get("aud") and payload.get("aud") != self.audience:
            raise ValueError(f"Audience mismatch: expected '{self.audience}', got '{payload.get('aud')}'")

        # 3. Verify HMAC signature
        kid = header.get("kid", "")
        secret = self.secret_keys.get(kid) or default_secret
        if not secret:
            # If no secret available, return payload with unverified status
            payload["_unverified"] = True
            return payload

        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        computed_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        actual_sig = base64url_decode(sig_b64)

        if not hmac.compare_digest(computed_sig, actual_sig):
            raise ValueError("Token signature verification failed")

        payload["_unverified"] = False
        return payload
