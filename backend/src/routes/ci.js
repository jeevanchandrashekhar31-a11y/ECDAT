/**
 * CI/CD Scanner & Developer Experience Routes — Phase 13.1
 *
 * Exposes first-class CI scanner endpoints:
 * - GET  /api/v1/ci/status: Health, config, and supported exit codes
 * - POST /api/v1/ci/scan: Executes CI scan and returns results with deterministic exit codes
 * - POST /api/v1/ci/gate: Evaluates findings against policy-as-code gate
 * - POST /api/v1/ci/sarif: Formats findings into OASIS SARIF v2.1.0 report
 */

const express = require("express");
const router = express.Router();
const { NodeCiScanner, CI_EXIT_CODES, VALID_FAIL_ON } = require("../ci/ci_scanner");

/**
 * GET /api/v1/ci/status
 * Returns scanner capabilities and exit code definitions.
 */
router.get("/status", (req, res) => {
  res.json({
    status: "ready",
    version: "1.0.0",
    supportedExitCodes: {
      0: "PASS",
      1: "POLICY_SECURITY_FAILURE",
      2: "SCANNER_ERROR",
      3: "INVALID_CONFIG",
    },
    supportedScanTypes: [
      "pull_request",
      "full_repo",
      "policy_gate",
      "cbom_generation",
      "sarif_upload",
      "dependency_scan",
      "secret_scan",
      "container_scan",
    ],
    validFailOn: VALID_FAIL_ON,
    conflationGuaranteedFalse: true,
  });
});

/**
 * POST /api/v1/ci/scan
 * Executes CI scan orchestrator and returns deterministic exit code.
 */
router.post("/scan", async (req, res, next) => {
  try {
    const scanner = new NodeCiScanner(req.body || {});
    const result = await scanner.runScan();

    // Map exit code to appropriate HTTP status:
    // 0 -> 200 OK
    // 1 -> 422 Unprocessable Entity (Policy/Security Failure)
    // 2 -> 500 Internal Server Error (Scanner Error)
    // 3 -> 400 Bad Request (Invalid Config)
    const statusMap = {
      [CI_EXIT_CODES.PASS]: 200,
      [CI_EXIT_CODES.POLICY_SECURITY_FAILURE]: 422,
      [CI_EXIT_CODES.SCANNER_ERROR]: 500,
      [CI_EXIT_CODES.INVALID_CONFIG]: 400,
    };

    const httpStatus = statusMap[result.exitCode] || 200;
    return res.status(httpStatus).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/ci/gate
 * Evaluates findings or CBOM against policy gate.
 */
router.post("/gate", (req, res, next) => {
  try {
    const { findings = [], failOn = "critical", policy = null, failOnWarn = false } = req.body;
    const scanner = new NodeCiScanner({ failOn, policyPath: policy, failOnWarn });
    const gateResult = scanner.evaluateGate(findings, { failOn, policy, failOnWarn });

    const exitCode = gateResult.passed
      ? CI_EXIT_CODES.PASS
      : CI_EXIT_CODES.POLICY_SECURITY_FAILURE;

    return res.status(gateResult.passed ? 200 : 422).json({
      passed: gateResult.passed,
      verdict: gateResult.verdict,
      exitCode,
      violations: gateResult.violations,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/ci/vulnerability-release-gate
 * Evaluates findings against the Phase 23.3 4-tier Vulnerability Release Gate:
 * CRITICAL = release blocker
 * HIGH = release blocker unless formally risk accepted
 * MEDIUM = tracked remediation
 * LOW = tracked improvement
 * Rejects severity tampering without documented cryptographic evidence.
 */
router.post("/vulnerability-release-gate", (req, res, next) => {
  try {
    const { findings = [], riskAcceptances = null, severityOverrides = null } = req.body;
    const { evaluateReleaseGate } = require("../security/vulnerability_release_gate");
    const verdict = evaluateReleaseGate(findings, { riskAcceptances, severityOverrides });
    return res.status(verdict.passed ? 200 : 422).json(verdict);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/ci/sarif
 * Formats findings array into OASIS SARIF v2.1.0 standard JSON.
 */
router.post("/sarif", (req, res, next) => {
  try {
    const { findings = [], toolName = "ECDAT CI Scanner" } = req.body;
    const { NodeSarifEngine } = require("../ci/sarif_engine");
    const sarif = NodeSarifEngine.generateAndValidate(findings, { toolName });
    return res.json(sarif);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/ci/sarif/validate
 * Automatically validates a SARIF v2.1.0 document.
 */
router.post("/sarif/validate", (req, res, next) => {
  try {
    const { sarif } = req.body;
    const { NodeSarifEngine } = require("../ci/sarif_engine");
    const result = NodeSarifEngine.validate(sarif);
    return res.status(result.isValid ? 200 : 422).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/ci/feedback
 * Generates 9-dimensional developer-actionable feedback cards for findings.
 */
router.post("/feedback", (req, res, next) => {
  try {
    const { findings = [], targetRoot = null } = req.body;
    const { DeveloperFeedbackGenerator } = require("../ci/developer_feedback");

    const feedbackList = findings.map((f) => {
      const fb = DeveloperFeedbackGenerator.generate(f, targetRoot);
      return {
        ...fb,
        terminal_card: DeveloperFeedbackGenerator.renderTerminalCard(fb),
        markdown_card: DeveloperFeedbackGenerator.renderMarkdown(fb),
      };
    });

    return res.json({
      total: feedbackList.length,
      feedback: feedbackList,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/ci/rules/:id/guidance
 * Returns cryptographic rationale, safe fix, and suppression workflow for a rule ID.
 */
router.get("/rules/:id/guidance", (req, res, next) => {
  try {
    const { id } = req.params;
    const { DeveloperFeedbackGenerator } = require("../ci/developer_feedback");
    const finding = {
      rule_id: id,
      algorithm: id,
      finding_type: "weak_crypto",
      file_path: "src/example.js",
      line_number: 1,
      evidence: "// Example cryptographic call",
    };
    const fb = DeveloperFeedbackGenerator.generate(finding);
    return res.json({
      rule_id: id,
      why_it_matters: fb.why_it_matters,
      safe_fix: fb.safe_fix,
      references: fb.references,
      suppression_workflow: fb.suppression_workflow,
      verification_command: fb.verification_command,
      markdown_card: DeveloperFeedbackGenerator.renderMarkdown(fb),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
