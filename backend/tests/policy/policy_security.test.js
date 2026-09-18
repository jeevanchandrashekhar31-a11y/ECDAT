// @ecdat-synthetic-corpus
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PolicySecurityController,
  PolicySecurityError,
} = require("../../src/policy/policy_security");
const {
  DEFAULT_POLICY_PATH,
  PolicyEngine,
} = require("../../src/policy/policy_engine");

function getSamplePolicy() {
  const engine = new PolicyEngine();
  return JSON.parse(JSON.stringify(engine.loadPolicy(DEFAULT_POLICY_PATH)));
}

test("PolicySecurity - RBAC admin authorization enforcement", () => {
  const controller = new PolicySecurityController();
  const nonAdmin = { username: "developer_dave", role: "developer" };
  const admin = { username: "alice_admin", role: "admin" };
  const policy = getSamplePolicy();

  assert.throws(() => controller.createDraft(policy, nonAdmin), /Unauthorized/);

  const draft = controller.createDraft(policy, admin);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.author, "alice_admin");
});

test("PolicySecurity - Four-eyes approval workflow prevents self-approval", () => {
  const controller = new PolicySecurityController();
  const author = { username: "alice_author", role: "admin" };
  const approver = { username: "bob_approver", role: "admin" };
  const policy = getSamplePolicy();

  controller.createDraft(policy, author);
  controller.submitForApproval(policy.version, author);

  // Self-approval must throw Four-Eyes Governance Violation
  assert.throws(
    () => controller.approvePolicy(policy.version, author),
    /Four-Eyes Governance Violation/,
  );

  // Peer approval succeeds
  const approved = controller.approvePolicy(
    policy.version,
    approver,
    "Looks good for production.",
  );
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approver, "bob_approver");

  // Activation
  const active = controller.activatePolicy(policy.version, approver);
  assert.equal(active.status, "ACTIVE");
  assert.equal(controller.activeVersion, policy.version);
});

test("PolicySecurity - Immutable audit ledger integrity and tamper detection", () => {
  const controller = new PolicySecurityController();
  const author = { username: "alice", role: "admin" };
  const approver = { username: "bob", role: "admin" };
  const policy = getSamplePolicy();

  controller.createDraft(policy, author);
  controller.submitForApproval(policy.version, author);
  controller.approvePolicy(policy.version, approver);

  // Check valid audit log
  const check = controller.verifyAuditChainIntegrity();
  assert.equal(check.valid, true);
  assert.equal(check.errors.length, 0);
  assert.ok(controller.auditLog.length >= 4);

  // Tamper with an audit entry
  controller.auditLog[2].actor = "unauthorized_imposter";

  // Verification fails immediately!
  const checkAfterTamper = controller.verifyAuditChainIntegrity();
  assert.equal(checkAfterTamper.valid, false);
  assert.ok(checkAfterTamper.errors.length > 0);
});

test("PolicySecurity - Rollback reverts active policy to previous approved version", () => {
  const controller = new PolicySecurityController();
  const author = { username: "alice", role: "admin" };
  const approver = { username: "bob", role: "admin" };

  // v1.0.0
  const v1 = getSamplePolicy();
  v1.version = "1.0.0";
  controller.createDraft(v1, author);
  controller.submitForApproval("1.0.0", author);
  controller.approvePolicy("1.0.0", approver);
  controller.activatePolicy("1.0.0", approver);
  assert.equal(controller.activeVersion, "1.0.0");

  // v2.0.0
  const v2 = getSamplePolicy();
  v2.version = "2.0.0";
  controller.createDraft(v2, author);
  controller.submitForApproval("2.0.0", author);
  controller.approvePolicy("2.0.0", approver);
  controller.activatePolicy("2.0.0", approver);
  assert.equal(controller.activeVersion, "2.0.0");
  assert.equal(controller.versions.get("1.0.0").status, "SUPERSEDED");

  // Rollback to 1.0.0
  const rolledBack = controller.rollbackToVersion(
    "1.0.0",
    author,
    "Detected issues in v2.0.0",
  );
  assert.equal(rolledBack.version, "1.0.0");
  assert.equal(rolledBack.status, "ACTIVE");
  assert.equal(controller.activeVersion, "1.0.0");
  assert.equal(controller.versions.get("2.0.0").status, "ROLLED_BACK");

  // Audit record exists
  const lastAudit = controller.auditLog[controller.auditLog.length - 1];
  assert.equal(lastAudit.action, "POLICY_ROLLED_BACK");
  assert.equal(lastAudit.details.target_version, "1.0.0");
});

test("PolicySecurity - Sandbox dry-run testing analyzes impact", () => {
  const controller = new PolicySecurityController();
  const policy = getSamplePolicy();
  const testAssets = [
    { asset_id: "test-md5", algorithm: "MD5", type: "digest" },
    { asset_id: "test-aes", algorithm: "AES-256-GCM", type: "cipher" },
  ];

  const report = controller.testPolicy(policy, testAssets);
  assert.equal(report.total_assets_tested, 2);
  assert.equal(report.blocking_violations, 1);
  assert.equal(report.clean_assets, 1);
  assert.equal(report.is_safe_for_production, false);
  assert.equal(report.verdict, "BLOCK");
});

test("PolicySecurity - Signed policy artifact generation and cryptographic verification", () => {
  const controller = new PolicySecurityController({
    signingSecret: "governance-secret-key-12345",
  });
  const policy = getSamplePolicy();
  const signer = { username: "ciso_alex", role: "admin" };

  // 1. Sign
  const bundle = controller.signPolicyBundle(policy, signer);
  assert.ok(bundle.signature);
  assert.equal(bundle.signature_algorithm, "HMAC-SHA256");
  assert.equal(bundle.signer, "ciso_alex");

  // 2. Verify legitimate bundle
  const validCheck = controller.verifySignedPolicyBundle(bundle);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.error, null);

  // 3. Tamper with policy inside bundle
  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.policy.description = "Tampered policy description";

  const tamperedCheck = controller.verifySignedPolicyBundle(tampered);
  assert.equal(tamperedCheck.valid, false);
  assert.ok(tamperedCheck.error.includes("FAILED"));
});

test("PolicySecurity - Rejects arbitrary code injection and prototype pollution", () => {
  const controller = new PolicySecurityController();
  const raw = JSON.stringify(getSamplePolicy());
  const maliciousPolicy = JSON.parse(
    raw.slice(0, -1) + ',"__proto__":{"polluted":true}}',
  );

  const admin = { username: "admin", role: "admin" };
  assert.throws(() => controller.createDraft(maliciousPolicy, admin));
});
