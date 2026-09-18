/**
 * Phase 24 (P1) Scanner Result Integrity & Provenance Tests (Node.js)
 *
 * Verifies:
 * - 6 Canonical states: FOUND, NOT_FOUND, NOT_SCANNED, SCAN_ERROR, UNSUPPORTED, UNKNOWN.
 * - Anti-Collapse Invariants:
 *   - Never collapse NOT_SCANNED into NOT_FOUND.
 *   - Never collapse ERROR / SCAN_ERROR into CLEAN.
 *   - Never collapse UNSUPPORTED into NOT_FOUND.
 * - Finding provenance completeness (location, detectionMethod, ruleId, toolName).
 * - Overall scan summary enforcement (cannot be CLEAN if errors or unscanned items exist).
 * - REST API endpoints for integrity validation.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const app = require("../../src/app");

const {
  RESULT_STATES,
  CANONICAL_STATES,
  ABSENCE_DISCLAIMER,
  ResultIntegrityError,
  validateResultState,
  assertNoIllegalCollapse,
  verifyFindingProvenance,
  ResultIntegrityTracker,
} = require("../../src/security/result_integrity");

describe("Phase 24: Scanner Result Integrity Engine", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("1. All 6 canonical states are strictly defined", () => {
    const expected = ["FOUND", "NOT_FOUND", "NOT_SCANNED", "SCAN_ERROR", "UNSUPPORTED", "UNKNOWN"];
    assert.strictEqual(CANONICAL_STATES.size, 6);
    for (const s of expected) {
      assert.ok(CANONICAL_STATES.has(s), `Expected state ${s} to exist`);
      assert.strictEqual(validateResultState(s), s);
    }
  });

  test("2. Rejects invalid or invented result states", () => {
    assert.throws(() => validateResultState("PASS"), ResultIntegrityError);
    assert.throws(() => validateResultState("SKIPPED_OK"), ResultIntegrityError);
  });

  test("3. Anti-Collapse Invariant: NEVER collapse NOT_SCANNED into NOT_FOUND", () => {
    assert.throws(
      () => assertNoIllegalCollapse("NOT_FOUND", "NOT_SCANNED", "large_file.dat"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'NOT_FOUND'"));
        return true;
      }
    );

    assert.throws(
      () => assertNoIllegalCollapse("CLEAN", "SKIPPED", "vendor_dir"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'CLEAN'"));
        return true;
      }
    );
  });

  test("4. Anti-Collapse Invariant: NEVER collapse ERROR / SCAN_ERROR into CLEAN", () => {
    assert.throws(
      () => assertNoIllegalCollapse("CLEAN", "SCAN_ERROR", "ast_parser_crash"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'CLEAN'"));
        return true;
      }
    );

    assert.throws(
      () => assertNoIllegalCollapse("NOT_FOUND", "ERROR", "permission_denied"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'NOT_FOUND'"));
        return true;
      }
    );

    assert.throws(
      () => assertNoIllegalCollapse("SUCCESS", "CRASH", "process_crash"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'SUCCESS'"));
        return true;
      }
    );
  });

  test("5. Anti-Collapse Invariant: NEVER collapse UNSUPPORTED into NOT_FOUND", () => {
    assert.throws(
      () => assertNoIllegalCollapse("NOT_FOUND", "UNSUPPORTED", "unknown_lang.xyz"),
      (err) => {
        assert.ok(err instanceof ResultIntegrityError);
        assert.ok(err.message.includes("illegally collapsed into 'NOT_FOUND'"));
        return true;
      }
    );
  });

  test("6. Finding Provenance Validation: Complete metadata passes", () => {
    const finding = {
      location: "src/crypto/kex.js:42",
      detectionMethod: "ast",
      ruleId: "ECDAT-AST-001",
      toolName: "ECDAT Static Scanner",
    };
    const check = verifyFindingProvenance(finding);
    assert.strictEqual(check.valid, true);
    assert.strictEqual(check.errors.length, 0);
  });

  test("7. Finding Provenance Validation: Incomplete metadata fails with actionable errors", () => {
    // Missing location
    const f1 = { detectionMethod: "ast", ruleId: "ECDAT-001", toolName: "ECDAT" };
    const c1 = verifyFindingProvenance(f1);
    assert.strictEqual(c1.valid, false);
    assert.ok(c1.errors.some((e) => e.includes("auditable physical location")));

    // Missing detection method
    const f2 = { location: "src/auth.js:10", ruleId: "ECDAT-001", toolName: "ECDAT" };
    const c2 = verifyFindingProvenance(f2);
    assert.strictEqual(c2.valid, false);
    assert.ok(c2.errors.some((e) => e.includes("detection method")));

    // Missing ruleId
    const f3 = { location: "src/auth.js:10", detectionMethod: "ast", toolName: "ECDAT" };
    const c3 = verifyFindingProvenance(f3);
    assert.strictEqual(c3.valid, false);
    assert.ok(c3.errors.some((e) => e.includes("rule_id")));
  });

  test("8. ResultIntegrityTracker: Accurate 6-state accounting and non-collapsing verdict", () => {
    const tracker = new ResultIntegrityTracker("Full Pipeline Scanner");

    tracker.recordFound(
      "item-1",
      "src/cipher.js",
      [{ algorithm: "AES" }],
      [{ location: "src/cipher.js:10", detectionMethod: "ast", ruleId: "R1", toolName: "ECDAT" }]
    );
    tracker.recordNotFound("item-2", "src/helper.js");
    tracker.recordNotScanned("item-3", "large_dump.sql", "File exceeds 10MB limit");
    tracker.recordScanError("item-4", "corrupt.js", "SyntaxError in parser");
    tracker.recordUnsupported("item-5", "weights.bin", "Unsupported binary format");
    tracker.recordUnknown("item-6", "obfuscated.js", "Ambiguous dynamic evaluation");

    const summary = tracker.getSummary();
    assert.strictEqual(summary.totalItems, 6);
    assert.strictEqual(summary.foundCount, 1);
    assert.strictEqual(summary.notFoundCount, 1);
    assert.strictEqual(summary.notScannedCount, 1);
    assert.strictEqual(summary.scanErrorCount, 1);
    assert.strictEqual(summary.unsupportedCount, 1);
    assert.strictEqual(summary.unknownCount, 1);

    // Because scanErrorCount > 0, verdict MUST be SCAN_ERROR (never CLEAN)
    assert.strictEqual(summary.overallVerdict, "SCAN_ERROR");
    assert.strictEqual(summary.cleanCertified, false);
    assert.strictEqual(summary.absenceDisclaimer, ABSENCE_DISCLAIMER);
  });

  test("9. ResultIntegrityTracker: Unscanned items prevent clean certification", () => {
    const tracker = new ResultIntegrityTracker("Partial Scanner");

    tracker.recordNotFound("f1", "src/clean.js");
    tracker.recordNotScanned("f2", "vendor/excluded.js", "Excluded directory");

    const summary = tracker.getSummary();
    assert.strictEqual(summary.foundCount, 0);
    assert.strictEqual(summary.scanErrorCount, 0);
    assert.strictEqual(summary.notScannedCount, 1);

    // MUST NOT BE CLEAN! Must be PARTIAL_ASSESSMENT with disclaimer
    assert.strictEqual(summary.overallVerdict, "PARTIAL_ASSESSMENT");
    assert.strictEqual(summary.cleanCertified, false);
    assert.strictEqual(summary.absenceDisclaimer, ABSENCE_DISCLAIMER);
  });

  test("10. ResultIntegrityTracker: 100% inspected clean certified", () => {
    const tracker = new ResultIntegrityTracker("Clean Scanner");

    tracker.recordNotFound("f1", "src/clean1.js");
    tracker.recordNotFound("f2", "src/clean2.js");

    const summary = tracker.getSummary();
    assert.strictEqual(summary.totalItems, 2);
    assert.strictEqual(summary.notFoundCount, 2);
    assert.strictEqual(summary.overallVerdict, "CLEAN");
    assert.strictEqual(summary.cleanCertified, true);
    assert.strictEqual(summary.absenceDisclaimer, "");
  });

  test("11. REST API: GET /api/v1/security/scanners/result-states returns canonical taxonomy", async () => {
    const res = await fetch(`${baseUrl}/api/v1/security/scanners/result-states`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.deepStrictEqual(
      data.canonicalStates.sort(),
      ["FOUND", "NOT_FOUND", "NOT_SCANNED", "SCAN_ERROR", "UNSUPPORTED", "UNKNOWN"].sort()
    );
    assert.ok(data.antiCollapseRules.length >= 3);
    assert.ok(data.absenceDisclaimer.includes("is NOT proof"));
  });

  test("12. REST API: POST /api/v1/security/scanners/validate-integrity validates items", async () => {
    const payload = {
      scannerName: "REST API Integration Scanner",
      items: [
        {
          itemId: "file-1",
          target: "src/crypto.js",
          status: "FOUND",
          findings: [{ algo: "AES-256-GCM" }],
          provenance: [
            {
              location: "src/crypto.js:14",
              detectionMethod: "ast",
              ruleId: "ECDAT-AES",
              toolName: "ECDAT",
            },
          ],
        },
        {
          itemId: "file-2",
          target: "src/util.js",
          status: "NOT_FOUND",
        },
        {
          itemId: "file-3",
          target: "node_modules/lib.js",
          status: "NOT_SCANNED",
          reason: "Vendor directory excluded",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/security/scanners/validate-integrity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "ecdat-demo-admin-key-2026",
      },
      body: JSON.stringify(payload),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.totalItems, 3);
    assert.strictEqual(data.foundCount, 1);
    assert.strictEqual(data.notFoundCount, 1);
    assert.strictEqual(data.notScannedCount, 1);
    assert.strictEqual(data.overallVerdict, "FINDINGS_DETECTED");
  });

  test("13. REST API: POST /api/v1/security/scanners/validate-integrity catches invalid states", async () => {
    const payload = {
      items: [
        {
          itemId: "file-bad",
          target: "src/bad.js",
          status: "PASS_NOT_REALLY",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/security/scanners/validate-integrity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "ecdat-demo-admin-key-2026",
      },
      body: JSON.stringify(payload),
    });

    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.error, "ResultIntegrityViolation");
    assert.ok(data.violations.some((v) => v.includes("Invalid state 'PASS_NOT_REALLY'")));
  });
});
