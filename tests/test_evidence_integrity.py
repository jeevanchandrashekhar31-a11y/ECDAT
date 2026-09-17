"""
Test Suite for ECDAT Evidence Integrity and Audit Attestation (Phase 26.3).

Verifies:
1. Presence of all 6 mandated metadata dimensions:
   - scan timestamp
   - ECDAT version
   - scanner versions
   - configuration
   - policy version
   - CBOM version
2. Canonical SHA-256 digests and Merkle root calculation
3. Anti-deception guard: Never imply independent audit/certification unless actually obtained
4. Integration with Executive and Technical reporting engines
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scanners.reporting.evidence_integrity import (
    DEFAULT_SCANNER_VERSIONS,
    ECDAT_VERSION,
    EvidenceIntegrityBuilder,
    compute_canonical_sha256,
    compute_evidence_merkle_root,
    validate_evidence_integrity,
)
from scanners.reporting.executive_reporter import ExecutiveReporter
from scanners.reporting.technical_reporter import TechnicalReporter


REPO_ROOT = Path(__file__).resolve().parent.parent


def test_canonical_sha256_determinism():
    """Verify that key order does not affect SHA-256 fingerprint generation."""
    obj_a = {"b": 2, "a": 1, "nested": {"y": "test", "x": 10}}
    obj_b = {"a": 1, "b": 2, "nested": {"x": 10, "y": "test"}}

    hash_a = compute_canonical_sha256(obj_a)
    hash_b = compute_canonical_sha256(obj_b)

    assert len(hash_a) == 64
    assert hash_a == hash_b


def test_evidence_merkle_root_computation():
    """Verify that evidence Merkle root is deterministic and 64 hex characters."""
    evidence_items = [
        {"evidence_id": "ev_1", "location": "auth/signer.go", "evidence_context": "rsa.Gen(1024)"},
        {"evidence_id": "ev_2", "location": "cache/hasher.go", "evidence_context": "md5.New()"},
        {"evidence_id": "ev_3", "location": "vault/aes.py", "evidence_context": "aes_gcm()"},
    ]

    merkle_root = compute_evidence_merkle_root(evidence_items)
    assert len(merkle_root) == 64

    # Empty list fallback
    empty_root = compute_evidence_merkle_root([])
    assert len(empty_root) == 64
    assert empty_root != merkle_root


def test_integrity_builder_all_mandated_fields():
    """Verify builder produces all 6 mandated metadata dimensions."""
    builder = EvidenceIntegrityBuilder(
        scan_timestamp="2026-09-17T02:13:04Z",
        policy_profile="regulated_bfsi",
    )
    block = builder.build_integrity_block()

    # 1. scan timestamp
    assert block["scan_timestamp"] == "2026-09-17T02:13:04Z"

    # 2. ECDAT version
    assert block["ecdat_version"] == ECDAT_VERSION

    # 3. scanner versions
    assert "static_tree_sitter_ast" in block["scanner_versions"]
    assert "ebpf_runtime_tracer" in block["scanner_versions"]

    # 4. configuration
    assert len(block["configuration"]["config_hash_sha256"]) == 64
    assert block["configuration"]["zero_secrets_redaction"] is True

    # 5. policy version
    assert block["policy_version"]["profile_id"] == "regulated_bfsi"
    assert len(block["policy_version"]["policy_hash_sha256"]) == 64

    # 6. CBOM version
    assert block["cbom_version"]["spec_version"] == "CycloneDX 1.6"
    assert len(block["cbom_version"]["cbom_sha256"]) == 64

    # Cryptographic hashes
    assert len(block["hashes"]["report_payload_sha256"]) == 64
    assert len(block["hashes"]["evidence_merkle_root"]) == 64
    assert block["hashes"]["canonical_fingerprint"].startswith("SHA256:")

    # Default independent audit status
    assert block["independent_attestation"]["independent_audit_obtained"] is False
    assert block["independent_attestation"]["certification_status"] == "UNATTESTED_AUTOMATED_EVALUATION"
    assert (
        "does NOT constitute an independent third-party audit"
        in block["independent_attestation"]["attestation_statement"]
    )


def test_validate_evidence_integrity_success():
    """Verify that a compliant report passes validation without violations."""
    builder = EvidenceIntegrityBuilder()
    block = builder.build_integrity_block()
    report = {"evidence_integrity": block, "report_id": "rep_100"}

    valid, violations = validate_evidence_integrity(report)
    assert valid is True
    assert len(violations) == 0


def test_anti_deception_guard_blocks_fake_audit():
    """Verify that deceptive certification claims are strictly rejected when uncertified."""
    builder = EvidenceIntegrityBuilder()
    block = builder.build_integrity_block()
    report = {
        "evidence_integrity": block,
        "title": "ECDAT Scan - Officially Third-Party Certified Report",
    }

    valid, violations = validate_evidence_integrity(report)
    assert valid is False
    assert any("Deceptive certification claim detected" in v for v in violations)


def test_anti_deception_guard_requires_auditor_credentials():
    """Verify that independent_audit_obtained: True requires explicit auditor credentials."""
    builder = EvidenceIntegrityBuilder(
        is_independently_audited=True,
        attestation_details={},  # Missing auditor_identity
    )
    block = builder.build_integrity_block()
    report = {"evidence_integrity": block}

    valid, violations = validate_evidence_integrity(report)
    assert valid is False
    assert any("auditor_identity" in v for v in violations)


def test_executive_reporter_embeds_integrity():
    """Verify that ExecutiveReporter automatically embeds valid evidence_integrity block."""
    reporter = ExecutiveReporter(scan_id="scan_exec_test")
    sample_findings = [
        {
            "id": "find_rsa",
            "algorithm": "RSA-1024",
            "severity": "Critical",
            "location": "auth/token.go",
            "line_number": 42,
        },
        {
            "id": "find_md5",
            "algorithm": "MD5",
            "severity": "Critical",
            "location": "cache/hasher.go",
            "line_number": 19,
        },
    ]
    report = reporter.generate_from_findings(sample_findings)

    assert "evidence_integrity" in report
    valid, violations = validate_evidence_integrity(report)
    assert valid is True, f"Violations: {violations}"
    assert report["evidence_integrity"]["ecdat_version"] == "1.0.0"
    assert len(report["evidence_integrity"]["configuration"]["config_hash_sha256"]) == 64


def test_technical_reporter_embeds_integrity():
    """Verify that TechnicalReporter automatically embeds valid evidence_integrity block."""
    reporter = TechnicalReporter(scan_id="scan_tech_test")
    sample_findings = [
        {
            "id": "find_rsa",
            "algorithm": "RSA-1024",
            "severity": "Critical",
            "location": "auth/token.go",
            "line_number": 42,
        },
    ]
    report = reporter.generate_report(sample_findings)

    assert "evidence_integrity" in report
    valid, violations = validate_evidence_integrity(report)
    assert valid is True, f"Violations: {violations}"
    assert report["evidence_integrity"]["independent_attestation"]["independent_audit_obtained"] is False


def test_cli_demo_and_verify(tmp_path):
    """Verify CLI interface of evidence_integrity module."""
    # 1. Test --demo
    cmd_demo = [sys.executable, str(REPO_ROOT / "scanners" / "reporting" / "evidence_integrity.py"), "--demo"]
    proc = subprocess.run(cmd_demo, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=15)
    assert proc.returncode == 0
    data = json.loads(proc.stdout)
    assert "scan_timestamp" in data
    assert "ecdat_version" in data

    # 2. Test --verify-file with valid report
    report_file = tmp_path / "valid_report.json"
    report_file.write_text(json.dumps({"evidence_integrity": data}), encoding="utf-8")

    cmd_verify = [
        sys.executable,
        str(REPO_ROOT / "scanners" / "reporting" / "evidence_integrity.py"),
        "--verify-file",
        str(report_file),
    ]
    proc_verify = subprocess.run(cmd_verify, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=15)
    assert proc_verify.returncode == 0
    assert "PASSED" in proc_verify.stdout
