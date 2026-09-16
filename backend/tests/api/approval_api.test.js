const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.ECDAT_API_KEY,
};

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

test("Approval API - Full lifecycle: propose, review, approve (Four-eyes), apply, and verify", async () => {
  await withServer(async (baseUrl) => {
    // 1. Propose
    const propRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/propose`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "alice_engineer",
        "X-Actor-Role": "developer",
      },
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
    const approvalId = propData.approval_id;

    // 2. Review
    const revRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/review`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "bob_reviewer",
        "X-Actor-Role": "reviewer",
      },
      body: JSON.stringify({ comments: "Cryptographic parameters verified." }),
    });
    assert.equal(revRes.status, 200);
    const revData = await revRes.json();
    assert.equal(revData.state, "REVIEWED");

    // 3. Self-approval must fail (Four-eyes violation)
    const selfAppRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "alice_engineer",
        "X-Actor-Role": "admin",
      },
      body: JSON.stringify({ comments: "Self approval attempt" }),
    });
    assert.equal(selfAppRes.status, 403);

    // 4. Authorized peer approval succeeds
    const appRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "charlie_admin",
        "X-Actor-Role": "admin",
      },
      body: JSON.stringify({ comments: "Approved for execution." }),
    });
    assert.equal(appRes.status, 200);
    const appData = await appRes.json();
    assert.equal(appData.state, "APPROVED");

    // 5. Apply
    const applyRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/apply`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "cd_pipeline",
        "X-Actor-Role": "deployer",
      },
    });
    assert.equal(applyRes.status, 200);
    const applyData = await applyRes.json();
    assert.equal(applyData.state, "APPLIED");

    // 6. Verify
    const verRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "scanner_bot",
        "X-Actor-Role": "verifier",
      },
      body: JSON.stringify({
        verification_results: { tests_passed: true, finding_resolved: true },
      }),
    });
    assert.equal(verRes.status, 200);
    const verData = await verRes.json();
    assert.equal(verData.state, "VERIFIED");

    // 7. Get details and audit chain
    const getRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.approval.state, "VERIFIED");
    assert.equal(getData.chain_verification.valid, true);
    assert.equal(getData.chain_verification.total_events, 5);
  });
});

test("Approval API - Live apply-patch rejects sensitive changes lacking approval", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      source_code: "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n",
      file_path: "service.js",
      target_algorithm: "SHA-256",
      category: "algorithm migration",
      environment: "production",
      dry_run: false, // Live apply
    };

    const res = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes("Approval Required"));
  });
});
