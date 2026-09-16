const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  validateSafeUrl,
  validateSafePath,
  inspectForInjection,
  sanitizeResponseData,
} = require("../../src/middleware/api_hardening");
const { createRateLimitMiddleware } = require("../../src/middleware/rate_limit");
const { defaultTokenService } = require("../../src/identity/token_service");

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

test("API Hardening - SSRF Defense rejects internal networks and cloud metadata", async () => {
  await withServer(async (baseUrl) => {
    // 1. Loopback / Localhost
    const loopback = await fetch(`${baseUrl}/api/v1/security/validate-url`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ url: "http://127.0.0.1/admin" }),
    });
    assert.equal(loopback.status, 200);
    const loopbackData = await loopback.json();
    assert.equal(loopbackData.safe, false);
    assert.match(loopbackData.error, /forbidden/i);

    // 2. AWS IMDS / Cloud Metadata (169.254.169.254)
    const imds = await fetch(`${baseUrl}/api/v1/security/validate-url`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
    });
    const imdsData = await imds.json();
    assert.equal(imdsData.safe, false);

    // 3. Private Class A (10.0.0.1)
    const privA = await fetch(`${baseUrl}/api/v1/security/validate-url`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ url: "http://10.10.10.5/api" }),
    });
    const privAData = await privA.json();
    assert.equal(privAData.safe, false);
    assert.match(privAData.error, /private/i);

    // 4. Invalid protocols (file, ftp, gopher)
    const fileProto = await fetch(`${baseUrl}/api/v1/security/validate-url`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    const fileProtoData = await fileProto.json();
    assert.equal(fileProtoData.safe, false);

    // 5. Valid public URL
    const valid = await fetch(`${baseUrl}/api/v1/security/validate-url`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ url: "https://api.github.com/repos" }),
    });
    const validData = await valid.json();
    assert.equal(validData.safe, true);
  });
});

test("API Hardening - Path Traversal Defense confines file access", async () => {
  await withServer(async (baseUrl) => {
    // 1. Directory traversal ..
    const trav = await fetch(`${baseUrl}/api/v1/security/validate-path`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ path: "../../etc/shadow" }),
    });
    const travData = await trav.json();
    assert.equal(travData.safe, false);
    assert.match(travData.error, /Directory traversal/);

    // 2. Null byte
    const nullByte = await fetch(`${baseUrl}/api/v1/security/validate-path`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ path: "report.pdf\0.png" }),
    });
    const nullByteData = await nullByte.json();
    assert.equal(nullByteData.safe, false);
    assert.match(nullByteData.error, /Null byte/);

    // 3. Safe subpath
    const safeSub = await fetch(`${baseUrl}/api/v1/security/validate-path`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ path: "reports/2026/cbom.json" }),
    });
    const safeSubData = await safeSub.json();
    assert.equal(safeSubData.safe, true);
  });
});

test("API Hardening - Injection Defense rejects prototype pollution, NoSQL, and SQL injection", async () => {
  // 1. Unit test inspectForInjection
  const protoViolation = inspectForInjection(JSON.parse('{"__proto__": {"polluted": true}}'));
  assert.ok(protoViolation);
  assert.equal(protoViolation.type, "PROTOTYPE_POLLUTION");

  const nosqlViolation = inspectForInjection({ user: { $where: "sleep(5000)" } });
  assert.ok(nosqlViolation);
  assert.equal(nosqlViolation.type, "NOSQL_INJECTION");

  const sqliViolation = inspectForInjection({ query: "1 UNION SELECT null, password FROM users" });
  assert.ok(sqliViolation);
  assert.equal(sqliViolation.type, "SQL_INJECTION");

  const cmdViolation = inspectForInjection({ target: "127.0.0.1; cat /etc/passwd" });
  assert.ok(cmdViolation);
  assert.equal(cmdViolation.type, "COMMAND_INJECTION");

  // 2. HTTP perimeter middleware test
  await withServer(async (baseUrl) => {
    const protoHttp = await fetch(`${baseUrl}/api/v1/security/inspect-injection`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: '{"__proto__": {"isAdmin": true}}',
    });
    assert.equal(protoHttp.status, 400);
    const protoData = await protoHttp.json();
    assert.equal(protoData.error, "SecurityViolation");
    assert.equal(protoData.code, "PROTOTYPE_POLLUTION");

    const nosqlHttp = await fetch(`${baseUrl}/api/v1/security/inspect-injection`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ user: { $gt: "" } }),
    });
    assert.equal(nosqlHttp.status, 400);
    const nosqlData = await nosqlHttp.json();
    assert.equal(nosqlData.error, "SecurityViolation");
    assert.equal(nosqlData.code, "NOSQL_INJECTION");
  });
});

test("API Hardening - BOPLA / Mass Assignment Defense blocks privileged field mutation", async () => {
  await withServer(async (baseUrl) => {
    const { accessToken: viewerToken } = defaultTokenService.issueTokenPair({
      userId: "viewer-123",
      roles: ["viewer"],
    });

    // Attempting mass assignment to elevate role
    const massAssignRes = await fetch(`${baseUrl}/api/v1/security/protected-user-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${viewerToken}`,
      },
      body: JSON.stringify({
        displayName: "Hacker",
        role: "admin", // Privileged property
      }),
    });

    assert.equal(massAssignRes.status, 403);
    const massAssignData = await massAssignRes.json();
    assert.equal(massAssignData.error, "MassAssignmentViolation");

    // Valid update without protected fields
    const validRes = await fetch(`${baseUrl}/api/v1/security/protected-user-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${viewerToken}`,
      },
      body: JSON.stringify({
        displayName: "Legit User",
      }),
    });

    assert.equal(validRes.status, 200);
  });
});

