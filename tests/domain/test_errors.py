"""
Unit tests for typed error model and scan status evaluation (Python).
"""

import pytest
from scanners.domain.contracts import ScanStatus
from scanners.domain.errors import (
    ErrorCategory,
    ErrorCode,
    EcdatException,
    InvalidInputError,
    UnsupportedFormatError,
    ParserFailureError,
    PermissionFailureError,
    NetworkTimeoutError,
    DependencyFailureError,
    ScannerFailureError,
    PolicyFailureError,
    InfrastructureFailureError,
    evaluate_scan_status,
    assert_valid_scanner_result,
)


def test_all_9_error_categories():
    errs = [
        InvalidInputError("Invalid path", {"target": "/bad"}),
        UnsupportedFormatError("Unknown archive", {"spec": "tar.zst"}),
        ParserFailureError("Tree-sitter parse error", {"line": 10}, fatal=False),
        PermissionFailureError("EACCES", {"file": "protected.go"}, fatal=False),
        NetworkTimeoutError("TLS Handshake timeout", {"endpoint": "10.0.0.1:443"}),
        DependencyFailureError("Syft not in PATH", {"tool": "syft"}),
        ScannerFailureError("AST worker aborted", {"signal": "SIGKILL"}),
        PolicyFailureError("Blocked on critical", {"policy": "bfsi"}),
        InfrastructureFailureError("DB timeout", {"pool": "pg"}),
    ]

    categories = {e.category for e in errs}
    assert len(categories) == 9

    assert errs[0].code == ErrorCode.ERR_INPUT_INVALID_TARGET
    assert errs[0].status_code == 400

    assert errs[1].code == ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC
    assert errs[1].status_code == 415

    assert errs[2].code == ErrorCode.ERR_PARSER_AST_SYNTAX
    assert errs[2].fatal is False

    assert errs[3].code == ErrorCode.ERR_PERMISSION_FILE_DENIED
    assert errs[3].fatal is False

    assert errs[4].code == ErrorCode.ERR_NETWORK_TIMEOUT
    assert errs[4].fatal is True

    assert errs[5].code == ErrorCode.ERR_DEPENDENCY_MISSING_TOOL
    assert errs[5].fatal is True

    assert errs[6].code == ErrorCode.ERR_SCANNER_EXECUTION_FAILURE
    assert errs[6].fatal is True

    assert errs[7].code == ErrorCode.ERR_POLICY_THRESHOLD_BREACHED
    assert errs[7].fatal is False

    assert errs[8].code == ErrorCode.ERR_INFRA_DATABASE_UNAVAILABLE
    assert errs[8].fatal is True

    d = errs[0].to_dict()
    assert d["category"] == "invalid_input"
    assert d["code"] == "ERR_INPUT_INVALID_TARGET"
    assert "timestamp" in d


def test_evaluate_scan_status_success():
    status = evaluate_scan_status(findings=[{"id": "1"}], errors=[], scanned_targets=1, failed_targets=0)
    assert status == ScanStatus.SUCCESS


def test_evaluate_scan_status_partial():
    non_fatal = PermissionFailureError("Cannot read file", fatal=False)
    status = evaluate_scan_status(
        findings=[{"id": "1"}],
        errors=[non_fatal],
        scanned_targets=3,
        failed_targets=1,
    )
    assert status == ScanStatus.PARTIAL


def test_evaluate_scan_status_fatal_failed():
    fatal = NetworkTimeoutError("Timeout")
    status = evaluate_scan_status(findings=[], errors=[fatal], scanned_targets=0, failed_targets=1)
    assert status == ScanStatus.FAILED


def test_evaluate_scan_status_all_targets_failed():
    non_fatal = ParserFailureError("Syntax", fatal=False)
    status = evaluate_scan_status(findings=[], errors=[non_fatal], scanned_targets=0, failed_targets=1)
    assert status == ScanStatus.FAILED


def test_anti_empty_result_guardrail():
    err = ScannerFailureError("Crash")
    with pytest.raises(ScannerFailureError):
        assert_valid_scanner_result(ScanStatus.SUCCESS, findings=[], errors=[err])
