/**
 * Safe Remediation REST API Router (Phase 12)
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const {
  getDefaultRemediationPlanner,
  getDefaultPatchGenerator,
  generatePatch,
  executePreApplicationLifecycle,
  getDefaultApprovalEngine,
  requiresExplicitApproval,
  ApprovalWorkflowError,
} = require("../remediation");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
const { defaultMetricsCollector } = require("../metrics");

const path = require("path");
const os = require("os");

const FORBIDDEN_SYSTEM_PREFIXES_POSIX = [
  "/etc", "/bin", "/sbin", "/usr", "/lib", "/var", "/proc", "/sys", "/dev", "/boot", "/root"
];

function validateRemediationPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("Invalid file path: path must be a non-empty string");
  }

  // Unicode NFKC normalization
  const clean = rawPath.normalize("NFKC").trim();

  // Reject control characters and null bytes
  if (/[\x00-\x1f]/.test(clean)) {
    throw new Error("Invalid file path: control characters or null bytes detected");
  }

  // Reject directory traversal sequences and UNC shares
  if (clean.includes("..") || clean.startsWith("\\\\") || clean.startsWith("//")) {
    throw new Error("Invalid file path: path traversal or UNC share rejected");
  }

  const resolved = path.resolve(clean);
  const resolvedLower = resolved.toLowerCase();

  // Check forbidden POSIX system directories
  for (const sysPrefix of FORBIDDEN_SYSTEM_PREFIXES_POSIX) {
    if (resolved.startsWith(sysPrefix + "/") || resolved === sysPrefix) {
      throw new Error(`File path confinement violation: forbidden system directory '${sysPrefix}'`);
    }
  }

  // Check forbidden Windows system directories
  if (process.platform === "win32") {
    const winDir = (process.env.WINDIR || "C:\\Windows").toLowerCase();
    const progFiles = (process.env.ProgramFiles || "C:\\Program Files").toLowerCase();
    const progFilesX86 = (process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)").toLowerCase();
    if (
      resolvedLower.startsWith(winDir) ||
      resolvedLower.startsWith(progFiles) ||
      resolvedLower.startsWith(progFilesX86)
    ) {
      throw new Error("File path confinement violation: Windows system directories are forbidden");
    }
  }

  // Allowed roots: repo root, current working directory, or OS temp directory
  const repoRoot = path.resolve(__dirname, "../../..").toLowerCase();
  const cwd = process.cwd().toLowerCase();
  const tempDir = os.tmpdir().toLowerCase();

  const isAllowed =
    resolvedLower.startsWith(repoRoot) ||
    resolvedLower.startsWith(cwd) ||
    resolvedLower.startsWith(tempDir);

  if (!isAllowed) {
    throw new Error(`File path confinement violation: path '${resolved}' is outside allowed workspace boundaries`);
  }

  return resolved;
}

const REMEDIATION_WORKSPACE = path.resolve(
  process.env.ECDAT_REMEDIATION_WORKSPACE || "/var/lib/ecdat/workspace"
);

function resolveConfinedPath(requestedPath) {
  if (!requestedPath || typeof requestedPath !== "string") {
    const e = new Error("file_path is required."); e.statusCode = 400; throw e;
  }
  if (requestedPath.includes("\0")) {
    const e = new Error("Invalid path."); e.statusCode = 400; throw e;
  }
  const resolved = path.resolve(REMEDIATION_WORKSPACE, requestedPath);
  const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  if (real !== REMEDIATION_WORKSPACE && !real.startsWith(REMEDIATION_WORKSPACE + path.sep)) {
    const e = new Error("Path escapes the remediation workspace."); e.statusCode = 403; throw e;
  }
  return real;
}

function getActorFromReq(req) {
  const role = req.auth?.role || req.tenantContext?.roles?.[0] || null;
  const username =
    req.user?.username || req.user?.sub || req.auth?.user?.sub || null;
  if (!role || !username) {
    const err = new Error("Authenticated actor identity required.");
    err.statusCode = 401;
    throw err;
  }
  return { username, role };
}

/**
 * POST /api/v1/remediation/plan
 * Generates a comprehensive 10-dimension remediation plan for findings or CBOM.
 * Defaults strictly to DRY RUN mode.
 */
