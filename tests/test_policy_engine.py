"""
Unit and Integration Tests for ECDAT Policy-as-Code Engine (Phase 11.1).
"""

import pytest
from datetime import datetime, timezone
from scanners.policy_engine import (
    PolicyEngine,
    PolicyValidationError,
    DEFAULT_POLICY_PATH,
)


@pytest.fixture
def engine():
    return PolicyEngine()


def test_schema_validation_accepts_valid_policy(engine):
    policy = engine.load_policy(DEFAULT_POLICY_PATH)
    assert policy["id"] == "ecdat:policy:enterprise-master-v1"
    assert len(policy["rules"]) >= 5


def test_schema_validation_rejects_malformed_policy(engine):
    invalid_policy = {
        "id": "bad-policy",
        # missing version, name, rules
    }
    valid, errors = engine.validate_policy(invalid_policy)
    assert valid is False
    assert len(errors) > 0


def test_evaluates_prohibited_algorithms(engine):
    vulnerable_assets = [
        {"asset_id": "legacy-hash", "algorithm": "MD5", "type": "digest"},
        {"asset_id": "sha1-cert", "algorithm": "SHA-1", "type": "certificate"},
        {"asset_id": "modern-aes", "algorithm": "AES-256-GCM", "type": "cipher"},
    ]

    result = engine.evaluate(vulnerable_assets)
    assert result["verdict"] == "BLOCK"
    assert result["metrics"]["counts_by_verdict"]["BLOCK"] == 2
    assert result["metrics"]["counts_by_verdict"]["ALLOW"] == 1

    md5_res = next(a for a in result["assets"] if a["asset_id"] == "legacy-hash")
    assert md5_res["verdict"] == "BLOCK"
    assert any("prohibited" in r["reasons"][0].lower() for r in md5_res["rule_results"])


def test_evaluates_key_sizes(engine):
    key_assets = [
        {"asset_id": "weak-rsa", "algorithm": "RSA", "key_size": 1024, "type": "key", "environment": "production"},
        {"asset_id": "strong-rsa", "algorithm": "RSA", "key_size": 2048, "type": "key", "environment": "production", "is_quantum_safe": True, "is_hybrid": True},
    ]

    result = engine.evaluate(key_assets)
    weak_rsa = next(a for a in result["assets"] if a["asset_id"] == "weak-rsa")
    strong_rsa = next(a for a in result["assets"] if a["asset_id"] == "strong-rsa")

    assert weak_rsa["verdict"] == "BLOCK"
    assert any("below minimum" in r["reasons"][0].lower() for r in weak_rsa["rule_results"])
    assert strong_rsa["verdict"] == "ALLOW"


def test_evaluates_protocols_and_ciphers(engine):
    proto_assets = [
        {"asset_id": "legacy-web", "protocol": "TLS 1.0", "type": "protocol", "environment": "production"},
        {"asset_id": "modern-tls", "protocol": "TLS 1.3", "cipher_suite": "TLS_AES_256_GCM_SHA384", "type": "protocol", "environment": "production"},
    ]

    result = engine.evaluate(proto_assets)
    legacy = next(a for a in result["assets"] if a["asset_id"] == "legacy-web")
    modern = next(a for a in result["assets"] if a["asset_id"] == "modern-tls")

    assert legacy["verdict"] == "BLOCK"
    assert modern["verdict"] == "ALLOW"


def test_evaluates_certificates_self_signed_and_validity(engine):
    cert_assets = [
        {
            "asset_id": "self-signed-prod",
            "type": "certificate",
            "is_self_signed": True,
            "environment": "production",
        },
        {
            "asset_id": "long-validity-cert",
            "type": "certificate",
            "is_self_signed": False,
            "validity_days": 800,
            "environment": "production",
        },
    ]

    result = engine.evaluate(cert_assets)
    self_signed = next(a for a in result["assets"] if a["asset_id"] == "self-signed-prod")
    assert self_signed["verdict"] == "BLOCK"


def test_precedence_active_exception_converts_block_to_exception(engine):
    # Asset configured with approved active exception in default policy:
    # "legacy-mainframe-connector" with rule "RULE-KEY-RSA-001"
    excepted_asset = [
        {
            "asset_id": "legacy-mainframe-connector",
            "name": "IBM Mainframe Link",
            "algorithm": "RSA",
            "key_size": 1024,
            "environment": "production",
            "application": "core-banking",
            "business_unit": "retail_banking",
            "type": "key",
        }
    ]

    context = {"evaluation_date": "2026-06-01T00:00:00Z"}
    result = engine.evaluate(excepted_asset, context=context)

    # Precedence: the raw BLOCK is overridden by active approved exception -> EXCEPTION
    assert result["verdict"] == "EXCEPTION"
    assert result["passed"] is True
    assert len(result["applied_exceptions"]) >= 1
    assert any(e["exception_id"] == "EXC-2026-LEGACY-MAINFRAME-001" for e in result["applied_exceptions"])


def test_precedence_expired_exception_fails_to_override_and_blocks(engine):
    # Asset with an expired exception:
    # "historical-checksum-archive" has exception expired 2025-12-31
    expired_asset = [
        {
            "asset_id": "historical-checksum-archive",
            "algorithm": "MD5",
            "type": "digest",
            "environment": "production",
            "application": "doc-archive",
            "business_unit": "operations",
        }
    ]

    context = {"evaluation_date": "2026-06-01T00:00:00Z"}
    result = engine.evaluate(expired_asset, context=context)

    # Precedence: expired exception does NOT override -> BLOCK
    assert result["verdict"] == "BLOCK"
    assert result["passed"] is False
    assert len(result["expired_exceptions"]) >= 1


def test_deadlines_escalate_from_warn_to_block(engine):
    # CNSA 2.0 PQC rule: Deprecation date 2026-01-01, Enforcement date 2030-01-01
    classical_asset = [
        {
            "asset_id": "classical-ssh",
            "algorithm": "RSA-3072",
            "type": "asymmetric_key",
            "is_quantum_safe": False,
            "is_hybrid": False,
            "environment": "production",
        }
    ]

    # In 2027 (before 2030 enforcement): WARN
    res_2027 = engine.evaluate(classical_asset, context={"evaluation_date": "2027-01-01T00:00:00Z"})
    assert res_2027["verdict"] == "WARN"
    assert res_2027["passed"] is True

    # In 2031 (after 2030 enforcement): BLOCK
    res_2031 = engine.evaluate(classical_asset, context={"evaluation_date": "2031-01-01T00:00:00Z"})
    assert res_2031["verdict"] == "BLOCK"
    assert res_2031["passed"] is False


def test_deterministic_evaluation_reproducibility(engine):
    assets = [
        {"asset_id": "b-asset", "algorithm": "SHA-256", "type": "digest"},
        {"asset_id": "a-asset", "algorithm": "MD5", "type": "digest"},
    ]
    context = {"evaluation_date": "2026-09-01T12:00:00Z"}

    res1 = engine.evaluate(assets, context=context)
    res2 = engine.evaluate(assets, context=context)

    assert res1["audit_digest"] == res2["audit_digest"]
    assert res1["verdict"] == res2["verdict"]
    assert res1["metrics"] == res2["metrics"]
