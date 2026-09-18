"""
Resource Governance & Denial-of-Service Defense Test Suite — Phase 20 / P1

Tests Python resource governance, concurrency limits, queue depth bounds,
scan timeouts, quotas, and expensive scanning complexity guards.
"""

import time
import pytest
from pathlib import Path
from tempfile import TemporaryDirectory

from scanners.common.resource_governance import (
    ResourceQuotas,
    ResourceQuotaGovernor,
    ScanTimeoutError,
    MemoryQuotaExceededError,
    DiskQuotaExceededError,
    CpuQuotaExceededError,
    ConcurrencyQuotaExceededError,
    QueueDepthExceededError,
    ExpensiveScanComplexityError,
    default_resource_governor,
)


class TestResourceGovernance:

    def setup_method(self):
        default_resource_governor.reset()

    def test_concurrency_quota_tenant_and_system(self):
        gov = ResourceQuotaGovernor(
            quotas=ResourceQuotas(
                max_concurrency_per_tenant=2,
                max_concurrency_system=3,
            )
        )

        # Tenant 1 acquires 2 slots
        assert gov.acquire_concurrency("tenant-1", "s1") is True
        assert gov.acquire_concurrency("tenant-1", "s2") is True

        # Tenant 1 cannot acquire 3rd slot (tenant limit)
        with pytest.raises(ConcurrencyQuotaExceededError) as exc:
            gov.acquire_concurrency("tenant-1", "s3")
        assert "tenant 'tenant-1' reached concurrency quota" in str(exc.value).lower()

        # Tenant 2 acquires 1 slot (now total = 3 = system limit)
        assert gov.acquire_concurrency("tenant-2", "s4") is True

        # System is full (system limit reached)
        with pytest.raises(ConcurrencyQuotaExceededError) as exc:
            gov.acquire_concurrency("tenant-3", "s5")
        assert "system-wide scan concurrency limit reached" in str(exc.value).lower()

        # Releasing permits new scan
        gov.release_concurrency("tenant-1", "s1")
        assert gov.acquire_concurrency("tenant-3", "s5") is True

    def test_queue_depth_limits(self):
        gov = ResourceQuotaGovernor(
            quotas=ResourceQuotas(
                max_queue_depth_per_tenant=10,
                max_queue_depth_system=25,
            )
        )

        # Within bounds
        assert gov.check_queue_depth("tenant-1", 5, 12) is True

        # Tenant queue depth exceeded
        with pytest.raises(QueueDepthExceededError):
            gov.check_queue_depth("tenant-1", 10, 15)

        # System queue depth exceeded
        with pytest.raises(QueueDepthExceededError):
            gov.check_queue_depth("tenant-1", 5, 25)

    def test_memory_quota_validation(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(memory_quota_mb=512.0))
        # Within quota
        gov.check_memory_quota(256.0)

        # Exceeds quota
        with pytest.raises(MemoryQuotaExceededError):
            gov.check_memory_quota(600.0)

    def test_disk_quota_validation(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(disk_quota_mb=500.0))
        # Within quota
        gov.check_disk_quota(100.0)

        # Exceeds quota
        with pytest.raises(DiskQuotaExceededError):
            gov.check_disk_quota(550.0)

    def test_cpu_quota_validation(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(cpu_quota_pct=80.0))
        # Within quota
        gov.check_cpu_quota(50.0)

        # Exceeds quota
        with pytest.raises(CpuQuotaExceededError):
            gov.check_cpu_quota(92.5)

    def test_governed_scan_successful_execution(self):
        gov = ResourceQuotaGovernor()

        def fast_scan(val: int) -> int:
            return val * 2

        res = gov.run_governed_scan(fast_scan, 21, tenant_id="t-fast")
        assert res == 42
        assert gov.get_active_count("t-fast") == 0

    def test_governed_scan_timeout_enforcement(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(scan_timeout_seconds=0.1))

        def slow_scan():
            time.sleep(0.5)
            return "done"

        with pytest.raises(ScanTimeoutError):
            gov.run_governed_scan(slow_scan, tenant_id="t-slow", timeout_seconds=0.1)

        # Concurrency slot must be guaranteed released on timeout
        assert gov.get_active_count("t-slow") == 0

    def test_repository_complexity_dos_defense_depth(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(max_directory_depth=3))

        with TemporaryDirectory() as tmpdir:
            deep_path = Path(tmpdir) / "level1" / "level2" / "level3" / "level4"
            deep_path.mkdir(parents=True, exist_ok=True)
            (deep_path / "target.py").write_text("# code")

            with pytest.raises(ExpensiveScanComplexityError) as exc:
                gov.check_repository_complexity(tmpdir)
            assert "directory nesting depth" in str(exc.value).lower()

    def test_repository_complexity_dos_defense_file_count(self):
        gov = ResourceQuotaGovernor(quotas=ResourceQuotas(max_scan_files=5))

        with TemporaryDirectory() as tmpdir:
            p = Path(tmpdir)
            for i in range(7):
                (p / f"file_{i}.txt").write_text("synthetic content")

            with pytest.raises(ExpensiveScanComplexityError) as exc:
                gov.check_repository_complexity(tmpdir)
            assert "repository file count" in str(exc.value).lower()
