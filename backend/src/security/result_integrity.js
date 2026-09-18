/**
 * ECDAT Scanner Result Integrity & Provenance Engine (Phase 24 - P1)
 *
 * Implements strict 6-state discovery outcome categorization:
 * 1. FOUND: Item scanned, positive cryptographic finding(s) or vulnerability discovered with provenance.
 * 2. NOT_FOUND: Item scanned and affirmatively inspected; zero findings detected.
 * 3. NOT_SCANNED: Item skipped, omitted, filtered out by rule/quota/boundary, or never reached.
 * 4. SCAN_ERROR: Scanner encountered execution failure, parser exception, permission error, or crash.
 * 5. UNSUPPORTED: Target, file format, language, or protocol recognized but unsupported by scanner.
 * 6. UNKNOWN: Analysis outcome is indeterminate, unresolvable, or ambiguous.
 *
 * CRITICAL ANTI-COLLAPSE INVARIANTS:
 * - NEVER collapse NOT_SCANNED into NOT_FOUND.
 * - NEVER collapse ERROR / SCAN_ERROR into CLEAN.
 * - Every finding MUST include sufficient provenance to reproduce why it was detected.
 */

const RESULT_STATES = Object.freeze({
  FOUND: "FOUND",
  NOT_FOUND: "NOT_FOUND",
  NOT_SCANNED: "NOT_SCANNED",
  SCAN_ERROR: "SCAN_ERROR",
  UNSUPPORTED: "UNSUPPORTED",
  UNKNOWN: "UNKNOWN",
});

const CANONICAL_STATES = new Set(Object.values(RESULT_STATES));

const ABSENCE_DISCLAIMER =
  "Absence of findings on scanned targets is NOT proof that no cryptographic assets " +
  "or vulnerabilities exist across unscanned, skipped, or unsupported components.";

class ResultIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResultIntegrityError";
  }
}

/**
 * Validates that a status string belongs strictly to the 6 canonical states.
 */
function validateResultState(state) {
  const upper = String(state || "").trim().toUpperCase();
  if (!CANONICAL_STATES.has(upper)) {
    throw new ResultIntegrityError(
      `Invalid scanner result state: '${state}'. Must be one of: ${Array.from(CANONICAL_STATES).sort().join(", ")}`
    );
  }
  return upper;
}

/**
 * Enforces strict anti-collapse invariants.
 */
function assertNoIllegalCollapse(reportedState, actualCondition, context = "") {
  const rep = String(reportedState || "").trim().toUpperCase();
  const act = String(actualCondition || "").trim().toUpperCase();
  const ctx = context ? ` (context: ${context})` : "";

  // Invariant 1: Never collapse NOT_SCANNED into NOT_FOUND
  if (
    ["NOT_SCANNED", "SKIPPED", "EXCLUDED", "OVERSIZED", "TIMEOUT"].includes(act) &&
    ["NOT_FOUND", "CLEAN", "EMPTY"].includes(rep)
  ) {
    throw new ResultIntegrityError(
      `CRITICAL INTEGRITY VIOLATION: '${act}' was illegally collapsed into '${rep}'${ctx}. ` +
        `Unscanned items must strictly be classified as NOT_SCANNED.`
    );
  }

  // Invariant 2: Never collapse ERROR / SCAN_ERROR into CLEAN
  if (
    ["SCAN_ERROR", "ERROR", "CRASH", "PARSER_FAILURE", "PERMISSION_DENIED"].includes(act) &&
    ["CLEAN", "NOT_FOUND", "SUCCESS", "PASSED", "ALLOW"].includes(rep)
  ) {
    throw new ResultIntegrityError(
      `CRITICAL INTEGRITY VIOLATION: '${act}' was illegally collapsed into '${rep}'${ctx}. ` +
        `Scanner errors must fail closed and never be presented as clean.`
    );
  }

  // Invariant 3: Never collapse UNSUPPORTED into NOT_FOUND
  if (
    ["UNSUPPORTED", "UNKNOWN_LANGUAGE", "UNRECOGNIZED_FORMAT"].includes(act) &&
    ["NOT_FOUND", "CLEAN"].includes(rep)
  ) {
    throw new ResultIntegrityError(
      `CRITICAL INTEGRITY VIOLATION: '${act}' was illegally collapsed into '${rep}'${ctx}. ` +
        `Unsupported targets must strictly be classified as UNSUPPORTED.`
    );
  }
}

/**
 * Validates that a finding contains sufficient provenance to reproduce why it was detected.
 */
