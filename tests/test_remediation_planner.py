"""
Unit Tests for ECDAT Safe Remediation Engine — Remediation Planner (Phase 12.1).
"""

import pytest
from scanners.remediation_planner import (
    RemediationPlanner,
    derive_why_it_matters,
    derive_recommended_remediation,
    build_migration_options,
    derive_expected_impact,
    derive_dependencies,
    derive_testing_plan,
    derive_rollback_plan,
    derive_confidence,
)


@pytest.fixture
def planner():
    return RemediationPlanner()


def test_default_to_dry_run(planner):
    finding = {
        "finding_id": "fnd-test-1",
        "algorithm": "MD5",
        "severity": "CRITICAL",
        "file": "src/auth/hash.py",
        "line": 42,
    }

    plan = planner.plan_remediations([finding])

    # Must default to DRY RUN
    assert plan["mode"] == "DRY_RUN"
    assert plan["is_dry_run"] is True
    assert plan["summary"]["default_mode"] == "DRY_RUN"

    item = plan["remediations"][0]
    assert item["dry_run"]["mode"] == "DRY_RUN"
    assert item["dry_run"]["is_dry_run"] is True
    assert "No files, certificates, or runtime configurations were modified" in item["dry_run"]["safety_guarantee"]


def test_all_10_required_dimensions_generated(planner):
    finding = {
        "id": "fnd-rsa-1024",
        "title": "Weak RSA Key Length",
        "algorithm": "RSA",
        "key_size": 1024,
        "severity": "CRITICAL",
        "location": "certs/server.key",
        "line": 1,
        "analysis_source": "ast",
        "confidence": "HIGH",
    }
    asset = {
        "asset_id": "asset-server-key",
        "name": "Production Ingress Key",
        "asset_type": "asymmetric_key",
        "is_internet_facing": True,
        "environment": "production",
        "business_unit": "payments",
    }

    item = planner.plan_finding_remediation(finding, options={"asset": asset})

    # 1. Finding
    assert "finding" in item
    assert item["finding"]["id"] == "fnd-rsa-1024"
    assert item["finding"]["severity"] == "CRITICAL"

    # 2. Why it matters
    assert "why_it_matters" in item
    assert "summary" in item["why_it_matters"]
    assert len(item["why_it_matters"]["detailed_reasons"]) >= 1

    # 3. Affected asset
    assert "affected_asset" in item
    assert item["affected_asset"]["asset_id"] == "asset-server-key"
    assert item["affected_asset"]["is_internet_facing"] is True

    # 4. Recommended remediation
    assert "recommended_remediation" in item
    assert item["recommended_remediation"]["action_type"] in ["KEY_ROTATION", "CODE_REFACTOR"]
    assert len(item["recommended_remediation"]["steps"]) >= 2

    # 5. Migration options
    assert "migration_options" in item
    assert len(item["migration_options"]) >= 3
    option_types = [opt["type"] for opt in item["migration_options"]]
    assert any("PQC" in t for t in option_types)
    assert "COMPENSATING_CONTROL" in option_types

    # 6. Expected impact
    assert "expected_impact" in item
    assert "blast_radius" in item["expected_impact"]
    assert "latency_impact" in item["expected_impact"]
    assert "downtime_requirement" in item["expected_impact"]

    # 7. Dependencies
    assert "dependencies" in item
    assert len(item["dependencies"]["required_libraries"]) >= 1
    assert len(item["dependencies"]["minimum_runtime_versions"]) >= 1

    # 8. Testing plan
    assert "testing_plan" in item
    assert len(item["testing_plan"]["stages"]) >= 3

    # 9. Rollback plan
    assert "rollback_plan" in item
    assert item["rollback_plan"]["zero_downtime_guaranteed"] is True
    assert len(item["rollback_plan"]["step_by_step_procedure"]) >= 3

    # 10. Confidence
    assert "confidence" in item
    assert item["confidence"]["level"] in ["CONFIRMED", "HIGH", "MEDIUM", "LOW"]
    assert item["confidence"]["score"] >= 0.5


def test_classical_weakness_remediations(planner):
    md5_finding = {"algorithm": "MD5", "asset_type": "digest", "severity": "HIGH"}
    plan_md5 = planner.plan_finding_remediation(md5_finding)
    assert "collision" in plan_md5["why_it_matters"]["summary"].lower()
    assert "SHA-256" in plan_md5["recommended_remediation"]["summary"]

    des_finding = {"algorithm": "3DES", "asset_type": "cipher", "severity": "CRITICAL"}
    plan_des = planner.plan_finding_remediation(des_finding)
    assert (
        "Sweet32" in plan_des["why_it_matters"]["summary"]
        or "collision" in plan_des["why_it_matters"]["summary"].lower()
    )
    assert "AES-256-GCM" in plan_des["recommended_remediation"]["summary"]


def test_pqc_hybrid_tls_remediation(planner):
    tls_finding = {
        "algorithm": "TLS 1.2",
        "asset_type": "network_session",
        "is_internet_facing": True,
        "mosca_status": "AT_RISK",
    }

    plan_tls = planner.plan_finding_remediation(tls_finding)
    recs = plan_tls["migration_options"]
    assert any("X25519MLKEM768" in o["name"] for o in recs)
    assert plan_tls["rollback_plan"]["flag_name"] == "ENABLE_PQC_HYBRID_CRYPTO"


def test_secret_safe_evidence_sanitization(planner):
    raw_key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
    finding_with_secret = {
        "finding_id": "fnd-leak",
        "algorithm": "RSA",
        "private_key": raw_key,
        "evidence": {
            "snippet": f"secret_key = '{raw_key}'",
            "password": "PasswordSecret999!",
        },
    }

    plan = planner.plan_finding_remediation(finding_with_secret)
    plan_str = str(plan)

    # Asserts zero raw secrets in generated remediation plan
    assert raw_key not in plan_str
    assert "PasswordSecret999!" not in plan_str
    assert "[REDACTED_SECRET SHA256:" in plan_str


def test_cbom_remediation_planning(planner):
    cbom_data = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": [
            {
                "name": "Legacy DES Module",
                "bom-ref": "comp-1",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "name": "DES",
                    },
                },
            },
            {
                "name": "RSA Ingress Cert",
                "bom-ref": "comp-2",
                "cryptoProperties": {
                    "assetType": "certificate",
                    "algorithmProperties": {
                        "name": "RSA",
                        "parameterSetIdentifier": "2048",
                    },
                },
            },
        ],
    }

    plan = planner.plan_remediations(cbom_data)
    assert plan["summary"]["total_actionable_findings"] == 2
    assert plan["plan_digest"] is not None
    assert len(plan["plan_digest"]) == 64


def test_explicit_apply_mode(planner):
    finding = {"algorithm": "RC4", "severity": "HIGH"}
    plan = planner.plan_remediations([finding], options={"dry_run": False})

    assert plan["mode"] == "APPLY"
    assert plan["is_dry_run"] is False
    assert plan["remediations"][0]["dry_run"]["mode"] == "LIVE_APPLY"
