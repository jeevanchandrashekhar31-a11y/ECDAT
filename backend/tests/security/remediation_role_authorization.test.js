const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.ECDAT_REMEDIATION_WORKSPACE = process.cwd();

const app = require("../../src/app");
const { defaultTokenService } = require("../../src/identity/token_service");
const { getDefaultApprovalEngine } = require("../../src/remediation");

// Identities
const normalViewer = { sub: "normal_viewer", roles: ["reviewer"] };
const normalDev = { sub: "normal_dev", roles: ["developer"] };
const realAdmin = { sub: "real_admin", roles: ["admin"] };
const platformAdmin = { sub: "real_platform_admin", roles: ["platform administrator"] };

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

test("P0 Security Fix - Client-controlled role authorization rejected on remediation endpoints", async () => {
  await withServer(async (baseUrl) => {
    const engine = getDefaultApprovalEngine();

    // Setup: Propose an item to test against
    const propRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/propose`, {
      method: "POST",
      headers: createAuthHeaders(normalDev),
      body: JSON.stringify({
        title: "Test Remediation For Role Gating",
        category: "algorithm migration",
        environment: "production",
      }),
    });
    assert.equal(propRes.status, 201);
    const propData = await propRes.json();
    const approvalId = propData.approval_id || propData.id;

    // Review it so it can be approved
    const revRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/review`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify({ comments: "Peer review" }),
    });
    assert.equal(revRes.status, 200);

    // =========================================================================
    // 1. APPROVE ENDPOINT
    // =========================================================================
    // Normal user attempts approval -> 403
    const appNorm = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify({ comments: "Normal user approval" }),
    });
    assert.equal(appNorm.status, 403, "Normal user must receive 403 on approve");

    // Normal user attempts approval with X-Actor-Role: admin -> MUST STILL BE 403
    const appSpoof = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
      body: JSON.stringify({ comments: "Spoofed admin approval", role: "admin" }),
    });
    assert.equal(appSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on approve");

    // =========================================================================
    // 2. LIVE APPLY-PATCH ENDPOINT
    // =========================================================================
    const patchPayload = {
      source_code: "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n",
      file_path: "service.js",
      target_algorithm: "SHA-256",
      category: "algorithm migration",
      environment: "production",
      dry_run: false, // Live apply
    };

    // Normal user attempts live apply-patch -> 403
    const patchNorm = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify(patchPayload),
    });
    assert.equal(patchNorm.status, 403, "Normal user must receive 403 on live apply-patch");

    // Normal user attempts live apply-patch with X-Actor-Role: admin -> MUST STILL BE 403
    const patchSpoof = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
      body: JSON.stringify({ ...patchPayload, role: "admin" }),
    });
    assert.equal(patchSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on live apply-patch");

    // =========================================================================
    // 3. VERIFY ENDPOINT
    // =========================================================================
    // Normal user attempts verify -> 403
    const verNorm = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify({ verification_results: { tests_passed: true, finding_resolved: true } }),
    });
    assert.equal(verNorm.status, 403, "Normal user must receive 403 on verify");

    // Normal user attempts verify with X-Actor-Role: admin -> MUST STILL BE 403
    const verSpoof = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
      body: JSON.stringify({ verification_results: { tests_passed: true, finding_resolved: true }, role: "admin" }),
    });
    assert.equal(verSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on verify");

    // =========================================================================
    // 4. ROLLBACK ENDPOINT
    // =========================================================================
    // Normal user attempts rollback -> 403
    const rollNorm = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/rollback`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify({ reason: "Unauthorized rollback attempt" }),
    });
    assert.equal(rollNorm.status, 403, "Normal user must receive 403 on rollback");

    // Normal user attempts rollback with X-Actor-Role: admin -> MUST STILL BE 403
    const rollSpoof = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/rollback`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
      body: JSON.stringify({ reason: "Unauthorized rollback attempt", role: "admin" }),
    });
    assert.equal(rollSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on rollback");

    // =========================================================================
    // 5. REJECT ENDPOINT
    // =========================================================================
    // Normal user attempts reject -> 403
    const rejNorm = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer),
      body: JSON.stringify({ reason: "Unauthorized reject attempt" }),
    });
    assert.equal(rejNorm.status, 403, "Normal user must receive 403 on reject");

    // Normal user attempts reject with X-Actor-Role: admin -> MUST STILL BE 403
    const rejSpoof = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
      body: JSON.stringify({ reason: "Unauthorized reject attempt", role: "admin" }),
    });
    assert.equal(rejSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on reject");

    // =========================================================================
    // 6. DELETE ENDPOINT
    // =========================================================================
    // Normal user attempts delete -> 403
    const delNorm = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}`, {
      method: "DELETE",
      headers: createAuthHeaders(normalViewer),
    });
    assert.equal(delNorm.status, 403, "Normal user must receive 403 on delete");

    // Normal user attempts delete with X-Actor-Role: admin -> MUST STILL BE 403
    const delSpoof = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}`, {
      method: "DELETE",
      headers: createAuthHeaders(normalViewer, { "X-Actor-Role": "admin" }),
    });
    assert.equal(delSpoof.status, 403, "X-Actor-Role: admin must NOT bypass 403 on delete");

    // =========================================================================
    // 7. AUTHENTICATE AS REAL ADMIN -> LEGITIMATE OPERATIONS WORK
    // =========================================================================
    // Real admin approves
    const adminApp = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: createAuthHeaders(realAdmin),
      body: JSON.stringify({ comments: "Legitimate admin approval" }),
    });
    assert.equal(adminApp.status, 200, "Real admin approval must succeed with 200");
    const appSuccessData = await adminApp.json();
    assert.equal(appSuccessData.state, "APPROVED");

    // Real admin applies
    const adminApply = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/apply`, {
      method: "POST",
      headers: createAuthHeaders(realAdmin),
    });
    assert.equal(adminApply.status, 200, "Real admin apply must succeed with 200");

    // Real admin verifies
    const adminVer = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: createAuthHeaders(realAdmin),
      body: JSON.stringify({ verification_results: { tests_passed: true, finding_resolved: true } }),
    });
    assert.equal(adminVer.status, 200, "Real admin verify must succeed with 200");

    // Create a temporary proposal for testing delete as real admin
    const prop2Res = await fetch(`${baseUrl}/api/v1/remediation/approvals/propose`, {
      method: "POST",
      headers: createAuthHeaders(realAdmin),
      body: JSON.stringify({
        title: "Proposal for Deletion Test",
        category: "algorithm migration",
        environment: "production",
      }),
    });
    assert.equal(prop2Res.status, 201);
    const prop2Data = await prop2Res.json();

    // Real admin deletes the proposal
    const adminDel = await fetch(`${baseUrl}/api/v1/remediation/approvals/${prop2Data.approval_id}`, {
      method: "DELETE",
      headers: createAuthHeaders(realAdmin),
    });
    assert.equal(adminDel.status, 200, "Real admin delete must succeed with 200");
  });
});
