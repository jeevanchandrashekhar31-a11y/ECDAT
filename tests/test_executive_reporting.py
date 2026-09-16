"""
Tests for ECDAT Enterprise Executive Reporting Engine (Phase 26.1).

Verifies coverage of:
1. Total crypto assets
2. Weak/deprecated assets
3. PQC readiness
4. Critical applications
5. Certificates
6. Policy violations
7. Remediation progress
8. Business ownership
9. Trend over time
10. Strict 100% evidence traceability across every metric
"""

import pytest
from scanners.reporting.executive_reporter import ExecutiveReporter


SAMPLE_FINDINGS = [
    {
        "id": "find_rsa_1024",
        "asset_id": "svc_payments",
        "component_id": "comp_signer",
        "algorithm": "RSA-1024",
        "key_size": 1024,
        "category": "algorithm",
        "severity": "Critical",
        "location": "services/auth/signer.go",
        "line_number": 42,
        "evidence_context": "rsa.GenerateKey(rand.Reader, 1024)",
        "owner": "Payments Team",
        "app_tier": "tier_0_mission_critical",
    },
    {
        "id": "find_md5_hash",
        "asset_id": "svc_cache",
        "component_id": "comp_etag",
        "algorithm": "MD5",
        "key_size": 128,
        "category": "algorithm",
        "severity": "Critical",
        "location": "pkg/cache/etag.go",
        "line_number": 19,
        "evidence_context": "md5.New().Sum(data)",
        "owner": "Infrastructure Team",
        "app_tier": "tier_1_business_critical",
    },
    {
        "id": "find_sha1_legacy",
        "asset_id": "svc_ledger",
        "component_id": "comp_commit",
        "algorithm": "SHA-1",
        "key_size": 160,
        "category": "algorithm",
        "severity": "High",
        "location": "ledger/commit.rs",
        "line_number": 88,
        "evidence_context": "Sha1::digest(bytes)",
        "owner": "Core Platform",
        "app_tier": "tier_1_business_critical",
    },
    {
        "id": "find_hybrid_mlkem",
        "asset_id": "svc_gateway",
        "component_id": "comp_tunnel",
        "algorithm": "X25519+ML-KEM-768",
        "key_size": 256,
        "category": "algorithm",
        "severity": "Low",
        "location": "tunnel/wireguard.go",
        "line_number": 31,
        "evidence_context": "hybrid.NewKeyExchange()",
        "owner": "Core Platform",
        "app_tier": "tier_0_mission_critical",
    },
    {
        "id": "find_aes_gcm",
        "asset_id": "svc_vault",
        "component_id": "comp_vault",
        "algorithm": "AES-256-GCM",
        "key_size": 256,
        "category": "algorithm",
        "severity": "Low",
        "location": "vault/aes.py",
        "line_number": 56,
        "evidence_context": "AESGCM(key).encrypt()",
        "owner": "Security Team",
        "app_tier": "tier_0_mission_critical",
    },
]


class TestExecutiveReporting:
    """Test suite for ExecutiveReporter."""

    @pytest.fixture
    def reporter(self):
        return ExecutiveReporter(scan_name="Unit Test Target", scan_id="scan_test_001")

    @pytest.fixture
    def report(self, reporter):
        return reporter.generate_from_findings(SAMPLE_FINDINGS)

    def test_total_crypto_assets_covered(self, report):
        """Report must cover total crypto assets with accurate counts and evidence."""
        assets = report["total_crypto_assets"]
        assert assets["total_count"] == len(SAMPLE_FINDINGS)
        assert assets["by_type"]["algorithms"] == len(SAMPLE_FINDINGS)
        assert len(assets["evidence_items"]) == len(SAMPLE_FINDINGS)

    def test_weak_deprecated_assets_covered(self, report):
        """Report must identify broken, deprecated, and short-key assets."""
        weak = report["weak_deprecated_assets"]
        assert weak["total_weak_count"] == 3  # RSA-1024, MD5, SHA-1
        assert weak["broken_count"] == 1       # MD5
        assert weak["deprecated_count"] == 1   # SHA-1
        assert weak["short_key_count"] == 1    # RSA-1024
        assert len(weak["evidence_items"]) == 3

    def test_pqc_readiness_and_mosca_calculus_covered(self, report):
        """Report must evaluate PQC readiness, quantum vulnerability, and Mosca delta."""
        pqc = report["pqc_readiness"]
        assert pqc["quantum_vulnerable_count"] == 1  # RSA-1024
        assert pqc["hybrid_count"] == 1              # X25519+ML-KEM-768
        assert pqc["quantum_safe_count"] == 1        # AES-256-GCM
        assert pqc["pqc_readiness_percentage"] > 0
        assert pqc["mosca_calculus"]["in_quantum_deficit"] is True
        assert pqc["mosca_calculus"]["quantum_collapse_year"] == 2033

    def test_critical_applications_covered(self, report):
        """Report must categorize assets across critical business applications."""
        apps = report["critical_applications"]
        assert apps["total_critical_applications"] >= 4
        app_names = [a["app_id"] for a in apps["applications"]]
        assert "svc_payments" in app_names
        assert "svc_gateway" in app_names

    def test_certificates_covered(self, report):
        """Report must include certificate tracking with SHA-256 fingerprints."""
        certs = report["certificates"]
        assert certs["total_certificates"] >= 1
        assert len(certs["evidence_items"]) >= 1
        assert all(len(c["fingerprint"]) == 64 for c in certs["details"])

    def test_policy_violations_covered(self, report):
        """Report must map violations to standard regulatory frameworks."""
        policy = report["policy_violations"]
        assert policy["total_violations"] >= 2
        assert policy["critical_violations_count"] == 2  # RSA-1024, MD5

    def test_remediation_progress_covered(self, report):
        """Report must detail remediation velocity, status counts, and MTTR."""
        remediation = report["remediation_progress"]
        assert remediation["total_findings"] == len(SAMPLE_FINDINGS)
        assert remediation["remediation_rate_percentage"] > 0
        assert "open" in remediation["status_counts"]
        assert "verified" in remediation["status_counts"]

    def test_business_ownership_covered(self, report):
        """Report must map findings to responsible business owners."""
        ownership = report["business_ownership"]
        assert ownership["total_owners_count"] >= 3
        owner_names = [o["owner_name"] for o in ownership["owners"]]
        assert "Payments Team" in owner_names
        assert "Core Platform" in owner_names

    def test_trend_over_time_covered(self, report):
        """Report must provide historical progression and trajectory metrics."""
        trend = report["trend_over_time"]
        assert len(trend["historical_periods"]) >= 3
        assert trend["velocity_summary"]["direction"] == "IMPROVING"

    def test_strict_evidence_traceability(self, report):
        """Every metric must be strictly traceable to underlying evidence."""
        valid, violations = ExecutiveReporter.validate_traceability(report)
        assert valid is True, f"Traceability violations: {violations}"
        assert len(report["evidence_index"]) >= len(SAMPLE_FINDINGS)
