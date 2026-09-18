const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
const { db } = require("../../src/db/connection");
const {
  classifyRoute,
  isScannerRoute,
  ROUTE_CLASSIFICATIONS,
  PUBLIC_AUTH_PATHS,
} = require("../../src/middleware/auth");

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

test("P0 — Authentication Middleware Audit: Route Classification Catalog", async () => {
  // 1. Health classification
  assert.strictEqual(classifyRoute("/health", "GET"), ROUTE_CLASSIFICATIONS.HEALTH);
  assert.strictEqual(classifyRoute("/api/v1/health", "GET"), ROUTE_CLASSIFICATIONS.HEALTH);

  // 2. Scan classification
  const scannerPaths = [
    "/scan/static",
    "/api/v1/scan/static",
    "/scan/network",
    "/api/v1/scan/network",
    "/scan/binary",
    "/api/v1/scan/binary",
    "/cbom/merge",
    "/api/v1/cbom/merge",
    "/cbom/quantum-risk",
    "/api/v1/cbom/quantum-risk",
    "/cbom/merged",
    "/api/v1/cbom/merged",
    "/cbom/risk",
    "/api/v1/cbom/risk",
    "/cbom/pqc-report",
    "/api/v1/cbom/pqc-report",
    "/api/v1/cbom",
    "/api/v1/cboms",
    "/sbom/ingest",
    "/api/v1/sbom/ingest",
    "/api/v1/ci/scan",
  ];
  for (const p of scannerPaths) {
    assert.strictEqual(
      classifyRoute(p, "POST"),
      ROUTE_CLASSIFICATIONS.SCAN,
      `Expected ${p} to be classified as SCAN`,
    );
    assert.ok(isScannerRoute(p), `Expected isScannerRoute(${p}) to be true`);
  }
  assert.strictEqual(classifyRoute("/api/v1/scans", "GET"), ROUTE_CLASSIFICATIONS.SCAN);

  // 3. Auth classification
  assert.strictEqual(classifyRoute("/api/v1/auth/local/login", "POST"), ROUTE_CLASSIFICATIONS.AUTH);
  assert.strictEqual(classifyRoute("/api/v1/auth/mfa/setup", "POST"), ROUTE_CLASSIFICATIONS.AUTH);
  assert.strictEqual(classifyRoute("/api/v1/auth/mfa/enable", "POST"), ROUTE_CLASSIFICATIONS.AUTH);
  assert.strictEqual(classifyRoute("/api/v1/auth/token/revoke", "POST"), ROUTE_CLASSIFICATIONS.AUTH);
  assert.strictEqual(classifyRoute("/api/v1/auth/logout-all", "POST"), ROUTE_CLASSIFICATIONS.AUTH);

  // 4. Internal classification
  assert.strictEqual(classifyRoute("/metrics/record", "POST"), ROUTE_CLASSIFICATIONS.INTERNAL);
  assert.strictEqual(classifyRoute("/api/v1/metrics/record", "POST"), ROUTE_CLASSIFICATIONS.INTERNAL);
  assert.strictEqual(classifyRoute("/api/v1/security/database/prune", "POST"), ROUTE_CLASSIFICATIONS.INTERNAL);

  // 5. Admin classification
  assert.strictEqual(classifyRoute("/api/v1/auth/admin/users", "POST"), ROUTE_CLASSIFICATIONS.ADMIN);
  assert.strictEqual(classifyRoute("/api/v1/auth/secrets/rotate", "POST"), ROUTE_CLASSIFICATIONS.ADMIN);
  assert.strictEqual(classifyRoute("/api/v1/siem/config", "PUT"), ROUTE_CLASSIFICATIONS.ADMIN);

  // 6. Public classification
  assert.strictEqual(classifyRoute("/metrics", "GET"), ROUTE_CLASSIFICATIONS.PUBLIC);
  assert.strictEqual(classifyRoute("/api/v1/metrics", "GET"), ROUTE_CLASSIFICATIONS.PUBLIC);
});

test("P0 — Scanner API: Default Authenticated Invariant (Zero Anonymous Scanner Access)", async () => {
  await withServer(async (baseUrl) => {
    const endpointsToTest = [
      { path: "/scan/static", method: "POST", body: { github_url: "https://github.com/test/repo" } },
      { path: "/api/v1/scan/static", method: "POST", body: { github_url: "https://github.com/test/repo" } },
      { path: "/scan/network", method: "POST", body: { host: "example.com" } },
      { path: "/api/v1/scan/network", method: "POST", body: { host: "example.com" } },
      { path: "/scan/binary", method: "POST", body: { target: "test" } },
      { path: "/api/v1/scan/binary", method: "POST", body: { target: "test" } },
      { path: "/cbom/merge", method: "POST", body: { cboms: [] } },
      { path: "/api/v1/cbom/merge", method: "POST", body: { cboms: [] } },
      { path: "/cbom/quantum-risk", method: "POST", body: {} },
      { path: "/api/v1/cbom/quantum-risk", method: "POST", body: {} },
      { path: "/cbom/merged", method: "GET" },
      { path: "/api/v1/cbom/merged", method: "GET" },
      { path: "/cbom/risk", method: "GET" },
      { path: "/api/v1/cbom/risk", method: "GET" },
      { path: "/cbom/pqc-report", method: "GET" },
      { path: "/api/v1/cbom/pqc-report", method: "GET" },
      { path: "/api/v1/scans", method: "DELETE" },
      { path: "/api/v1/scans/scan_123", method: "DELETE" },
      { path: "/sbom/ingest", method: "POST", body: {} },
      { path: "/sbom/validate", method: "POST", body: {} },
    ];

    for (const ep of endpointsToTest) {
      const res = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: ep.body ? { "Content-Type": "application/json" } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });

      assert.strictEqual(
        res.status,
        401,
        `Expected anonymous request to ${ep.method} ${ep.path} to be rejected with 401 Unauthorized, got ${res.status}`,
      );
      const data = await res.json();
      assert.strictEqual(data.error, "Unauthorized");
    }
  });
});

