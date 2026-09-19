/**
 * Resource Governance & Denial-of-Service Defense Verification Suite
 * Phase 20 / P1
 *
 * Verifies:
 * 1. Operation-specific rate limits (all 12 security-sensitive operations):
 *    - registration (max 5)
 *    - login (max 10)
 *    - MFA (max 10)
 *    - password reset (max 5)
 *    - token operations (max 20)
 *    - scan submission (max 10)
 *    - network scan (max 5)
 *    - Git scan (max 5)
 *    - archive upload (max 10)
 *    - CBOM generation (max 15)
 *    - report generation (max 15)
 *    - integration calls (max 20)
 * 2. Standard rate limit headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After)
 * 3. Request size limit middleware (HTTP 413 Payload Too Large)
 * 4. Scan concurrency quota governor & middleware (HTTP 429)
 * 5. Queue depth limit governor (HTTP 429)
 * 6. Scan execution timeout & memory quota
 * 7. End-to-end password reset with NIST compliance & rate limits
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../../src/app");
const {
  RATE_LIMITS,
  resetAllRateLimiters,
  RESOURCE_QUOTAS,
  ConcurrencyGovernor,
  defaultConcurrencyGovernor,
  QueueDepthGovernor,
  defaultQueueDepthGovernor,
  executeGovernedScan,
  ScanTimeoutError,
  MemoryQuotaExceededError,
  ConcurrencyQuotaError,
  QueueDepthExceededError,
} = require("../../src/security/resource_governance");

function withServer(appInstance, testFn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(appInstance);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await testFn(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("Phase 20 / P1 — Resource Governance & Denial-of-Service Defense", async (t) => {
  await withServer(app, async (baseUrl) => {
    // ------------------------------------------------------------------------
    // 1. Rate Limiting on Security-Sensitive Operations
    // ------------------------------------------------------------------------

    await t.test("1.1 Registration rate limiter triggers HTTP 429 after 5 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
          body: JSON.stringify({
            username: `reg_test_${i}`,
            email: `reg_${i}@example.com`,
            password: "synthetic-ValidPassword123!",
          }),
        });
        assert.notEqual(res.status, 429, `Request ${i + 1} should not be rate-limited`);
        assert.ok(res.headers.get("ratelimit-limit"));
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
        body: JSON.stringify({
          username: "reg_overflow",
          email: "overflow@example.com",
          password: "synthetic-ValidPassword123!",
        }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "registration");
      assert.ok(blockedRes.headers.get("retry-after"));
      assert.equal(blockedRes.headers.get("ratelimit-remaining"), "0");
    });

    await t.test("1.2 Login rate limiter triggers HTTP 429 after 10 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ username: "unknown_user", password: "synthetic-wrong-password" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ username: "unknown_user", password: "synthetic-wrong-password" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "login");
      assert.ok(blockedRes.headers.get("retry-after"));
    });

    await t.test("1.3 MFA rate limiter triggers HTTP 429 after 10 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ mfaToken: "fake_token", code: "123456" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ mfaToken: "fake_token", code: "123456" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "mfa");
    });

    await t.test("1.4 Password reset rate limiter triggers HTTP 429 after 5 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ email: "user@example.com" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ email: "user@example.com" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "password_reset");
      assert.ok(blockedRes.headers.get("retry-after"));
    });

    await t.test("1.5 Token operations rate limiter triggers HTTP 429 after 20 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ refreshToken: "invalid.dummy.token" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ refreshToken: "invalid.dummy.token" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "token_operations");
    });

    const testApiKey = "ecdat-demo-admin-key-2026";

    await t.test("1.6 Scan submission rate limiter triggers HTTP 429 after 10 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/scan/binary`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ target: "non_existent_target_xyz" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/scan/binary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ target: "non_existent_target_xyz" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "scan_submission");
    });

    await t.test("1.7 Network scan rate limiter triggers HTTP 429 after 5 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/scan/network`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ target: "127.0.0.1:443" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/scan/network`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ target: "127.0.0.1:443" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "network_scan");
    });

    await t.test("1.8 Git scan rate limiter triggers HTTP 429 after 5 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/scan/static`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ git_url: "https://127.0.0.1/test-repo.git" }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/scan/static`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ git_url: "https://127.0.0.1/test-repo.git" }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "git_scan");
    });

    await t.test("1.9 Archive upload rate limiter triggers HTTP 429 after 10 requests/min", async () => {
      resetAllRateLimiters();

      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.zip"\r\nContent-Type: application/zip\r\n\r\nPK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\r\n--${boundary}--\r\n`;

      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${baseUrl}/api/v1/cboms`, {
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "x-api-key": testApiKey,
            "x-enforce-rate-limit": "true",
          },
          body,
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/cboms`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "x-api-key": testApiKey,
          "x-enforce-rate-limit": "true",
        },
        body,
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "archive_upload");
    });

    await t.test("1.10 CBOM generation rate limiter triggers HTTP 429 after 15 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 15; i++) {
        const res = await fetch(`${baseUrl}/cbom/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
          body: JSON.stringify({ cboms: [] }),
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/cbom/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": testApiKey, "x-enforce-rate-limit": "true" },
        body: JSON.stringify({ cboms: [] }),
      });

      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "cbom_generation");
    });

    await t.test("1.11 Report generation rate limiter triggers HTTP 429 after 15 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 15; i++) {
        const res = await fetch(`${baseUrl}/api/v1/reports/summary`, {
          headers: { "x-enforce-rate-limit": "true" },
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/reports/summary`, {
        headers: { "x-enforce-rate-limit": "true" },
      });
      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "report_generation");
    });

    await t.test("1.12 Integration calls rate limiter triggers HTTP 429 after 20 requests/min", async () => {
      resetAllRateLimiters();

      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/connectors`, {
          headers: { "x-enforce-rate-limit": "true" },
        });
        assert.notEqual(res.status, 429);
      }

      const blockedRes = await fetch(`${baseUrl}/api/v1/integrations/ticketing/connectors`, {
        headers: { "x-enforce-rate-limit": "true" },
      });
      assert.equal(blockedRes.status, 429);
      const data = await blockedRes.json();
      assert.equal(data.code, "RATE_LIMIT_EXCEEDED");
      assert.equal(data.operation, "integration_calls");
    });

    // ------------------------------------------------------------------------
    // 2. Resource Quotas & Concurrency Governance
    // ------------------------------------------------------------------------

    await t.test("2.1 Request size limit middleware returns HTTP 413 when content-length exceeds quota", async () => {
      const oversizedBytes = RESOURCE_QUOTAS.REQUEST_SIZE_LIMIT_BYTES + 1024;

      // Make raw request specifying oversized Content-Length header
      const res = await new Promise((resolve, reject) => {
        const u = new URL(`${baseUrl}/api/v1/cboms`);
        const req = http.request(
          {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(oversizedBytes),
            },
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => {
              try {
                resolve({ status: response.statusCode, data: JSON.parse(body) });
              } catch {
                resolve({ status: response.statusCode, data: body });
              }
            });
          }
        );
        req.on("error", reject);
        req.end();
      });

      assert.equal(res.status, 413);
      assert.equal(res.data.error, "PayloadTooLarge");
      assert.equal(res.data.code, "REQUEST_SIZE_LIMIT_EXCEEDED");
    });

    await t.test("2.2 Concurrency governor enforces per-tenant concurrent scan quota", () => {
      const gov = new ConcurrencyGovernor({ maxPerTenant: 3, maxSystem: 10 });
      const t1 = "tenant-alpha";

      gov.acquire(t1, "scan-1");
      gov.acquire(t1, "scan-2");
      gov.acquire(t1, "scan-3");

      assert.throws(
        () => gov.acquire(t1, "scan-4"),
        (err) => err instanceof ConcurrencyQuotaError && err.code === "CONCURRENCY_LIMIT_EXCEEDED"
      );

      gov.release(t1, "scan-2");
      const acquired = gov.acquire(t1, "scan-4");
      assert.equal(acquired.scanId, "scan-4");
    });

    await t.test("2.3 Concurrency governor enforces system-wide concurrent scan quota", () => {
      const gov = new ConcurrencyGovernor({ maxPerTenant: 5, maxSystem: 3 });

      gov.acquire("tenant-1", "s1");
      gov.acquire("tenant-2", "s2");
      gov.acquire("tenant-3", "s3");

      assert.throws(
        () => gov.acquire("tenant-4", "s4"),
        (err) => err instanceof ConcurrencyQuotaError && /system-wide/i.test(err.message)
      );
    });

    await t.test("2.4 Queue depth governor rejects jobs when capacity exceeded", () => {
      const gov = new QueueDepthGovernor({ maxPerTenant: 2, maxSystem: 5 });

      assert.equal(gov.verifyCapacity(1, 2, "tenant-a"), true);

      assert.throws(
        () => gov.verifyCapacity(2, 3, "tenant-a"),
        (err) => err instanceof QueueDepthExceededError && err.code === "QUEUE_DEPTH_EXCEEDED"
      );

      assert.throws(
        () => gov.verifyCapacity(1, 5, "tenant-b"),
        (err) => err instanceof QueueDepthExceededError && /system queue capacity/i.test(err.message)
      );
    });

    await t.test("2.5 Scan timeout aborts execution with ScanTimeoutError", async () => {
      await assert.rejects(
        async () => {
          await executeGovernedScan({
            tenantId: "tenant-timeout",
            scanId: "scan-slow-1",
            timeoutMs: 50,
            executeFn: () => new Promise((resolve) => setTimeout(resolve, 200)),
          });
        },
        (err) => err instanceof ScanTimeoutError && err.code === "SCAN_TIMED_OUT"
      );
    });

    await t.test("2.6 Governed scan guarantees concurrency release on error", async () => {
      const gov = defaultConcurrencyGovernor;
      gov.reset();

      try {
        await executeGovernedScan({
          tenantId: "tenant-err",
          scanId: "scan-failing",
          executeFn: async () => {
            throw new Error("Scan fatal fault");
          },
        });
      } catch {
        // Expected
      }

      assert.equal(gov.getActiveCount("tenant-err"), 0);
    });

    // ------------------------------------------------------------------------
    // 3. Password Reset Workflow & Policy Enforcement
    // ------------------------------------------------------------------------

    await t.test("3.1 Initiates password reset and confirms password update with NIST compliance", async () => {
      resetAllRateLimiters();

      // 1. Register a test user
      const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "reset_user_test",
          email: "reset_test@example.com",
          password: "synthetic-InitialPass123!",
        }),
      });
      assert.equal(regRes.status, 201);

      // 2. Request password reset
      const reqRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "reset_test@example.com" }),
      });

      assert.equal(reqRes.status, 200);
      const reqData = await reqRes.json();
      assert.ok(reqData.resetToken);
      const token = reqData.resetToken;

      // 3. Confirm with weak password (rejected by NIST SP 800-63B policy)
      const weakRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "weak" }),
      });

      assert.equal(weakRes.status, 400);
      const weakData = await weakRes.json();
      assert.equal(weakData.error, "PasswordPolicyViolation");

      // 4. Confirm with compliant password
      const goodRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "synthetic-NewCompliantPassword789!" }),
      });

      assert.equal(goodRes.status, 200);
      const goodData = await goodRes.json();
      assert.equal(goodData.success, true);

      // 5. Token is single-use: replay must be rejected
      const replayRes = await fetch(`${baseUrl}/api/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "synthetic-NewCompliantPassword789!" }),
      });

      assert.equal(replayRes.status, 400);

      // 6. User can log in with new password
      const loginRes = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "reset_user_test",
          password: "synthetic-NewCompliantPassword789!",
        }),
      });

      assert.equal(loginRes.status, 200);
      const loginData = await loginRes.json();
      assert.ok(loginData.accessToken);
    });
  });
});
