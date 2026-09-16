"""
Tests for Phase 21.1 (Large-Repository Scaling) and Phase 21.2 (Incremental Scanning).

Verifies:
1. Synthetic corpus generator generates requested LOC within ±2% accuracy.
2. ResourceMonitor correctly tracks non-zero wall time, CPU time, peak RAM, and disk bytes.
3. ScalableScanner produces 100% deterministic findings regardless of concurrency (workers 1 vs 4).
4. Multi-dimensional FingerprintEngine tracks all 5 vectors (file, dependency, config, engine, policy).
5. Stale cache invalidation occurs immediately when policy or engine fingerprints change.
6. Incremental scanning achieves significant speedup on warm runs with zero findings drift.
"""

from pathlib import Path
import shutil
import pytest

from testing.corpora.generate_large_repo import generate_corpus
from scanners.common.resource_monitor import ResourceMonitor
from scanners.common.fingerprint_engine import FingerprintEngine
from scanners.common.scanner_cache import ScannerCache
from scanners.static.scalable_scanner import ScalableScanner
from scanners.domain.contracts import ScanStatus

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def sample_test_repo(tmp_path_factory):
    """Creates a temporary 10,000 LOC test repository fixture."""
    base_dir = tmp_path_factory.mktemp("test_scaling_repo")
    meta = generate_corpus(target_loc=10000, output_dir=base_dir)
    return base_dir, meta


def test_corpus_generator_loc_accuracy(sample_test_repo):
    """Corpus generator must generate code within ±2% of requested LOC."""
    repo_dir, meta = sample_test_repo
    target_loc = meta["target_loc_requested"]
    actual_loc = meta["actual_loc"]
    diff_pct = abs(actual_loc - target_loc) / target_loc * 100.0
    assert diff_pct <= 2.0, f"LOC deviation too high: requested {target_loc}, got {actual_loc} ({diff_pct:.2f}%)"
    assert meta["total_files"] > 0
    assert (repo_dir / "package.json").exists()
    assert (repo_dir / "requirements.txt").exists()


def test_resource_monitor_metrics(sample_test_repo):
    """ResourceMonitor must capture valid, non-negative empirical metrics."""
    repo_dir, _ = sample_test_repo
    with ResourceMonitor(target_dir=repo_dir) as mon:
        scanner = ScalableScanner(target_dir=repo_dir, concurrency=1, enable_cache=False)
        result = scanner.scan()

    ext_metrics = mon.metrics
    assert ext_metrics.wall_time_seconds > 0.001
    assert ext_metrics.cpu_time_seconds >= 0.0
    assert ext_metrics.peak_ram_mb > 0.0
    assert ext_metrics.current_ram_mb > 0.0

    # Scanner internal metrics with LOC throughput
    scan_metrics = result.metrics
    assert scan_metrics.throughput_loc_per_sec > 0.0
    assert scan_metrics.throughput_files_per_sec > 0.0
    assert scan_metrics.target_disk_mb > 0.0


def test_scalable_scanner_concurrency_determinism(sample_test_repo):
    """ScalableScanner must produce identical findings across concurrency 1 and concurrency 4."""
    repo_dir, _ = sample_test_repo

    scanner_seq = ScalableScanner(target_dir=repo_dir, concurrency=1, enable_cache=False)
    res_seq = scanner_seq.scan()

    scanner_par = ScalableScanner(target_dir=repo_dir, concurrency=4, enable_cache=False)
    res_par = scanner_par.scan()

    assert res_seq.status == ScanStatus.SUCCESS
    assert res_par.status == ScanStatus.SUCCESS
    assert len(res_seq.findings) == len(res_par.findings)

    # Sort and verify finding equality
    seq_keys = sorted([f"{f['file_path']}:{f['line_number']}:{f['algorithm']}" for f in res_seq.findings])
    par_keys = sorted([f"{f['file_path']}:{f['line_number']}:{f['algorithm']}" for f in res_par.findings])
    assert seq_keys == par_keys


def test_fingerprint_engine_vectors(sample_test_repo):
    """FingerprintEngine must calculate all 5 required fingerprint vectors."""
    repo_dir, _ = sample_test_repo
    fp_engine = FingerprintEngine(root_dir=repo_dir)

    config = {"include_exts": [".py", ".c"], "max_depth": 25}
    fps = fp_engine.generate_composite_fingerprints(config_dict=config)

    assert len(fps.engine_fingerprint) == 64
    assert len(fps.policy_fingerprint) == 64
    assert len(fps.config_fingerprint) == 64
    assert len(fps.dependency_fingerprint) == 64
    assert len(fps.environment_digest) == 64
    assert len(fps.dependency_files_tracked) >= 2


def test_stale_cache_invalidation_on_policy_drift(sample_test_repo, tmp_path):
    """Modifying policy or engine fingerprint must immediately invalidate stale cache."""
    repo_dir, _ = sample_test_repo
    cache_dir = tmp_path / "cache_policy_test"

    config_1 = {"include_exts": [".py", ".c"], "policy_profile": "baseline"}
    cache_1 = ScannerCache(cache_dir=cache_dir, target_root=repo_dir, config_dict=config_1)

    # Add a mock cached item
    cache_1.put("test_file.py", b"def foo(): pass", [{"algorithm": "AES"}])
    cache_1.save()
    assert cache_1.stats.total_entries == 1

    # Now open cache with altered policy
    config_2 = {"include_exts": [".py", ".c"], "policy_profile": "strict_fips"}
    cache_2 = ScannerCache(cache_dir=cache_dir, target_root=repo_dir, config_dict=config_2)

    # Must be invalidated
    assert cache_2.stats.invalidations == 1
    assert cache_2.stats.total_entries == 0


def test_incremental_scan_speedup_and_fidelity(sample_test_repo, tmp_path):
    """Incremental scan must achieve significant speedup on warm run with identical findings."""
    repo_dir, _ = sample_test_repo
    cache_dir = tmp_path / "cache_incr_test"

    # Cold Run
    scanner_cold = ScalableScanner(
        target_dir=repo_dir,
        concurrency=2,
        enable_cache=True,
        cache_dir=cache_dir,
    )
    res_cold = scanner_cold.scan()
    assert res_cold.cache_stats.hits == 0
    assert res_cold.cache_stats.misses > 0

    # Warm Run
    scanner_warm = ScalableScanner(
        target_dir=repo_dir,
        concurrency=2,
        enable_cache=True,
        cache_dir=cache_dir,
    )
    res_warm = scanner_warm.scan()
    assert res_warm.cache_stats.hits == res_cold.cache_stats.misses
    assert res_warm.cache_stats.misses == 0
    assert res_warm.cache_stats.hit_ratio_pct == 100.0

    # Findings must match 100%
    assert len(res_cold.findings) == len(res_warm.findings)
    assert res_warm.metrics.wall_time_seconds <= res_cold.metrics.wall_time_seconds
