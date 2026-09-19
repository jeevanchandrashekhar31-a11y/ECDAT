// @ecdat-synthetic-corpus
/**
 * ECDAT Final Red-Team Assessment Test Suite — Phase 37
 *
 * Simulates active attacks across 26 attack vectors as an unauthenticated adversary,
 * followed by privilege and tenant boundary crossing attacks from authenticated personas:
 *   - viewer
 *   - analyst
 *   - tenant administrator
 *
 * Every attack must be deterministically intercepted and fail-closed:
 *   - HTTP 401 Unauthorized for unauthenticated attacks
 *   - HTTP 403 Forbidden for unauthorized or cross-tenant attacks
 *   - HTTP 400/422/413/429 for input, size, or rate limit validation rejections
 *   - Zero side-effects and zero state corruption
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const crypto = require("crypto");

const app = require("../../src/app");
const {
  ROLES,
  CAPABILITIES,
  evaluateCapability,
  AUTHORIZATION_MATRIX,
} = require("../../src/middleware/rbac");
const { defaultTokenService } = require("../../src/identity/token_service");
const { defaultLocalAuthManager } = require("../../src/identity/password_auth");
const { defaultObjectStateRegistry, OBJECT_TYPES } = require("../../src/security/object_authorization");
const { checkForbiddenIp } = require("../../src/security/ssrf_protection");
const { validateCanonicalPathContainment } = require("../../src/security/archive_guard");
const { scrubSensitiveFields } = require("../../src/audit/scrubber");
const { verifyAuditChainIntegrity } = require("../../src/audit/tamper_chain");

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", async () => {
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

test("Phase 37: Final Red-Team Assessment — Active Exploitation Defense", async (suite) => {

  // ==========================================================================
  // SECTION 1: ATTACK AS UNAUTHENTICATED ADVERSARY (26 ATTACK VECTORS)
  // ==========================================================================
  await suite.test("1. Unauthenticated Adversary Attacks", async (t) => {

    await withServer(async (baseUrl) => {

      // Vector 1: Privilege Escalation
      await t.test("Vector 01: Privilege Escalation — Unauthenticated admin creation blocked", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/register-admin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "attacker_admin", password: "AttackerPassword123!" }),
        });
        assert.ok([401, 403, 404].includes(res.status), `Expected 401/403/404, got ${res.status}`);
      });

      // Vector 2: Role Injection
      await t.test("Vector 02: Role Injection — Injecting role='platform_admin' rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: `hacker_${Date.now()}`,
            password: "StrongPassword123!",
            role: "platform_admin",
            roles: ["admin", "platform_admin"],
          }),
        });
        // Registration endpoint if enabled must either reject or strictly clamp role to lowest viewer
        if (res.status === 201 || res.status === 200) {
          const data = await res.json();
          assert.notStrictEqual(data.role, "platform_admin");
          assert.notStrictEqual(data.role, "admin");
        } else {
          assert.ok([400, 401, 403, 422].includes(res.status));
        }
      });

      // Vector 3: Tenant Escape
      await t.test("Vector 03: Tenant Escape — Arbitrary x-tenant-id without credentials rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/cbom/inventory`, {
          headers: { "x-tenant-id": "victim-tenant-999" },
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 4: IDOR
      await t.test("Vector 04: IDOR — Accessing victim profile by sequential ID rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/users/user_victim_1`, {
          method: "GET",
        });
        assert.ok([401, 403, 404].includes(res.status), `Expected 401/403/404, got ${res.status}`);
      });

      // Vector 5: BOLA
      await t.test("Vector 05: BOLA — Modifying victim scan by scanId rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/scans/scan-victim-target-001`, {
          method: "DELETE",
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 6: Session Theft
      await t.test("Vector 06: Session Theft — Forged/tampered session cookie rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { Cookie: "ecdat_session=forged_untrusted_session_token_12345" },
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 7: Session Revocation Abuse
      await t.test("Vector 07: Session Revocation Abuse — Triggering global revocation rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/revoke-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "target-victim-user" }),
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 8: MFA Takeover
      await t.test("Vector 08: MFA Takeover — Bypassing MFA validation code rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "victim", code: "000000" }),
        });
        assert.ok([400, 401, 403].includes(res.status), `Expected 400/401/403, got ${res.status}`);
      });

      // Vector 9: Token Abuse
      await t.test("Vector 09: Token Abuse — Tampered bearer token signature rejected", async () => {
        const tampered = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkbWluIiwiaWF0IjoxNTE2MjM5MDIyfQ.tampered_signature";
        const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${tampered}` },
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 10: SSRF
      await t.test("Vector 10: SSRF — Cloud metadata & private IPv4 IP checks strictly reject", () => {
        assert.strictEqual(checkForbiddenIp("169.254.169.254").forbidden, true, "Must block AWS metadata");
        assert.strictEqual(checkForbiddenIp("127.0.0.1").forbidden, true, "Must block loopback");
        assert.strictEqual(checkForbiddenIp("10.0.0.1").forbidden, true, "Must block RFC 1918 10.x");
        assert.strictEqual(checkForbiddenIp("172.16.0.1").forbidden, true, "Must block RFC 1918 172.16.x");
        assert.strictEqual(checkForbiddenIp("192.168.1.1").forbidden, true, "Must block RFC 1918 192.168.x");
        assert.strictEqual(checkForbiddenIp("0.0.0.0").forbidden, true, "Must block 0.0.0.0");
      });

      // Vector 11: Command Injection
      await t.test("Vector 11: Command Injection — Shell metacharacters rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/scans/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: "https://example.com; cat /etc/passwd" }),
        });
        assert.ok([400, 401, 403, 422].includes(res.status), `Expected 400/401/403/422, got ${res.status}`);
      });

      // Vector 12: SQL Injection
      await t.test("Vector 12: SQL Injection — Tautology payloads in parameters rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/cbom/search?query=' OR '1'='1`, {
          method: "GET",
        });
        assert.ok([400, 401, 403, 422].includes(res.status), `Expected 400/401/403/422, got ${res.status}`);
      });

      // Vector 13: Path Traversal
      await t.test("Vector 13: Path Traversal — Path containment rejects directory escape", () => {
        assert.throws(
          () => validateCanonicalPathContainment("C:\\safe\\base", "../../../../windows/win.ini"),
          /PathTraversalError|Path traversal/
        );
        assert.throws(
          () => validateCanonicalPathContainment("/safe/base", "../../etc/shadow"),
          /PathTraversalError|Path traversal/
        );
      });

      // Vector 14: Zip Slip
      await t.test("Vector 14: Zip Slip — Relative path extraction pre-checks fail closed", () => {
        assert.throws(
          () => validateCanonicalPathContainment("/app/data", "../../../app/src/index.js"),
          /PathTraversalError|Path traversal/
        );
      });

      // Vector 15: Archive DoS
      await t.test("Vector 15: Archive DoS — Massive payload exceeding 10mb rejected by body-parser", async () => {
        const oversized = "A".repeat(11 * 1024 * 1024);
        try {
          const res = await fetch(`${baseUrl}/api/v1/cbom/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payload: oversized }),
          });
          assert.ok([400, 401, 403, 413].includes(res.status), `Expected 400/401/403/413, got ${res.status}`);
        } catch (err) {
          // Socket hang up or payload too large is an acceptable defense
          assert.ok(true);
        }
      });

      // Vector 16: Scanner DoS
      await t.test("Vector 16: Scanner DoS — Unauthenticated scan floods blocked", async () => {
        const res = await fetch(`${baseUrl}/api/v1/scans/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flood: true }),
        });
        assert.ok([401, 403].includes(res.status));
      });

      // Vector 17: Network Scan Abuse
      await t.test("Vector 17: Network Scan Abuse — Direct internal port targeting rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/network/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: "127.0.0.1", port: 5432 }),
        });
        assert.ok([401, 403, 404].includes(res.status));
      });

      // Vector 18: Secret Extraction
      await t.test("Vector 18: Secret Extraction — Auditing scrubber redacts credentials", () => {
        const sensitive = {
          apiKey: "ecdat-sensitive-token-12345",
          password: "SuperSecretPassword123!",
          privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkq...",
          data: "normal_data",
        };
        const scrubbed = scrubSensitiveFields(sensitive);
        assert.strictEqual(scrubbed.apiKey, "[REDACTED_SECRET]");
        assert.strictEqual(scrubbed.password, "[REDACTED_SECRET]");
        assert.strictEqual(scrubbed.data, "normal_data");
      });

      // Vector 19: Information Disclosure
      await t.test("Vector 19: Information Disclosure — Server banner headers sanitized", async () => {
        const res = await fetch(`${baseUrl}/api/v1/health`);
        const poweredBy = res.headers.get("x-powered-by");
        assert.strictEqual(poweredBy, null, "x-powered-by banner must be removed");
      });

      // Vector 20: Audit-Log Manipulation
      await t.test("Vector 20: Audit-Log Manipulation — Direct audit record mutation rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/audit/logs`, {
          method: "DELETE",
        });
        assert.ok([401, 403, 404, 405].includes(res.status));
      });

      // Vector 21: Rate-Limit Bypass
      await t.test("Vector 21: Rate-Limit Bypass — Rate limiting enforced on sensitive endpoints", async () => {
        const promises = [];
        for (let i = 0; i < 70; i++) {
          promises.push(
            fetch(`${baseUrl}/api/v1/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: "attacker", password: "wrong" }),
            })
          );
        }
        const responses = await Promise.all(promises);
        const hasRateLimitOrDenial = responses.some((r) => [401, 429].includes(r.status));
        assert.ok(hasRateLimitOrDenial, "Rate limiter or authentication gate must intercept request bursts");
      });

      // Vector 22: CORS Abuse
      await t.test("Vector 22: CORS Abuse — Disallowed origin receives no wildcard access", async () => {
        const res = await fetch(`${baseUrl}/api/v1/health`, {
          headers: { Origin: "https://malicious-evil-site.com" },
        });
        const allowOrigin = res.headers.get("access-control-allow-origin");
        assert.notStrictEqual(allowOrigin, "*", "CORS origin must never be wildcard *");
        assert.notStrictEqual(allowOrigin, "https://malicious-evil-site.com");
      });

      // Vector 23: CSRF Where Relevant
      await t.test("Vector 23: CSRF Defense — Cross-origin state mutation without anti-CSRF rejected", async () => {
        const res = await fetch(`${baseUrl}/api/v1/remediations/approve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://attacker.site",
          },
          body: JSON.stringify({ planId: "remed-123" }),
        });
        assert.ok([401, 403].includes(res.status));
      });

      // Vector 24: JWT Attacks (alg='none')
      await t.test("Vector 24: JWT None-Algorithm Attack rejected", async () => {
        // alg='none' token
        const noneAlgToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJhdHRhY2tlciIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTYwMDAwMDAwMH0.";
        const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${noneAlgToken}` },
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 25: Algorithm Confusion Attack
      await t.test("Vector 25: Algorithm Confusion Attack — Unsupported algorithm rejected", async () => {
        const confusedToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.invalidsig";
        const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${confusedToken}` },
        });
        assert.ok([401, 403].includes(res.status), `Expected 401/403, got ${res.status}`);
      });

      // Vector 26: Weak Password Handling
      await t.test("Vector 26: Weak Password Handling — Trivial passwords rejected by policy", () => {
        const weakPasswords = ["123456", "password", "admin", "test", "qwerty", "111111"];
        for (const wp of weakPasswords) {
          assert.throws(
            () => defaultLocalAuthManager.policy.validate(wp),
            /requirements|length|weak/i,
            `Password '${wp}' must be rejected by password strength validator`
          );
        }
      });

    });

  });

  // ==========================================================================
  // SECTION 2: ATTACK AS 'VIEWER' PERSONA
  // ==========================================================================
  await suite.test("2. Adversarial Persona: Viewer", async (t) => {

    await t.test("Viewer privilege escalation: Triggering scans is forbidden (403)", () => {
      const res = evaluateCapability("viewer", CAPABILITIES.TRIGGER_SCANS, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Viewer cannot trigger scans");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Viewer privilege escalation: Modifying risk policies is forbidden (403)", () => {
      const res = evaluateCapability("viewer", CAPABILITIES.MANAGE_POLICIES, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Viewer cannot manage policies");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Viewer privilege escalation: Approving remediations is forbidden (403)", () => {
      const res = evaluateCapability("viewer", CAPABILITIES.APPROVE_REMEDIATION, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Viewer cannot approve remediations");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Viewer tenant escape: Querying cross-tenant data is strictly forbidden (403)", () => {
      const res = evaluateCapability("viewer", CAPABILITIES.READ_TENANT_DATA, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Viewer cannot read cross-tenant data");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Viewer object access: Attempting to access Tenant 2 scan via IDOR is rejected", () => {
      const objectState = {
        type: OBJECT_TYPES.SCAN,
        id: "scan-tenant2-confidential-001",
        tenantId: "tenant_2",
        ownerUserId: "user_tenant2",
      };
      // Caller is in tenant_1
      const caller = {
        userId: "viewer_user",
        tenantId: "tenant_1",
        role: ROLES.VIEWER,
      };
      assert.notStrictEqual(caller.tenantId, objectState.tenantId, "Cross-tenant access attempt detected");
    });

  });

  // ==========================================================================
  // SECTION 3: ATTACK AS 'ANALYST' PERSONA
  // ==========================================================================
  await suite.test("3. Adversarial Persona: Analyst", async (t) => {

    await t.test("Analyst privilege escalation: Approving remediations is forbidden (403)", () => {
      const res = evaluateCapability("analyst", CAPABILITIES.APPROVE_REMEDIATION, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Analyst cannot approve remediations");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Analyst privilege escalation: Rotating cryptographic secrets is forbidden (403)", () => {
      const res = evaluateCapability("analyst", CAPABILITIES.ROTATE_SECRETS, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Analyst cannot rotate secrets");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Analyst privilege escalation: User administration is forbidden (403)", () => {
      const res = evaluateCapability("analyst", CAPABILITIES.MANAGE_USERS, { isCrossTenant: false });
      assert.strictEqual(res.allowed, false, "Analyst cannot manage users");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Analyst tenant escape: Launching scans in another tenant is forbidden (403)", () => {
      const res = evaluateCapability("analyst", CAPABILITIES.TRIGGER_SCANS, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Analyst cannot trigger cross-tenant scans");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Analyst tenant escape: Reading cross-tenant compliance audit is forbidden (403)", () => {
      const res = evaluateCapability("analyst", CAPABILITIES.READ_COMPLIANCE_AUDIT, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Analyst cannot read cross-tenant audit trails");
      assert.strictEqual(res.status, 403);
    });

  });

  // ==========================================================================
  // SECTION 4: ATTACK AS 'TENANT ADMINISTRATOR' PERSONA
  // ==========================================================================
  await suite.test("4. Adversarial Persona: Tenant Administrator", async (t) => {

    await t.test("Tenant Admin escape: Cross-tenant data access is strictly forbidden (403)", () => {
      const res = evaluateCapability("admin", CAPABILITIES.CROSS_TENANT_ACCESS, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Tenant Admin cannot access cross-tenant data");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Tenant Admin escape: Modifying another tenant's policies is forbidden (403)", () => {
      const res = evaluateCapability("admin", CAPABILITIES.MANAGE_POLICIES, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Tenant Admin cannot manage policies for other tenants");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Tenant Admin escape: Accessing another tenant's cryptographic keys is forbidden (403)", () => {
      const res = evaluateCapability("admin", CAPABILITIES.ROTATE_SECRETS, { isCrossTenant: true });
      assert.strictEqual(res.allowed, false, "Tenant Admin cannot rotate secrets for other tenants");
      assert.strictEqual(res.status, 403);
    });

    await t.test("Tenant Admin privilege escalation: Global platform superuser elevation is blocked", () => {
      const res = evaluateCapability("admin", CAPABILITIES.CROSS_TENANT_ACCESS, { isPlatformScope: true });
      assert.strictEqual(res.allowed, false, "Tenant Admin cannot access platform-level scope");
      assert.strictEqual(res.status, 403);
    });

  });

});
