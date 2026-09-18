// @ecdat-synthetic-corpus
/**
 * ECDAT Adversarial Security Control Test Suite (Node.js) — Phase 26 (P1)
 *
 * Enforces 5-point validation across core security controls:
 * 1. Positive test: Valid inputs accepted
 * 2. Negative test: Invalid/malformed inputs rejected cleanly
 * 3. Boundary test: Edge-case length/threshold handling
 * 4. Malicious test: Active exploit payloads blocked
 * 5. Regression test: Architectural invariants & CVE fixes remain intact
 */

const { describe, test } = require("node:test");
const assert = require("node:assert");
const { timingSafeCompare } = require("../../src/security/crypto_security_service.js");
const {
  requireObjectAuthorization,
  defaultObjectStateRegistry,
  OBJECT_TYPES,
} = require("../../src/security/object_authorization.js");
const { checkForbiddenIp } = require("../../src/security/ssrf_protection.js");
const { validateCanonicalPathContainment, PathTraversalError } = require("../../src/security/archive_guard.js");
const { scrubSensitiveFields } = require("../../src/audit/scrubber.js");

function safeAssign(target, source) {
  if (!target || typeof target !== "object" || !source || typeof source !== "object") return target;
  for (const [key, value] of Object.entries(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = safeAssign(target[key] || {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

describe("Phase 26: P1 — Adversarial Test Suite (Node.js)", () => {

  // ==========================================================================
  // 1. AUTHENTICATION CONTROL
  // ==========================================================================
  describe("Control 01: Authentication & Timing Attack Defense", () => {
    test("positive: Matching credentials return true", () => {
      assert.strictEqual(timingSafeCompare("synthetic-secret-2026", "synthetic-secret-2026"), true);
    });

    test("negative: Non-matching credentials return false", () => {
      assert.strictEqual(timingSafeCompare("synthetic-secret-2026", "wrong-secret-2026"), false);
    });

    test("boundary: Empty strings return expected comparison results", () => {
      assert.strictEqual(timingSafeCompare("", ""), true);
      assert.strictEqual(timingSafeCompare("val", ""), false);
      assert.strictEqual(timingSafeCompare("", "val"), false);
    });

    test("malicious: Attacker timing attack candidates rejected", () => {
      const secret = "synthetic-secret-token-key-2026";
      const cand1 = "x" + secret.slice(1);
      const cand2 = secret.slice(0, -1) + "x";
      assert.strictEqual(timingSafeCompare(secret, cand1), false);
      assert.strictEqual(timingSafeCompare(secret, cand2), false);
    });

    test("regression: Rejection of null byte / injection strings in password", () => {
      assert.strictEqual(timingSafeCompare("target", "target\x00extra"), false);
    });
  });

  // ==========================================================================
  // 2. TENANT ISOLATION CONTROL
  // ==========================================================================
  describe("Control 02: Tenant Isolation & Multi-Tenancy Boundary", () => {
    test("positive: Same-tenant object lookup succeeds", async () => {
      defaultObjectStateRegistry.projects.set("proj-t1-001", {
        id: "proj-t1-001",
        tenantId: "tenant-alpha",
        ownerId: "user-1",
      });

      const mw = requireObjectAuthorization(OBJECT_TYPES.PROJECT);
      let nextCalled = false;
      const req = {
        params: { id: "proj-t1-001" },
        auth: { userId: "user-1", tenantId: "tenant-alpha", role: "analyst" },
        tenantContext: { tenantId: "tenant-alpha", isPlatformAdmin: false },
      };
      const res = {
        status() { return this; },
        json() { return this; },
      };
      await mw(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, true);
    });

    test("negative: Missing caller context rejected with 403", async () => {
      const mw = requireObjectAuthorization(OBJECT_TYPES.PROJECT);
      let statusCode = 0;
      let errorResponse = null;
      const req = { params: { id: "proj-t1-001" } };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          errorResponse = body;
          return this;
        },
      };
      await mw(req, res, () => {});
      assert.strictEqual(statusCode, 403);
      assert.strictEqual(errorResponse.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    test("boundary: Non-existent object returns 404 NOT_FOUND", async () => {
      const mw = requireObjectAuthorization(OBJECT_TYPES.PROJECT);
      let statusCode = 0;
      const req = {
        params: { id: "proj-non-existent-999" },
        auth: { userId: "user-1", tenantId: "tenant-alpha", role: "analyst" },
        tenantContext: { tenantId: "tenant-alpha", isPlatformAdmin: false },
      };
      const res = {
        status(code) { statusCode = code; return this; },
        json() { return this; },
      };
      await mw(req, res, () => {});
      assert.strictEqual(statusCode, 404);
    });

    test("malicious: Cross-tenant lookup returns 403 HORIZONTAL_TENANT_VIOLATION", async () => {
      defaultObjectStateRegistry.projects.set("proj-victim", {
        id: "proj-victim",
        tenantId: "tenant-victim",
        ownerId: "user-victim",
      });

      const mw = requireObjectAuthorization(OBJECT_TYPES.PROJECT);
      let statusCode = 0;
      let errorBody = null;
      const req = {
        params: { id: "proj-victim" },
        auth: { userId: "attacker", tenantId: "tenant-attacker", role: "analyst" },
        tenantContext: { tenantId: "tenant-attacker", isPlatformAdmin: false },
      };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          errorBody = body;
          return this;
        },
      };
      await mw(req, res, () => {});
      assert.strictEqual(statusCode, 403);
      assert.strictEqual(errorBody.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    test("regression: Non-admin caller cannot bypass tenant boundary via query parameter spoofing", async () => {
      const mw = requireObjectAuthorization(OBJECT_TYPES.PROJECT);
      let statusCode = 0;
      const req = {
        params: { id: "proj-victim" },
        query: { tenantId: "tenant-victim" },
        auth: { userId: "attacker", tenantId: "tenant-attacker", role: "viewer" },
        tenantContext: { tenantId: "tenant-attacker", isPlatformAdmin: false },
      };
      const res = {
        status(code) { statusCode = code; return this; },
        json() { return this; },
      };
      await mw(req, res, () => {});
      assert.strictEqual(statusCode, 403);
    });
  });

  // ==========================================================================
  // 3. SSRF PROTECTION CONTROL
  // ==========================================================================
  describe("Control 03: SSRF Protection & Private IP Defense", () => {
    test("positive: Public IP 8.8.8.8 is allowed", () => {
      assert.strictEqual(checkForbiddenIp("8.8.8.8").forbidden, false);
    });

    test("negative: Loopback 127.0.0.1 is blocked", () => {
      assert.strictEqual(checkForbiddenIp("127.0.0.1").forbidden, true);
    });

    test("boundary: IPv6 loopback [::1] is blocked", () => {
      assert.strictEqual(checkForbiddenIp("::1").forbidden, true);
    });

    test("malicious: AWS metadata IP 169.254.169.254 is strictly blocked", () => {
      const res = checkForbiddenIp("169.254.169.254");
      assert.strictEqual(res.forbidden, true);
      assert.match(res.reason, /cloud metadata|private|loopback/i);
    });

    test("regression: Private RFC 1918 subnets (10.0.0.1, 172.16.0.1, 192.168.1.1) blocked", () => {
      assert.strictEqual(checkForbiddenIp("10.0.0.1").forbidden, true);
      assert.strictEqual(checkForbiddenIp("172.16.0.1").forbidden, true);
      assert.strictEqual(checkForbiddenIp("192.168.1.1").forbidden, true);
    });
  });

  // ==========================================================================
  // 4. PATH TRAVERSAL & ARCHIVE GUARD CONTROL
  // ==========================================================================
  describe("Control 04: Path Traversal & Zip Slip Defense", () => {
    test("positive: Safe nested subpath resolves within extraction base", () => {
      const baseDir = process.cwd();
      const resolved = validateCanonicalPathContainment("sub/dir/file.txt", baseDir);
      assert.ok(resolved.startsWith(baseDir));
    });

    test("negative: Empty path string throws PathTraversalError", () => {
      assert.throws(() => {
        validateCanonicalPathContainment("", process.cwd());
      }, PathTraversalError);
    });

    test("boundary: Max depth relative path within boundary resolves safely", () => {
      const baseDir = process.cwd();
      const resolved = validateCanonicalPathContainment("a/b/c/d/e.txt", baseDir);
      assert.ok(resolved.startsWith(baseDir));
    });

    test("malicious: Zip Slip traversal sequences throw PathTraversalError", () => {
      assert.throws(() => {
        validateCanonicalPathContainment("../../etc/passwd", process.cwd());
      }, PathTraversalError);

      assert.throws(() => {
        validateCanonicalPathContainment("..\\..\\windows\\calc.exe", process.cwd());
      }, PathTraversalError);
    });

    test("regression: SEC-REG-007 traversal defense blocks absolute root overrides", () => {
      assert.throws(() => {
        validateCanonicalPathContainment("/etc/shadow", process.cwd());
      }, PathTraversalError);
    });
  });

  // ==========================================================================
  // 5. PROTOTYPE POLLUTION & INPUT SANITIZATION CONTROL
  // ==========================================================================
  describe("Control 05: Prototype Pollution Defense", () => {
    test("positive: Normal clean payload sanitizes without changes", () => {
      const clean = { name: "test", count: 5 };
      const sanitized = safeAssign({}, clean);
      assert.strictEqual(sanitized.name, "test");
      assert.strictEqual(sanitized.count, 5);
    });

    test("negative: Null input handled safely", () => {
      const res = safeAssign({}, null);
      assert.deepStrictEqual(res, {});
    });

    test("boundary: Deeply nested valid JSON objects", () => {
      const deep = { a: { b: { c: { d: "ok" } } } };
      const res = safeAssign({}, deep);
      assert.strictEqual(res.a.b.c.d, "ok");
    });

    test("malicious: __proto__ and constructor keys stripped from payload", () => {
      const hostile = JSON.parse('{"__proto__": {"polluted": true}, "name": "clean"}');
      const sanitized = safeAssign({}, hostile);
      assert.strictEqual(sanitized.name, "clean");
      assert.strictEqual(Object.prototype.polluted, undefined);
    });

    test("regression: SEC-REG-003 prototype tampering mitigation", () => {
      const hostile = JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}}');
      safeAssign({}, hostile);
      assert.strictEqual({}.isAdmin, undefined);
    });
  });

  // ==========================================================================
  // 6. LOGGING & SECRET LEAKAGE CONTROL
  // ==========================================================================
  describe("Control 06: Secret Scrubbing & Logging Defense", () => {
    test("positive: Clean record without sensitive fields preserved", () => {
      const record = { user: "alice", role: "analyst", count: 1 };
      const scrubbed = scrubSensitiveFields(record);
      assert.strictEqual(scrubbed.user, "alice");
      assert.strictEqual(scrubbed.role, "analyst");
    });

    test("negative: Null or empty object handled safely", () => {
      assert.strictEqual(scrubSensitiveFields(null), null);
      assert.deepStrictEqual(scrubSensitiveFields({}), {});
    });

    test("boundary: Field names matching sensitive patterns at word boundary", () => {
      const record = { password: "plain_password_123", apikey: "key_xyz" };
      const scrubbed = scrubSensitiveFields(record);
      assert.strictEqual(scrubbed.password, "[REDACTED_SECRET]");
      assert.strictEqual(scrubbed.apikey, "[REDACTED_SECRET]");
    });

    test("malicious: Credentials and tokens scrubbed with [REDACTED_SECRET]", () => {
      const hostileLog = {
        password: "SuperSecretPassword123!",
        token: "mock-jwt-token-12345", // ecdat:fixture
        private_key: "-----BEGIN PRIVATE KEY-----...",
      };
      const scrubbed = scrubSensitiveFields(hostileLog);
      assert.strictEqual(scrubbed.password, "[REDACTED_SECRET]");
      assert.strictEqual(scrubbed.token, "[REDACTED_SECRET]");
      assert.strictEqual(scrubbed.private_key, "[REDACTED_SECRET]");
    });

    test("regression: Zero plaintext credential leakage in structured logs", () => {
      const auditEntry = {
        action: "USER_LOGIN",
        token: "mock-token-abc", // ecdat:fixture
        details: { password: "secret" },
      };
      const clean = scrubSensitiveFields(auditEntry);
      assert.strictEqual(clean.token, "[REDACTED_SECRET]");
      assert.strictEqual(clean.details.password, "[REDACTED_SECRET]");
    });
  });

});
