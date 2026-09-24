const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ApprovalState,
  SENSITIVE_APPROVAL_CATEGORIES,
  ApprovalWorkflowError,
  ApprovalWorkflowEngine,
  getDefaultApprovalEngine,
  normalizeCategory,
  requiresExplicitApproval,
} = require("../../src/remediation");

test("Approval Workflow - Correctly categorizes 6 sensitive operations", () => {
  assert.equal(requiresExplicitApproval("key/certificate rotation"), true);
  assert.equal(requiresExplicitApproval("production config changes"), true);
  assert.equal(requiresExplicitApproval("algorithm migration"), true);
  assert.equal(requiresExplicitApproval("dependency upgrades"), true);
  assert.equal(requiresExplicitApproval("network changes"), true);
  assert.equal(requiresExplicitApproval("infrastructure changes"), true);

  assert.equal(normalizeCategory("cert_renewal"), "KEY_CERT_ROTATION");
  assert.equal(normalizeCategory("prod_config"), "PROD_CONFIG_CHANGE");
  assert.equal(normalizeCategory("pqc_migration"), "ALGORITHM_MIGRATION");
  assert.equal(normalizeCategory("library_upgrade"), "DEPENDENCY_UPGRADE");
  assert.equal(normalizeCategory("tls_change"), "NETWORK_CHANGE");
  assert.equal(normalizeCategory("cluster_change"), "INFRASTRUCTURE_CHANGE");
});

test("Approval Workflow - Lifecycle progression PROPOSED -> REVIEWED -> APPROVED -> APPLIED -> VERIFIED", async () => {
  const engine = new ApprovalWorkflowEngine();
  const proposer = { username: "alice_eng", role: "developer" };
  const reviewer = { username: "bob_lead", role: "reviewer" };
  const approver = { username: "charlie_admin", role: "admin" };
  const deployer = { username: "pipeline_bot", role: "deployer" };
  const verifier = { username: "scanner_bot", role: "verifier" };

  // 1. Propose
  const req = await engine.proposeRemediation(
    {
      title: "Rotate API signing certificate",
      category: "key/certificate rotation",
      environment: "production",
    },
    proposer,
  );
  const id = (((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id);
  assert.equal(req.state, ApprovalState.PROPOSED);
  assert.equal((req.metadata?.requires_explicit_approval || (typeof req.metadata === "string" ? JSON.parse(req.metadata).requires_explicit_approval : false)), true);

  // 2. Review
  const reviewed = await await await await await await engine.reviewRemediation(id, reviewer, "Review passed.");
  assert.equal(reviewed.state, ApprovalState.REVIEWED);

  // 3. Approve
  const approved = await await await await await await engine.approveRemediation(id, approver, "Approved for deployment.");
  assert.equal(approved.state, ApprovalState.APPROVED);

  // 4. Apply
  const applied = await await await await await await engine.applyRemediation(id, deployer);
  assert.equal(applied.state, ApprovalState.APPLIED);

  // 5. Verify
  const verified = await engine.verifyRemediation(id, verifier, {
    tests_passed: true,
    finding_resolved: true,
  });
  assert.equal(verified.state, ApprovalState.VERIFIED);

  // Cryptographic audit chain verification
  const chain = await engine.verifyStateChain(id);
  assert.equal(chain.valid, true);
  assert.equal(chain.total_events, 5);
});

test("Approval Workflow - Four-Eyes Principle prevents self-approval", async () => {
  const engine = new ApprovalWorkflowEngine();
  const alice = { username: "alice_admin", role: "admin" };

  const req = await engine.proposeRemediation(
    { title: "PQC Migration", category: "algorithm migration" },
    alice,
  );
  await await await await await engine.reviewRemediation((((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id), { username: "bob_reviewer", role: "reviewer" });

  await assert.rejects(
    async () => {
      await await await await await engine.approveRemediation((((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id), alice);
    },
    (err) => {
      assert.ok(err instanceof ApprovalWorkflowError);
      assert.ok(err.message.includes("Four-Eyes Governance Violation"));
      return true;
    },
  );
});

test("Approval Workflow - Enforces RBAC approver authorization", async () => {
  const engine = new ApprovalWorkflowEngine();
  const req = await engine.proposeRemediation(
    { title: "Config change", category: "production config changes" },
    { username: "alice", role: "developer" },
  );
  await await await await await engine.reviewRemediation((((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id), { username: "bob", role: "reviewer" });

  const nonAdmin = { username: "dave", role: "developer" };
  await assert.rejects(
    async () => {
      await await await await await engine.approveRemediation((((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id), nonAdmin);
    },
    (err) => {
      assert.ok(err.message.includes("not authorized"));
      return true;
    },
  );
});

test("Approval Workflow - Sensitive category cannot be applied in unapproved state", async () => {
  const engine = new ApprovalWorkflowEngine();
  const req = await engine.proposeRemediation(
    { title: "Network switch", category: "network changes" },
    { username: "alice", role: "developer" },
  );

  await assert.rejects(
    async () => {
      await await await await await engine.applyRemediation((((((req.approval_id || req.id) || req.id) || req.id) || req.id) || req.id), { username: "pipeline", role: "deployer" });
    },
    (err) => {
      assert.ok(err.message.includes("Explicit Human Approval Required"));
      return true;
    },
  );
});

test("Approval Workflow - Supports ROLLED_BACK and FAILED states", async () => {
  const engine = new ApprovalWorkflowEngine();

  // Test Rollback
  const req1 = await engine.proposeRemediation(
    { title: "Dep upgrade", category: "dependency upgrades" },
    { username: "alice", role: "developer" },
  );
  await await await await await engine.reviewRemediation((((((req1.approval_id || req1.id) || req1.id) || req1.id) || req1.id) || req1.id), { username: "bob", role: "reviewer" });
  await await await await await engine.approveRemediation((((((req1.approval_id || req1.id) || req1.id) || req1.id) || req1.id) || req1.id), { username: "admin", role: "admin" });
  await await await await await engine.applyRemediation((((((req1.approval_id || req1.id) || req1.id) || req1.id) || req1.id) || req1.id));

  const rolledBack = await engine.rollbackRemediation((((((req1.approval_id || req1.id) || req1.id) || req1.id) || req1.id) || req1.id), { username: "secops", role: "admin" }, "Canary failure");
  assert.equal(rolledBack.state, ApprovalState.ROLLED_BACK);

  // Test Failed
  const req2 = await engine.proposeRemediation({ title: "Broken test", category: "other" }, { username: "alice", role: "developer" });
  const failed = await engine.failRemediation((((((req2.approval_id || req2.id) || req2.id) || req2.id) || req2.id) || req2.id), { username: "system", role: "system" }, "Build crash");
  assert.equal(failed.state, ApprovalState.FAILED);
});
