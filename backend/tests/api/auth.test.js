const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
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

test("Auth API - Read routes and /health are accessible without API key by default", async () => {
  await withServer(async (baseUrl) => {
    // 1. Health check is always public
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);

    // 2. Dashboard summary is publicly readable by default
    const dashRes = await fetch(`${baseUrl}/api/v1/dashboard/summary`);
    assert.strictEqual(dashRes.status, 200);

    // 3. Assets query is publicly readable by default
    const assetsRes = await fetch(`${baseUrl}/api/v1/assets`);
    assert.strictEqual(assetsRes.status, 200);
  });
});

test("Auth API - Read routes are protected when REQUIRE_AUTH_FOR_READS is enabled", async () => {
  // Temporarily enable REQUIRE_AUTH_FOR_READS
  config.REQUIRE_AUTH_FOR_READS = true;

  try {
    await withServer(async (baseUrl) => {
      // 1. Read without key should now fail with 401
      const resWithoutKey = await fetch(`${baseUrl}/api/v1/assets`);
      assert.strictEqual(resWithoutKey.status, 401);

      // 2. Read with invalid key should fail with 403
      const resWithBadKey = await fetch(`${baseUrl}/api/v1/assets`, {
        headers: { "X-API-Key": "wrong-key" },
      });
      assert.strictEqual(resWithBadKey.status, 403);

      // 3. Read with valid key should succeed with 200
      const resWithKey = await fetch(`${baseUrl}/api/v1/assets`, {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      });
      assert.strictEqual(resWithKey.status, 200);

      // 4. /health must still remain public
      const healthRes = await fetch(`${baseUrl}/health`);
      assert.strictEqual(healthRes.status, 200);
    });
  } finally {
    // Restore default
    config.REQUIRE_AUTH_FOR_READS = false;
  }
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

