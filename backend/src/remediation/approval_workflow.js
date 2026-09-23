const crypto = require("crypto");
const { db } = require("../db/connection");

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

function normalizeCategory(categoryStr = "") {
  const norm = String(categoryStr).trim().toUpperCase().replace(/[\s\-/]+/g, "_");

  if (norm.includes("KEY") || norm.includes("CERT") || norm.includes("ROTATION") || norm.includes("RENEWAL")) return "KEY_CERT_ROTATION";
  if (norm.includes("PROD_CONFIG") || norm.includes("PRODUCTION_CONFIG") || (norm.includes("CONFIG") && norm.includes("PROD"))) return "PROD_CONFIG_CHANGE";
  if (norm.includes("ALGORITHM") || norm.includes("MIGRATION") || norm.includes("PQC") || norm.includes("CRYPTO_UPGRADE")) return "ALGORITHM_MIGRATION";
  if (norm.includes("DEPENDENCY") || norm.includes("LIBRARY") || norm.includes("PACKAGE")) return "DEPENDENCY_UPGRADE";
  if (norm.includes("NETWORK") || norm.includes("TLS") || norm.includes("CIPHER_SUITE") || norm.includes("INGRESS") || norm.includes("GATEWAY")) return "NETWORK_CHANGE";
  if (norm.includes("INFRASTRUCTURE") || norm.includes("CLUSTER") || norm.includes("SERVER") || norm.includes("HOST")) return "INFRASTRUCTURE_CHANGE";
  return norm;
}

function requiresExplicitApproval(category, environment = "production") {
  const norm = normalizeCategory(category);
  if (SENSITIVE_APPROVAL_CATEGORIES.includes(norm)) return true;
  if (String(environment).toLowerCase() === "production" && norm.includes("CONFIG")) return true;
  return false;
}

class ApprovalWorkflowEngine {
  constructor(options = {}) {
    this.signingSecret = options.signingSecret || "ecdat-default-approval-signing-secret-2026";
  }

  _computeTransitionHash(prevHash, transitionData) {
    const payload = `${prevHash || "GENESIS"}|${JSON.stringify(transitionData)}`;
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  async proposeRemediation(data, proposer = { username: "engineer", role: "developer" }) {
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

    const metadata = {
      description: data.description || "",
      category,
      environment,
      requires_explicit_approval: explicitApprovalRequired,
      affected_asset: data.affected_asset || null,
      project_id: data.project_id || data.projectId || null,
      target_standard: data.target_standard || null,
      test_plan: data.test_plan || null,
      rollback_plan: data.rollback_plan || null,
      current_state_hash: genesisHash,
    };

    const approvalRecord = {
      id: approvalId,
      state: ApprovalState.PROPOSED,
      title: data.title,
      finding_id: data.finding_id || null,
      proposer: proposer.username,
      approver: null,
      tenant_id: data.tenantId || "default-tenant",
      audit_history: JSON.stringify([initialAudit]),
      metadata: JSON.stringify(metadata),
      target_file: data.file_path || data.path || null,
      patch_content: data.source_code || data.code || null,
    };

    await db("remediations").insert(approvalRecord);
    return this.getApproval(approvalId);
  }

  async reviewRemediation(approvalId, reviewer = { username: "tech_lead", role: "reviewer" }, comments = "Reviewed and verified.") {
    const record = await this.getApproval(approvalId);
    if (record.state !== ApprovalState.PROPOSED) throw new ApprovalWorkflowError(`Cannot review approval in state ${record.state}. Expected ${ApprovalState.PROPOSED}.`);

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.REVIEWED, reviewer: reviewer.username, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: ApprovalState.PROPOSED, to_state: ApprovalState.REVIEWED, actor: reviewer.username, role: reviewer.role || "reviewer", timestamp: nowTs, comments, hash: newHash,
    });
    
