/**
 * ECDAT Enterprise Policy Security & Governance Subsystem (Phase 11.2)
 *
 * Enforces:
 * - Only authorized administrators may modify policy
 * - Policy versioning lifecycle (DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> SUPERSEDED / ROLLED_BACK)
 * - Four-eyes approval workflow (author !== approver)
 * - Immutable cryptographically chained audit history (SHA-256 hash chaining)
 * - Rollback to previous approved versions with full audit attribution
 * - Sandbox / dry-run policy impact testing
 * - Cryptographic digital signing and verification of policy artifacts
 * - Strict prevention of arbitrary code execution
 */

const crypto = require("crypto");
const { PolicyEngine, PolicyValidationError } = require("./policy_engine");

class PolicySecurityError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = "PolicySecurityError";
    this.status = status;
  }
}

class PolicySecurityController {
  constructor(options = {}) {
    this.signingSecret =
      options.signingSecret ||
      process.env.ECDAT_POLICY_SIGNING_KEY ||
      "ecdat-default-secure-governance-secret-key-32b";
    this.engine = new PolicyEngine(options);
    this.auditLog = [];
    this.versions = new Map(); // version -> version_meta
    this.activeVersion = null;

    // Genesis audit entry
    this._appendAuditEntry({
      action: "GENESIS",
      actor: "SYSTEM",
      policyId: "ecdat:policy:genesis",
      version: "0.0.0",
      details: "Policy security & governance ledger initialized.",
    });
  }

  // =========================================================================
  // 1. Immutable Cryptographically Chained Audit Ledger
  // =========================================================================
  _appendAuditEntry({ action, actor, policyId, version, details }) {
    const prevHash =
      this.auditLog.length > 0
        ? this.auditLog[this.auditLog.length - 1].audit_hash
        : "0".repeat(64);
    const entryId = `AUDIT-${String(this.auditLog.length + 1).padStart(6, "0")}`;
    const timestamp = new Date().toISOString();

    const canonicalPayload = {
      entry_id: entryId,
      timestamp,
      action,
      actor,
      policy_id: policyId,
      version,
      details,
      prev_audit_hash: prevHash,
    };

    const entryJson = JSON.stringify(canonicalPayload);
    const entryHash = crypto
      .createHash("sha256")
      .update(entryJson)
      .digest("hex");

    const entry = {
      ...canonicalPayload,
      audit_hash: entryHash,
    };
    this.auditLog.push(entry);
    return entry;
  }

