const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");

// Configure remediation workspace to cwd so path validation succeeds on Windows
process.env.ECDAT_REMEDIATION_WORKSPACE = process.cwd();

const app = require("../../src/app");
const { defaultTokenService } = require("../../src/identity/token_service");

// Distinct non-admin and admin identities
const alice = { sub: "alice", roles: ["developer"] };
const bob = { sub: "bob", roles: ["reviewer"] };
const carol = { sub: "carol", roles: ["deployer"] };
const charlieAdmin = { sub: "charlie_admin", roles: ["admin"] };

/**
 * Helper to issue a real short-lived JWT for a specific user identity.
 */
function createAuthHeaders(user, extraHeaders = {}) {
  const { accessToken } = defaultTokenService.issueTokenPair({
    userId: user.sub,
    roles: user.roles,
  });
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  };
}

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("Approval API - Full lifecycle with real distinct roles and separation of duties", async () => {
  await withServer(async (baseUrl) => {
    // 1. Propose: Alice (developer) proposes — must succeed
    const propRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/propose`, {
      method: "POST",
      headers: createAuthHeaders(alice),
      body: JSON.stringify({
        title: "Migrate Payment Gateway to ML-KEM-768",
        category: "algorithm migration",
        environment: "production",
      }),
    });

    assert.equal(propRes.status, 201);
    const propData = await propRes.json();
    assert.equal(propData.state, "PROPOSED");
    assert.equal(propData.category, "ALGORITHM_MIGRATION");
    assert.equal(propData.requires_explicit_approval, true);
    assert.equal(propData.proposer.username, "alice");
    assert.equal(propData.proposer.role, "developer");
    const approvalId = propData.approval_id;

    // 2. Review: Bob (reviewer) reviews — must succeed
    const revRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/review`, {
      method: "POST",
      headers: createAuthHeaders(bob),
      body: JSON.stringify({ comments: "Cryptographic parameters verified." }),
    });
    assert.equal(revRes.status, 200);
    const revData = await revRes.json();
    assert.equal(revData.state, "REVIEWED");
    assert.equal(revData.approval.reviewer.username, "bob");
    assert.equal(revData.approval.reviewer.role, "reviewer");

    // 3. Self-approval violation: Alice attempts to approve her own proposal — must be REJECTED (Four-Eyes violation)
    const selfAppRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(alice, { "X-Actor-Role": "admin" }), // Attempt spoofing admin role
      body: JSON.stringify({ comments: "Self approval attempt" }),
    });
    assert.equal(selfAppRes.status, 403, "Self-approval must be rejected with 403");
    const selfAppData = await selfAppRes.json();
    assert.ok(
      selfAppData.message.includes("Four-Eyes") ||
        selfAppData.message.includes("cannot approve") ||
        selfAppData.message.includes("Unauthorized") ||
        selfAppData.message.includes("not authorized"),
      "Error must indicate Four-Eyes self-approval violation",
    );

    // 4. Role-gating check: Bob (reviewer) attempts to approve with X-Actor-Role: admin — must be REJECTED
    // Header must NOT elevate Bob; recorded role check must evaluate to his real token role ("reviewer")
    const bobAppRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(bob, { "X-Actor-Role": "admin" }), // Attempt role spoofing
      body: JSON.stringify({ comments: "Reviewer attempting approval" }),
    });
    assert.equal(bobAppRes.status, 403, "Non-admin role must be rejected for approval even with X-Actor-Role: admin");
    const bobAppData = await bobAppRes.json();
    assert.ok(bobAppData.message.includes("Unauthorized") || bobAppData.message.includes("not authorized"));

    // 5. Authorized approval: Charlie (admin) approves — must succeed
    const appRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(charlieAdmin),
      body: JSON.stringify({ comments: "Approved for execution by platform admin." }),
    });
    assert.equal(appRes.status, 200);
    const appData = await appRes.json();
    assert.equal(appData.state, "APPROVED");
    assert.equal(appData.approval.approver.username, "charlie_admin");
    assert.equal(appData.approval.approver.role, "admin");

    // 6. Apply: Carol (deployer) applies with X-Actor-Role: admin
    // Must NOT elevate Carol — recorded actor role in resulting record must be "deployer", not "admin"
    const applyRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/apply`, {
      method: "POST",
      headers: createAuthHeaders(carol, { "X-Actor-Role": "admin" }), // Attempt role spoofing
    });
    assert.equal(applyRes.status, 200);
    const applyData = await applyRes.json();
    assert.equal(applyData.state, "APPLIED");
    assert.equal(applyData.approval.deployer.username, "carol");
    assert.equal(
      applyData.approval.deployer.role,
      "deployer",
      "Recorded deployer role must be real token role ('deployer'), NOT spoofed 'admin'",
    );

    // 7. Verify: Authorized verifier / admin verifies
    const verRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: createAuthHeaders(charlieAdmin),
      body: JSON.stringify({
        verification_results: { tests_passed: true, finding_resolved: true },
      }),
    });
    assert.equal(verRes.status, 200);
    const verData = await verRes.json();
    assert.equal(verData.state, "VERIFIED");

    // 8. Audit trail verification: inspect resulting record
    const getRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}`, {
      headers: createAuthHeaders(bob),
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.approval.state, "VERIFIED");
    assert.equal(getData.chain_verification.valid, true);
    assert.equal(getData.chain_verification.total_events, 5);

    // Ensure Carol's event recorded her real role 'deployer' and not 'admin'
    const applyEvent = getData.approval.audit_history.find((e) => e.to_state === "APPLIED");
    assert.ok(applyEvent, "Audit history must contain APPLIED transition");
    assert.equal(applyEvent.actor, "carol");
    assert.equal(applyEvent.role, "deployer", "Audit history must record 'deployer', not spoofed 'admin'");
  });
});

test("Approval API - Adversarial: Developer role token rejected on live apply-patch", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      source_code: "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n",
      file_path: "service.js",
      target_algorithm: "SHA-256",
      category: "algorithm migration",
      environment: "production",
      dry_run: false, // Live apply
    };

    // Alice (developer) directly calls /apply-patch without approval
    const res = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
      method: "POST",
      headers: createAuthHeaders(alice, { "X-Actor-Role": "admin" }), // Attempt role spoofing
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 403, "Direct live apply-patch must be rejected with 403");
    const data = await res.json();
    assert.ok(
      data.error.includes("Approval Required") || (data.message && data.message.includes("approved change request")),
      "Must reject unapproved sensitive live patch application",
    );
  });
});
