"""
ECDAT High-Precision Resource Monitor (Phase 21.1)

Measures live resource utilization across:
- Wall time (microsecond precision via time.perf_counter)
- CPU time (process user + system time via time.process_time and GetProcessTimes)
- CPU utilization percentage
- RAM: Peak Working Set (RSS) in MB (Win32 PSAPI on Windows, getrusage on Unix, tracemalloc fallback)
- RAM: Current Working Set in MB
- Disk I/O: Read and write bytes transferred (GetProcessIoCounters on Windows)
- Filesystem storage footprint: Recursive directory size tracking

Adheres to: "Do not promise arbitrary performance targets before measurement."
All metrics are empirically sampled.
"""

from dataclasses import dataclass, field
import datetime
import os
import sys
import time
import tracemalloc
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# Windows native API bindings for zero-dependency process metrics
IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_uint64),
            ("WriteOperationCount", ctypes.c_uint64),
            ("OtherOperationCount", ctypes.c_uint64),
            ("ReadTransferCount", ctypes.c_uint64),
            ("WriteTransferCount", ctypes.c_uint64),
            ("OtherTransferCount", ctypes.c_uint64),
        ]

    try:
        _kernel32 = ctypes.WinDLL("kernel32")
        _psapi = ctypes.WinDLL("psapi")

        _GetProcessMemoryInfo = _psapi.GetProcessMemoryInfo
        _GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(PROCESS_MEMORY_COUNTERS),
            wintypes.DWORD,
        ]
        _GetProcessMemoryInfo.restype = wintypes.BOOL

        _GetProcessIoCounters = _kernel32.GetProcessIoCounters
        _GetProcessIoCounters.argtypes = [wintypes.HANDLE, ctypes.POINTER(IO_COUNTERS)]
        _GetProcessIoCounters.restype = wintypes.BOOL

        _GetCurrentProcess = _kernel32.GetCurrentProcess
        _GetCurrentProcess.restype = wintypes.HANDLE
    except Exception:
        _GetProcessMemoryInfo = None
        _GetProcessIoCounters = None
        _GetCurrentProcess = None
else:
    _GetProcessMemoryInfo = None
    _GetProcessIoCounters = None
    _GetCurrentProcess = None


@dataclass
class ResourceMetrics:
    wall_time_seconds: float = 0.0
    cpu_time_seconds: float = 0.0
    cpu_utilization_pct: float = 0.0
    peak_ram_mb: float = 0.0
    current_ram_mb: float = 0.0
    heap_peak_mb: float = 0.0
    disk_read_kb: float = 0.0
    disk_write_kb: float = 0.0
    target_disk_mb: float = 0.0
    cache_disk_mb: float = 0.0
    throughput_loc_per_sec: float = 0.0
    throughput_files_per_sec: float = 0.0
    concurrency_workers: int = 1
    total_loc: int = 0
    total_files: int = 0
    sample_timestamp: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "wall_time_seconds": round(self.wall_time_seconds, 4),
            "cpu_time_seconds": round(self.cpu_time_seconds, 4),
            "cpu_utilization_pct": round(self.cpu_utilization_pct, 2),
            "peak_ram_mb": round(self.peak_ram_mb, 2),
            "current_ram_mb": round(self.current_ram_mb, 2),
            "heap_peak_mb": round(self.heap_peak_mb, 2),
            "disk_read_kb": round(self.disk_read_kb, 2),
            "disk_write_kb": round(self.disk_write_kb, 2),
            "target_disk_mb": round(self.target_disk_mb, 2),
            "cache_disk_mb": round(self.cache_disk_mb, 2),
            "throughput_loc_per_sec": round(self.throughput_loc_per_sec, 2),
            "throughput_files_per_sec": round(self.throughput_files_per_sec, 2),
            "concurrency_workers": self.concurrency_workers,
            "total_loc": self.total_loc,
            "total_files": self.total_files,
            "sample_timestamp": self.sample_timestamp,
        }


def get_directory_size_mb(path: Optional[Path]) -> float:
    """Computes total size of directory contents in megabytes."""
    if not path or not path.exists():
        return 0.0
    total_bytes = 0
    try:
        if path.is_file():
            return path.stat().st_size / (1024 * 1024)
        for root, _, files in os.walk(path):
            for f in files:
                try:
                    fp = Path(root) / f
                    total_bytes += fp.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    return total_bytes / (1024 * 1024)