router.post("/plan", (req, res) => {
  try {
    const findingsOrCbom =
      req.body.findings ||
      req.body.components ||
      req.body.assets ||
      req.body.cbom ||
      req.body;

    const dryRun = req.body.dry_run !== undefined ? Boolean(req.body.dry_run) : true;
    const environment = req.body.environment || "production";
    const businessUnit = req.body.business_unit || "general";

    const planner = getDefaultRemediationPlanner();
    const result = planner.planRemediations(findingsOrCbom, {
      dryRun,
      environment,
      business_unit: businessUnit,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Remediation Planning Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/remediation/plan/:findingId
 * Generates remediation plan for a specific finding.
 */
router.post("/plan/:findingId", (req, res) => {
  try {
    const finding = req.body.finding || req.body;
    finding.id = req.params.findingId;

    const dryRun = req.body.dry_run !== undefined ? Boolean(req.body.dry_run) : true;
    const environment = req.body.environment || "production";

    const planner = getDefaultRemediationPlanner();
    const result = planner.planFindingRemediation(finding, {
      dryRun,
      environment,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Single Finding Remediation Planning Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/remediation/simulate
 * Explicit dry-run execution simulation verifying safety without applying changes.
 */
router.post("/simulate", (req, res) => {
  try {
    const findingsOrCbom =
      req.body.findings ||
      req.body.components ||
      req.body.assets ||
      req.body.cbom ||
      req.body;

    const planner = getDefaultRemediationPlanner();
    const result = planner.planRemediations(findingsOrCbom, {
      dryRun: true,
    });

    return res.status(200).json({
      success: true,
      simulation: true,
      mode: "DRY_RUN",
      message: "Remediation simulation completed safely with zero mutations.",
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Remediation Simulation Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/remediation/generate-patch
 * Generates safe, AST-aware unified diff, explanation, test plan, and syntax validation.
 */
router.post("/generate-patch", (req, res) => {
  try {
    const sourceCode = req.body.source_code || req.body.code || "";
    const filePath = resolveConfinedPath(req.body.file_path || req.body.path);
    const targetAlgorithm = req.body.target_algorithm || req.body.target_standard || "SHA-256";

    const patchResult = generatePatch(sourceCode, filePath, { targetAlgorithm });

    return res.status(200).json({
      success: true,
      ...patchResult,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Patch Generation Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/remediation/verify-patch
 * Executes mandatory pre-application safety lifecycle.
 */
router.post("/verify-patch", (req, res) => {
  try {
    const sourceCode = req.body.source_code || req.body.code || "";
    let filePath = resolveConfinedPath(req.body.file_path || req.body.path);
    try {
      filePath = validateRemediationPath(filePath);
    } catch (pathErr) {
      return res.status(400).json({
        error: "PathConfinementViolation",
        code: "PATH_CONFINEMENT_VIOLATION",
        message: pathErr.message,
      });
    }
    const targetAlgorithm = req.body.target_algorithm || "SHA-256";
    const testCommand = req.body.test_command || null;

    const patchResult = req.body.patch || generatePatch(sourceCode, filePath, { targetAlgorithm });
    const safetyCheck = executePreApplicationLifecycle(filePath, patchResult, testCommand);

    return res.status(200).json({
      success: true,
      verdict: safetyCheck.verdict,
      safety_lifecycle: safetyCheck,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Patch Safety Verification Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/remediation/apply-patch
 * Applies patch only after full safety lifecycle passes and approval is verified if required.
 */
router.post("/apply-patch", (req, res) => {
  try {
    const sourceCode = req.body.source_code || req.body.code || "";
    let filePath = resolveConfinedPath(req.body.file_path || req.body.path);
    try {
      filePath = validateRemediationPath(filePath);
    } catch (pathErr) {
      return res.status(400).json({
        error: "PathConfinementViolation",
        code: "PATH_CONFINEMENT_VIOLATION",
        message: pathErr.message,
      });
    }
    const targetAlgorithm = req.body.target_algorithm || "SHA-256";
    const dryRun = req.body.dry_run !== undefined ? Boolean(req.body.dry_run) : true;
    const category = req.body.category || "ALGORITHM_MIGRATION";
    const environment = req.body.environment || "production";
    const approvalId = req.body.approval_id || null;

    // Check if human approval is required
    if (!dryRun && requiresExplicitApproval(category, environment)) {
      if (!approvalId) {
        return res.status(403).json({
          error: "Explicit Human Approval Required",
          message: `Changes for category '${category}' in '${environment}' require an approved change request. Please propose and approve first.`,
        });
      }

      const engine = getDefaultApprovalEngine();
      const approval = engine.getApproval(approvalId);
      if (approval.state !== "APPROVED") {
        return res.status(403).json({
          error: "Approval Incomplete",
          message: `Approval request '${approvalId}' is currently in state '${approval.state}'. Must be 'APPROVED' before applying.`,
        });
      }
    }

    const patchResult = req.body.patch || generatePatch(sourceCode, filePath, { targetAlgorithm });
    const safetyCheck = executePreApplicationLifecycle(filePath, patchResult);

    if (!safetyCheck.all_passed) {
      return res.status(400).json({
        success: false,
        error: "Patch Application Rejected",
        message: "Mandatory pre-application safety checks failed. Patch was not applied.",
        safety_lifecycle: safetyCheck,
      });
    }

    if (!dryRun && fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, patchResult.patched_code, "utf-8");
    }

    return res.status(200).json({
      success: true,
      mode: dryRun ? "DRY_RUN" : "APPLIED",
      is_dry_run: dryRun,
      message: dryRun
        ? "All safety checks passed. (DRY RUN: file was not modified on disk)"
        : "Patch successfully verified and applied to target file.",
      safety_lifecycle: safetyCheck,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({
        error: "Approval Error",
        message: err.message,
      });
    }
    return res.status(500).json({
      error: "Patch Application Failed",
      message: err.message,
    });
  }
});

// =====================================================================
// Human Approval Workflow Endpoints (Phase 12.3)
// =====================================================================

/**
 * POST /api/v1/remediation/approvals/propose
 * Creates a remediation proposal in PROPOSED state.
 */
router.post("/approvals/propose", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const record = engine.proposeRemediation(req.body, actor);
    defaultMetricsCollector.recordRemediation("proposed");

    return res.status(201).json({
      success: true,
      ...record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Proposal Error", message: err.message });
    }
    return res.status(500).json({ error: "Proposal Failed", message: err.message });
  }
});

/**
 * GET /api/v1/remediation/approvals
 * Lists approvals with optional filters (?state=...&category=...).
 */
router.get("/approvals", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const filters = {
      state: req.query.state,
      category: req.query.category,
      environment: req.query.environment,
    };
    const list = engine.listApprovals(filters);

    return res.status(200).json({
      success: true,
      total_approvals: list.length,
      approvals: list,
    });
  } catch (err) {
    return res.status(500).json({ error: "Retrieval Failed", message: err.message });
  }
});

/**
 * GET /api/v1/remediation/approvals/:approvalId
 * Retrieves specific approval request and verifies state chain integrity.
 */
router.get("/approvals/:approvalId", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const record = engine.getApproval(req.params.approvalId);
    const chainVerification = engine.verifyStateChain(req.params.approvalId);

    return res.status(200).json({
      success: true,
      approval: record,
      chain_verification: chainVerification,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 404).json({ error: "Not Found", message: err.message });
    }
    return res.status(500).json({ error: "Retrieval Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/review
 * Transitions from PROPOSED -> REVIEWED.
 */
router.post("/approvals/:approvalId/review", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const comments = req.body.comments || "Peer review completed.";
    const record = engine.reviewRemediation(req.params.approvalId, actor, comments);

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Review Error", message: err.message });
    }
    return res.status(500).json({ error: "Review Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/approve
 * Transitions from REVIEWED -> APPROVED. Enforces Four-Eyes Principle.
 */
router.post("/approvals/:approvalId/approve", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const comments = req.body.comments || "Approved for execution.";
    const record = engine.approveRemediation(req.params.approvalId, actor, comments);
    defaultMetricsCollector.recordRemediation("approved");

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.REMEDIATION_APPROVAL,
      action: AUDIT_ACTIONS.REMEDIATION_APPROVE,
      actor: { id: actor.username, username: actor.username, role: actor.role, ipAddress: req.ip },
      tenantId: req.tenantContext?.tenantId || "default",
      target: req.params.approvalId,
      status: AUDIT_STATUSES.SUCCESS,
      details: { approvalId: req.params.approvalId, comments },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Approval Error", message: err.message });
    }
    return res.status(500).json({ error: "Approval Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/apply
 * Transitions from APPROVED -> APPLIED.
 */
router.post("/approvals/:approvalId/apply", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const record = engine.applyRemediation(req.params.approvalId, actor);
    defaultMetricsCollector.recordRemediation("applied");

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.REMEDIATION_EXECUTION,
      action: AUDIT_ACTIONS.REMEDIATION_APPLY,
      actor: { id: actor.username, username: actor.username, role: actor.role, ipAddress: req.ip },
      tenantId: req.tenantContext?.tenantId || "default",
      target: req.params.approvalId,
      status: AUDIT_STATUSES.SUCCESS,
      details: { approvalId: req.params.approvalId },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Apply Error", message: err.message });
    }
    return res.status(500).json({ error: "Apply Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/verify
 * Transitions from APPLIED -> VERIFIED.
 */
router.post("/approvals/:approvalId/verify", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const results = req.body.verification_results;
    if (!results || typeof results !== "object") {
      return res.status(400).json({
        error: "Verification Evidence Required",
        code: "MISSING_VERIFICATION_RESULTS",
        status: "NOT_VERIFIED",
        message: "verification_results must be supplied. Absent evidence is never treated as a pass.",
      });
    }
    const record = engine.verifyRemediation(req.params.approvalId, actor, results);
    defaultMetricsCollector.recordRemediation("verified");

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Verification Error", message: err.message });
    }
    return res.status(500).json({ error: "Verification Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/rollback
 * Transitions to ROLLED_BACK.
 */
router.post("/approvals/:approvalId/rollback", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const reason = req.body.reason || "Manual rollback requested.";
    const record = engine.rollbackRemediation(req.params.approvalId, actor, reason);

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Rollback Error", message: err.message });
    }
    return res.status(500).json({ error: "Rollback Failed", message: err.message });
  }
});

/**
 * POST /api/v1/remediation/approvals/:approvalId/reject
 * Transitions to FAILED.
 */
router.post("/approvals/:approvalId/reject", (req, res) => {
  try {
    const engine = getDefaultApprovalEngine();
    const actor = getActorFromReq(req);
    const reason = req.body.reason || "Remediation rejected.";
    const record = engine.failRemediation(req.params.approvalId, actor, reason);

    return res.status(200).json({
      success: true,
      state: record.state,
      approval: record,
    });
  } catch (err) {
    if (err instanceof ApprovalWorkflowError) {
      return res.status(err.statusCode || 400).json({ error: "Rejection Error", message: err.message });
    }
    return res.status(500).json({ error: "Rejection Failed", message: err.message });
  }
});

module.exports = router;
