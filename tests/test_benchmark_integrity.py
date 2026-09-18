# @ecdat-synthetic-corpus
"""
Unit tests for Phase 29: Benchmark Integrity (P2 Mandate).

Validates:
1. Raw benchmark telemetry exists in `benchmarks/results/latest_benchmark_run.json`.
2. Telemetry contains all required P2 metadata fields:
   - machine specification (CPU, RAM, architecture, cores)
   - OS (system, release, version)
   - runtime versions (Python, Node)
   - dependency versions
   - number of repetitions and warmup policy
   - raw execution time arrays
   - statistical percentiles (median, p95, p99)
   - empirical throughput and failure rate
3. Markdown report is dynamically generated from raw JSON telemetry (zero manual typing).
4. All raw result numbers in the Markdown report match the raw JSON telemetry exactly.
"""

import json
from pathlib import Path
import pytest

from benchmarks.generate_report import generate_markdown_report_from_raw

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = REPO_ROOT / "benchmarks" / "results"
LATEST_JSON = RESULTS_DIR / "latest_benchmark_run.json"
REPORT_MD = REPO_ROOT / "docs" / "BENCHMARK_REPORT.md"


def test_latest_benchmark_telemetry_exists_and_valid():
    """Verify that latest raw benchmark telemetry exists and contains required metadata."""
    assert LATEST_JSON.exists(), f"Raw benchmark file missing: {LATEST_JSON}"
    with open(LATEST_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("benchmark_run_metadata", {})
    assert "machine_specification" in meta
    hw = meta["machine_specification"]
    assert hw.get("processor_model")
    assert hw.get("architecture")
    assert hw.get("logical_cores", 0) > 0
    assert hw.get("total_ram_gb", 0) > 0

    assert "os" in meta
    os_info = meta["os"]
    assert os_info.get("system")
    assert os_info.get("release")
    assert os_info.get("version")

    assert "runtime_versions" in meta
    runtimes = meta["runtime_versions"]
    assert "python" in runtimes
    assert "node" in runtimes

    assert "dependency_versions" in meta
    assert len(meta["dependency_versions"]) > 0

    assert "execution_policy" in meta
    policy = meta["execution_policy"]
    assert policy.get("repetitions", 0) >= 5
    assert policy.get("warmup_policy")


def test_every_benchmark_has_required_fields():
    """Every benchmark in the suite must contain all required P2 statistical fields."""
    with open(LATEST_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    benchmarks = data.get("benchmarks", [])
    assert len(benchmarks) >= 4, f"Expected at least 4 benchmarks, found {len(benchmarks)}"

    for b in benchmarks:
        assert b.get("benchmark_id"), "Missing benchmark_id"
        assert b.get("benchmark_script"), "Missing benchmark_script"
        assert b.get("warmup_policy"), "Missing warmup_policy"
        assert b.get("number_of_repetitions", 0) >= 5, "Repetitions must be >= 5"
        
        raw_res = b.get("raw_results", [])
        assert isinstance(raw_res, list) and len(raw_res) == b["number_of_repetitions"]
        assert all(isinstance(x, (int, float)) and x > 0 for x in raw_res)

        assert "median" in b and b["median"] > 0
        assert "p95" in b and b["p95"] > 0
        assert "p99" in b and b["p99"] > 0
        assert "throughput" in b and len(str(b["throughput"])) > 0
        assert "failure_rate" in b and str(b["failure_rate"]).endswith("%")

        # Input dataset validation
        ds = b.get("input_dataset", {})
        assert ds.get("name")
        assert ds.get("path")
        dataset_path = REPO_ROOT / ds["path"]
        assert dataset_path.exists(), f"Dataset path missing: {dataset_path}"


def test_benchmark_report_matches_raw_telemetry_deterministically(tmp_path):
    """Verify that report generator produces output matching docs/BENCHMARK_REPORT.md exactly."""
    assert REPORT_MD.exists(), f"Benchmark report missing: {REPORT_MD}"
    
    # Generate report to temporary file
    temp_report = tmp_path / "BENCHMARK_REPORT.md"
    generate_markdown_report_from_raw(LATEST_JSON, temp_report)

    actual_text = REPORT_MD.read_text(encoding="utf-8")
    generated_text = temp_report.read_text(encoding="utf-8")

    assert actual_text == generated_text, (
        "docs/BENCHMARK_REPORT.md diverged from raw results generation! "
        "Reports must be purely generated from raw JSON."
    )


def test_report_contains_zero_unverified_figures():
    """Verify that report contains verified percentiles directly from raw JSON."""
    with open(LATEST_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    report_text = REPORT_MD.read_text(encoding="utf-8")

    # Assert that all median values from raw JSON appear in the report
    for b in data.get("benchmarks", []):
        median_str = f"{b['median']}s"
        assert median_str in report_text, f"Median {median_str} missing from report"
        assert b["throughput"] in report_text, f"Throughput {b['throughput']} missing from report"
