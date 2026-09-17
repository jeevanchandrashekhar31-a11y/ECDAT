"""
ECDAT Scalable Concurrent Scanner (Phase 21.1, 21.2, 21.3)

Provides high-throughput, multi-worker cryptographic discovery for large repositories:
- Concurrency Scaling: Parallel file analysis (1, 2, 4, 8+ workers).
- Incremental Caching: Content-addressed 5D fingerprint cache skipping unmodified files.
- Job-Level Isolation: Per-file and per-engine failure isolation (SUCCESS/PARTIAL/FAILED).
- Zero Arbitrary Claims: Live metrics measured via ResourceMonitor.
"""

from dataclasses import asdict, dataclass, field
import datetime
import os
from pathlib import Path
import sys
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

from scanners.static.discovery import FileDiscovery
from scanners.static.regex_rules import apply_regex_rules
from scanners.static.sanitization import redact_secrets
from scanners.static.results import StaticFinding
from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.secret_detector import SecretSafeDetector
from scanners.cbom_mapping import code_finding_to_cbom, merge_cboms, serialize_cbom
from scanners.models import CodeCryptoFinding
from scanners.common.resource_monitor import ResourceMonitor, ResourceMetrics
from scanners.common.scanner_cache import ScannerCache, CacheStats
from scanners.common.job_isolation import (
    EngineJobReport,
    StructuredError,
    ScanStatus,
)
from scanners.domain.errors import (
    EcdatException,
    ErrorCategory,
    ErrorCode,
    ParserFailureError,
    PermissionFailureError,
)

DEFAULT_INCLUDE_EXTS = {
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".go",
    ".js",
    ".mjs",
    ".cjs",
    ".py",
    ".pyw",
    ".java",
    ".kt",
    ".kts",
    ".ts",
    ".tsx",
    ".cs",
    ".rs",
}

DEFAULT_EXCLUDE_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".venv", "__pycache__", ".pytest_cache"}


def scan_single_file(
    fpath: Path,
    root_dir: Path,
    registry: Any,
    cache: Optional[ScannerCache] = None,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]], int]:
    """
    Analyzes an individual source file with error trapping and caching.
    Returns (findings, structured_error_or_none, line_count).
    """
    rel_path = str(fpath.relative_to(root_dir)).replace("\\", "/")
    try:
        with open(fpath, "rb") as f:
            source_bytes = f.read()
        content = source_bytes.decode("utf-8", errors="replace")
    except (PermissionError, OSError) as pe:
        err = PermissionFailureError(
            f"Cannot read file '{rel_path}': {pe}",
            {"file": rel_path},
            fatal=False,
        ).to_dict()
        return [], err, 0

    loc = content.count("\n") + (1 if content else 0)

    # 1. Check Incremental Cache
    if cache:
        cached = cache.get(rel_path, source_bytes)
        if cached is not None:
            return cached, None, loc

    ext = fpath.suffix.lower()
    ast_findings: List[StaticFinding] = []
    file_errors: List[Dict[str, Any]] = []

    # 2. AST Extraction
    adapter = registry.get_by_extension(ext)
    if adapter:
        try:
            ast_findings = adapter.extract_findings(source_bytes, fpath, root_dir)
        except Exception as e:
            file_errors.append(
                ParserFailureError(
                    f"AST parsing failed for '{rel_path}': {e}",
                    {"file": rel_path},
                    fatal=False,
                ).to_dict()
            )

    # 3. Regex Rule Matching
    regex_findings: List[StaticFinding] = []
    try:
        raw_matches = apply_regex_rules(content)
        for m in raw_matches:
            sanitized = redact_secrets(m.get("evidence", ""))
            f_item = StaticFinding(
                file_path=rel_path,
                line_number=m.get("line_number", 1),
                rule_id=m.get("rule_id", "ECDAT-STATIC"),
                algorithm=m.get("algorithm", "UNKNOWN"),
                evidence=sanitized,
                confidence=m.get("confidence", "medium"),
                finding_type=m.get("finding_type", "crypto_api_call"),
                severity=m.get("severity", "medium"),
            )
            regex_findings.append(f_item)
    except Exception as re_err:
        file_errors.append(
            ParserFailureError(
                f"Regex scanner failed on '{rel_path}': {re_err}",
                {"file": rel_path},
                fatal=False,
            ).to_dict()
        )

    # 4. Deduplicate Findings
    dedup: Dict[str, Dict[str, Any]] = {}
    for af in ast_findings:
        key = f"{af.file_path}:{af.line_number}:{af.algorithm}"
        dedup[key] = {
            "file_path": af.file_path,
            "line_number": af.line_number,
            "rule_id": af.rule_id,
            "algorithm": af.algorithm,
            "evidence": af.evidence,
            "confidence": af.confidence,
            "finding_type": af.finding_type,
            "severity": af.severity,
            "analysis_source": "ast",
        }

    for rf in regex_findings:
        key = f"{rf.file_path}:{rf.line_number}:{rf.algorithm}"
        if key not in dedup:
            dedup[key] = {
                "file_path": rf.file_path,
                "line_number": rf.line_number,
                "rule_id": rf.rule_id,
                "algorithm": rf.algorithm,
                "evidence": rf.evidence,
                "confidence": rf.confidence,
                "finding_type": rf.finding_type,
                "severity": rf.severity,
                "analysis_source": "regex",
            }

    # 5. Secret-Safe Key Candidate Detection
    try:
        _, secret_candidates = SecretSafeDetector.detect_and_redact(content, file_path=rel_path)
        secret_findings = SecretSafeDetector.create_static_findings(secret_candidates)
        for sf in secret_findings:
            key = f"{sf.file_path}:{sf.line_number}:{sf.algorithm}"
            if key not in dedup:
                dedup[key] = {
                    "file_path": sf.file_path,
                    "line_number": sf.line_number,
                    "rule_id": sf.rule_id,
                    "algorithm": sf.algorithm,
                    "evidence": sf.evidence,
                    "confidence": sf.confidence,
                    "finding_type": sf.finding_type,
                    "severity": sf.severity,
                    "analysis_source": "secret_detector",
                }
    except Exception:
        pass

    # Cap findings per file at 500
    final_findings = list(dedup.values())[:500]

    # Store into cache on miss
    if cache:
        cache.put(rel_path, source_bytes, final_findings)

    first_err = file_errors[0] if file_errors else None
    return final_findings, first_err, loc