  verifyAuditChainIntegrity() {
    if (this.auditLog.length === 0) return { valid: true, errors: [] };

    const errors = [];
    for (let i = 0; i < this.auditLog.length; i++) {
      const entry = this.auditLog[i];
      const expectedPrev =
        i > 0 ? this.auditLog[i - 1].audit_hash : "0".repeat(64);

      if (entry.prev_audit_hash !== expectedPrev) {
        errors.push(
          `Chain break at entry ${entry.entry_id}: expected prev_hash ${expectedPrev}, found ${entry.prev_audit_hash}`,
        );
      }

      const payload = {
        entry_id: entry.entry_id,
        timestamp: entry.timestamp,
        action: entry.action,
        actor: entry.actor,
        policy_id: entry.policy_id,
        version: entry.version,
        details: entry.details,
        prev_audit_hash: entry.prev_audit_hash,
      };

      const computedHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");

      if (computedHash !== entry.audit_hash) {
        errors.push(
          `Hash mismatch at entry ${entry.entry_id}: computed ${computedHash}, recorded ${entry.audit_hash}`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // =========================================================================
  // 2. Authorization & RBAC Checks
  // =========================================================================
  _assertAdminAuthorized(actor) {
    if (!actor || typeof actor !== "object") {
      throw new PolicySecurityError("Invalid actor credentials", 401);
    }
    const role = String(actor.role || "").toLowerCase();
    if (role !== "admin") {
      throw new PolicySecurityError(
        `Unauthorized: User '${actor.username || "unknown"}' with role '${role}' is not an authorized policy administrator.`,
        403,
      );
    }
  }

  // =========================================================================
  // 3. Policy Lifecycle & Four-Eyes Approval Workflow
  // =========================================================================
  createDraft(policyData, author) {
    this._assertAdminAuthorized(author);

    const validation = this.engine.validatePolicy(policyData);
    if (!validation.valid) {
      throw new PolicyValidationError(
        `Cannot create draft with invalid policy schema: ${validation.errors.join("; ")}`,
        validation.errors,
      );
    }

    const version = policyData.version;
    const policyId = policyData.id;

    if (this.versions.has(version)) {
      const existing = this.versions.get(version);
      if (["ACTIVE", "APPROVED", "SUPERSEDED"].includes(existing.status)) {
        throw new PolicySecurityError(
          `Policy version '${version}' already exists and is immutable.`,
          409,
        );
      }
    }

    const authorName = author.username || author.id || "admin";
    const now = new Date().toISOString();

    const meta = {
      policy_id: policyId,
      version,
      status: "DRAFT",
      author: authorName,
      created_at: now,
      policy_document: policyData,
      approver: null,
      approved_at: null,
      activated_at: null,
    };
    this.versions.set(version, meta);

    this._appendAuditEntry({
      action: "POLICY_DRAFT_CREATED",
      actor: authorName,
      policyId,
      version,
      details: {
        name: policyData.name,
        rules_count: (policyData.rules || []).length,
      },
    });

    return meta;
  }

  submitForApproval(version, submitter) {
    this._assertAdminAuthorized(submitter);
    if (!this.versions.has(version)) {
      throw new PolicySecurityError(
        `Policy version '${version}' not found.`,
        404,
      );
    }

    const item = this.versions.get(version);
    if (item.status !== "DRAFT") {
      throw new PolicySecurityError(
        `Policy version '${version}' is in status '${item.status}', expected 'DRAFT'.`,
        400,
      );
    }

    const submitterName = submitter.username || "admin";
    item.status = "PENDING_APPROVAL";

    this._appendAuditEntry({
      action: "POLICY_SUBMITTED_FOR_APPROVAL",
      actor: submitterName,
      policyId: item.policy_id,
      version,
      details: { submitter: submitterName },
    });

    return item;
  }

  approvePolicy(version, approver, comments = null) {
    this._assertAdminAuthorized(approver);
    if (!this.versions.has(version)) {
      throw new PolicySecurityError(
        `Policy version '${version}' not found.`,
        404,
      );
    }

    const item = this.versions.get(version);
    if (item.status !== "PENDING_APPROVAL") {
      throw new PolicySecurityError(
        `Policy version '${version}' is in status '${item.status}', must be 'PENDING_APPROVAL' to approve.`,
        400,
      );
    }

    const approverName = approver.username || approver.id || "approver";
    if (approverName === item.author) {
      throw new PolicySecurityError(
        `Four-Eyes Governance Violation: Author '${item.author}' cannot approve their own policy submission.`,
        403,
      );
    }

    const now = new Date().toISOString();
    item.status = "APPROVED";
    item.approver = approverName;
    item.approved_at = now;
    item.approval_comments = comments || "Approved by security administrator.";

    this._appendAuditEntry({
      action: "POLICY_APPROVED",
      actor: approverName,
      policyId: item.policy_id,
      version,
      details: { approver: approverName, comments: item.approval_comments },
    });

    return item;
  }

  rejectPolicy(version, reviewer, reason) {
    this._assertAdminAuthorized(reviewer);
    if (!this.versions.has(version)) {
      throw new PolicySecurityError(
        `Policy version '${version}' not found.`,
        404,
      );
    }

    const item = this.versions.get(version);
    const reviewerName = reviewer.username || "reviewer";
    item.status = "REJECTED";
    item.rejection_reason = reason;

    this._appendAuditEntry({
      action: "POLICY_REJECTED",
      actor: reviewerName,
      policyId: item.policy_id,
      version,
      details: { reviewer: reviewerName, reason },
    });

    return item;
  }

  activatePolicy(version, admin) {
    this._assertAdminAuthorized(admin);
    if (!this.versions.has(version)) {
      throw new PolicySecurityError(
        `Policy version '${version}' not found.`,
        404,
      );
    }

    const item = this.versions.get(version);
    if (item.status !== "APPROVED") {
      throw new PolicySecurityError(
        `Cannot activate policy '${version}' with status '${item.status}'. Policy must be 'APPROVED' first.`,
        400,
      );
    }

    const adminName = admin.username || "admin";
    const now = new Date().toISOString();

    if (this.activeVersion && this.versions.has(this.activeVersion)) {
      const oldItem = this.versions.get(this.activeVersion);
      oldItem.status = "SUPERSEDED";
      this._appendAuditEntry({
        action: "POLICY_SUPERSEDED",
        actor: adminName,
        policyId: oldItem.policy_id,
        version: this.activeVersion,
        details: { superseded_by: version },
      });
    }

    item.status = "ACTIVE";
    item.activated_at = now;
    this.activeVersion = version;

    this._appendAuditEntry({
      action: "POLICY_ACTIVATED",
      actor: adminName,
      policyId: item.policy_id,
      version,
      details: { activated_by: adminName },
    });

    return item;
  }

  // =========================================================================
  // 4. Rollback
  // =========================================================================
  rollbackToVersion(targetVersion, admin, reason) {
    this._assertAdminAuthorized(admin);
    if (!this.versions.has(targetVersion)) {
      throw new PolicySecurityError(
        `Rollback target version '${targetVersion}' does not exist.`,
        404,
      );
    }

    const target = this.versions.get(targetVersion);
    if (!["SUPERSEDED", "APPROVED", "ACTIVE"].includes(target.status)) {
      throw new PolicySecurityError(
        `Cannot rollback to version '${targetVersion}' in status '${target.status}'.`,
        400,
      );
    }

    const adminName = admin.username || "admin";
    const currentActive = this.activeVersion;

    if (currentActive && this.versions.has(currentActive)) {
      this.versions.get(currentActive).status = "ROLLED_BACK";
    }

    target.status = "ACTIVE";
    target.activated_at = new Date().toISOString();
    this.activeVersion = targetVersion;

    this._appendAuditEntry({
      action: "POLICY_ROLLED_BACK",
      actor: adminName,
      policyId: target.policy_id,
      version: targetVersion,
      details: {
        previous_version: currentActive,
        target_version: targetVersion,
        reason,
      },
    });

    return target;
  }

  // =========================================================================
  // 5. Sandbox / Dry-Run Policy Testing
  // =========================================================================
  testPolicy(policyDataOrVersion, testAssetsOrCbom, context = {}) {
    let policyDoc;
    if (
      typeof policyDataOrVersion === "string" &&
      this.versions.has(policyDataOrVersion)
    ) {
      policyDoc = this.versions.get(policyDataOrVersion).policy_document;
    } else if (
      typeof policyDataOrVersion === "object" &&
      policyDataOrVersion !== null
    ) {
      policyDoc = policyDataOrVersion;
    } else {
      throw new PolicySecurityError(
        "Invalid policy reference for dry-run testing.",
        400,
      );
    }

    const result = this.engine.evaluate(testAssetsOrCbom, context, policyDoc);

    return {
      test_timestamp: new Date().toISOString(),
      policy_id: policyDoc.id,
      policy_version: policyDoc.version,
      verdict: result.verdict,
      total_assets_tested: result.metrics.total_assets_evaluated,
      blocking_violations: result.metrics.counts_by_verdict.BLOCK,
      warning_violations: result.metrics.counts_by_verdict.WARN,
      exceptions_applied: result.metrics.counts_by_verdict.EXCEPTION,
      clean_assets: result.metrics.counts_by_verdict.ALLOW,
      is_safe_for_production: result.metrics.counts_by_verdict.BLOCK === 0,
      evaluation_result: result,
    };
  }

  // =========================================================================
  // 6. Cryptographic Policy Artifact Signing & Verification
  // =========================================================================
  signPolicyBundle(policyData, signerInfo = {}) {
    const validation = this.engine.validatePolicy(policyData);
    if (!validation.valid) {
      throw new PolicyValidationError(
        `Cannot sign invalid policy: ${validation.errors.join("; ")}`,
        validation.errors,
      );
    }

    const canonicalBody = JSON.stringify(policyData);
    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(canonicalBody)
      .digest("hex");

    const signer = signerInfo.username || "security-officer";
    const bundle = {
      envelope_version: "1.0.0",
      signed_at: new Date().toISOString(),
      signer,
      signature_algorithm: "HMAC-SHA256",
      policy_id: policyData.id,
      policy_version: policyData.version,
      signature,
      policy: policyData,
    };

    this._appendAuditEntry({
      action: "POLICY_SIGNED",
      actor: signer,
      policyId: policyData.id,
      version: policyData.version,
      details: { signature_preview: signature.substring(0, 16) + "..." },
    });

    return bundle;
  }

  verifySignedPolicyBundle(bundle) {
    if (!bundle || typeof bundle !== "object") {
      return { valid: false, error: "Bundle must be a JSON object." };
    }

    const required = ["signature", "signature_algorithm", "policy"];
    for (const r of required) {
      if (!bundle[r]) {
        return {
          valid: false,
          error: `Signed bundle missing required field '${r}'.`,
        };
      }
    }

    const canonicalBody = JSON.stringify(bundle.policy);
    const expectedSig = crypto
      .createHmac("sha256", this.signingSecret)
      .update(canonicalBody)
      .digest("hex");

    const sigA = Buffer.from(bundle.signature);
    const sigB = Buffer.from(expectedSig);

    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      return {
        valid: false,
        error:
          "Cryptographic signature verification FAILED. Policy artifact has been tampered with or key mismatch.",
      };
    }

    const validation = this.engine.validatePolicy(bundle.policy);
    if (!validation.valid) {
      return {
        valid: false,
        error: `Signed policy contains schema violations: ${validation.errors.join("; ")}`,
      };
    }

    return { valid: true, error: null };
  }
}

module.exports = {
  PolicySecurityController,
  PolicySecurityError,
};
