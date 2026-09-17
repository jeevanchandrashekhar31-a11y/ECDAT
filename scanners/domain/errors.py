"""
ECDAT Typed Error Model & Status Lifecycle (Python)
Distinguishes 9 operational error categories with structured codes,
serialization, and scan status state machine.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from scanners.domain.contracts import ScanStatus


class ErrorCategory(str, Enum):
    INVALID_INPUT = "invalid_input"
    UNSUPPORTED_FORMAT = "unsupported_format"
    PARSER_FAILURE = "parser_failure"
    PERMISSION_FAILURE = "permission_failure"
    NETWORK_TIMEOUT = "network_timeout"
    DEPENDENCY_FAILURE = "dependency_failure"
    SCANNER_FAILURE = "scanner_failure"
    POLICY_FAILURE = "policy_failure"
    INFRASTRUCTURE_FAILURE = "infrastructure_failure"


class ErrorCode(str, Enum):
    # Invalid Input
    ERR_INPUT_INVALID_TARGET = "ERR_INPUT_INVALID_TARGET"
    ERR_INPUT_INVALID_PARAMETER = "ERR_INPUT_INVALID_PARAMETER"
    ERR_INPUT_MISSING_FIELD = "ERR_INPUT_MISSING_FIELD"

    # Unsupported Format
    ERR_FORMAT_UNSUPPORTED_SPEC = "ERR_FORMAT_UNSUPPORTED_SPEC"
    ERR_FORMAT_UNSUPPORTED_ARCHIVE = "ERR_FORMAT_UNSUPPORTED_ARCHIVE"
    ERR_FORMAT_MALFORMED_ENCODING = "ERR_FORMAT_MALFORMED_ENCODING"

    # Parser Failure
    ERR_PARSER_AST_SYNTAX = "ERR_PARSER_AST_SYNTAX"
    ERR_PARSER_JSON_MALFORMED = "ERR_PARSER_JSON_MALFORMED"
    ERR_PARSER_X509_CORRUPT = "ERR_PARSER_X509_CORRUPT"

    # Permission Failure
    ERR_PERMISSION_FILE_DENIED = "ERR_PERMISSION_FILE_DENIED"
    ERR_PERMISSION_DIRECTORY_DENIED = "ERR_PERMISSION_DIRECTORY_DENIED"
    ERR_PERMISSION_NETWORK_FORBIDDEN = "ERR_PERMISSION_NETWORK_FORBIDDEN"

    # Network Timeout
    ERR_NETWORK_TIMEOUT = "ERR_NETWORK_TIMEOUT"
    ERR_NETWORK_CONNECTION_REFUSED = "ERR_NETWORK_CONNECTION_REFUSED"
    ERR_NETWORK_HOST_UNREACHABLE = "ERR_NETWORK_HOST_UNREACHABLE"

    # Dependency Failure
    ERR_DEPENDENCY_MISSING_TOOL = "ERR_DEPENDENCY_MISSING_TOOL"
    ERR_DEPENDENCY_VERSION_INCOMPATIBLE = "ERR_DEPENDENCY_VERSION_INCOMPATIBLE"
    ERR_DEPENDENCY_CRASHED = "ERR_DEPENDENCY_CRASHED"

    # Scanner Failure
    ERR_SCANNER_EXECUTION_FAILURE = "ERR_SCANNER_EXECUTION_FAILURE"
    ERR_SCANNER_UNHANDLED_EXCEPTION = "ERR_SCANNER_UNHANDLED_EXCEPTION"
    ERR_SCANNER_INTERNAL_FAULT = "ERR_SCANNER_INTERNAL_FAULT"

    # Policy Failure
    ERR_POLICY_THRESHOLD_BREACHED = "ERR_POLICY_THRESHOLD_BREACHED"
    ERR_POLICY_PROFILE_NOT_FOUND = "ERR_POLICY_PROFILE_NOT_FOUND"
    ERR_POLICY_EVALUATION_ERROR = "ERR_POLICY_EVALUATION_ERROR"

    # Infrastructure Failure
    ERR_INFRA_DATABASE_UNAVAILABLE = "ERR_INFRA_DATABASE_UNAVAILABLE"
    ERR_INFRA_OUT_OF_MEMORY = "ERR_INFRA_OUT_OF_MEMORY"
    ERR_INFRA_DISK_FULL = "ERR_INFRA_DISK_FULL"


def _sanitize_error_val(val: Any) -> Any:
    if isinstance(val, str):
        import re

        pat = re.compile(
            r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
            re.IGNORECASE,
        )
        return pat.sub("[REDACTED_PRIVATE_KEY]", val)
    elif isinstance(val, dict):
        return {k: _sanitize_error_val(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [_sanitize_error_val(v) for v in val]
    return val


class EcdatException(Exception):
    """Base Typed ECDAT Exception"""

    def __init__(
        self,
        message: str,
        category: ErrorCategory,
        code: ErrorCode,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = True,
        status_code: int = 500,
    ):
        clean_msg = _sanitize_error_val(message)
        super().__init__(clean_msg)
        self.message = clean_msg
        self.category = category
        self.code = code
        self.details = _sanitize_error_val(dict(details or {}))
        self.fatal = fatal
        self.status_code = status_code
        self.timestamp = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": self.__class__.__name__,
            "category": self.category.value if isinstance(self.category, Enum) else str(self.category),
            "code": self.code.value if isinstance(self.code, Enum) else str(self.code),
            "message": self.message,
            "fatal": self.fatal,
            "details": self.details,
            "timestamp": self.timestamp,
        }


class InvalidInputError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        code: ErrorCode = ErrorCode.ERR_INPUT_INVALID_TARGET,
    ):
        super().__init__(message, ErrorCategory.INVALID_INPUT, code, details, fatal=True, status_code=400)


class UnsupportedFormatError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        code: ErrorCode = ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC,
    ):
        super().__init__(message, ErrorCategory.UNSUPPORTED_FORMAT, code, details, fatal=True, status_code=415)


class ParserFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = False,
        code: ErrorCode = ErrorCode.ERR_PARSER_AST_SYNTAX,
    ):
        super().__init__(message, ErrorCategory.PARSER_FAILURE, code, details, fatal=fatal, status_code=422)


class PermissionFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = False,
        code: ErrorCode = ErrorCode.ERR_PERMISSION_FILE_DENIED,
    ):
        super().__init__(message, ErrorCategory.PERMISSION_FAILURE, code, details, fatal=fatal, status_code=403)


class NetworkTimeoutError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = True,
        code: ErrorCode = ErrorCode.ERR_NETWORK_TIMEOUT,
    ):
        super().__init__(message, ErrorCategory.NETWORK_TIMEOUT, code, details, fatal=fatal, status_code=504)


class DependencyFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = True,
        code: ErrorCode = ErrorCode.ERR_DEPENDENCY_MISSING_TOOL,
    ):
        super().__init__(message, ErrorCategory.DEPENDENCY_FAILURE, code, details, fatal=fatal, status_code=502)


class ScannerFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = True,
        code: ErrorCode = ErrorCode.ERR_SCANNER_EXECUTION_FAILURE,
    ):
        super().__init__(message, ErrorCategory.SCANNER_FAILURE, code, details, fatal=fatal, status_code=500)


class PolicyFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = False,
        code: ErrorCode = ErrorCode.ERR_POLICY_THRESHOLD_BREACHED,
    ):
        super().__init__(message, ErrorCategory.POLICY_FAILURE, code, details, fatal=fatal, status_code=422)


class InfrastructureFailureError(EcdatException):
    def __init__(
        self,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        fatal: bool = True,
        code: ErrorCode = ErrorCode.ERR_INFRA_DATABASE_UNAVAILABLE,
    ):
        super().__init__(message, ErrorCategory.INFRASTRUCTURE_FAILURE, code, details, fatal=fatal, status_code=503)


def evaluate_scan_status(
    findings: Optional[List[Any]] = None,
    errors: Optional[List[Any]] = None,
    scanned_targets: int = 0,
    failed_targets: int = 0,
) -> ScanStatus:
    """
    Evaluates scan outcome status as SUCCESS, PARTIAL, or FAILED.
    Guaranteed: Scanner failure is NEVER converted into an empty/successful result.
    """
    findings_list = findings or []
    errors_list = errors or []

    # Check for any fatal errors
    has_fatal = any(getattr(e, "fatal", False) or (isinstance(e, dict) and e.get("fatal")) for e in errors_list)
    if has_fatal:
        return ScanStatus.FAILED

    if failed_targets > 0 and scanned_targets == 0:
        return ScanStatus.FAILED

    if len(errors_list) > 0 or failed_targets > 0:
        if len(findings_list) > 0 or scanned_targets > 0:
            return ScanStatus.PARTIAL
        return ScanStatus.FAILED

    return ScanStatus.SUCCESS


def assert_valid_scanner_result(
    status: ScanStatus, findings: Optional[List[Any]] = None, errors: Optional[List[Any]] = None
) -> None:
    """Guardrail asserting that a scanner failure is never marked as a successful empty result."""
    errs = errors or []
    if len(errs) > 0 and status == ScanStatus.SUCCESS:
        raise ScannerFailureError(
            "Invalid Scan State: Scan reported SUCCESS despite containing recorded scanner errors"
        )
