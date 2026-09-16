"""
ECDAT Job-Level Failure Isolation Engine (Phase 21.3)

Guarantees:
- Job-Level Isolation: A failed scanner does not corrupt or abort the whole scan.
- Explicit Status: Each discovery engine reports SUCCESS, PARTIAL, or FAILED.
- Anti-Masking Invariant: Failures are NEVER converted into empty findings or false SUCCESS.
- Structured Diagnostics: Unhandled crashes are converted into typed structured error objects.
"""

from dataclasses import asdict, dataclass, field
import datetime
from enum import Enum
import logging
import time
import traceback
from typing import Any, Callable, Dict, List, Optional

from scanners.domain.contracts import ScanStatus
from scanners.domain.errors import (
    EcdatException,
    ErrorCategory,
    ErrorCode,
    ScannerFailureError,
    ParserFailureError,
    evaluate_scan_status,
    assert_valid_scanner_result,
)

logger = logging.getLogger("ECDAT.JobIsolation")


@dataclass
class StructuredError:
    code: str
    category: str
    message: str
    fatal: bool = False
    details: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EngineJobReport:
    """
    Structured execution report emitted by each isolated discovery engine.
    """
    engine_name: str
    status: ScanStatus
    findings: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    targets_scanned: int = 0
    targets_failed: int = 0
    duration_seconds: float = 0.0
    isolated_failure: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "engine_name": self.engine_name,
            "status": self.status.value if isinstance(self.status, Enum) else str(self.status),
            "findings_count": len(self.findings),
            "findings": self.findings,
            "errors": self.errors,
            "targets_scanned": self.targets_scanned,
            "targets_failed": self.targets_failed,
            "duration_seconds": round(self.duration_seconds, 4),
            "isolated_failure": self.isolated_failure,
        }


@dataclass
class EngineJob:
    """
    Defines a discovery task to be executed within an isolated job boundary.
    """
    engine_name: str
    task: Callable[[], Any]
    timeout_seconds: float = 60.0
    is_critical: bool = False


class IsolatedJobRunner:
    """
    Supervisor executing discovery engines in isolated job boundaries.
    """

    @staticmethod
    def run_job(job: EngineJob) -> EngineJobReport:
        """
        Executes an EngineJob within a strictly isolated try/except boundary.
        Enforces that errors are converted to structured error objects,
        and never silently masked as empty findings.
        """
        start_time = time.perf_counter()
        engine_name = job.engine_name
        errors: List[Dict[str, Any]] = []
        findings: List[Dict[str, Any]] = []
        targets_scanned = 0
        targets_failed = 0

        try:
            # Execute the engine task
            result = job.task()

            # Result can be a dict, ScanResult, or tuple
            if isinstance(result, dict):
                findings = result.get("findings", [])
                raw_errors = result.get("errors", [])
                targets_scanned = result.get("targets_scanned", len(findings))
                targets_failed = result.get("targets_failed", 0)

                for err in raw_errors:
                    if isinstance(err, EcdatException):
                        errors.append(err.to_dict())
                    elif isinstance(err, dict):
                        errors.append(err)
                    else:
                        errors.append(
                            StructuredError(
                                code=ErrorCode.ERR_SCANNER_INTERNAL_FAULT.value,
                                category=ErrorCategory.SCANNER_FAILURE.value,
                                message=str(err),
                                fatal=False,
                            ).to_dict()
                        )
            elif isinstance(result, list):
                # Simple list of findings
                findings = result
                targets_scanned = len(findings)
            else:
                findings = getattr(result, "findings", [])
                targets_scanned = len(findings)

            # Evaluate status based on errors and findings
            has_fatal = any(e.get("fatal", False) for e in errors)
            if has_fatal:
                status = ScanStatus.FAILED
            elif errors or targets_failed > 0:
                status = ScanStatus.PARTIAL if (findings or targets_scanned > 0) else ScanStatus.FAILED
            else:
                status = ScanStatus.SUCCESS

            duration = time.perf_counter() - start_time

            # Enforce guardrail invariant: Never report SUCCESS if errors are present
            if errors and status == ScanStatus.SUCCESS:
                status = ScanStatus.PARTIAL

            return EngineJobReport(
                engine_name=engine_name,
                status=status,
                findings=findings,
                errors=errors,
                targets_scanned=targets_scanned,
                targets_failed=targets_failed,
                duration_seconds=duration,
                isolated_failure=status == ScanStatus.FAILED,
            )

        except EcdatException as ee:
            duration = time.perf_counter() - start_time
            errors.append(ee.to_dict())
            logger.error(f"Engine '{engine_name}' raised typed EcdatException: {ee.message}")
            return EngineJobReport(
                engine_name=engine_name,
                status=ScanStatus.FAILED,
                findings=[],  # Strict: do not convert failure to successful empty findings
                errors=errors,
                targets_scanned=0,
                targets_failed=1,
                duration_seconds=duration,
                isolated_failure=True,
            )

        except Exception as ex:
            duration = time.perf_counter() - start_time
            tb = traceback.format_exc()
            struct_err = StructuredError(
                code=ErrorCode.ERR_SCANNER_UNHANDLED_EXCEPTION.value,
                category=ErrorCategory.SCANNER_FAILURE.value,
                message=f"Unhandled crash in discovery engine '{engine_name}': {str(ex)}",
                fatal=True,
                details={"exception_type": type(ex).__name__, "traceback": tb[-500:]},
            ).to_dict()
            errors.append(struct_err)
            logger.error(f"Engine '{engine_name}' crashed: {str(ex)}")

            return EngineJobReport(
                engine_name=engine_name,
                status=ScanStatus.FAILED,
                findings=[],  # Strict: do not convert failure to successful empty findings
                errors=errors,
                targets_scanned=0,
                targets_failed=1,
                duration_seconds=duration,
                isolated_failure=True,
            )