test("P0 — Anti-Bypass: Path Prefix Manipulation Cannot Bypass Authentication", async () => {
  await withServer(async (baseUrl) => {
    // Attempting to inject "/scan/" or traversal into administrative routes
    const bypassAttempts = [
      { path: "/scan/../api/v1/auth/admin/users", method: "POST", body: {} },
      { path: "/scan/..;/api/v1/auth/admin/users", method: "POST", body: {} },
      { path: "/scan/bypass", method: "GET" },
      { path: "/api/v1/scan/bypass", method: "GET" },
      { path: "/api/v1/scan/../../../api/v1/auth/secrets/rotate", method: "POST", body: {} },
      { path: "/scan/%2e%2e/api/v1/auth/secrets/rotate", method: "POST", body: {} },
    ];

    for (const att of bypassAttempts) {
      const res = await fetch(`${baseUrl}${att.path}`, {
        method: att.method,
        headers: att.body ? { "Content-Type": "application/json" } : undefined,
        body: att.body ? JSON.stringify(att.body) : undefined,
      });

      // Must be rejected with 401 Unauthorized or 404/400 (never 200)
      assert.ok(
        [400, 401, 403, 404].includes(res.status),
        `Expected bypass attempt ${att.method} ${att.path} to fail, got ${res.status}`,
      );
      assert.notStrictEqual(res.status, 200);
    }
  });
});

test("P0 — Health Probes: Strictly Public and Unauthenticated", async () => {
  await withServer(async (baseUrl) => {
    // /health
    const rootHealth = await fetch(`${baseUrl}/health`);
    assert.strictEqual(rootHealth.status, 200);
    const rootData = await rootHealth.json();
    assert.strictEqual(rootData.service, "ecdat-backend");
    assert.strictEqual(rootData.status, "healthy");

    // /api/v1/health
    const v1Health = await fetch(`${baseUrl}/api/v1/health`);
    assert.strictEqual(v1Health.status, 200);
    const v1Data = await v1Health.json();
    assert.strictEqual(v1Data.service, "ecdat-backend");
    assert.strictEqual(v1Data.status, "healthy");
  });
});

test("P0 — Auth Endpoints: Public Entrypoints vs Authenticated Lifecycle Boundaries", async () => {
  await withServer(async (baseUrl) => {
    // 1. CSRF Token is public
    const csrfRes = await fetch(`${baseUrl}/api/v1/auth/csrf-token`);
    assert.strictEqual(csrfRes.status, 200);
    const csrfData = await csrfRes.json();
    assert.ok(csrfData.csrfToken);

    // 2. RBAC Catalog is public
    const rbacRes = await fetch(`${baseUrl}/api/v1/auth/rbac/catalog`);
    assert.strictEqual(rbacRes.status, 200);

    // 3. Authenticated Auth routes reject anonymous callers with 401
    const protectedAuthRoutes = [
      { path: "/api/v1/auth/mfa/setup", method: "POST" },
      { path: "/api/v1/auth/mfa/enable", method: "POST" },
      { path: "/api/v1/auth/mfa/reset", method: "POST" },
      { path: "/api/v1/auth/token/revoke", method: "POST" },
      { path: "/api/v1/auth/logout", method: "POST" },
      { path: "/api/v1/auth/logout-all", method: "POST" },
    ];

    for (const route of protectedAuthRoutes) {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.strictEqual(
        res.status,
        401,
        `Expected anonymous caller on ${route.method} ${route.path} to receive 401 Unauthorized, got ${res.status}`,
      );
    }
  });
});

test("P0 — Internal Endpoints: POST /metrics/record Requires Authentication", async () => {
  await withServer(async (baseUrl) => {
    // Unauthenticated POST /metrics/record must be rejected with 401
    const anonRecord = await fetch(`${baseUrl}/metrics/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "scan_duration", payload: { scannerType: "static", durationMs: 120 } }),
    });
    assert.strictEqual(anonRecord.status, 401);

    const anonV1Record = await fetch(`${baseUrl}/api/v1/metrics/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "scan_duration", payload: { scannerType: "static", durationMs: 120 } }),
    });
    assert.strictEqual(anonV1Record.status, 401);

    // Authenticated POST /metrics/record succeeds
    const authRecord = await fetch(`${baseUrl}/metrics/record`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: JSON.stringify({ type: "scan_duration", payload: { scannerType: "static", durationMs: 120 } }),
    });
    assert.strictEqual(authRecord.status, 200);
    const recData = await authRecord.json();
    assert.strictEqual(recData.success, true);
  });
});

test("P0 — Authenticated Scanner Pipeline Access Works Successfully", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = { "X-API-Key": config.ECDAT_API_KEY };

    // Authenticated access to /cbom/risk when no scan exists returns 404 (not 401)
    const riskRes = await fetch(`${baseUrl}/cbom/risk`, { headers: authHeaders });
    assert.strictEqual(riskRes.status, 404);

    // Authenticated access to /api/v1/scans returns 200
    const scansRes = await fetch(`${baseUrl}/api/v1/scans`, { headers: authHeaders });
    assert.strictEqual(scansRes.status, 200);
    const scansData = await scansRes.json();
    assert.ok(Array.isArray(scansData.scans));
  });
});

test.after(async () => {
  await db.destroy();
});
