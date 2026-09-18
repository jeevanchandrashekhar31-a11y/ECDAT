/**
 * Policy and Governance REST API Router (Phase 11)
 */

const express = require("express");
const router = express.Router();
const {
  getDefaultEngine,
  getDefaultSecurityController,
  PolicyValidationError,
  PolicySecurityError,
} = require("../policy");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");

// Helper to extract actor strictly from verified security principal
function getActorFromReq(req) {
  // If user JWT is authenticated, user identity is immutable from JWT
  if (req.user) {
    const role = req.user.role || (Array.isArray(req.user.roles) ? req.user.roles[0] : "viewer");
    return {
      username: req.user.username || req.user.sub || req.user.userId || "authenticated-user",
      role: role || "viewer",
    };
  }

  // If authenticated via API Key / system token
  if (req.auth && req.auth.authenticated) {
    const authenticatedRole = req.auth.role || (Array.isArray(req.auth.roles) ? req.auth.roles[0] : "viewer");
    const isAdmin = authenticatedRole === "admin" || authenticatedRole === "platform administrator";

    // Only an authenticated admin API key may attribute actions to a sub-actor username for four-eyes audit
    const requestedUsername = req.headers["x-actor-username"] || req.body?.actor_username;
    const actorUsername = (isAdmin && requestedUsername && typeof requestedUsername === "string")
      ? requestedUsername.trim().slice(0, 100)
      : (req.auth.user?.username || req.auth.username || req.auth.keyId || "api-key-caller");

    // Role can NEVER be escalated above authenticatedRole
    return {
      username: actorUsername,
      role: authenticatedRole,
    };
  }

  // Unauthenticated caller is strictly anonymous viewer
  return {
    username: "anonymous",
    role: "viewer",
  };
}

/**
 * POST /api/v1/policy/evaluate
 * Evaluates assets, findings, or CBOM against a policy profile or active policy.
 */
router.post("/evaluate", (req, res) => {
  try {
    const engine = getDefaultEngine();
    const assetsOrCbom =
      req.body.assets || req.body.components || req.body.findings || req.body;
    const context = req.body.context || {};
    const policy = req.body.policy || null;

    const result = engine.evaluate(assetsOrCbom, context, policy);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof PolicyValidationError) {
      return res
        .status(400)
        .json({
          error: "Validation Error",
          message: err.message,
          details: err.errors,
        });
    }
    return res
      .status(500)
      .json({ error: "Evaluation Error", message: err.message });
  }
});

/**
 * POST /api/v1/policy/validate
 * Validates a policy document against the JSON Schema.
 */
router.post("/validate", (req, res) => {
  try {
    const engine = getDefaultEngine();
    const policy = req.body.policy || req.body;
    const validation = engine.validatePolicy(policy);
    return res.status(validation.valid ? 200 : 400).json(validation);
  } catch (err) {
    return res.status(500).json({ valid: false, errors: [err.message] });
  }
});

/**
 * GET /api/v1/policy/rules
 * Returns active policy rules and metadata.
 */
