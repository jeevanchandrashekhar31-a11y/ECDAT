"""
Tests for Evidence-Based Compliance Mapping Engine (Phase 11.3).
"""

import pytest
from scanners.compliance_mapping import (
    ComplianceMapper,
    NON_CERTIFICATION_DISCLAIMER,
    SUPPORT_LEVELS,
    sanitize_evidence_data,
    redact_secret_string,
)


@pytest.fixture
def mapper():
    return ComplianceMapper()


def test_catalog_loading_and_schema_validation(mapper):
    catalog = mapper.get_catalog()
    assert "standards" in catalog
    assert len(catalog["standards"]) >= 5
    assert catalog.get("disclaimer") == NON_CERTIFICATION_DISCLAIMER


def test_standards_listing_and_retrieval(mapper):
    standards = mapper.list_standards()
    assert len(standards) >= 5
    std_ids = [s["id"] for s in standards]
    assert "nist_sp_800_53_r5" in std_ids
    assert "nist_cnsa_2_0" in std_ids
    assert "pci_dss_v4" in std_ids
    assert "nist_sp_800_131a_r2" in std_ids
    assert "iso_iec_27001_2022" in std_ids

    # Test single retrieval
    cnsa = mapper.get_standard("nist_cnsa_2_0")
    assert cnsa is not None
    assert cnsa["name"].startswith("NIST CNSA 2.0")
    assert len(cnsa["controls"]) >= 4

    # Non-existent
    assert mapper.get_standard("unknown_standard_xyz") is None


def test_support_levels_strictly_categorized(mapper):
    catalog = mapper.get_catalog()
    valid_levels = set(SUPPORT_LEVELS)

    for standard in catalog["standards"]:
        for control in standard["controls"]:
            level = control.get("support_level")
            assert level in valid_levels, f"Control {control.get('control_id')} has invalid support level {level}"


def test_non_certification_disclaimer(mapper):
    dummy_assets = [{"name": "aes-key", "algorithm": "AES-256", "key_size": 256, "asset_type": "symmetric_key"}]
    report = mapper.assess(dummy_assets)

    # Formal certification claim must be explicitly disclaimed and false
    assert report["disclaimer"] == NON_CERTIFICATION_DISCLAIMER
    assert report["certification_claimed"] is False
    assert "evidence_digest" in report
    assert len(report["evidence_digest"]) == 64


def test_zero_secret_leakage_and_redaction():
    raw_key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y3...\n-----END RSA PRIVATE KEY-----"
    raw_dict = {
        "asset_name": "db_credentials_key",
        "algorithm": "RSA",
        "private_key": raw_key,
        "api_token": "secret_token_abcdef1234567890",
        "nested": {
            "password": "SuperSecretPassword123!",
            "public_exponent": 65537,
        }
    }

    sanitized = sanitize_evidence_data(raw_dict)

    # Verify no raw private key or password exists in sanitized data
    assert raw_key not in str(sanitized)
    assert "SuperSecretPassword123!" not in str(sanitized)
    assert "[REDACTED_SECRET SHA256:" in sanitized["private_key"]
    assert "[REDACTED_SECRET SHA256:" in sanitized["nested"]["password"]
    assert sanitized["nested"]["public_exponent"] == 65537


def test_control_assessment_supported_control(mapper):
    # Compliant assets
    compliant_assets = [
        {
            "id": "asset-1",
            "name": "TLS 1.3 Endpoint",
            "asset_type": "protocol",
            "protocol": "TLS 1.3",
            "cipher_suite": "TLS_AES_256_GCM_SHA384",
        },
        {
            "id": "asset-2",
            "name": "Post-Quantum Key Exchange",
            "asset_type": "key_exchange",
            "algorithm": "ML-KEM-768",
            "is_quantum_safe": True,
            "is_hybrid": True,
        },
        {
            "id": "asset-3",
            "name": "Database Storage Key",
            "asset_type": "symmetric_key",
            "algorithm": "AES-256",
            "key_size": 256,
        },
    ]

    report = mapper.assess(compliant_assets, standard_ids=["nist_cnsa_2_0", "pci_dss_v4"])
    assert report["certification_claimed"] is False
    summary = report["summary"]
    assert summary["total_standards_assessed"] == 2
    assert summary["support_level_breakdown"]["SUPPORTED CONTROL"] > 0

    # Non-compliant assets (e.g. deprecated TLS 1.0, weak RSA 1024, MD5)
    non_compliant_assets = [
        {
            "id": "asset-bad-1",
            "name": "Legacy SSL Gateway",
            "asset_type": "protocol",
            "protocol": "TLS 1.0",
            "cipher_suite": "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
        },
        {
            "id": "asset-bad-2",
            "name": "Old Signing Key",
            "asset_type": "asymmetric_key",
            "algorithm": "RSA",
            "key_size": 1024,
        },
        {
            "id": "asset-bad-3",
            "name": "Legacy Checksum",
            "asset_type": "digest",
            "algorithm": "MD5",
        }
    ]

    bad_report = mapper.assess(non_compliant_assets, standard_ids=["nist_sp_800_131a_r2", "pci_dss_v4"])
    pci_std = next(s for s in bad_report["standards"] if s["standard_id"] == "pci_dss_v4")
    req_4_2_1 = next(c for c in pci_std["controls"] if c["control_id"] == "Req 4.2.1")
    assert req_4_2_1["compliant"] is False
    assert len(req_4_2_1["gaps"]) > 0


def test_control_assessment_not_supported_scope(mapper):
    assets = [{"name": "test-asset", "algorithm": "AES-256", "asset_type": "symmetric_key"}]
    report = mapper.assess(assets, standard_ids=["pci_dss_v4", "nist_sp_800_53_r5"])

    pci_std = next(s for s in report["standards"] if s["standard_id"] == "pci_dss_v4")
    req_9_1 = next(c for c in pci_std["controls"] if c["control_id"] == "Req 9.1")

    assert req_9_1["support_level"] == "NOT SUPPORTED"
    assert req_9_1["verdict"] == "NOT_APPLICABLE_OUT_OF_SCOPE"
    assert req_9_1["compliant"] is None
    assert "manual_audit_guidance" in req_9_1


def test_cbom_format_support(mapper):
    cbom_data = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": [
            {
                "name": "AES-GCM Component",
                "type": "cryptographic-asset",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "name": "AES",
                        "primitive": "ae",
                        "parameterSetIdentifier": "256",
                    }
                }
            }
        ]
    }

    report = mapper.assess(cbom_data)
    assert report["summary"]["total_standards_assessed"] >= 5
    assert report["evidence_digest"] is not None
