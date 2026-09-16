"""
Tests for Phase 21.3: Discovery Engine Job-Level Failure Isolation.

Verifies:
1. Failed discovery engine does not corrupt findings of healthy companion engines.
2. Discovery engines report structured status: SUCCESS, PARTIAL, FAILED.
3. Failures are NEVER converted into empty findings or false SUCCESS.
4. Structured error diagnostics (codes, categories, stack traces) are preserved.
"""

import pytest

from scanners.common.job_isolation import (
    EngineJob,
    EngineJobReport,
    IsolatedJobRunner,
    CompositeScanAggregator,
    StructuredError,
    ScanStatus,
)
from scanners.domain.errors import (
    ErrorCode,
    ErrorCategory,
    ScannerFailureError,
    ParserFailureError,
)


def test_isolated_engine_success():
    """Healthy engine must report SUCCESS with all findings and zero errors."""
    def healthy_task():
        return {
            "findings": [
                {"algorithm": "AES-256", "file": "src/crypto.py"},
                {"algorithm": "RSA-2048", "file": "src/keys.py"},
            ],
            "targets_scanned": 2,
            "errors": [],
        }

    job = EngineJob(engine_name="test_ast_engine", task=healthy_task)
    report = IsolatedJobRunner.run_job(job)

    assert report.status == ScanStatus.SUCCESS
    assert len(report.findings) == 2
    assert len(report.errors) == 0
    assert report.targets_scanned == 2
    assert report.targets_failed == 0
    assert report.isolated_failure is False


def test_isolated_engine_partial_failure():
    """Engine encountering non-fatal error while extracting findings must report PARTIAL."""
    def partial_task():
        return {
            "findings": [{"algorithm": "SHA-256", "file": "src/valid.c"}],
            "targets_scanned": 2,
            "targets_failed": 1,
            "errors": [
                ParserFailureError("Corrupted token in broken.c", {"file": "broken.c"}, fatal=False)
            ],
        }

    job = EngineJob(engine_name="test_partial_engine", task=partial_task)
    report = IsolatedJobRunner.run_job(job)

    assert report.status == ScanStatus.PARTIAL
    assert len(report.findings) == 1
    assert len(report.errors) == 1
    assert report.errors[0]["category"] == ErrorCategory.PARSER_FAILURE.value
    assert report.errors[0]["code"] == ErrorCode.ERR_PARSER_AST_SYNTAX.value


def test_isolated_engine_fatal_crash_anti_masking():
    """
    Engine encountering unhandled crash or fatal error must report FAILED.
    Strict invariant: NEVER convert failures into empty findings or false SUCCESS.
    """
    def crashing_task():
        raise RuntimeError("Segmentation fault / memory bus error in native parser")

    job = EngineJob(engine_name="crashing_native_engine", task=crashing_task)
    report = IsolatedJobRunner.run_job(job)

    assert report.status == ScanStatus.FAILED
    assert report.isolated_failure is True
    assert len(report.errors) == 1
    assert report.errors[0]["code"] == ErrorCode.ERR_SCANNER_UNHANDLED_EXCEPTION.value
    assert "Segmentation fault" in report.errors[0]["message"]
    assert report.errors[0]["fatal"] is True


def test_failed_engine_does_not_corrupt_composite_scan():
    """
    When one engine crashes, other healthy engines must preserve 100% of their findings.
    Composite scan outcome reports PARTIAL (or FAILED), with all healthy findings intact.
    """
    def healthy_engine_1():
        return {
            "findings": [
                {"id": 1, "algorithm": "AES-256-GCM"},
                {"id": 2, "algorithm": "Ed25519"},
            ],
            "targets_scanned": 10,
        }

    def healthy_engine_2():
        return {
            "findings": [
                {"id": 3, "algorithm": "TLS 1.3"},
            ],
            "targets_scanned": 5,
        }

    def fatal_engine_3():
        raise ScannerFailureError("Database unreachable during scan", fatal=True)

    rep1 = IsolatedJobRunner.run_job(EngineJob("engine_1", healthy_engine_1))
    rep2 = IsolatedJobRunner.run_job(EngineJob("engine_2", healthy_engine_2))
    rep3 = IsolatedJobRunner.run_job(EngineJob("engine_3", fatal_engine_3))

    assert rep1.status == ScanStatus.SUCCESS
    assert rep2.status == ScanStatus.SUCCESS
    assert rep3.status == ScanStatus.FAILED

    composite = CompositeScanAggregator.aggregate([rep1, rep2, rep3])

    # Status must reflect partial/non-clean run, NOT false success
    assert composite.composite_status == ScanStatus.PARTIAL
    # Zero corruption: All 3 findings from engines 1 and 2 must be preserved
    assert composite.total_findings == 3
    assert len(composite.all_findings) == 3
    # Error from engine 3 must be recorded
    assert composite.total_errors == 1
    assert composite.all_errors[0]["code"] == ErrorCode.ERR_SCANNER_EXECUTION_FAILURE.value
