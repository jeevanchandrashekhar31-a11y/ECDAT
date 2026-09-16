const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  DEFAULT_POLICY_PATH,
  PolicyEngine,
} = require("../../src/policy/policy_engine");

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

function getValidPolicy() {
  const engine = new PolicyEngine();
  return JSON.parse(JSON.stringify(engine.loadPolicy(DEFAULT_POLICY_PATH)));
}

test("Policy API - POST /api/v1/policy/evaluate evaluates assets against active policy", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      assets: [
        { asset_id: "insecure-hash", algorithm: "MD5", type: "digest" },
        { asset_id: "secure-cipher", algorithm: "AES-256-GCM", type: "cipher" },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/policy/evaluate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.verdict, "BLOCK");
    assert.equal(data.metrics.counts_by_verdict.BLOCK, 1);
    assert.equal(data.metrics.counts_by_verdict.ALLOW, 1);
    assert.ok(data.audit_digest);
  });
});

test("Policy API - POST /api/v1/policy/validate validates policy document against JSON schema", async () => {
  await withServer(async (baseUrl) => {
    const validPolicy = getValidPolicy();
    const resValid = await fetch(`${baseUrl}/api/v1/policy/validate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ policy: validPolicy }),
    });
    assert.equal(resValid.status, 200);
    const dataValid = await resValid.json();
    assert.equal(dataValid.valid, true);

    // Invalid policy
    const resInvalid = await fetch(`${baseUrl}/api/v1/policy/validate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ policy: { id: "bad" } }),
    });
    assert.equal(resInvalid.status, 400);
    const dataInvalid = await resInvalid.json();
    assert.equal(dataInvalid.valid, false);
  });
});

test("Policy API - GET /api/v1/policy/rules returns active policy metadata and rules list", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/policy/rules`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.rules_count >= 5);
    assert.ok(data.rules.some((r) => r.id === "RULE-ALG-BROKEN-001"));
  });
});

test("Policy API - Governance lifecycle: draft, four-eyes approval, activation, and rollback", async () => {
  await withServer(async (baseUrl) => {
    const policy = getValidPolicy();
    policy.version = "1.5.0";

    // 1. Create Draft
    const draftRes = await fetch(`${baseUrl}/api/v1/policy/draft`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "author_alice",
        "X-Actor-Role": "admin",
      },
      body: JSON.stringify({ policy }),
    });
    assert.equal(draftRes.status, 201);
    const draftData = await draftRes.json();
    assert.equal(draftData.draft.status, "DRAFT");

    // 2. Submit for approval
    const submitRes = await fetch(`${baseUrl}/api/v1/policy/1.5.0/submit`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "author_alice",
        "X-Actor-Role": "admin",
      },
    });
    assert.equal(submitRes.status, 200);

    // 3. Self-approval must be rejected (Four-eyes violation)
    const selfApproveRes = await fetch(
      `${baseUrl}/api/v1/policy/1.5.0/approve`,
      {
        method: "POST",
        headers: {
          ...AUTH_HEADERS,
          "X-Actor-Username": "author_alice",
          "X-Actor-Role": "admin",
        },
      },
    );
    assert.equal(selfApproveRes.status, 403);
    const selfApproveData = await selfApproveRes.json();
    assert.ok(
      selfApproveData.message.includes("Four-Eyes Governance Violation"),
    );

    // 4. Peer approval succeeds
    const peerApproveRes = await fetch(
      `${baseUrl}/api/v1/policy/1.5.0/approve`,
      {
        method: "POST",
        headers: {
          ...AUTH_HEADERS,
          "X-Actor-Username": "approver_bob",
          "X-Actor-Role": "admin",
        },
        body: JSON.stringify({ comments: "Production approved." }),
      },
    );
    assert.equal(peerApproveRes.status, 200);

    // 5. Activation
    const activateRes = await fetch(`${baseUrl}/api/v1/policy/1.5.0/activate`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "approver_bob",
        "X-Actor-Role": "admin",
      },
    });
    assert.equal(activateRes.status, 200);

    // 6. Check Audit Log & Hash Chain Integrity
    const auditRes = await fetch(`${baseUrl}/api/v1/policy/audit-log`);
    assert.equal(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.equal(auditData.integrity_verified, true);
    assert.equal(auditData.integrity_errors.length, 0);
  });
});

test("Policy API - Digital signing and verification of policy artifacts", async () => {
  await withServer(async (baseUrl) => {
    const policy = getValidPolicy();

    // 1. Sign policy
    const signRes = await fetch(`${baseUrl}/api/v1/policy/sign`, {
      method: "POST",
      headers: {
        ...AUTH_HEADERS,
        "X-Actor-Username": "ciso_officer",
        "X-Actor-Role": "admin",
      },
      body: JSON.stringify({ policy }),
    });
    assert.equal(signRes.status, 200);
    const signData = await signRes.json();
    assert.ok(signData.bundle.signature);

    // 2. Verify legitimate bundle
    const verifyRes = await fetch(`${baseUrl}/api/v1/policy/verify-signature`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ bundle: signData.bundle }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.valid, true);

    // 3. Tamper with policy and verify failure
    const tamperedBundle = JSON.parse(JSON.stringify(signData.bundle));
    tamperedBundle.policy.name = "Tampered Unauthorized Name";

    const tamperedRes = await fetch(
      `${baseUrl}/api/v1/policy/verify-signature`,
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ bundle: tamperedBundle }),
      },
    );
    assert.equal(tamperedRes.status, 400);
    const tamperedData = await tamperedRes.json();
    assert.equal(tamperedData.valid, false);
  });
});
