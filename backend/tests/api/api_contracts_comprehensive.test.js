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

test("Phase 22.1 — Subsystem 7: Comprehensive API Contracts & Security Hardening", async (t) => {
  await t.test("1. Health, Readiness, and Service Discovery Contracts", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.equal(body.status, "healthy");
      assert.equal(body.service, "ecdat-backend");
      assert.ok(typeof body.version === "string");
      assert.ok(typeof body.uptime_seconds === "number");

      // Mandatory audit & tracing headers
      const requestId = res.headers.get("x-request-id");
      assert.ok(requestId && requestId.length > 0);
    });
  });

  await t.test("2. Injection Attack Resilience: SQLi, NoSQLi, Command Injection, Path Traversal", () => {
    // SQL Injection patterns
    assert.ok(inspectForInjection("admin UNION SELECT null, password FROM credentials") !== null);
    assert.ok(inspectForInjection("; DROP TABLE scans; --") !== null);
    assert.ok(inspectForInjection("test OR 1=1") !== null);

    // Command Injection patterns
    assert.ok(inspectForInjection("target.corp; rm -rf /") !== null);
    assert.ok(inspectForInjection("host.internal | cat /etc/passwd") !== null);
    assert.ok(inspectForInjection("`whoami`") !== null);
    assert.ok(inspectForInjection("$(whoami)") !== null);

    // NoSQL Injection patterns
    assert.ok(inspectForInjection({ "$gt": "" }) !== null);
    assert.ok(inspectForInjection({ "$ne": null }) !== null);

    // Path Traversal patterns
    assert.equal(validateSafePath("../../etc/passwd").safe, false);
    assert.equal(validateSafePath("..\\..\\windows\\system32\\cmd.exe").safe, false);
    assert.equal(validateSafePath("/etc/shadow").safe, false);
    assert.equal(validateSafePath("scans/valid_cbom.json").safe, true);

    // Benign inputs must not trigger false positives
    assert.equal(inspectForInjection("AES-256-GCM"), null);
    assert.equal(inspectForInjection("CN=api.ecdat.org, O=Enterprise"), null);
    assert.equal(inspectForInjection("src/crypto/keys.py"), null);
  });

  await t.test("3. Standardized Error Envelopes & Zero Stack Trace Disclosure", async () => {
    await withServer(async (baseUrl) => {
      // 404 Route
      const res404 = await fetch(`${baseUrl}/api/v1/non-existent-route`);
      assert.equal(res404.status, 404);
      const data404 = await res404.json();
      assert.ok(data404.error);
      // Ensure no internal stack trace leaked
      assert.equal(data404.stack, undefined);

      // Malformed JSON Payload (400 Bad Request)
      const resBadJson = await fetch(`${baseUrl}/api/v1/policy/evaluate`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: "{ malformed: json, missing closing",
      });
      assert.ok([400, 422].includes(resBadJson.status));
      const textBad = await resBadJson.text();
      assert.ok(!textBad.includes("node_modules"));
      assert.ok(!textBad.includes("at Object."));
    });
  });

  await t.test("4. Response Sanitization: Strict Zero Secret Exposure", () => {
    const rawSensitiveObject = {
      scan_id: "scan-999",
      findings: [
        {
          algorithm: "RSA",
          private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
          secret: "super_secret_token_12345",
          password: "db_password_never_expose",
          public_key_pem: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhki...\n-----END PUBLIC KEY-----",
        },
      ],
    };

    const sanitized = sanitizeResponseData(rawSensitiveObject);

    assert.equal(sanitized.scan_id, "scan-999");
    assert.equal(sanitized.findings[0].private_key, "[REDACTED_SENSITIVE_DATA]");
    assert.equal(sanitized.findings[0].secret, "[REDACTED_SENSITIVE_DATA]");
    assert.equal(sanitized.findings[0].password, "[REDACTED_SENSITIVE_DATA]");
    // Public non-sensitive metadata preserved
    assert.ok(sanitized.findings[0].public_key_pem.includes("PUBLIC KEY"));
  });

  await t.test("5. Payload Size Limits and Enforced Protections", async () => {
    await withServer(async (baseUrl) => {
      // Send a massive 15MB payload to exceed typical json parser limit
      const massivePayload = JSON.stringify({
        data: "X".repeat(12 * 1024 * 1024),
      });

      const res = await fetch(`${baseUrl}/api/v1/cbom/upload`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: massivePayload,
      });

      // Must reject cleanly with 413 Payload Too Large or 400
      assert.ok([413, 400].includes(res.status));
    });
  });
});