@dataclass
class ScalableScanResult:
    status: ScanStatus
    findings: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    total_files_discovered: int = 0
    total_files_scanned: int = 0
    total_loc: int = 0
    concurrency_workers: int = 1
    metrics: ResourceMetrics = field(default_factory=ResourceMetrics)
    cache_stats: CacheStats = field(default_factory=CacheStats)
    cbom_json: Optional[str] = None
    engine_report: Optional[EngineJobReport] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status.value,
            "total_findings": len(self.findings),
            "total_files_discovered": self.total_files_discovered,
            "total_files_scanned": self.total_files_scanned,
            "total_loc": self.total_loc,
            "concurrency_workers": self.concurrency_workers,
            "metrics": self.metrics.to_dict(),
            "cache_stats": self.cache_stats.to_dict(),
            "errors_count": len(self.errors),
            "errors": self.errors,
            "findings": self.findings,
        }


class ScalableScanner:
    """
    High-throughput discovery coordinator with concurrency, caching, and failure isolation.
    """

    def __init__(
        self,
        target_dir: str | Path,
        concurrency: int = 1,
        include_exts: Optional[Set[str]] = None,
        exclude_dirs: Optional[Set[str]] = None,
        max_file_size_mb: int = 10,
        max_files: int = 100000,
        max_depth: int = 25,
        enable_cache: bool = True,
        cache_dir: Optional[str | Path] = None,
        rules_path: Optional[str | Path] = None,
    ):
        self.target_dir = Path(target_dir).resolve()
        self.concurrency = max(1, concurrency)
        self.include_exts = include_exts or set(DEFAULT_INCLUDE_EXTS)
        self.exclude_dirs = exclude_dirs or set(DEFAULT_EXCLUDE_DIRS)
        self.max_file_size_bytes = max_file_size_mb * 1024 * 1024
        self.max_files = max_files
        self.max_depth = max_depth
        self.enable_cache = enable_cache
        self.cache_dir = Path(cache_dir).resolve() if cache_dir else None
        self.rules_path = Path(rules_path).resolve() if rules_path else None

        # Configuration signature for cache fingerprinting
        self.config_dict = {
            "include_exts": sorted(list(self.include_exts)),
            "exclude_dirs": sorted(list(self.exclude_dirs)),
            "max_file_size_mb": max_file_size_mb,
            "max_depth": max_depth,
            "rules_path": str(self.rules_path) if self.rules_path else "",
        }

        self.cache = ScannerCache(
            cache_dir=self.cache_dir,
            target_root=self.target_dir,
            config_dict=self.config_dict,
            enabled=self.enable_cache,
        )

    def scan(self) -> ScalableScanResult:
        """
        Executes parallel discovery with live resource monitoring.
        """
        monitor = ResourceMonitor(target_dir=self.target_dir, cache_dir=self.cache.cache_dir)
        monitor.start()

        discovery = FileDiscovery(
            root_dir=str(self.target_dir),
            include_exts=self.include_exts,
            exclude_dirs=self.exclude_dirs,
            max_file_size_bytes=self.max_file_size_bytes,
            max_files=self.max_files,
            max_depth=self.max_depth,
        )

        try:
            files_to_scan = discovery.discover_files()
        except Exception as de:
            metrics = monitor.stop()
            err = StructuredError(
                code=ErrorCode.ERR_INPUT_INVALID_TARGET.value,
                category=ErrorCategory.INVALID_INPUT.value,
                message=f"Discovery failed for '{self.target_dir}': {de}",
                fatal=True,
            ).to_dict()
            return ScalableScanResult(
                status=ScanStatus.FAILED,
                errors=[err],
                metrics=metrics,
                cache_stats=self.cache.stats,
            )

        registry = get_default_adapter_registry()
        all_findings: List[Dict[str, Any]] = []
        all_errors: List[Dict[str, Any]] = []
        total_loc = 0
        scanned_count = 0

        # Execute parallel scan using worker pool
        if self.concurrency > 1 and len(files_to_scan) > 1:
            with ThreadPoolExecutor(max_workers=self.concurrency) as executor:
                future_to_file = {
                    executor.submit(scan_single_file, fp, self.target_dir, registry, self.cache): fp
                    for fp in files_to_scan
                }
                for future in as_completed(future_to_file):
                    scanned_count += 1
                    try:
                        file_findings, file_err, loc = future.result()
                        all_findings.extend(file_findings)
                        total_loc += loc
                        if file_err:
                            all_errors.append(file_err)
                    except Exception as exc:
                        fp = future_to_file[future]
                        all_errors.append(
                            StructuredError(
                                code=ErrorCode.ERR_SCANNER_UNHANDLED_EXCEPTION.value,
                                category=ErrorCategory.SCANNER_FAILURE.value,
                                message=f"Task exception on '{fp.name}': {exc}",
                                fatal=False,
                            ).to_dict()
                        )
        else:
            # Single-worker execution
            for fp in files_to_scan:
                scanned_count += 1
                try:
                    file_findings, file_err, loc = scan_single_file(fp, self.target_dir, registry, self.cache)
                    all_findings.extend(file_findings)
                    total_loc += loc
                    if file_err:
                        all_errors.append(file_err)
                except Exception as exc:
                    all_errors.append(
                        StructuredError(
                            code=ErrorCode.ERR_SCANNER_UNHANDLED_EXCEPTION.value,
                            category=ErrorCategory.SCANNER_FAILURE.value,
                            message=f"File exception on '{fp.name}': {exc}",
                            fatal=False,
                        ).to_dict()
                    )

        # Save cache manifest and update storage size
        if self.enable_cache:
            self.cache.save()

        # Stop metrics collector
        metrics = monitor.stop(
            total_loc=total_loc,
            total_files=scanned_count,
            concurrency_workers=self.concurrency,
        )

        # Evaluate scan status
        has_fatal = any(e.get("fatal", False) for e in all_errors)
        if has_fatal:
            status = ScanStatus.FAILED
        elif all_errors:
            status = ScanStatus.PARTIAL if (all_findings or scanned_count > 0) else ScanStatus.FAILED
        else:
            status = ScanStatus.SUCCESS

        # Generate EngineJobReport for job isolation tracking
        engine_report = EngineJobReport(
            engine_name="static_code_scanner",
            status=status,
            findings=all_findings,
            errors=all_errors,
            targets_scanned=scanned_count,
            targets_failed=len(all_errors),
            duration_seconds=metrics.wall_time_seconds,
            isolated_failure=status == ScanStatus.FAILED,
        )

        return ScalableScanResult(
            status=status,
            findings=all_findings,
            errors=all_errors,
            total_files_discovered=len(files_to_scan),
            total_files_scanned=scanned_count,
            total_loc=total_loc,
            concurrency_workers=self.concurrency,
            metrics=metrics,
            cache_stats=self.cache.stats,
            engine_report=engine_report,
        )
