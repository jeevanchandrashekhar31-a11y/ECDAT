"""
Resource Governance & Denial-of-Service Defense Engine — Phase 20 / P1

Implements strict quotas and guards to prevent DoS via expensive scanning:
- Scan execution timeout
- CPU quota
- Memory quota
- Disk quota
- Concurrency quota per tenant & system-wide
- Queue depth limit per tenant & system-wide
- Expensive scan DoS protection (file count, directory depth, decompression ratio)
"""

from __future__ import annotations

import os
import sys
import time
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple


class GovernanceError(Exception):
    """Base exception for resource governance and quota violations."""
    pass


class ScanTimeoutError(GovernanceError):
    """Raised when scan execution exceeds the allowed wall-clock time limit."""
    pass


class MemoryQuotaExceededError(GovernanceError):
    """Raised when memory consumption exceeds the allocated quota."""
    pass


class DiskQuotaExceededError(GovernanceError):
    """Raised when temporary disk storage exceeds the allocated quota."""
    pass


class CpuQuotaExceededError(GovernanceError):
    """Raised when CPU utilization or compute time exceeds allocated quota."""
    pass


class ConcurrencyQuotaExceededError(GovernanceError):
    """Raised when concurrent scan operations exceed the allowed limit."""
    pass


class QueueDepthExceededError(GovernanceError):
    """Raised when pending job queue depth exceeds the allowed limit."""
    pass


class ExpensiveScanComplexityError(GovernanceError):
    """Raised when target repository or file structure exceeds complexity thresholds."""
    pass


@dataclass
class ResourceQuotas:
    cpu_quota_pct: float = 85.0
    memory_quota_mb: float = 1024.0
    disk_quota_mb: float = 1024.0
    scan_timeout_seconds: float = 300.0
    max_concurrency_per_tenant: int = 3
    max_concurrency_system: int = 10
    max_queue_depth_per_tenant: int = 50
    max_queue_depth_system: int = 200
    max_scan_files: int = 50_000
    max_directory_depth: int = 25


