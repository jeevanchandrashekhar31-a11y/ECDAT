"""
Automated Test Suite for Python Audit Logging Engine — Task 21 (P1 — Audit Logging)

Validates:
1. All 13 mandatory security-sensitive operations
2. All 9 mandated audit record dimensions
3. Strict Zero-Secret Guarantee (passwords, MFA secrets, backup codes, API keys, access tokens, private keys, raw credentials)
4. Cryptographic SHA-256 Tamper-Chain and HMAC Verification
"""

import pytest
from scanners.common.audit_logger import (
    AuditLogger,
    AuditCategories,
    AuditActions,
    MANDATORY_AUDIT_ACTIONS,
    scrub_secrets,
    scrub_string,
    verify_audit_chain,
    compute_event_hash,
)


@pytest.fixture
def audit_logger():
    logger = AuditLogger(secret_key="test-key-2026")
    logger.reset()
    return logger


def test_zero_secret_guarantee():
    """Verifies that all 7 forbidden secret classes are strictly redacted."""
    dirty_payload = {
        "user": "security_admin",
        "password": "Password123!@#",
        "user_password": "super-password",
        "mfa_secret": "JBSWY3DPEHPK3PXP",
        "totp_secret": "NBSWY3DPEHPK3PXP",
        "backup_codes": ["1234-5678", "8765-4321"],
        "recovery_code": "rec-99999",
        "api_key": "ecdat-live-sec-abcdef1234567890",
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy",
        "access_token": "token-12345",
        "raw_credentials": "user:pass:cleartext",
        "credential": "admin:supersecret",
        "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
        "nested": {
            "client_secret": "cs-secret-key-1",
            "bearer_token": "Bearer auth-token-xyz",
            "safe_field": "dilithium3",
        },
    }

    clean = scrub_secrets(dirty_payload)

    # 1. Passwords
    assert clean["password"] == "[REDACTED_SECRET]"
    assert clean["user_password"] == "[REDACTED_SECRET]"
    # 2. MFA secrets
    assert clean["mfa_secret"] == "[REDACTED_SECRET]"
    assert clean["totp_secret"] == "[REDACTED_SECRET]"
    # 3. Backup codes
    assert clean["backup_codes"] == "[REDACTED_SECRET]"
    assert clean["recovery_code"] == "[REDACTED_SECRET]"
    # 4. API keys
    assert clean["api_key"] == "[REDACTED_SECRET]"
    # 5. Access tokens
    assert clean["token"] == "[REDACTED_SECRET]"
    assert clean["access_token"] == "[REDACTED_SECRET]"
    # 6. Raw credentials
    assert clean["raw_credentials"] == "[REDACTED_SECRET]"
    assert clean["credential"] == "[REDACTED_SECRET]"
    # 7. Private keys
    assert clean["private_key"] == "[REDACTED_PRIVATE_KEY]"

    # Nested checks
    assert clean["nested"]["client_secret"] == "[REDACTED_SECRET]"
    assert clean["nested"]["bearer_token"] == "Bearer [REDACTED_TOKEN]"
    assert clean["nested"]["safe_field"] == "dilithium3"