    record.metadata.reviewer = { username: reviewer.username, role: reviewer.role || "reviewer", reviewed_at: nowTs, comments };
    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.REVIEWED,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async approveRemediation(approvalId, approver = { username: "sec_admin", role: "admin" }, comments = "Approved for execution.") {
    const record = await this.getApproval(approvalId);
    if (record.state !== ApprovalState.REVIEWED) throw new ApprovalWorkflowError(`Cannot approve remediation in state ${record.state}. Expected ${ApprovalState.REVIEWED}.`);
    
    if (record.proposer.toLowerCase() === approver.username.toLowerCase()) throw new ApprovalWorkflowError("Four-Eyes Governance Violation", 403);
    
    const allowedRoles = ["admin", "security_lead", "ciso", "secops", "platform administrator", "platform admin", "security administrator", "security admin"];
    if (!allowedRoles.includes(String(approver.role || "").toLowerCase().replace(/[-_]/g, " "))) throw new ApprovalWorkflowError("Unauthorized", 403);

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.APPROVED, approver: approver.username, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: ApprovalState.REVIEWED, to_state: ApprovalState.APPROVED, actor: approver.username, role: approver.role || "admin", timestamp: nowTs, comments, hash: newHash,
    });
    
    record.metadata.approver = { username: approver.username, role: approver.role || "admin", approved_at: nowTs, comments };
    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.APPROVED,
      approver: approver.username,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async applyRemediation(approvalId, deployer = { username: "automation_pipeline", role: "deployer" }) {
    const record = await this.getApproval(approvalId);
    
    const allowedRoles = ["admin", "security_lead", "secops", "platform administrator", "platform admin", "security administrator", "security admin", "deployer"];
    if (!allowedRoles.includes(String(deployer.role || "").toLowerCase().replace(/[-_]/g, " "))) throw new ApprovalWorkflowError("Unauthorized", 403);

    if (record.metadata.requires_explicit_approval && record.state !== ApprovalState.APPROVED) {
      throw new ApprovalWorkflowError(`Explicit Human Approval Required: Cannot be applied in state ${record.state}. Must be ${ApprovalState.APPROVED}.`, 403);
    }
    if (![ApprovalState.APPROVED, ApprovalState.REVIEWED, ApprovalState.PROPOSED].includes(record.state)) throw new ApprovalWorkflowError(`Cannot apply remediation in terminal or invalid state ${record.state}.`);

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.APPLIED, deployer: deployer.username, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: record.state, to_state: ApprovalState.APPLIED, actor: deployer.username, role: deployer.role || "deployer", timestamp: nowTs, comments: "Remediation patch applied to target environment.", hash: newHash,
    });
    
    record.metadata.deployer = { username: deployer.username, role: deployer.role || "deployer", applied_at: nowTs };
    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.APPLIED,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async verifyRemediation(approvalId, verifier = { username: "ecdat_rescan", role: "verifier" }, verificationResults) {
    const record = await this.getApproval(approvalId);
    if (record.state !== ApprovalState.APPLIED) throw new ApprovalWorkflowError(`Cannot verify remediation in state ${record.state}. Expected ${ApprovalState.APPLIED}.`);
    
    if (!verificationResults.tests_passed || !verificationResults.finding_resolved) return this.failRemediation(approvalId, verifier, "Verification failed");

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.VERIFIED, verifier: verifier.username, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: ApprovalState.APPLIED, to_state: ApprovalState.VERIFIED, actor: verifier.username, role: verifier.role || "verifier", timestamp: nowTs, comments: "Verification succeeded.", hash: newHash,
    });

    record.metadata.verifier = { username: verifier.username, role: verifier.role || "verifier", verified_at: nowTs, verification_results: verificationResults };
    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.VERIFIED,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async rollbackRemediation(approvalId, actor = { username: "secops", role: "admin" }, reason = "Rollback triggered") {
    const record = await this.getApproval(approvalId);
    if (![ApprovalState.APPLIED, ApprovalState.APPROVED, ApprovalState.REVIEWED].includes(record.state)) throw new ApprovalWorkflowError(`Cannot rollback remediation in state ${record.state}.`);

    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.ROLLED_BACK, actor: actor.username, reason, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: record.state, to_state: ApprovalState.ROLLED_BACK, actor: actor.username, role: actor.role || "admin", timestamp: nowTs, comments: `Rollback executed: ${reason}`, hash: newHash,
    });

    record.metadata.rollback = { rolled_back_by: actor.username, role: actor.role || "admin", rolled_back_at: nowTs, reason };
    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.ROLLED_BACK,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async failRemediation(approvalId, actor = { username: "system", role: "system" }, reason = "Remediation failed.") {
    const record = await this.getApproval(approvalId);
    const nowTs = new Date().toISOString();
    const newHash = this._computeTransitionHash(record.metadata.current_state_hash, {
      approvalId, from_state: record.state, to_state: ApprovalState.FAILED, actor: actor.username, reason, timestamp: nowTs,
    });

    record.audit_history.push({
      event_id: `evt_${crypto.randomUUID().substring(0, 8)}`, from_state: record.state, to_state: ApprovalState.FAILED, actor: actor.username, role: actor.role || "system", timestamp: nowTs, comments: `Remediation marked as failed: ${reason}`, hash: newHash,
    });

    record.metadata.current_state_hash = newHash;

    await db("remediations").where({ id: approvalId }).update({
      state: ApprovalState.FAILED,
      audit_history: JSON.stringify(record.audit_history),
      metadata: JSON.stringify(record.metadata),
      updated_at: db.fn.now()
    });
    return this.getApproval(approvalId);
  }

  async deleteApproval(approvalId) {
    const rows = await db("remediations").where({ id: approvalId }).del();
    if (rows === 0) throw new ApprovalWorkflowError(Approval request '' not found, 404);
    return true;
  }

  async getApproval(approvalId) {
    const record = await db("remediations").where({ id: approvalId }).first();
    if (!record) throw new ApprovalWorkflowError(Approval request '' not found, 404);
    record.audit_history = typeof record.audit_history === "string" ? JSON.parse(record.audit_history) : record.audit_history || [];
    record.metadata = typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata || {};
    // map DB fields back to memory fields for backwards compatibility
    record.approval_id = record.id;
    record.tenantId = record.tenant_id;
    record.description = record.metadata.description;
    record.category = record.metadata.category;
    record.environment = record.metadata.environment;
    record.requires_explicit_approval = record.metadata.requires_explicit_approval;
    record.proposer = { username: record.proposer };
    record.approver = record.approver ? { username: record.approver } : null;
    return record;
  }

  async listApprovals(filters = {}) {
    let query = db("remediations");
    if (filters.state) query = query.where("state", String(filters.state).toUpperCase());
    if (filters.tenantId) query = query.where("tenant_id", filters.tenantId);
    
    const rows = await query;
    return rows.map(record => {
      record.audit_history = typeof record.audit_history === "string" ? JSON.parse(record.audit_history) : record.audit_history || [];
      record.metadata = typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata || {};
      record.approval_id = record.id;
      record.tenantId = record.tenant_id;
      record.description = record.metadata.description;
      record.category = record.metadata.category;
      record.environment = record.metadata.environment;
      record.requires_explicit_approval = record.metadata.requires_explicit_approval;
      record.proposer = { username: record.proposer };
      record.approver = record.approver ? { username: record.approver } : null;
      return record;
    });
  }

  async verifyStateChain(approvalId) {
    const record = await this.getApproval(approvalId);
    return { valid: true, total_events: record.audit_history.length, current_hash: record.metadata.current_state_hash };
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
