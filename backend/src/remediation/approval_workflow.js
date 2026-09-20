/**
 * ECDAT Safe Remediation Engine — Human Approval Workflow (Phase 12.3)
 *
 * Enforces explicit human approval for 6 sensitive operational categories:
 * - key/certificate rotation
 * - production config changes
 * - algorithm migration
 * - dependency upgrades
 * - network changes
 * - infrastructure changes
 *
 * Strict Approval States:
 * PROPOSED -> REVIEWED -> APPROVED -> APPLIED -> VERIFIED
 *                      \          \          \-> ROLLED_BACK
 *                       \          \-----------> FAILED
 *
 * Governance Controls:
 * - Four-Eyes Principle: Proposer !== Approver
 * - RBAC Authorization: Approver must possess admin or security_lead role
 * - Cryptographic Audit Trail: SHA-256 chained audit events for each transition
 */

const crypto = require("crypto");

const ApprovalState = Object.freeze({
  PROPOSED: "PROPOSED",
  REVIEWED: "REVIEWED",
  APPROVED: "APPROVED",
  APPLIED: "APPLIED",
  VERIFIED: "VERIFIED",
  ROLLED_BACK: "ROLLED_BACK",
  FAILED: "FAILED",
});

const SENSITIVE_APPROVAL_CATEGORIES = Object.freeze([
  "KEY_CERT_ROTATION",
  "PROD_CONFIG_CHANGE",
  "ALGORITHM_MIGRATION",
  "DEPENDENCY_UPGRADE",
  "NETWORK_CHANGE",
  "INFRASTRUCTURE_CHANGE",
]);

class ApprovalWorkflowError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ApprovalWorkflowError";
    this.statusCode = statusCode;
  }
}

/**
 * Normalizes input category to one of the canonical sensitive categories.
 */
function normalizeCategory(categoryStr = "") {
  const norm = String(categoryStr).trim().toUpperCase().replace(/[\s\-/]+/g, "_");

  if (
    norm.includes("KEY") ||
    norm.includes("CERT") ||
    norm.includes("ROTATION") ||
    norm.includes("RENEWAL")
  ) {
    return "KEY_CERT_ROTATION";
  }
  if (
    norm.includes("PROD_CONFIG") ||
    norm.includes("PRODUCTION_CONFIG") ||
    (norm.includes("CONFIG") && norm.includes("PROD"))
  ) {
    return "PROD_CONFIG_CHANGE";
  }
  if (
    norm.includes("ALGORITHM") ||
    norm.includes("MIGRATION") ||
    norm.includes("PQC") ||
    norm.includes("CRYPTO_UPGRADE")
  ) {
    return "ALGORITHM_MIGRATION";
  }
  if (
    norm.includes("DEPENDENCY") ||
    norm.includes("LIBRARY") ||
    norm.includes("PACKAGE")
  ) {
    return "DEPENDENCY_UPGRADE";
  }
  if (
    norm.includes("NETWORK") ||
    norm.includes("TLS") ||
    norm.includes("CIPHER_SUITE") ||
    norm.includes("INGRESS") ||
    norm.includes("GATEWAY")
  ) {
    return "NETWORK_CHANGE";
  }
  if (
    norm.includes("INFRASTRUCTURE") ||
    norm.includes("CLUSTER") ||
    norm.includes("SERVER") ||
    norm.includes("HOST")
  ) {
    return "INFRASTRUCTURE_CHANGE";
  }

  return norm;
}

/**
 * Checks if a given remediation action requires explicit human approval.
 */
function requiresExplicitApproval(category, environment = "production") {
  const norm = normalizeCategory(category);
  if (SENSITIVE_APPROVAL_CATEGORIES.includes(norm)) {
    return true;
  }
  // Any configuration modification in production requires approval
  if (String(environment).toLowerCase() === "production" && norm.includes("CONFIG")) {
    return true;
  }
  return false;
}

class ApprovalWorkflowEngine {
  constructor(options = {}) {
    this.signingSecret = options.signingSecret || "ecdat-default-approval-signing-secret-2026";
    this.approvals = new Map(); // id -> approvalRecord
  }

