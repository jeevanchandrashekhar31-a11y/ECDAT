/**
 * ECDAT Typed Error Model & Status Lifecycle (Node.js)
 * Distinguishes 9 operational error categories with structured codes,
 * serialization, and scan status state machine.
 */

const { ScanStatus } = require("./contracts");

const ErrorCategory = Object.freeze({
  INVALID_INPUT: "invalid_input",
  UNSUPPORTED_FORMAT: "unsupported_format",
  PARSER_FAILURE: "parser_failure",
  PERMISSION_FAILURE: "permission_failure",
  NETWORK_TIMEOUT: "network_timeout",
  DEPENDENCY_FAILURE: "dependency_failure",
  SCANNER_FAILURE: "scanner_failure",
  POLICY_FAILURE: "policy_failure",
  INFRASTRUCTURE_FAILURE: "infrastructure_failure",
});

const ErrorCode = Object.freeze({
  // Invalid Input
  ERR_INPUT_INVALID_TARGET: "ERR_INPUT_INVALID_TARGET",
  ERR_INPUT_INVALID_PARAMETER: "ERR_INPUT_INVALID_PARAMETER",
  ERR_INPUT_MISSING_FIELD: "ERR_INPUT_MISSING_FIELD",

  // Unsupported Format
  ERR_FORMAT_UNSUPPORTED_SPEC: "ERR_FORMAT_UNSUPPORTED_SPEC",
  ERR_FORMAT_UNSUPPORTED_ARCHIVE: "ERR_FORMAT_UNSUPPORTED_ARCHIVE",
  ERR_FORMAT_MALFORMED_ENCODING: "ERR_FORMAT_MALFORMED_ENCODING",

  // Parser Failure
  ERR_PARSER_AST_SYNTAX: "ERR_PARSER_AST_SYNTAX",
  ERR_PARSER_JSON_MALFORMED: "ERR_PARSER_JSON_MALFORMED",
  ERR_PARSER_X509_CORRUPT: "ERR_PARSER_X509_CORRUPT",

  // Permission Failure
  ERR_PERMISSION_FILE_DENIED: "ERR_PERMISSION_FILE_DENIED",
  ERR_PERMISSION_DIRECTORY_DENIED: "ERR_PERMISSION_DIRECTORY_DENIED",
  ERR_PERMISSION_NETWORK_FORBIDDEN: "ERR_PERMISSION_NETWORK_FORBIDDEN",

  // Network Timeout
  ERR_NETWORK_TIMEOUT: "ERR_NETWORK_TIMEOUT",
  ERR_NETWORK_CONNECTION_REFUSED: "ERR_NETWORK_CONNECTION_REFUSED",
  ERR_NETWORK_HOST_UNREACHABLE: "ERR_NETWORK_HOST_UNREACHABLE",

  // Dependency Failure
  ERR_DEPENDENCY_MISSING_TOOL: "ERR_DEPENDENCY_MISSING_TOOL",
  ERR_DEPENDENCY_VERSION_INCOMPATIBLE: "ERR_DEPENDENCY_VERSION_INCOMPATIBLE",
  ERR_DEPENDENCY_CRASHED: "ERR_DEPENDENCY_CRASHED",

  // Scanner Failure
  ERR_SCANNER_EXECUTION_FAILURE: "ERR_SCANNER_EXECUTION_FAILURE",
  ERR_SCANNER_UNHANDLED_EXCEPTION: "ERR_SCANNER_UNHANDLED_EXCEPTION",
  ERR_SCANNER_INTERNAL_FAULT: "ERR_SCANNER_INTERNAL_FAULT",

  // Policy Failure
  ERR_POLICY_THRESHOLD_BREACHED: "ERR_POLICY_THRESHOLD_BREACHED",
  ERR_POLICY_PROFILE_NOT_FOUND: "ERR_POLICY_PROFILE_NOT_FOUND",
  ERR_POLICY_EVALUATION_ERROR: "ERR_POLICY_EVALUATION_ERROR",

  // Infrastructure Failure
  ERR_INFRA_DATABASE_UNAVAILABLE: "ERR_INFRA_DATABASE_UNAVAILABLE",
  ERR_INFRA_OUT_OF_MEMORY: "ERR_INFRA_OUT_OF_MEMORY",
  ERR_INFRA_DISK_FULL: "ERR_INFRA_DISK_FULL",
});

/**
 * Base Typed ECDAT Error
 */
const PRIVATE_KEY_ERROR_REGEX =
  /(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)/gi;

function sanitizeErrorValue(val) {
  if (typeof val === "string") {
    return val.replace(PRIVATE_KEY_ERROR_REGEX, "[REDACTED_PRIVATE_KEY]");
  }
  if (Array.isArray(val)) return val.map(sanitizeErrorValue);
  if (val && typeof val === "object") {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeErrorValue(v);
    }
    return res;
  }
  return val;
}

class EcdatError extends Error {
  constructor({
    message,
    category = ErrorCategory.INFRASTRUCTURE_FAILURE,
    code = ErrorCode.ERR_SCANNER_INTERNAL_FAULT,
    details = {},
    fatal = true,
    statusCode = 500,
    cause = null,
  }) {
    const cleanMessage = sanitizeErrorValue(message);
    super(cleanMessage);
    this.name = this.constructor.name;
    this.category = category;
    this.code = code;
    this.details = sanitizeErrorValue({ ...details });
    this.fatal = Boolean(fatal);
    this.statusCode = Number(statusCode);
    this.timestamp = new Date().toISOString();
    if (cause) this.cause = cause;
  }

