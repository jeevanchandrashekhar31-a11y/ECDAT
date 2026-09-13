const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
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
} = require("../../src/domain/errors");

const { ScanStatus } = require("../../src/domain/contracts");

describe("Typed Error Model & Status Lifecycle (Node.js)", () => {
  test("Distinguishes all 9 operational error categories with typed classes", () => {
    const errs = [
      new InvalidInputError("Target does not exist", { target: "/invalid" }),
      new UnsupportedFormatError("Spec version 0.9 not supported", { spec: "0.9" }),
      new ParserFailureError("AST Syntax error", { line: 12 }, false),
      new PermissionFailureError("Access denied", { file: "/etc/shadow" }, false),
      new NetworkTimeoutError("Handshake timed out", { host: "example.com:443" }),
      new DependencyFailureError("Syft tool not found in PATH", { tool: "syft" }),
      new ScannerFailureError("Scanner subprocess crashed", { exitCode: 137 }),
      new PolicyFailureError("Critical finding violates policy", { rule: "MD5" }),
      new InfrastructureFailureError("PostgreSQL connection refused", { host: "localhost" }),
    ];

    const categories = new Set(errs.map((e) => e.category));
    assert.equal(categories.size, 9, "Must distinguish all 9 error categories");

    assert.equal(errs[0].code, ErrorCode.ERR_INPUT_INVALID_TARGET);
    assert.equal(errs[0].statusCode, 400);

    assert.equal(errs[1].code, ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC);
    assert.equal(errs[1].statusCode, 415);

    assert.equal(errs[2].code, ErrorCode.ERR_PARSER_AST_SYNTAX);
    assert.equal(errs[2].fatal, false);

    assert.equal(errs[3].code, ErrorCode.ERR_PERMISSION_FILE_DENIED);
    assert.equal(errs[3].fatal, false);

    assert.equal(errs[4].code, ErrorCode.ERR_NETWORK_TIMEOUT);
    assert.equal(errs[4].fatal, true);

    assert.equal(errs[5].code, ErrorCode.ERR_DEPENDENCY_MISSING_TOOL);
    assert.equal(errs[5].fatal, true);

    assert.equal(errs[6].code, ErrorCode.ERR_SCANNER_EXECUTION_FAILURE);
    assert.equal(errs[6].fatal, true);

    assert.equal(errs[7].code, ErrorCode.ERR_POLICY_THRESHOLD_BREACHED);
    assert.equal(errs[7].fatal, false);

    assert.equal(errs[8].code, ErrorCode.ERR_INFRA_DATABASE_UNAVAILABLE);
    assert.equal(errs[8].fatal, true);

    // Serialization
    const json = errs[0].toJSON();
    assert.equal(json.category, "invalid_input");
    assert.equal(json.code, "ERR_INPUT_INVALID_TARGET");
    assert.ok(json.timestamp);
  });

  test("Scan status evaluation - Clean run reports SUCCESS", () => {
    const status = evaluateScanStatus({
      findings: [{ id: "fnd_1" }],
      errors: [],
      scannedTargets: 1,
      failedTargets: 0,
    });
    assert.equal(status, ScanStatus.SUCCESS);
  });

  test("Scan status evaluation - Non-fatal errors with partial findings report PARTIAL", () => {
    const nonFatalErr = new PermissionFailureError("Cannot read file", { file: "secret.key" }, false);
    const status = evaluateScanStatus({
      findings: [{ id: "fnd_1" }],
      errors: [nonFatalErr],
      scannedTargets: 5,
      failedTargets: 1,
    });
    assert.equal(status, ScanStatus.PARTIAL);
  });

  test("Scan status evaluation - Fatal error reports FAILED", () => {
    const fatalErr = new NetworkTimeoutError("Target unreachable");
    const status = evaluateScanStatus({
      findings: [],
      errors: [fatalErr],
      scannedTargets: 0,
      failedTargets: 1,
    });
    assert.equal(status, ScanStatus.FAILED);
  });

  test("Scan status evaluation - All targets failed reports FAILED even with non-fatal errors", () => {
    const nonFatalErr = new ParserFailureError("File unparseable", {}, false);
    const status = evaluateScanStatus({
      findings: [],
      errors: [nonFatalErr],
      scannedTargets: 0,
      failedTargets: 1,
    });
    assert.equal(status, ScanStatus.FAILED);
  });

  test("Anti-empty-result invariant - Rejects claiming SUCCESS when scanner errors exist", () => {
    const err = new ScannerFailureError("Crash");
    assert.throws(
      () => {
        assertValidScannerResult(ScanStatus.SUCCESS, [], [err]);
      },
      /Invalid Scan State: Scan reported SUCCESS despite containing recorded scanner errors/
    );
  });
});