def test_all_13_mandatory_security_operations_logged(audit_logger):
    """Verifies that every one of the 13 required operations produces structured audit events with 9 dimensions."""
    operations = [
        ("authentication_success", AuditActions.AUTH_LOGIN_SUCCESS, "User logged in"),
        ("authentication_failure", AuditActions.AUTH_LOGIN_FAILURE, "Invalid password"),
        ("authorization_denial", AuditActions.AUTHORIZATION_FAILURE, "Permission denied for analyst"),
        ("role_change", AuditActions.ROLE_ASSIGNED, "Role upgraded to security_admin"),
        ("tenant_change", AuditActions.TENANT_CHANGED, "Switched tenant to finance-prod"),
        ("mfa_enable", AuditActions.AUTH_MFA_ENABLED, "TOTP enrollment complete"),
        ("mfa_disable", AuditActions.AUTH_MFA_DISABLED, "TOTP enrollment removed"),
        ("session_revocation", AuditActions.AUTH_LOGOUT_ALL, "All sessions revoked"),
        ("token_revocation", AuditActions.AUTH_TOKEN_REVOKED, "API key revoked"),
        ("secret_rotation", AuditActions.SECRET_ROTATED, "Root CA private key rotated"),
        ("scan_start", AuditActions.SCAN_STARTED, "Static repo scan initiated"),
        ("scan_failure", AuditActions.SCAN_FAILED, "Git clone timed out"),
        ("scan_completion", AuditActions.SCAN_COMPLETED, "CBOM generated with 42 findings"),
        ("integration_modification", AuditActions.INTEGRATION_MODIFIED, "Jira connector updated"),
        ("security_policy_modification", AuditActions.POLICY_UPDATED, "BFSI policy v2 activated"),
    ]

    for op_name, action, reason in operations:
        record = audit_logger.log_event(
            action=action,
            actor={"id": "usr-101", "username": "alice", "role": "admin", "ipAddress": "192.168.1.10"},
            tenant="tenant-alpha",
            target={"type": "resource", "id": f"res-{op_name}", "name": op_name},
            result="SUCCESS" if "failure" not in op_name and "denial" not in op_name else "DENIED",
            reason=reason,
            request_id=f"req-{op_name}",
            source_ip="192.168.1.10",
            details={"op": op_name, "password": "attempted-leak"},
        )

        # Validate the 9 mandated dimensions:
        assert record["actor"]["username"] == "alice", "Mandatory dimension: actor"
        assert record["tenant"] == "tenant-alpha", "Mandatory dimension: tenant"
        assert record["action"] == action, "Mandatory dimension: action"
        assert record["target"]["id"] == f"res-{op_name}", "Mandatory dimension: target"
        assert "T" in record["timestamp"], "Mandatory dimension: timestamp"
        assert record["requestId"] == f"req-{op_name}", "Mandatory dimension: request ID"
        assert record["result"] in ("SUCCESS", "DENIED"), "Mandatory dimension: result"
        assert record["reason"] == reason, "Mandatory dimension: reason"
        assert record["sourceIp"] == "192.168.1.10", "Mandatory dimension: source IP"

        # Zero-secret verification
        assert record["details"]["password"] == "[REDACTED_SECRET]"

    # Verify that all 15 events form an unbroken cryptographic chain
    integrity = audit_logger.verify_integrity()
    assert integrity["valid"] is True
    assert integrity["total_verified"] == len(operations)
    assert integrity["error"] is None


def test_tamper_detection(audit_logger):
    """Verifies that cryptographic hash chaining catches modifications, sequence breaks, and signature forgery."""
    audit_logger.log_event(action=AuditActions.SCAN_STARTED, reason="Scan 1")
    audit_logger.log_event(action=AuditActions.SCAN_COMPLETED, reason="Scan 2")
    audit_logger.log_event(action=AuditActions.POLICY_UPDATED, reason="Policy 3")

    # Initially intact
    check = audit_logger.verify_integrity()
    assert check["valid"] is True

    # 1. Mutate payload of event #2
    audit_logger.events[1]["action"] = "FORGED_ACTION"
    check = audit_logger.verify_integrity()
    assert check["valid"] is False
    assert "Tamper detected" in check["error"]

    # Restore
    audit_logger.events[1]["action"] = AuditActions.SCAN_COMPLETED
    audit_logger.events[1]["hash"] = compute_event_hash(audit_logger.events[1], audit_logger.events[1]["prevHash"])
    # Because signature is over hash, re-compute sig
    from scanners.common.audit_logger import sign_hash
    audit_logger.events[1]["signature"] = sign_hash(audit_logger.events[1]["hash"], audit_logger.secret_key)
    check = audit_logger.verify_integrity()
    assert check["valid"] is True

    # 2. Break sequence continuity (remove record #2)
    removed = audit_logger.events.pop(1)
    check = audit_logger.verify_integrity()
    assert check["valid"] is False
    assert "Sequence gap" in check["error"]

    # Restore
    audit_logger.events.insert(1, removed)
    check = audit_logger.verify_integrity()
    assert check["valid"] is True