  toJSON() {
    return {
      error: this.name,
      category: this.category,
      code: this.code,
      message: this.message,
      fatal: this.fatal,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

class InvalidInputError extends EcdatError {
  constructor(message, details = {}, code = ErrorCode.ERR_INPUT_INVALID_TARGET) {
    super({
      message,
      category: ErrorCategory.INVALID_INPUT,
      code,
      details,
      fatal: true,
      statusCode: 400,
    });
  }
}

class UnsupportedFormatError extends EcdatError {
  constructor(message, details = {}, code = ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC) {
    super({
      message,
      category: ErrorCategory.UNSUPPORTED_FORMAT,
      code,
      details,
      fatal: true,
      statusCode: 415,
    });
  }
}

class ParserFailureError extends EcdatError {
  constructor(message, details = {}, fatal = false, code = ErrorCode.ERR_PARSER_AST_SYNTAX) {
    super({
      message,
      category: ErrorCategory.PARSER_FAILURE,
      code,
      details,
      fatal,
      statusCode: 422,
    });
  }
}

class PermissionFailureError extends EcdatError {
  constructor(message, details = {}, fatal = false, code = ErrorCode.ERR_PERMISSION_FILE_DENIED) {
    super({
      message,
      category: ErrorCategory.PERMISSION_FAILURE,
      code,
      details,
      fatal,
      statusCode: 403,
    });
  }
}

class NetworkTimeoutError extends EcdatError {
  constructor(message, details = {}, fatal = true, code = ErrorCode.ERR_NETWORK_TIMEOUT) {
    super({
      message,
      category: ErrorCategory.NETWORK_TIMEOUT,
      code,
      details,
      fatal,
      statusCode: 504,
    });
  }
}

class DependencyFailureError extends EcdatError {
  constructor(message, details = {}, fatal = true, code = ErrorCode.ERR_DEPENDENCY_MISSING_TOOL) {
    super({
      message,
      category: ErrorCategory.DEPENDENCY_FAILURE,
      code,
      details,
      fatal,
      statusCode: 502,
    });
  }
}

class ScannerFailureError extends EcdatError {
  constructor(message, details = {}, fatal = true, code = ErrorCode.ERR_SCANNER_EXECUTION_FAILURE) {
    super({
      message,
      category: ErrorCategory.SCANNER_FAILURE,
      code,
      details,
      fatal,
      statusCode: 500,
    });
  }
}

class PolicyFailureError extends EcdatError {
  constructor(message, details = {}, fatal = false, code = ErrorCode.ERR_POLICY_THRESHOLD_BREACHED) {
    super({
      message,
      category: ErrorCategory.POLICY_FAILURE,
      code,
      details,
      fatal,
      statusCode: 422,
    });
  }
}

class InfrastructureFailureError extends EcdatError {
  constructor(message, details = {}, fatal = true, code = ErrorCode.ERR_INFRA_DATABASE_UNAVAILABLE) {
    super({
      message,
      category: ErrorCategory.INFRASTRUCTURE_FAILURE,
      code,
      details,
      fatal,
      statusCode: 503,
    });
  }
}

/**
 * Evaluates the scan outcome status strictly as SUCCESS, PARTIAL, or FAILED.
 * Guaranteed: Scanner failure is NEVER converted into an empty/successful result.
 *
 * @param {object} params
 * @param {Array} [params.findings=[]]
 * @param {Array<EcdatError|object>} [params.errors=[]]
 * @param {number} [params.scannedTargets=1]
 * @param {number} [params.failedTargets=0]
 * @returns {string} One of ScanStatus.SUCCESS, ScanStatus.PARTIAL, ScanStatus.FAILED
 */
function evaluateScanStatus({
  findings = [],
  errors = [],
  scannedTargets = 0,
  failedTargets = 0,
} = {}) {
  const hasFatalError = errors.some((e) => e.fatal === true);

  // If there are fatal errors (e.g. tool crash, unreachable target, DB down)
  if (hasFatalError) {
    return ScanStatus.FAILED;
  }

  // If all targets failed
  if (failedTargets > 0 && scannedTargets === 0) {
    return ScanStatus.FAILED;
  }

  // If there are non-fatal errors (e.g. individual unreadable files, parse issues)
  if (errors.length > 0 || failedTargets > 0) {
    // If we have some successful findings or scanned targets, report PARTIAL
    if (findings.length > 0 || scannedTargets > 0) {
      return ScanStatus.PARTIAL;
    }
    // If errors prevented any scanning from taking place, report FAILED
    return ScanStatus.FAILED;
  }

  // Completely clean execution
  return ScanStatus.SUCCESS;
}

/**
 * Guardrail asserting that a scanner failure is never marked as a successful empty result.
 */
function assertValidScannerResult(status, _findings = [], errors = []) {
  if (errors.length > 0 && status === ScanStatus.SUCCESS) {
    throw new ScannerFailureError(
      "Invalid Scan State: Scan reported SUCCESS despite containing recorded scanner errors",
      { errorsCount: errors.length }
    );
  }
}

module.exports = {
  ErrorCategory,
  ErrorCode,
  EcdatError,
  InvalidInputError,
  UnsupportedFormatError,
  ParserFailureError,
  PermissionFailureError,
  NetworkTimeoutError,
  DependencyFailureError,
  ScannerFailureError,
  PolicyFailureError,
  InfrastructureFailureError,
  evaluateScanStatus,
  assertValidScannerResult,
};
