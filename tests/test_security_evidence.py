"""
Pytest Test Suite for ECDAT Evidence-Based Verification Subsystem (Phase 34).

Verifies:
1. security_evidence/ directory exists.
2. All 10 mandatory evidence files exist.
3. Every file conforms strictly to the 8-key schema:
   - timestamp (ISO 8601)
   - tool
   - tool_version
   - command
   - repository_commit (40-char SHA)
   - status (PASS / SUCCESS / APPROVED)
   - summary (dict or non-empty string)
   - raw_result_reference (file on disk)
4. CLI validation and JSON output.
5. Failure detection for corrupt or incomplete evidence.
"""

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.generate_security_evidence import (
    EVIDENCE_DIR,
    MANDATORY_EVIDENCE_FILES,
    REPO_ROOT,
    REQUIRED_SCHEMA_KEYS,
    validate_all_evidence,
    validate_single_evidence,
)


def test_security_evidence_directory_exists():
    """Asserts that the security_evidence/ directory exists at repository root."""
    assert EVIDENCE_DIR.exists()
    assert EVIDENCE_DIR.is_dir()


def test_all_10_mandatory_evidence_files_exist():
    """Asserts that all 10 mandated evidence files are present and non-empty."""
    assert len(MANDATORY_EVIDENCE_FILES) == 10
    for filename in MANDATORY_EVIDENCE_FILES:
        target_path = EVIDENCE_DIR / filename
        assert target_path.exists(), f"Mandatory evidence file missing: {filename}"
        assert target_path.stat().st_size > 0, f"Evidence file is empty (0 bytes): {filename}"


@pytest.mark.parametrize("filename", MANDATORY_EVIDENCE_FILES)
def test_each_evidence_file_conforms_to_schema(filename):
    """Verifies that each individual evidence file satisfies all schema requirements."""
    target_path = EVIDENCE_DIR / filename
    valid, errors, data = validate_single_evidence(target_path, REPO_ROOT)
    assert valid is True, f"Schema validation failed for {filename}: {errors}"
    assert data is not None

    # Check 8 required keys
    for key in REQUIRED_SCHEMA_KEYS:
        assert key in data, f"Key '{key}' missing from {filename}"
        assert data[key] is not None, f"Key '{key}' is null in {filename}"

    # Check timestamp format
    ts_str = data["timestamp"]
    parsed_dt = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    assert parsed_dt is not None

    # Check repository_commit format (40-char hex)
    commit = data["repository_commit"]
    assert re.match(r"^[0-9a-fA-F]{40}$", commit), f"Invalid git commit SHA: {commit}"

    # Check status
    status = data["status"]
    assert status.upper() in {"PASS", "SUCCESS", "APPROVED"}

    # Check raw_result_reference exists on disk
    raw_ref = data["raw_result_reference"]
    ref_path = REPO_ROOT / raw_ref
    assert ref_path.exists(), f"Referenced raw file does not exist: {raw_ref}"


def test_validate_all_evidence_suite():
    """Verifies that validate_all_evidence returns passing state for security_evidence/."""
    valid, errors, verified_data = validate_all_evidence(EVIDENCE_DIR, REPO_ROOT)
    assert valid is True, f"Full suite validation failed: {errors}"
    assert len(verified_data) == 10
    assert not errors


def test_validator_detects_missing_field(tmp_path):
    """Verifies that validator detects missing mandatory schema fields."""
    bad_file = tmp_path / "test-results.json"
    bad_file.write_text(
        json.dumps({
            "timestamp": "2026-09-18T17:40:00Z",
            "tool": "pytest",
            # Missing tool_version, command, repository_commit, status, summary, raw_result_reference
        }),
        encoding="utf-8",
    )

    valid, errors, _ = validate_single_evidence(bad_file, tmp_path)
    assert valid is False
    assert any("Missing required field 'command'" in e for e in errors)
    assert any("Missing required field 'repository_commit'" in e for e in errors)


def test_validator_detects_invalid_commit(tmp_path):
    """Verifies that validator detects invalid git commit strings."""
    bad_file = tmp_path / "test-results.json"
    bad_file.write_text(
        json.dumps({
            "timestamp": "2026-09-18T17:40:00Z",
            "tool": "pytest",
            "tool_version": "8.0",
            "command": "pytest",
            "repository_commit": "not-a-sha",
            "status": "PASS",
            "summary": {"passed": 10},
            "raw_result_reference": "README.md",
        }),
        encoding="utf-8",
    )

    valid, errors, _ = validate_single_evidence(bad_file, REPO_ROOT)
    assert valid is False
    assert any("repository_commit must be a 40-character hexadecimal" in e for e in errors)


def test_validator_detects_non_existent_reference(tmp_path):
    """Verifies that validator detects raw_result_reference pointing to non-existent files."""
    bad_file = tmp_path / "test-results.json"
    bad_file.write_text(
        json.dumps({
            "timestamp": "2026-09-18T17:40:00Z",
            "tool": "pytest",
            "tool_version": "8.0",
            "command": "pytest",
            "repository_commit": "211bb7792b985503ca7d770af361d2df89809ef6",
            "status": "PASS",
            "summary": {"passed": 10},
            "raw_result_reference": "non_existent_raw_report_file.json",
        }),
        encoding="utf-8",
    )

    valid, errors, _ = validate_single_evidence(bad_file, REPO_ROOT)
    assert valid is False
    assert any("points to non-existent file" in e for e in errors)


def test_validator_detects_failing_status(tmp_path):
    """Verifies that validator detects non-approved status."""
    bad_file = tmp_path / "test-results.json"
    bad_file.write_text(
        json.dumps({
            "timestamp": "2026-09-18T17:40:00Z",
            "tool": "pytest",
            "tool_version": "8.0",
            "command": "pytest",
            "repository_commit": "211bb7792b985503ca7d770af361d2df89809ef6",
            "status": "FAIL",
            "summary": {"passed": 0},
            "raw_result_reference": "README.md",
        }),
        encoding="utf-8",
    )

    valid, errors, _ = validate_single_evidence(bad_file, REPO_ROOT)
    assert valid is False
    assert any("Status 'FAIL' is not approved" in e for e in errors)


def test_cli_verify_execution():
    """Verifies CLI execution of scripts/generate_security_evidence.py --verify returns exit code 0."""
    cmd = [sys.executable, "scripts/generate_security_evidence.py", "--verify"]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0
    assert "[EVIDENCE VERIFICATION APPROVED]" in proc.stdout


def test_cli_json_execution():
    """Verifies CLI execution of scripts/generate_security_evidence.py --json returns valid JSON payload."""
    cmd = [sys.executable, "scripts/generate_security_evidence.py", "--json"]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0
    data = json.loads(proc.stdout)
    assert data["verified"] is True
    assert data["evidence_files_count"] == 10
    assert not data["errors"]