@dataclass
class CompositeScanReport:
    composite_status: ScanStatus
    total_findings: int
    total_errors: int
    engine_reports: Dict[str, EngineJobReport] = field(default_factory=dict)
    all_findings: List[Dict[str, Any]] = field(default_factory=list)
    all_errors: List[Dict[str, Any]] = field(default_factory=list)
    duration_seconds: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "composite_status": self.composite_status.value
            if isinstance(self.composite_status, Enum)
            else str(self.composite_status),
            "total_findings": self.total_findings,
            "total_errors": self.total_errors,
            "duration_seconds": round(self.duration_seconds, 4),
            "engine_reports": {
                name: r.to_dict() for name, r in self.engine_reports.items()
            },
            "findings": self.all_findings,
            "errors": self.all_errors,
        }


class CompositeScanAggregator:
    """
    Combines isolated discovery reports into an aggregated scan result.
    Guarantees that healthy engine findings are fully preserved even when
    other engines fail.
    """

    @staticmethod
    def aggregate(reports: List[EngineJobReport], total_duration: float = 0.0) -> CompositeScanReport:
        all_findings: List[Dict[str, Any]] = []
        all_errors: List[Dict[str, Any]] = []
        engine_dict: Dict[str, EngineJobReport] = {}

        has_failed = False
        has_success = False
        has_partial = False

        for r in reports:
            engine_dict[r.engine_name] = r
            all_findings.extend(r.findings)
            all_errors.extend(r.errors)

            if r.status == ScanStatus.FAILED:
                has_failed = True
            elif r.status == ScanStatus.PARTIAL:
                has_partial = True
            elif r.status == ScanStatus.SUCCESS:
                has_success = True

        # Composite status evaluation
        if has_failed and not has_success and not has_partial:
            composite_status = ScanStatus.FAILED
        elif has_failed or has_partial:
            composite_status = ScanStatus.PARTIAL if all_findings else ScanStatus.FAILED
        else:
            composite_status = ScanStatus.SUCCESS

        return CompositeScanReport(
            composite_status=composite_status,
            total_findings=len(all_findings),
            total_errors=len(all_errors),
            engine_reports=engine_dict,
            all_findings=all_findings,
            all_errors=all_errors,
            duration_seconds=total_duration,
        )