router.get("/rules", (_req, res) => {
  try {
    const engine = getDefaultEngine();
    const policy = engine.loadPolicy();
    return res.status(200).json({
      success: true,
      policy_id: policy.id,
      name: policy.name,
      version: policy.version,
      rules_count: (policy.rules || []).length,
      exceptions_count: (policy.exceptions || []).length,
      rules: policy.rules,
      exceptions: policy.exceptions,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Rules Retrieval Error", message: err.message });
  }
});

/**
 * GET /api/v1/policy/versions
 * Returns the version history of policies.
 */
router.get("/versions", (_req, res) => {
  try {
    const security = getDefaultSecurityController();
    const versionsList = Array.from(security.versions.values()).map((v) => ({
      version: v.version,
      policy_id: v.policy_id,
      status: v.status,
      author: v.author,
      created_at: v.created_at,
      approver: v.approver,
      approved_at: v.approved_at,
      activated_at: v.activated_at,
    }));
    return res.status(200).json({
      success: true,
      active_version: security.activeVersion,
      versions: versionsList,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Version History Error", message: err.message });
  }
});

/**
 * POST /api/v1/policy/draft
 * Creates a new policy draft (admin only).
 */
router.post("/draft", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const policyData = req.body.policy || req.body;

    const draft = security.createDraft(policyData, actor);
    return res.status(201).json({ success: true, draft });
  } catch (err) {
    const status =
      err.status || (err instanceof PolicyValidationError ? 400 : 500);
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/:version/submit
 * Submits a draft policy for peer review.
 */
router.post("/:version/submit", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const result = security.submitForApproval(req.params.version, actor);
    return res.status(200).json({ success: true, policy: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/:version/approve
 * Approves a submitted policy (enforces four-eyes: approver !== author).
 */
router.post("/:version/approve", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const comments = req.body.comments || null;
    const result = security.approvePolicy(req.params.version, actor, comments);
    return res.status(200).json({ success: true, policy: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/:version/reject
 * Rejects a submitted policy.
 */
router.post("/:version/reject", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const reason = req.body.reason || "Rejected by reviewer.";
    const result = security.rejectPolicy(req.params.version, actor, reason);
    return res.status(200).json({ success: true, policy: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/:version/activate
 * Promotes an approved policy to active status.
 */
router.post("/:version/activate", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const result = security.activatePolicy(req.params.version, actor);

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.POLICY_CHANGE,
      action: AUDIT_ACTIONS.POLICY_ACTIVATE,
      actor: { id: actor.username, username: actor.username, role: actor.role, ipAddress: req.ip },
      tenantId: req.tenantContext?.tenantId || "default",
      target: req.params.version,
      status: AUDIT_STATUSES.SUCCESS,
      details: { version: req.params.version },
    }).catch(() => {});

    return res.status(200).json({ success: true, policy: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/rollback
 * Rolls back active policy to an earlier approved version.
 */
router.post("/rollback", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const { target_version, reason } = req.body;
    if (!target_version) {
      return res
        .status(400)
        .json({
          error: "Missing Parameter",
          message: "target_version is required for rollback.",
        });
    }
    const result = security.rollbackToVersion(
      target_version,
      actor,
      reason || "Administrative rollback",
    );

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.POLICY_CHANGE,
      action: AUDIT_ACTIONS.POLICY_ROLLBACK,
      actor: { id: actor.username, username: actor.username, role: actor.role, ipAddress: req.ip },
      tenantId: req.tenantContext?.tenantId || "default",
      target: target_version,
      status: AUDIT_STATUSES.SUCCESS,
      details: { target_version, reason },
    }).catch(() => {});

    return res.status(200).json({ success: true, active_policy: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/test
 * Dry-run simulation against sample assets or CBOM.
 */
router.post("/test", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const policyDoc = req.body.policy || req.body.version;
    const testAssets =
      req.body.assets || req.body.components || req.body.findings || [];
    const context = req.body.context || {};

    const report = security.testPolicy(policyDoc, testAssets, context);
    return res.status(200).json({ success: true, report });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * GET /api/v1/policy/audit-log
 * Returns the immutable audit history and chain integrity status.
 */
router.get("/audit-log", (_req, res) => {
  try {
    const security = getDefaultSecurityController();
    const integrity = security.verifyAuditChainIntegrity();
    return res.status(200).json({
      success: true,
      integrity_verified: integrity.valid,
      integrity_errors: integrity.errors,
      entries_count: security.auditLog.length,
      audit_log: security.auditLog,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Audit Log Error", message: err.message });
  }
});

/**
 * POST /api/v1/policy/sign
 * Generates a signed policy bundle.
 */
router.post("/sign", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const actor = getActorFromReq(req);
    const policyData = req.body.policy || req.body;
    const bundle = security.signPolicyBundle(policyData, actor);
    return res.status(200).json({ success: true, bundle });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.name, message: err.message });
  }
});

/**
 * POST /api/v1/policy/verify-signature
 * Verifies a signed policy bundle.
 */
router.post("/verify-signature", (req, res) => {
  try {
    const security = getDefaultSecurityController();
    const bundle = req.body.bundle || req.body;
    const verification = security.verifySignedPolicyBundle(bundle);
    return res.status(verification.valid ? 200 : 400).json(verification);
  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
});

module.exports = router;
