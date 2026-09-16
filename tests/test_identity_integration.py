"""
Unit tests for Enterprise Identity & Directory Integration (Phase 14.2).

Verifies:
- Standards-based identity verification
- Short-lived token validation
- Zero password storage & leakage
- Secret rotation
- Authentication event audit logging & tamper-chain integrity
"""

import base64
import hashlib
import hmac
import json
import time
import pytest

from scanners.identity.token_verifier import TokenVerifier, base64url_decode
from scanners.identity.auth_audit import AuthAuditLogger


def make_jwt(payload, secret, kid="k1", alg="HS256"):
    header = {"alg": alg, "typ": "JWT", "kid": kid}

    def b64url(d):
        raw = json.dumps(d).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    h_b64 = b64url(header)
    p_b64 = b64url(payload)
    sig_input = f"{h_b64}.{p_b64}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), sig_input, hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
    return f"{h_b64}.{p_b64}.{s_b64}"


def test_token_verifier_validates_short_lived_token():
    """TokenVerifier validates valid short-lived tokens and rejects expired tokens."""
    secret = "my-secret-key-12345"
    now = int(time.time())

    verifier = TokenVerifier(
        issuer="https://ecdat.internal/auth",
        audience="ecdat-api",
        secret_keys={"k1": secret},
    )

    # 1. Valid short-lived token (15 minutes)
    payload = {
        "sub": "user_42",
        "email": "dev@corp.com",
        "roles": ["secops"],
        "iss": "https://ecdat.internal/auth",
        "aud": "ecdat-api",
        "iat": now,
        "exp": now + 900,
    }
    token = make_jwt(payload, secret, kid="k1")
    verified = verifier.verify_token(token)
    assert verified["sub"] == "user_42"
    assert verified["roles"] == ["secops"]
    assert verified["_unverified"] is False

    # 2. Expired token is rejected
    expired_payload = dict(payload)
    expired_payload["exp"] = now - 10
    expired_token = make_jwt(expired_payload, secret, kid="k1")
    with pytest.raises(ValueError) as exc:
        verifier.verify_token(expired_token)
    assert "expired" in str(exc.value).lower()

    # 3. Invalid signature is rejected
    bad_sig_token = token[:-4] + "xxxx"
    with pytest.raises(ValueError) as exc:
        verifier.verify_token(bad_sig_token)
    assert "signature verification failed" in str(exc.value).lower()

    # 4. Audience mismatch is rejected
    aud_payload = dict(payload)
    aud_payload["aud"] = "wrong-api"
    aud_token = make_jwt(aud_payload, secret, kid="k1")
    with pytest.raises(ValueError) as exc:
        verifier.verify_token(aud_token)
    assert "audience mismatch" in str(exc.value).lower()


def test_auth_audit_logger_chain_and_zero_secret_leakage():
    """AuthAuditLogger must maintain tamper-evident hash chain and redact secrets."""
    logger = AuthAuditLogger()

    # Log events
    logger.log_event(
        event_type="AUTH_SUCCESS",
        user_id="alice",
        provider="oidc",
        metadata={
            "scope": "openid email",
            "user_password": "super-secret-password-123",  # Must be redacted
            "client_secret": "raw-client-secret-xyz",        # Must be redacted
            "auth_token": "bearer-token-abc",              # Must be redacted
            "safe_attribute": "department_secops",
        },
    )

    logger.log_event(
        event_type="SECRET_ROTATED",
        user_id="admin",
        provider="secret_manager",
        metadata={"keyType": "jwt_signing", "newKid": "key_2"},
    )

    # Verify chain integrity
    integrity = logger.verify_chain_integrity()
    assert integrity["valid"] is True
    assert integrity["totalEvents"] == 2

    # Verify zero secret leakage: password and secrets redacted
    first_event = logger.events[0]
    meta = first_event["metadata"]
    assert meta["user_password"] == "[REDACTED]"
    assert meta["client_secret"] == "[REDACTED]"
    assert meta["auth_token"] == "[REDACTED]"
    assert meta["safe_attribute"] == "department_secops"

    # Tampering with any entry breaks the hash chain
    logger.events[0]["userId"] = "mallory"
    tampered_integrity = logger.verify_chain_integrity()
    assert tampered_integrity["valid"] is False
    assert "mismatch" in tampered_integrity["error"].lower() or "broken" in tampered_integrity["error"].lower()