function verifyFindingProvenance(finding) {
  const errors = [];
  if (!finding || typeof finding !== "object") {
    return { valid: false, errors: ["Finding must be an object"] };
  }

  const loc = finding.location || finding.file_path || finding.filePath || finding.host;
  if (!loc || String(loc).trim() === "" || String(loc).trim() === "unknown") {
    errors.push("Provenance requires an auditable physical location (file:line or host:port).");
  }

  const method = finding.detection_method || finding.detectionMethod || finding.analysis_source || finding.analysisSource;
  if (!method || String(method).trim() === "" || String(method).trim() === "unknown") {
    errors.push("Provenance requires a concrete detection method (e.g. ast, regex, runtime_hook).");
  }

  const rule = finding.rule_id || finding.ruleId || finding.algorithm || finding.rule;
  if (!rule || String(rule).trim() === "" || String(rule).trim() === "unknown") {
    errors.push("Provenance requires an identifiable rule_id or signature name.");
  }

  const tool = finding.tool_name || finding.toolName || finding.scanner;
  if (!tool || String(tool).trim() === "" || String(tool).trim() === "unknown") {
    errors.push("Provenance requires identifying the detecting tool name.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Tracks items and evaluates overall scan result integrity.
 */
class ResultIntegrityTracker {
  constructor(scannerName = "ECDAT Scanner") {
    this.scannerName = scannerName;
    this.records = [];
  }

  recordFound(itemId, target, findings = [], provenanceList = [], reasons = []) {
    if (!findings || findings.length === 0) {
      throw new ResultIntegrityError(`Cannot record FOUND for item '${itemId}' with zero findings.`);
    }

    if (provenanceList && provenanceList.length > 0) {
      for (const prov of provenanceList) {
        const check = verifyFindingProvenance(prov);
        if (!check.valid) {
          throw new ResultIntegrityError(
            `Insufficient provenance on finding for '${itemId}': ${check.errors.join("; ")}`
          );
        }
      }
    }

    const rec = {
      itemId,
      target,
      status: RESULT_STATES.FOUND,
      reasons: reasons.length ? reasons : [`${findings.length} cryptographic finding(s) detected`],
      findings,
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  recordNotFound(itemId, target, reasons = []) {
    const rec = {
      itemId,
      target,
      status: RESULT_STATES.NOT_FOUND,
      reasons: reasons.length ? reasons : ["Target inspected; zero findings detected"],
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  recordNotScanned(itemId, target, reason, details = {}) {
    assertNoIllegalCollapse(RESULT_STATES.NOT_SCANNED, "NOT_SCANNED", itemId);
    const rec = {
      itemId,
      target,
      status: RESULT_STATES.NOT_SCANNED,
      reasons: [`SKIPPED: ${reason}`],
      metadata: details,
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  recordScanError(itemId, target, error, details = {}) {
    assertNoIllegalCollapse(RESULT_STATES.SCAN_ERROR, "SCAN_ERROR", itemId);
    const rec = {
      itemId,
      target,
      status: RESULT_STATES.SCAN_ERROR,
      reasons: [`ERROR: ${error}`],
      errors: [String(error)],
      metadata: details,
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  recordUnsupported(itemId, target, reason, details = {}) {
    assertNoIllegalCollapse(RESULT_STATES.UNSUPPORTED, "UNSUPPORTED", itemId);
    const rec = {
      itemId,
      target,
      status: RESULT_STATES.UNSUPPORTED,
      reasons: [`UNSUPPORTED: ${reason}`],
      metadata: details,
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  recordUnknown(itemId, target, reason, details = {}) {
    const rec = {
      itemId,
      target,
      status: RESULT_STATES.UNKNOWN,
      reasons: [`UNKNOWN: ${reason}`],
      metadata: details,
      timestamp: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  getSummary() {
    const counts = {};
    for (const s of Object.values(RESULT_STATES)) {
      counts[s] = 0;
    }

    let totalFindings = 0;
    for (const r of this.records) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.findings) {
        totalFindings += r.findings.length;
      }
    }

    const totalItems = this.records.length;
    let overallVerdict;
    let cleanCertified = false;

    if (counts[RESULT_STATES.SCAN_ERROR] > 0) {
      overallVerdict = "SCAN_ERROR";
      cleanCertified = false;
    } else if (counts[RESULT_STATES.FOUND] > 0) {
      overallVerdict = "FINDINGS_DETECTED";
      cleanCertified = false;
    } else if (
      counts[RESULT_STATES.NOT_SCANNED] > 0 ||
      counts[RESULT_STATES.UNSUPPORTED] > 0 ||
      counts[RESULT_STATES.UNKNOWN] > 0
    ) {
      overallVerdict = "PARTIAL_ASSESSMENT";
      cleanCertified = false;
    } else if (counts[RESULT_STATES.NOT_FOUND] > 0 && totalItems === counts[RESULT_STATES.NOT_FOUND]) {
      overallVerdict = "CLEAN";
      cleanCertified = true;
    } else {
      overallVerdict = "EMPTY";
      cleanCertified = false;
    }

    return {
      scannerName: this.scannerName,
      totalItems,
      totalFindings,
      states: counts,
      foundCount: counts[RESULT_STATES.FOUND],
      notFoundCount: counts[RESULT_STATES.NOT_FOUND],
      notScannedCount: counts[RESULT_STATES.NOT_SCANNED],
      scanErrorCount: counts[RESULT_STATES.SCAN_ERROR],
      unsupportedCount: counts[RESULT_STATES.UNSUPPORTED],
      unknownCount: counts[RESULT_STATES.UNKNOWN],
      overallVerdict,
      cleanCertified,
      absenceDisclaimer: cleanCertified ? "" : ABSENCE_DISCLAIMER,
      antiCollapseVerified: true,
    };
  }
}

module.exports = {
  RESULT_STATES,
  CANONICAL_STATES,
  ABSENCE_DISCLAIMER,
  ResultIntegrityError,
  validateResultState,
  assertNoIllegalCollapse,
  verifyFindingProvenance,
  ResultIntegrityTracker,
};