test("API Hardening - BOLA / IDOR Object-Level Authorization enforces tenant boundaries", async () => {
  await withServer(async (baseUrl) => {
    // User in tenant-beta attempting to read tenant-alpha's asset
    const { accessToken: betaToken } = defaultTokenService.issueTokenPair({
      userId: "user-beta-1",
      roles: ["developer"],
      customClaims: { tenantId: "tenant-beta" },
    });

    const bolaRes = await fetch(`${baseUrl}/api/v1/security/tenants/tenant-alpha/assets/asset-1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${betaToken}`,
      },
    });

    assert.equal(bolaRes.status, 403);
    const bolaData = await bolaRes.json();
    assert.equal(bolaData.code, "TENANT_ACCESS_DENIED");

    // User in tenant-alpha reading own tenant asset
    const { accessToken: alphaToken } = defaultTokenService.issueTokenPair({
      userId: "user-alpha-1",
      roles: ["developer"],
      customClaims: { tenantId: "tenant-alpha" },
    });

    const legitRes = await fetch(`${baseUrl}/api/v1/security/tenants/tenant-alpha/assets/asset-1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${alphaToken}`,
      },
    });

    assert.equal(legitRes.status, 200);
  });
});

test("API Hardening - Strict Schema Validation with Allowlists rejects extra properties", async () => {
  await withServer(async (baseUrl) => {
    // 1. Valid payload
    const validRes = await fetch(`${baseUrl}/api/v1/security/validate-asset`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        name: "AuthService",
        assetType: "service",
        environment: "production",
      }),
    });
    assert.equal(validRes.status, 200);

    // 2. Missing required field
    const missingRes = await fetch(`${baseUrl}/api/v1/security/validate-asset`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        name: "AuthService",
      }),
    });
    assert.equal(missingRes.status, 400);
    const missingData = await missingRes.json();
    assert.equal(missingData.error, "ValidationError");

    // 3. Unallowed extra property (additionalProperties: false enforcement)
    const extraRes = await fetch(`${baseUrl}/api/v1/security/validate-asset`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        name: "AuthService",
        assetType: "service",
        unknownPropertyInject: "malicious",
      }),
    });
    assert.equal(extraRes.status, 400);
    const extraData = await extraRes.json();
    assert.equal(extraData.error, "ValidationError");
    assert.ok(extraData.errors.some((e) => e.rule === "additionalProperties"));
  });
});

test("API Hardening - Excessive Data Exposure Filter automatically redacts secrets", () => {
  const dirty = {
    userId: "u-1",
    password: "secret_password",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----",
    secretBytes: "010203",
    safeData: "hello",
  };

  const clean = sanitizeResponseData(dirty);
  assert.equal(clean.userId, "u-1");
  assert.equal(clean.safeData, "hello");
  assert.equal(clean.password, "[REDACTED_SENSITIVE_DATA]");
  assert.equal(clean.privateKey, "[REDACTED_SENSITIVE_DATA]");
  assert.equal(clean.secretBytes, "[REDACTED_SENSITIVE_DATA]");
});

test("API Hardening - Resource Exhaustion Guard blocks excessive nesting depth", async () => {
  await withServer(async (baseUrl) => {
    // Construct nested object with depth > 20
    let deeplyNested = { val: "bottom" };
    for (let i = 0; i < 25; i++) {
      deeplyNested = { child: deeplyNested };
    }

    const deepRes = await fetch(`${baseUrl}/api/v1/security/inspect-injection`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(deeplyNested),
    });

    assert.equal(deepRes.status, 400);
    const deepData = await deepRes.json();
    assert.equal(deepData.error, "PayloadComplexityError");
  });
});

test("API Hardening - Rate Limiter returns 429 and Retry-After header upon abuse", () => {
  const limiter = createRateLimitMiddleware({
    windowMs: 60_000,
    max: 2,
    keyGenerator: () => "test-client-ip",
  });

  const req = { id: "req-1" };
  const headers = {};
  let statusCode = 200;
  let responseBody = null;

  const res = {
    setHeader: (k, v) => {
      headers[k] = v;
    },
    status: (code) => {
      statusCode = code;
      return {
        json: (b) => {
          responseBody = b;
        },
      };
    },
  };

  let nextCalls = 0;
  const next = () => {
    nextCalls++;
  };

  // Request 1: Allowed
  limiter(req, res, next);
  assert.equal(nextCalls, 1);
  assert.equal(headers["RateLimit-Limit"], "2");
  assert.equal(headers["RateLimit-Remaining"], "1");

  // Request 2: Allowed
  limiter(req, res, next);
  assert.equal(nextCalls, 2);
  assert.equal(headers["RateLimit-Remaining"], "0");

  // Request 3: Blocked (429)
  limiter(req, res, next);
  assert.equal(nextCalls, 2); // Not called
  assert.equal(statusCode, 429);
  assert.ok(headers["Retry-After"]);
  assert.equal(responseBody.error, "TooManyRequests");
});
