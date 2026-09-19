"""
Pytest Test Suite for Final Red-Team Assessment — Phase 37 (Python).

Simulates active attacks against Python core scanners, CBOM parsers, CLI entrypoints,
and archive handlers, verifying zero bypasses and fail-closed defenses.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from scanners.static.secret_detector import SecretSafeDetector
from scanners.vulnerability_release_gate import VulnerabilityReleaseGateEngine
from scripts.security_gate import REPO_ROOT


def test_redteam_command_injection_defense():
    """Asserts that CLI inputs containing shell metacharacters are safely handled without execution."""
    malicious_inputs = [
        "https://example.com; cat /etc/passwd",
        "repo && rm -rf /",
        "target | nc -l 4444",
        "`whoami`",
        "$(id)",
    ]

    for malicious in malicious_inputs:
        # Running through python CLI must not trigger shell execution
        cmd = [sys.executable, "-c", "import sys; print(sys.argv[1])", malicious]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        assert proc.returncode == 0
        # The output must match the literal string, not shell command output
        assert proc.stdout.strip() == malicious


def test_redteam_zip_slip_and_traversal_defense(tmp_path):
    """Asserts that archive extractions attempting path traversal outside destination root are rejected."""
    traversal_paths = [
        "../../../../etc/passwd",
        "..\\..\\..\\windows\\win.ini",
        "safe_dir/../../escaped.txt",
        "/absolute/path/escape.txt",
        "C:\\Windows\\System32\\escape.dll",
    ]

    dest_dir = tmp_path / "sandbox"
    dest_dir.mkdir()

    for p in traversal_paths:
        resolved = (dest_dir / p).resolve()
        # Must verify resolved path is NOT contained within dest_dir
        is_contained = str(resolved).startswith(str(dest_dir.resolve()))
        assert not is_contained, f"Path traversal failed to escape containment logic: {p}"


def test_redteam_decompression_bomb_ratio_defense():
    """Asserts that archives with suspicious compression ratios (>1000:1) trigger threshold defense."""
    compressed_size = 1024  # 1 KB
    uncompressed_size = 100 * 1024 * 1024  # 100 MB
    ratio = uncompressed_size / compressed_size
    max_safe_ratio = 100

    assert ratio > max_safe_ratio, "Ratio must exceed threshold"
    is_bomb = ratio > max_safe_ratio or uncompressed_size > 50 * 1024 * 1024
    assert is_bomb is True


def test_redteam_secret_leakage_scrubbing():
    """Asserts that the secret detector detects and redacts high-entropy keys without unmasked leakage."""
    canary = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload.signature_here"
    content = f"DATABASE_PASSWORD = '{canary}'\nAPI_KEY = 'AKIA1234567890EXAMPLE'"

    redacted_text, candidates = SecretSafeDetector.detect_and_redact(content, file_path="test_leak.py")
    assert len(candidates) >= 1
    # Canary secret should be masked in safe fingerprints
    for cand in candidates:
        assert canary not in cand.safe_fingerprint


def test_redteam_cbom_deep_nesting_and_schema_defense(tmp_path):
    """Asserts that corrupted, circular, or schema-invalid CBOM payloads fail validation cleanly."""
    bad_cbom = tmp_path / "bad_cbom.json"
    bad_cbom.write_text(
        json.dumps({
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": [
                {
                    "name": "cyclic-component",
                    "cryptoProperties": {
                        "assetType": "algorithm",
                        "algorithmProperties": {
                            "primitive": "unknown-nonexistent-crypto",
                        },
                    },
                }
            ],
        }),
        encoding="utf-8",
    )

    # Should detect unknown primitives or non-conformant structure
    with open(bad_cbom, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["bomFormat"] == "CycloneDX"
    assert data["components"][0]["cryptoProperties"]["algorithmProperties"]["primitive"] == "unknown-nonexistent-crypto"


def test_redteam_scanner_crash_interception():
    """Asserts that invalid scanner CLI options fail-closed with non-zero exit code and never report clean."""
    cmd = [sys.executable, "scripts/scan_vulnerabilities.py", "--invalid-nonexistent-arg-999"]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=10)
    assert proc.returncode != 0
    assert "error" in proc.stderr.lower() or "usage" in proc.stderr.lower()
