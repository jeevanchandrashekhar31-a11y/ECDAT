const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
if (!config.ECDAT_API_KEY) {
  config.ECDAT_API_KEY = "test-auth-api-key-32-chars-long-entropy!!";
}
const { safeCompare, extractApiKey } = require("../../src/middleware/auth");
const { db } = require("../../src/db/connection");

// Helper to launch an ephemeral test server
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

const sampleCbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  components: [
    {
      type: "cryptographic-asset",
      name: "AES-GCM",
      "bom-ref": "auth:test/sample",
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: { primitive: "block-cipher" },
      },
    },
  ],
};

test("Auth Middleware - Unit tests for safeCompare and extractApiKey", () => {
  // Constant-time comparison
  assert.strictEqual(safeCompare("secret-key-123", "secret-key-123"), true);
  assert.strictEqual(safeCompare("secret-key-123", "secret-key-wrong"), false);
  assert.strictEqual(safeCompare("short", "much-longer-secret-key"), false);
  assert.strictEqual(safeCompare(null, "key"), false);
  assert.strictEqual(safeCompare("key", undefined), false);

  // Extraction from X-API-Key
  assert.strictEqual(
    extractApiKey({ headers: { "x-api-key": "my-api-key" } }),
    "my-api-key",
  );

  // Extraction from Authorization Bearer
  assert.strictEqual(
    extractApiKey({ headers: { authorization: "Bearer token-123" } }),
    "token-123",
  );

  // Extraction from Authorization ApiKey
  assert.strictEqual(
    extractApiKey({ headers: { authorization: "ApiKey custom-key" } }),
    "custom-key",
  );

  // Query-string credentials are intentionally rejected to avoid URL leakage.
  assert.strictEqual(
    extractApiKey({ headers: {}, query: { apiKey: "query-key" } }),
    null,
  );
  assert.strictEqual(
    extractApiKey({ headers: {}, query: { api_key: "query-key-2" } }),
    null,
  );
  assert.strictEqual(extractApiKey({ headers: {}, query: {} }), null);
});

test("Auth API - Unauthorized upload without API key returns 401", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleCbom),
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Unauthorized");
    assert.ok(data.message.includes("Authentication required"));
    // Ensure key is NOT in error message
    assert.strictEqual(data.message.includes(config.ECDAT_API_KEY), false);
  });
});

test("Auth API - Unauthorized upload with invalid API key returns 403", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "totally-bogus-invalid-key-999",
      },
      body: JSON.stringify(sampleCbom),
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.error, "Forbidden");
    assert.strictEqual(data.message, "Invalid API key.");
  });
});

test("Auth API - Authorized upload via X-API-Key header returns 201", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: JSON.stringify(sampleCbom),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.scan_id);
    assert.strictEqual(
      data.message,
      "CBOM successfully ingested and risk-annotated",
    );
  });
});

test("Auth API - Authorized upload via Authorization: Bearer header returns 201", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ECDAT_API_KEY}`,
      },
      body: JSON.stringify(sampleCbom),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.scan_id);
  });
});

test("Auth API - Health check is public, but protected tenant routes require authentication (fail-closed)", async () => {
  await withServer(async (baseUrl) => {
    // 1. Health check is public
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);

    const apiHealthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(apiHealthRes.status, 200);

    // 2. Protected tenant routes without authentication MUST fail with 401
    const dashRes = await fetch(`${baseUrl}/api/v1/dashboard/summary`);
    assert.strictEqual(dashRes.status, 401);

    const assetsRes = await fetch(`${baseUrl}/api/v1/assets`);
    assert.strictEqual(assetsRes.status, 401);

    const findingsRes = await fetch(`${baseUrl}/api/v1/findings`);
    assert.strictEqual(findingsRes.status, 401);

    // 3. Read with valid key should succeed with 200
    const resWithKey = await fetch(`${baseUrl}/api/v1/assets`, {
      headers: { "X-API-Key": config.ECDAT_API_KEY },
    });
    assert.strictEqual(resWithKey.status, 200);

    // 4. Read with invalid key should fail with 403
    const resWithBadKey = await fetch(`${baseUrl}/api/v1/assets`, {
      headers: { "X-API-Key": "wrong-key" },
    });
    assert.strictEqual(resWithBadKey.status, 403);
  });
});

test("Auth API - Network scan & operational scan routes require valid API key and reject invalid credentials with 403", async () => {
  await withServer(async (baseUrl) => {
    // 1. Scan with random/invalid API key MUST be rejected with 403
    const badKeyRes = await fetch(`${baseUrl}/api/v1/scan/network`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "some-random-thing-987654",
      },
      body: JSON.stringify({ target: "api.ecdat.io" }),
    });
    assert.strictEqual(badKeyRes.status, 403);
    const badKeyData = await badKeyRes.json();
    assert.strictEqual(badKeyData.error, "Forbidden");
    assert.strictEqual(badKeyData.message, "Invalid API key.");

    // 2. Scan without API key MUST be rejected with 401
    const noKeyRes = await fetch(`${baseUrl}/api/v1/scan/network`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "api.ecdat.io" }),
    });
    assert.strictEqual(noKeyRes.status, 401);
    const noKeyData = await noKeyRes.json();
    assert.strictEqual(noKeyData.error, "Unauthorized");

    // 3. Static scan with random/invalid API key MUST be rejected with 403
    const badStaticRes = await fetch(`${baseUrl}/api/v1/scan/static`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "some-random-invalid-key",
      },
      body: JSON.stringify({ target: "/some/path" }),
    });
    assert.strictEqual(badStaticRes.status, 403);
  });
});

test.after(async () => {
  await db.destroy();
});