class ResourceMonitor:
    """
    Precision resource monitor bracket capturing live execution statistics.
    Supports context manager pattern:
        with ResourceMonitor() as mon:
            work()
        metrics = mon.metrics
    """

    def __init__(self, target_dir: Optional[Path] = None, cache_dir: Optional[Path] = None):
        self.target_dir = Path(target_dir).resolve() if target_dir else None
        self.cache_dir = Path(cache_dir).resolve() if cache_dir else None
        self.metrics = ResourceMetrics()
        self._start_perf: float = 0.0
        self._start_cpu: float = 0.0
        self._start_read_bytes: int = 0
        self._start_write_bytes: int = 0
        self._is_active: bool = False

    def _get_io_counts(self) -> Tuple[int, int]:
        """Returns (read_bytes, write_bytes) for the current process."""
        if IS_WINDOWS and _GetProcessIoCounters and _GetCurrentProcess:
            try:
                handle = _GetCurrentProcess()
                io = IO_COUNTERS()
                if _GetProcessIoCounters(handle, ctypes.byref(io)):
                    return int(io.ReadTransferCount), int(io.WriteTransferCount)
            except Exception:
                pass
        return 0, 0

    def _get_ram_info(self) -> Tuple[float, float]:
        """Returns (peak_ram_mb, current_ram_mb) for the current process."""
        if IS_WINDOWS and _GetProcessMemoryInfo and _GetCurrentProcess:
            try:
                handle = _GetCurrentProcess()
                pmc = PROCESS_MEMORY_COUNTERS()
                pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
                if _GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb):
                    peak_mb = pmc.PeakWorkingSetSize / (1024 * 1024)
                    curr_mb = pmc.WorkingSetSize / (1024 * 1024)
                    return peak_mb, curr_mb
            except Exception:
                pass

        # Unix fallback using getrusage
        try:
            import resource

            usage = resource.getrusage(resource.RUSAGE_SELF)
            # On Linux maxrss is in KB; on macOS in bytes
            peak_kb = usage.ru_maxrss
            if sys.platform == "darwin":
                peak_kb /= 1024
            return peak_kb / 1024, peak_kb / 1024
        except Exception:
            pass

        return 0.0, 0.0

    def start(self):
        """Starts resource collection."""
        if not tracemalloc.is_tracing():
            tracemalloc.start()
        tracemalloc.reset_peak()

        self._start_perf = time.perf_counter()
        self._start_cpu = time.process_time()
        self._start_read_bytes, self._start_write_bytes = self._get_io_counts()
        self._is_active = True

    def stop(
        self,
        total_loc: int = 0,
        total_files: int = 0,
        concurrency_workers: int = 1,
    ) -> ResourceMetrics:
        """Stops collection and finalizes empirical metrics."""
        end_perf = time.perf_counter()
        end_cpu = time.process_time()
        end_read, end_write = self._get_io_counts()

        wall_time = max(end_perf - self._start_perf, 0.0001)
        cpu_time = max(end_cpu - self._start_cpu, 0.0)
        cpu_pct = (cpu_time / wall_time) * 100.0

        peak_ram_mb, current_ram_mb = self._get_ram_info()

        heap_current, heap_peak = tracemalloc.get_traced_memory()
        heap_peak_mb = heap_peak / (1024 * 1024)

        # Ensure peak RAM reflects at least the Python heap allocation
        if peak_ram_mb < heap_peak_mb:
            peak_ram_mb = heap_peak_mb

        disk_read_kb = max(end_read - self._start_read_bytes, 0) / 1024.0
        disk_write_kb = max(end_write - self._start_write_bytes, 0) / 1024.0

        target_disk_mb = get_directory_size_mb(self.target_dir) if self.target_dir else 0.0
        cache_disk_mb = get_directory_size_mb(self.cache_dir) if self.cache_dir else 0.0

        throughput_loc = (total_loc / wall_time) if total_loc > 0 else 0.0
        throughput_files = (total_files / wall_time) if total_files > 0 else 0.0

        self.metrics = ResourceMetrics(
            wall_time_seconds=wall_time,
            cpu_time_seconds=cpu_time,
            cpu_utilization_pct=cpu_pct,
            peak_ram_mb=peak_ram_mb,
            current_ram_mb=current_ram_mb,
            heap_peak_mb=heap_peak_mb,
            disk_read_kb=disk_read_kb,
            disk_write_kb=disk_write_kb,
            target_disk_mb=target_disk_mb,
            cache_disk_mb=cache_disk_mb,
            throughput_loc_per_sec=throughput_loc,
            throughput_files_per_sec=throughput_files,
            concurrency_workers=concurrency_workers,
            total_loc=total_loc,
            total_files=total_files,
        )
        self._is_active = False
        return self.metrics

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._is_active:
            self.stop()
