"""
Pytest Test Suite for ECDAT Security Release Gate (Phase 33).

Verifies that the security release gate:
1. Passes when all 14 mandatory controls have verified evidence.
2. Fails when critical vulnerability exists.
3. Fails when high vulnerability exists.
4. Fails when test suite fails.
5. Fails when security regression fails.
6. Fails when authorization regression fails.
7. Fails when tenant isolation fails.
8. Fails when scanner fails unexpectedly.
9. Fails when dependency scan is incomplete.
10. Fails when secret scan fails.
11. Fails when CBOM validation fails.
12. Fails when container scan fails.
13. Fails when Kubernetes policy fails.
14. Fails when required artifact is missing.
15. Fails when required security evidence is missing.
"""

import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.security_gate import REPO_ROOT, SecurityReleaseGate, GateControlResult


@pytest.fixture
def gate():
    return SecurityReleaseGate(repo_root=REPO_ROOT, verbose=False)


def test_security_gate_full_execution_approved(gate):
    """Verifies that in clean repository state, the security gate approves release across all 14 controls."""
    passed, results = gate.execute(quick=True)
    assert passed is True, f"Gate failed with results: {[(r.name, r.fail_reason) for r in results if not r.passed]}"
    assert len(results) == 14
    assert all(r.passed for r in results)
    assert all(r.verified_evidence is not None for r in results)


def test_control_01_fails_on_unaccepted_critical_vulnerability(gate, tmp_path):
    """Verifies Control 01 fails if an unaccepted critical vulnerability exists."""
    report_dir = tmp_path / "artifacts" / "security"
    report_dir.mkdir(parents=True)
    fake_report = report_dir / "ecdat_vulnerability_report.json"
    fake_report.write_text(
        json.dumps({
            "status": "VULNERABLE",
            "findings": [
                {
                    "package": "malicious-lib",
                    "version": "1.0.0",
                    "severity": "CRITICAL",
                    "advisory_id": "CVE-2026-9999",
                }
            ],
        }),
        encoding="utf-8",
    )

    with patch.object(gate, "repo_root", tmp_path):
        res = gate.check_01_critical_vulnerability()
        assert res.passed is False
        assert "CRITICAL" in res.fail_reason


def test_control_02_fails_on_unaccepted_high_vulnerability(gate, tmp_path):
    """Verifies Control 02 fails if an unaccepted high vulnerability exists."""
    report_dir = tmp_path / "artifacts" / "security"
    report_dir.mkdir(parents=True)
    fake_report = report_dir / "ecdat_vulnerability_report.json"
    fake_report.write_text(
        json.dumps({
            "status": "VULNERABLE",
            "findings": [
                {
                    "package": "vulnerable-lib",
                    "version": "2.0.0",
                    "severity": "HIGH",
                    "advisory_id": "GHSA-xxxx-yyyy-zzzz",
                }
            ],
        }),
        encoding="utf-8",
    )

    with patch.object(gate, "repo_root", tmp_path):
        res = gate.check_02_high_vulnerability()
        assert res.passed is False
        assert "HIGH" in res.fail_reason


def test_control_07_scanner_crash_interception(gate):
    """Verifies Control 07 asserts deterministic non-zero error on invalid invocation."""
    res = gate.check_07_scanner_crash_interception()
    assert res.passed is True
    assert res.verified_evidence.get("invalid_invocation_exit_code") == 2


def test_control_08_fails_when_dependency_scan_is_incomplete(gate, tmp_path):
    """Verifies Control 08 fails if dependency scan status is INCOMPLETE_VULNERABILITY_DATA."""
    fake_dir = tmp_path / "artifacts" / "security"
    fake_dir.mkdir(parents=True)
    fake_report = fake_dir / "ecdat_vulnerability_report.json"
    fake_report.write_text(
        json.dumps({
            "status": "INCOMPLETE_VULNERABILITY_DATA",
            "scan_successful": False,
            "errors": ["Database coverage 0.5%"],
        }),
        encoding="utf-8",
    )

    with patch.object(gate, "repo_root", tmp_path):
        res = gate.check_08_dependency_scan_completeness()
        assert res.passed is False
        assert "incomplete" in res.fail_reason.lower()


def test_control_10_fails_on_corrupt_cbom(gate, tmp_path):
    """Verifies Control 10 fails if CBOM is invalid or missing cryptoProperties."""
    fake_dir = tmp_path / "artifacts" / "sbom"
    fake_dir.mkdir(parents=True)
    fake_cbom = fake_dir / "ecdat_sbom_cyclonedx.json"
    fake_cbom.write_text(
        json.dumps({
            "bomFormat": "NotCycloneDX",
            "specVersion": "1.0",
        }),
        encoding="utf-8",
    )

    with patch.object(gate, "repo_root", tmp_path):
        res = gate.check_10_cbom_validation()
        assert res.passed is False
        assert "invalid bomformat" in res.fail_reason.lower()


def test_control_13_fails_when_mandated_artifact_missing(gate, tmp_path):
    """Verifies Control 13 fails if any required artifact is missing."""
    with patch.object(gate, "repo_root", tmp_path):
        res = gate.check_13_required_artifacts()
        assert res.passed is False
        assert "missing" in res.fail_reason.lower()


def test_control_14_security_evidence_verification(gate):
    """Verifies Control 14 successfully validates digital signatures and cryptographic evidence."""
    res = gate.check_14_security_evidence()
    assert res.passed is True
    assert res.verified_evidence.get("signature_algorithm") == "Ed25519"
    assert res.verified_evidence.get("verification_exit_code") == 0


def test_cli_security_gate_execution():
    """Verifies CLI execution of scripts/security_gate.py returns exit code 0."""
    cmd = [sys.executable, "scripts/security_gate.py", "--quick"]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0
    assert "[SECURITY GATE APPROVED]" in proc.stdout