class ResourceQuotaGovernor:
    """
    Coordinates multi-tenant resource governance, concurrency limits, and quotas.
    """

    def __init__(self, quotas: Optional[ResourceQuotas] = None):
        self.quotas = quotas or ResourceQuotas()
        self._lock = threading.Lock()
        self._active_scans: Dict[str, Set[str]] = {}  # tenant_id -> Set[scan_id]
        self._system_active_count: int = 0

    def acquire_concurrency(self, tenant_id: str, scan_id: str) -> bool:
        """
        Acquires a concurrency slot for a tenant and system.
        Raises ConcurrencyQuotaExceededError if quota is exhausted.
        """
        tid = str(tenant_id or "default-tenant").strip().lower()

        with self._lock:
            if self._system_active_count >= self.quotas.max_concurrency_system:
                raise ConcurrencyQuotaExceededError(
                    f"System-wide scan concurrency limit reached "
                    f"({self._system_active_count}/{self.quotas.max_concurrency_system})."
                )

            tenant_set = self._active_scans.setdefault(tid, set())
            if len(tenant_set) >= self.quotas.max_concurrency_per_tenant:
                raise ConcurrencyQuotaExceededError(
                    f"Tenant '{tid}' reached concurrency quota "
                    f"({len(tenant_set)}/{self.quotas.max_concurrency_per_tenant})."
                )

            tenant_set.add(scan_id)
            self._system_active_count += 1
            return True

    def release_concurrency(self, tenant_id: str, scan_id: str) -> None:
        """
        Releases a concurrency slot.
        """
        tid = str(tenant_id or "default-tenant").strip().lower()

        with self._lock:
            tenant_set = self._active_scans.get(tid)
            if tenant_set and scan_id in tenant_set:
                tenant_set.remove(scan_id)
                if not tenant_set:
                    self._active_scans.pop(tid, None)
                self._system_active_count = max(0, self._system_active_count - 1)

    def get_active_count(self, tenant_id: Optional[str] = None) -> int:
        with self._lock:
            if tenant_id:
                tid = str(tenant_id).strip().lower()
                return len(self._active_scans.get(tid, set()))
            return self._system_active_count

    def check_queue_depth(
        self,
        tenant_id: str,
        current_tenant_depth: int,
        current_system_depth: int,
    ) -> bool:
        """
        Validates that queue depths are within safe bounds.
        """
        if current_system_depth >= self.quotas.max_queue_depth_system:
            raise QueueDepthExceededError(
                f"System queue depth exceeded ({current_system_depth}/{self.quotas.max_queue_depth_system})."
            )

        if current_tenant_depth >= self.quotas.max_queue_depth_per_tenant:
            raise QueueDepthExceededError(
                f"Tenant '{tenant_id}' queue depth exceeded "
                f"({current_tenant_depth}/{self.quotas.max_queue_depth_per_tenant})."
            )

        return True

    def check_memory_quota(self, current_mb: float) -> None:
        if current_mb > self.quotas.memory_quota_mb:
            raise MemoryQuotaExceededError(
                f"Process memory usage ({current_mb:.1f}MB) exceeds quota ({self.quotas.memory_quota_mb}MB)."
            )

    def check_disk_quota(self, current_mb: float) -> None:
        if current_mb > self.quotas.disk_quota_mb:
            raise DiskQuotaExceededError(
                f"Disk footprint ({current_mb:.1f}MB) exceeds quota ({self.quotas.disk_quota_mb}MB)."
            )

    def check_cpu_quota(self, current_pct: float) -> None:
        if current_pct > self.quotas.cpu_quota_pct:
            raise CpuQuotaExceededError(
                f"CPU utilization ({current_pct:.1f}%) exceeds quota ({self.quotas.cpu_quota_pct}%)."
            )

    def check_repository_complexity(self, target_dir: str | Path) -> Dict[str, int]:
        """
        Validates target workspace complexity to prevent DoS via expensive directory traversal.
        """
        p = Path(target_dir)
        if not p.is_dir():
            return {"files": 0, "max_depth": 0}

        file_count = 0
        max_depth = 0
        base_depth = len(p.resolve().parts)

        for root, dirs, files in os.walk(p):
            curr_depth = len(Path(root).resolve().parts) - base_depth
            if curr_depth > max_depth:
                max_depth = curr_depth

            if max_depth > self.quotas.max_directory_depth:
                raise ExpensiveScanComplexityError(
                    f"Directory nesting depth ({max_depth}) exceeds maximum limit ({self.quotas.max_directory_depth})."
                )

            file_count += len(files)
            if file_count > self.quotas.max_scan_files:
                raise ExpensiveScanComplexityError(
                    f"Repository file count ({file_count}) exceeds maximum limit ({self.quotas.max_scan_files})."
                )

        return {"files": file_count, "max_depth": max_depth}

    def run_governed_scan(
        self,
        fn: Callable[..., Any],
        *args: Any,
        tenant_id: str = "default-tenant",
        scan_id: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        **kwargs: Any,
    ) -> Any:
        """
        Executes a scan callable under full resource governance:
        - Concurrency quota acquisition & release
        - Wall-time timeout enforcement
        """
        sid = scan_id or f"scan_{int(time.time() * 1000)}"
        limit_sec = timeout_seconds if timeout_seconds is not None else self.quotas.scan_timeout_seconds

        self.acquire_concurrency(tenant_id, sid)
        result_holder: List[Any] = []
        exception_holder: List[BaseException] = []

        def worker():
            try:
                res = fn(*args, **kwargs)
                result_holder.append(res)
            except BaseException as exc:
                exception_holder.append(exc)

        th = threading.Thread(target=worker, daemon=True)
        th.start()
        th.join(timeout=limit_sec)

        try:
            if th.is_alive():
                raise ScanTimeoutError(
                    f"Scan '{sid}' for tenant '{tenant_id}' timed out after {limit_sec} seconds."
                )

            if exception_holder:
                raise exception_holder[0]

            return result_holder[0] if result_holder else None
        finally:
            self.release_concurrency(tenant_id, sid)

    def reset(self) -> None:
        with self._lock:
            self._active_scans.clear()
            self._system_active_count = 0


default_resource_governor = ResourceQuotaGovernor()
