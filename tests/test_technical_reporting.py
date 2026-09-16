"""
Tests for ECDAT Technical Drill-Down Reporting Engine (Phase 26.2).

Verifies presence and accuracy of all 12 required technical dimensions:
1. exact source location
2. scanner
3. confidence
4. evidence
5. algorithm
6. parameters
7. dependency
8. certificate
9. network endpoint
10. runtime evidence
11. risk
12. remediation
"""

import pytest
from scanners.reporting.technical_reporter import TechnicalReporter, REQUIRED_DIMENSIONS


SAMPLE_FINDINGS = [
    {
        "id": "find_rsa_1024_auth",
        "asset_id": "svc_payment_gateway",
        "component_id": "comp_jwt_signer",
        "algorithm": "RSA-1024",
        "key_size": 1024,
        "location": "services/auth/token_signer.go",
        "line_number": 42,
        "evidence_context": "rsa.GenerateKey(rand.Reader, 1024)",
        "severity": "Critical",
    },
    {
        "id": "find_md5_cache",
        "asset_id": "svc_payment_gateway",
        "component_id": "comp_cache_hasher",
        "algorithm": "MD5",
        "key_size": 128,
        "location": "pkg/cache/etag.go",
        "line_number": 19,
        "evidence_context": "md5.New().Sum([]byte(data))",
        "severity": "Critical",
    },
    {
        "id": "find_aes_gcm",
        "asset_id": "svc_customer_vault",
        "component_id": "comp_field_cipher",
        "algorithm": "AES-256-GCM",
        "key_size": 256,
        "location": "vault/storage/aes.py",
        "line_number": 56,
        "evidence_context": "AESGCM(key).encrypt(nonce, data, aad)",
        "severity": "Low",
    },
]


class TestTechnicalReporting:
    """Test suite for TechnicalReporter."""

    @pytest.fixture
    def reporter(self):
        return TechnicalReporter(scan_name="Test Enterprise Target", scan_id="scan_test_002")

    @pytest.fixture
    def report(self, reporter):
        return reporter.generate_report(SAMPLE_FINDINGS)

    def test_all_12_required_dimensions_present(self, report):
        """Every finding item must strictly contain all 12 mandated technical dimensions."""
        assert len(report["findings"]) == len(SAMPLE_FINDINGS)

        for item in report["findings"]:
            for dim in REQUIRED_DIMENSIONS:
                assert dim in item, f"Missing dimension '{dim}' in finding '{item.get('finding_id')}'"
                assert isinstance(item[dim], dict), f"Dimension '{dim}' must be a dict"

    def test_dimension_1_exact_source_location(self, report):
        """Source location must specify file_path, line_number, and function scope."""
        item = report["findings"][0]
        loc = item["exact_source_location"]
        assert loc["file_path"] == "services/auth/token_signer.go"
        assert loc["line_number"] == 42
        assert loc["column_number"] > 0
        assert "function_scope" in loc
        assert "git_ref" in loc

    def test_dimension_2_scanner_and_modality(self, report):
        """Scanner must specify scanner_id, version, and detection modality."""
        item = report["findings"][0]
        scanner = item["scanner"]
        assert "scanner_id" in scanner
        assert "scanner_version" in scanner
        assert "modality" in scanner

    def test_dimension_3_detection_confidence(self, report):
        """Confidence must contain level, score (0-1), and validation method."""
        item = report["findings"][0]
        conf = item["confidence"]
        assert conf["confidence_level"] in ("HIGH", "MEDIUM", "LOW")
        assert 0.0 <= conf["confidence_score"] <= 1.0
        assert "validation_method" in conf

    def test_dimension_4_concrete_evidence(self, report):
        """Evidence must contain raw snippet, context, and SHA-256 hash."""
        item = report["findings"][0]
        ev = item["evidence"]
        assert "rsa.GenerateKey" in ev["raw_evidence"]
        assert len(ev["sha256_hash"]) == 64
        assert ev["redaction_verified"] is True

    def test_dimension_5_algorithm_details(self, report):
        """Algorithm must identify family, OID, standard reference, and lifecycle status."""
        item = report["findings"][0]
        algo = item["algorithm"]
        assert algo["name"] == "RSA-1024"
        assert "family" in algo
        assert "oid" in algo
        assert "standard_reference" in algo
        assert "lifecycle_status" in algo

    def test_dimension_6_cryptographic_parameters(self, report):
        """Parameters must specify key size and cryptographic modes."""
        item = report["findings"][0]
        params = item["parameters"]
        assert params["key_size_bits"] == 1024
        assert "mode_of_operation" in params

    def test_dimension_7_dependency_tracking(self, report):
        """Dependency must specify package name, ecosystem, and purl."""
        item = report["findings"][0]
        dep = item["dependency"]
        assert "package_name" in dep
        assert "ecosystem" in dep
        assert "purl" in dep

    def test_dimension_8_certificate_details(self, report):
        """Certificate must specify Subject DN, Issuer, fingerprint, and validity."""
        item = report["findings"][0]
        cert = item["certificate"]
        assert cert["is_certificate_asset"] is True
        assert "subject_dn" in cert
        assert "issuer_dn" in cert
        assert len(cert["fingerprint_sha256"]) == 64
        assert "valid_to" in cert

    def test_dimension_9_network_endpoint(self, report):
        """Network endpoint must specify host, port, protocol, and TLS version."""
        item = report["findings"][0]
        net = item["network_endpoint"]
        assert "hostname" in net
        assert net["port"] == 443
        assert "tls_version" in net

    def test_dimension_10_runtime_evidence(self, report):
        """Runtime evidence must capture PID, process name, and kernel probe."""
        item = report["findings"][0]
        rt = item["runtime_evidence"]
        assert rt["is_runtime_observed"] is True
        assert rt["process_id"] > 0
        assert "process_name" in rt
        assert "kernel_probe" in rt

    def test_dimension_11_risk_evaluation(self, report):
        """Risk must evaluate severity, composite score, CWE, and blast radius."""
        item = report["findings"][0]
        risk = item["risk"]
        assert risk["severity"] == "CRITICAL"
        assert risk["risk_score"] > 80.0
        assert risk["cwe_id"].startswith("CWE-")
        assert risk["quantum_vulnerable"] is True
        assert len(risk["regulatory_violations"]) >= 1
        assert "blast_radius" in risk

    def test_dimension_12_remediation_and_patch(self, report):
        """Remediation must propose target standard, rollout, and syntactic patch diff."""
        item = report["findings"][0]
        rem = item["remediation"]
        assert "target_algorithm" in rem
        assert "target_nist_standard" in rem
        assert "patch_diff" in rem
        assert "--- a/" in rem["patch_diff"]
        assert "staged_rollout" in rem
        assert "rollback_plan" in rem

    def test_validation_detects_missing_dimension(self, report):
        """validate_completeness must catch any omitted technical dimension."""
        valid, violations = TechnicalReporter.validate_completeness(report)
        assert valid is True
        assert len(violations) == 0

        # Artificially strip a dimension
        corrupted = report["findings"][0].copy()
        del corrupted["exact_source_location"]
        corrupted_report = {"findings": [corrupted]}

        valid, violations = TechnicalReporter.validate_completeness(corrupted_report)
        assert valid is False
        assert any("exact_source_location" in v for v in violations)
