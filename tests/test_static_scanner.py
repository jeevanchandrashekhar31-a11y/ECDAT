import os
import json
import subprocess
from pathlib import Path


def test_sarif_output_contains_results():
    """Test that static scanner runs and outputs valid SARIF for fixtures."""
    out_sarif = "artifacts/test_static_results.sarif"

    # Run the scanner against the static fixtures
    result = subprocess.run(
        [
            "python",
            "-m",
            "scanners.static.main",
            "tests/fixtures/static/",
            "-o",
            "artifacts/test_static_cbom.json",
            "--output-sarif",
            out_sarif,
        ],
        capture_output=True,
        text=True,
    )

    # It might return non-zero if criticals are found, that's expected
    # but SARIF file must exist
    assert os.path.exists(out_sarif), "SARIF output file was not created"

    with open(out_sarif, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["version"] == "2.1.0"
    assert "runs" in data
    assert len(data["runs"]) > 0

    run = data["runs"][0]
    assert "results" in run

    # Fixtures should produce findings
    assert len(run["results"]) > 0

    # Check that secrets are redacted in evidence snippet
    for r in run["results"]:
        snippet = (
            r.get("locations", [{}])[0].get("physicalLocation", {}).get("region", {}).get("snippet", {}).get("text", "")
        )
        # Should not contain "password" or raw PEM if properly redacted
        assert "BEGIN PRIVATE KEY" not in snippet


def test_fail_on_critical():
    """Test that --fail-on critical exits with 1 when finding weak hashes."""
    result = subprocess.run(
        [
            "python",
            "-m",
            "scanners.static.main",
            "tests/fixtures/static/",
            "-o",
            "artifacts/test_static_cbom.json",
            "--fail-on",
            "critical",
        ],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert "Critical findings detected! Failing pipeline." in result.stderr


def test_fail_on_high_includes_high_findings_and_keeps_artifact():
    """High gates include High findings, while none remains report-only."""
    artifact = "artifacts/test_high_gate_cbom.json"
    result = subprocess.run(
        ["python", "-m", "scanners.static.main", "tests/fixtures/static/", "-o", artifact, "--fail-on", "high"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 1
    assert os.path.exists(artifact), "CBOM must be retained when the gate fails"

    report_only = subprocess.run(
        [
            "python",
            "-m",
            "scanners.static.main",
            "tests/fixtures/static/",
            "-o",
            "artifacts/test_report_only_cbom.json",
            "--fail-on",
            "none",
        ],
        capture_output=True,
        text=True,
    )
    assert report_only.returncode == 0


def test_safe_directory_traversal():
    """Test that scanner skips unreadable/symlinks properly."""
    # Ensure it prints skipped stats
    result = subprocess.run(
        ["python", "-m", "scanners.static.main", "tests/fixtures/static/", "-o", "artifacts/test_static_cbom.json"],
        capture_output=True,
        text=True,
    )

    assert "Skipped files:" in result.stdout