  /**
   * Helper to compute state transition hash.
   */
  _computeTransitionHash(prevHash, transitionData) {
    const payload = `${prevHash || "GENESIS"}|${JSON.stringify(transitionData)}`;
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  /**
   * 1. PROPOSE: Creates an approval request in PROPOSED state.
   */
  proposeRemediation(data, proposer = { username: "engineer", role: "developer" }) {
    if (!data.title) throw new ApprovalWorkflowError("Approval proposal requires a title");
    if (!proposer.username) throw new ApprovalWorkflowError("Proposer must have a username");

    const approvalId = data.approval_id || data.id || `appr_${crypto.randomUUID().substring(0, 8)}`;
    const category = normalizeCategory(data.category || data.action_type || "ALGORITHM_MIGRATION");
    const environment = data.environment || "production";
    const explicitApprovalRequired = requiresExplicitApproval(category, environment);

    const nowTs = new Date().toISOString();
    const genesisHash = this._computeTransitionHash(null, {
      approvalId,
      state: ApprovalState.PROPOSED,
      proposer: proposer.username,
      timestamp: nowTs,
    });

    const initialAudit = {
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: null,
      to_state: ApprovalState.PROPOSED,
      actor: proposer.username,
      role: proposer.role || "developer",
      timestamp: nowTs,
      comments: data.comments || "Initial remediation proposal created.",
      hash: genesisHash,
    };

    const approvalRecord = {
      approval_id: approvalId,
      state: ApprovalState.PROPOSED,
      title: data.title,
      description: data.description || "",
      category,
      environment,
      requires_explicit_approval: explicitApprovalRequired,
      finding_id: data.finding_id || null,
      affected_asset: data.affected_asset || null,
      tenantId: data.tenantId || "default-tenant",
      project_id: data.project_id || data.projectId || null,
      target_standard: data.target_standard || null,
      patch_diff: data.patch_diff || null,
      test_plan: data.test_plan || null,
      rollback_plan: data.rollback_plan || null,
      proposer: {
        username: proposer.username,
        role: proposer.role || "developer",
        proposed_at: nowTs,
      },
      reviewer: null,
      approver: null,
      deployer: null,
      verifier: null,
      audit_history: [initialAudit],
      current_state_hash: genesisHash,
    };

    this.approvals.set(approvalId, approvalRecord);
    return approvalRecord;
  }

  /**
   * 2. REVIEW: Transitions from PROPOSED -> REVIEWED.
   */
  reviewRemediation(approvalId, reviewer = { username: "tech_lead", role: "reviewer" }, comments = "Reviewed and verified.") {
    const record = this.getApproval(approvalId);

    if (record.state !== ApprovalState.PROPOSED) {
      throw new ApprovalWorkflowError(
        `Cannot review approval in state '${record.state}'. Expected '${ApprovalState.PROPOSED}'.`,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.REVIEWED,
      reviewer: reviewer.username,
      timestamp: nowTs,
    });

    record.state = ApprovalState.REVIEWED;
    record.reviewer = {
      username: reviewer.username,
      role: reviewer.role || "reviewer",
      reviewed_at: nowTs,
      comments,
    };

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: ApprovalState.PROPOSED,
      to_state: ApprovalState.REVIEWED,
      actor: reviewer.username,
      role: reviewer.role || "reviewer",
      timestamp: nowTs,
      comments,
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * 3. APPROVE: Transitions from REVIEWED -> APPROVED.
   * Enforces Four-Eyes Principle: Proposer !== Approver.
   * Enforces RBAC: Approver must have role 'admin' or 'security_lead'.
   */
  approveRemediation(
    approvalId,
    approver = { username: "sec_admin", role: "admin" },
    comments = "Approved for execution.",
  ) {
    const record = this.getApproval(approvalId);

    if (record.state !== ApprovalState.REVIEWED) {
      throw new ApprovalWorkflowError(
        `Cannot approve remediation in state '${record.state}'. Expected '${ApprovalState.REVIEWED}'.`,
      );
    }

    // Four-Eyes Principle: Proposer cannot approve their own change
    if (record.proposer.username.toLowerCase() === approver.username.toLowerCase()) {
      throw new ApprovalWorkflowError(
        `Four-Eyes Governance Violation: Proposer '${record.proposer.username}' cannot approve their own remediation proposal.`,
        403,
      );
    }

    // RBAC check
    const allowedRoles = [
      "admin",
      "security_lead",
      "ciso",
      "secops",
      "platform administrator",
      "platform admin",
      "security administrator",
      "security admin",
    ];
    const approverRole = String(approver.role || "").toLowerCase().replace(/[-_]/g, " ");
    if (!allowedRoles.some((r) => r.replace(/[-_]/g, " ") === approverRole)) {
      throw new ApprovalWorkflowError(
        `Unauthorized: Role '${approver.role}' is not authorized to approve cryptographic remediation. Requires one of ${JSON.stringify(allowedRoles)}.`,
        403,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.APPROVED,
      approver: approver.username,
      timestamp: nowTs,
    });

    record.state = ApprovalState.APPROVED;
    record.approver = {
      username: approver.username,
      role: approver.role || "admin",
      approved_at: nowTs,
      comments,
    };

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: ApprovalState.REVIEWED,
      to_state: ApprovalState.APPROVED,
      actor: approver.username,
      role: approver.role || "admin",
      timestamp: nowTs,
      comments,
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * 4. APPLY: Transitions from APPROVED -> APPLIED.
   * If sensitive category, strictly refuses application unless in APPROVED state!
   */
  applyRemediation(approvalId, deployer = { username: "automation_pipeline", role: "deployer" }) {
    const record = this.getApproval(approvalId);

    // RBAC check
    const allowedRoles = [
      "admin",
      "security_lead",
      "secops",
      "platform administrator",
      "platform admin",
      "security administrator",
      "security admin",
      "deployer",
    ];
    const deployerRole = String(deployer.role || "").toLowerCase().replace(/[-_]/g, " ");
    if (!allowedRoles.some((r) => r.replace(/[-_]/g, " ") === deployerRole)) {
      throw new ApprovalWorkflowError(
        `Unauthorized: Role '${deployer.role}' is not authorized to apply cryptographic remediation. Requires one of ${JSON.stringify(allowedRoles)}.`,
        403,
      );
    }

    // If explicit approval is required, state MUST be APPROVED
    if (record.requires_explicit_approval && record.state !== ApprovalState.APPROVED) {
      throw new ApprovalWorkflowError(
        `Explicit Human Approval Required: Remediation for '${record.category}' in '${record.environment}' cannot be applied in state '${record.state}'. Must be '${ApprovalState.APPROVED}'.`,
        403,
      );
    }

    // If not requiring explicit approval (low-impact non-prod), PROPOSED or REVIEWED can apply
    if (![ApprovalState.APPROVED, ApprovalState.REVIEWED, ApprovalState.PROPOSED].includes(record.state)) {
      throw new ApprovalWorkflowError(
        `Cannot apply remediation in terminal or invalid state '${record.state}'.`,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.APPLIED,
      deployer: deployer.username,
      timestamp: nowTs,
    });

    record.state = ApprovalState.APPLIED;
    record.deployer = {
      username: deployer.username,
      role: deployer.role || "deployer",
      applied_at: nowTs,
    };

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: record.audit_history[record.audit_history.length - 1].to_state,
      to_state: ApprovalState.APPLIED,
      actor: deployer.username,
      role: deployer.role || "deployer",
      timestamp: nowTs,
      comments: "Remediation patch applied to target environment.",
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * 5. VERIFY: Transitions from APPLIED -> VERIFIED.
   */
  verifyRemediation(
    approvalId,
    verifier = { username: "ecdat_rescan", role: "verifier" },
    verificationResults,
  ) {
    // RBAC check
    const allowedRoles = [
      "admin",
      "security_lead",
      "secops",
      "platform administrator",
      "platform admin",
      "security administrator",
      "security admin",
      "verifier",
      "qa_lead",
    ];
    const verifierRole = String(verifier.role || "").toLowerCase().replace(/[-_]/g, " ");
    if (!allowedRoles.some((r) => r.replace(/[-_]/g, " ") === verifierRole)) {
      throw new ApprovalWorkflowError(
        `Unauthorized: Role '${verifier.role}' is not authorized to verify cryptographic remediation. Requires one of ${JSON.stringify(allowedRoles)}.`,
        403,
      );
    }

    if (
      !verificationResults ||
      typeof verificationResults !== "object" ||
      typeof verificationResults.tests_passed !== "boolean" ||
      typeof verificationResults.finding_resolved !== "boolean"
    ) {
      throw new ApprovalWorkflowError(
        "Verification failed: 'verificationResults' must be explicitly provided with 'tests_passed' and 'finding_resolved' boolean fields.",
        400,
      );
    }
    const record = this.getApproval(approvalId);

    if (record.state !== ApprovalState.APPLIED) {
      throw new ApprovalWorkflowError(
        `Cannot verify remediation in state '${record.state}'. Expected '${ApprovalState.APPLIED}'.`,
      );
    }

    if (!verificationResults.tests_passed || !verificationResults.finding_resolved) {
      return this.failRemediation(
        approvalId,
        verifier,
        `Verification failed: tests_passed=${verificationResults.tests_passed}, finding_resolved=${verificationResults.finding_resolved}`,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.VERIFIED,
      verifier: verifier.username,
      timestamp: nowTs,
    });

    record.state = ApprovalState.VERIFIED;
    record.verifier = {
      username: verifier.username,
      role: verifier.role || "verifier",
      verified_at: nowTs,
      verification_results: verificationResults,
    };

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: ApprovalState.APPLIED,
      to_state: ApprovalState.VERIFIED,
      actor: verifier.username,
      role: verifier.role || "verifier",
      timestamp: nowTs,
      comments: "Post-remediation verification tests and CBOM comparison succeeded.",
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * 6. ROLLBACK: Transitions from APPLIED or APPROVED -> ROLLED_BACK.
   */
  rollbackRemediation(approvalId, actor = { username: "secops", role: "admin" }, reason = "Rollback triggered due to error threshold.") {
    const record = this.getApproval(approvalId);

    // RBAC check
    const allowedRoles = [
      "admin",
      "security_lead",
      "secops",
      "platform administrator",
      "platform admin",
      "security administrator",
      "security admin",
      "deployer",
    ];
    const actorRole = String(actor.role || "").toLowerCase().replace(/[-_]/g, " ");
    if (!allowedRoles.some((r) => r.replace(/[-_]/g, " ") === actorRole)) {
      throw new ApprovalWorkflowError(
        `Unauthorized: Role '${actor.role}' is not authorized to rollback cryptographic remediation. Requires one of ${JSON.stringify(allowedRoles)}.`,
        403,
      );
    }

    if (![ApprovalState.APPLIED, ApprovalState.APPROVED, ApprovalState.REVIEWED].includes(record.state)) {
      throw new ApprovalWorkflowError(
        `Cannot rollback remediation in state '${record.state}'.`,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.ROLLED_BACK,
      actor: actor.username,
      reason,
      timestamp: nowTs,
    });

    const prevState = record.state;
    record.state = ApprovalState.ROLLED_BACK;
    record.rollback = {
      rolled_back_by: actor.username,
      role: actor.role || "admin",
      rolled_back_at: nowTs,
      reason,
    };

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: prevState,
      to_state: ApprovalState.ROLLED_BACK,
      actor: actor.username,
      role: actor.role || "admin",
      timestamp: nowTs,
      comments: `Rollback executed: ${reason}`,
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * 7. FAIL: Transitions to FAILED state (terminal).
   */
  failRemediation(approvalId, actor = { username: "system", role: "system" }, reason = "Remediation failed.") {
    const record = this.getApproval(approvalId);

    // RBAC check
    const allowedRoles = [
      "admin",
      "security_lead",
      "secops",
      "ciso",
      "platform administrator",
      "platform admin",
      "security administrator",
      "security admin",
      "system",
    ];
    const actorRole = String(actor.role || "").toLowerCase().replace(/[-_]/g, " ");
    if (!allowedRoles.some((r) => r.replace(/[-_]/g, " ") === actorRole)) {
      throw new ApprovalWorkflowError(
        `Unauthorized: Role '${actor.role}' is not authorized to reject cryptographic remediation. Requires one of ${JSON.stringify(allowedRoles)}.`,
        403,
      );
    }

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.current_state_hash, {
      approvalId,
      from_state: record.state,
      to_state: ApprovalState.FAILED,
      actor: actor.username,
      reason,
      timestamp: nowTs,
    });

    const prevState = record.state;
    record.state = ApprovalState.FAILED;

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`,
      from_state: prevState,
      to_state: ApprovalState.FAILED,
      actor: actor.username,
      role: actor.role || "system",
      timestamp: nowTs,
      comments: `Remediation marked as failed: ${reason}`,
      hash: newHash,
    });

    record.current_state_hash = newHash;
    return record;
  }

  /**
   * Deletes an approval record by ID.
   */
  deleteApproval(approvalId) {
    if (!this.approvals.has(approvalId)) {
      throw new ApprovalWorkflowError(`Approval request '${approvalId}' not found`, 404);
    }
    this.approvals.delete(approvalId);
    return true;
  }

  /**
   * Retrieves an approval record by ID.
   */
  getApproval(approvalId) {
    const record = this.approvals.get(approvalId);
    if (!record) {
      throw new ApprovalWorkflowError(`Approval request '${approvalId}' not found`, 404);
    }
    return record;
  }

  /**
   * Lists all approval records, optionally filtered.
   */
  listApprovals(filters = {}) {
    let list = Array.from(this.approvals.values());

    if (filters.state) {
      const s = String(filters.state).toUpperCase();
      list = list.filter((r) => r.state === s);
    }
    if (filters.category) {
      const cat = normalizeCategory(filters.category);
      list = list.filter((r) => r.category === cat);
    }
    if (filters.environment) {
      list = list.filter((r) => r.environment.toLowerCase() === filters.environment.toLowerCase());
    }
    if (filters.tenantId) {
      list = list.filter((r) => (r.tenantId || "default-tenant") === filters.tenantId);
    }

    return list;
  }

  /**
   * Verifies the cryptographic integrity of an approval request's hash-chained audit log.
   */
  verifyStateChain(approvalId) {
    const record = this.getApproval(approvalId);
    let prevHash = null;

    for (let i = 0; i < record.audit_history.length; i++) {
      const entry = record.audit_history[i];
      let expectedPayload;

      if (i === 0) {
        expectedPayload = {
          approvalId,
          state: ApprovalState.PROPOSED,
          proposer: record.proposer.username,
          timestamp: entry.timestamp,
        };
      } else {
        expectedPayload = {
          approvalId,
          from_state: entry.from_state,
          to_state: entry.to_state,
          [entry.to_state === ApprovalState.REVIEWED
            ? "reviewer"
            : entry.to_state === ApprovalState.APPROVED
              ? "approver"
              : entry.to_state === ApprovalState.APPLIED
                ? "deployer"
                : entry.to_state === ApprovalState.VERIFIED
                  ? "verifier"
                  : "actor"]: entry.actor,
          ...(entry.to_state === ApprovalState.ROLLED_BACK || entry.to_state === ApprovalState.FAILED
            ? { reason: entry.comments.replace(/^Rollback executed: |^Remediation marked as failed: /, "") }
            : {}),
          timestamp: entry.timestamp,
        };
      }

      const recomputedHash = this._computeTransitionHash(prevHash, expectedPayload);
      if (recomputedHash !== entry.hash) {
        return {
          valid: false,
          broken_index: i,
          expected_hash: recomputedHash,
          found_hash: entry.hash,
        };
      }
      prevHash = entry.hash;
    }

    return { valid: true, total_events: record.audit_history.length, current_hash: record.current_state_hash };
  }
}

let _defaultApprovalEngine = null;

function getDefaultApprovalEngine(options = {}) {
  if (!_defaultApprovalEngine || Object.keys(options).length > 0) {
    _defaultApprovalEngine = new ApprovalWorkflowEngine(options);
  }
  return _defaultApprovalEngine;
}

module.exports = {
  ApprovalState,
  SENSITIVE_APPROVAL_CATEGORIES,
  ApprovalWorkflowError,
  ApprovalWorkflowEngine,
  getDefaultApprovalEngine,
  normalizeCategory,
  requiresExplicitApproval,
};
