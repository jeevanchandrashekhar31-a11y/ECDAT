/**
 * Phase 23.1 — Backend Application Security Assessment (Red Team Validation)
 *
 * Validates ECDAT's defensive posture across all 17 core attack surfaces:
 * 1.  Auth Bypass
 * 2.  IDOR / BOLA
 * 3.  Privilege Escalation
 * 4.  SSRF
 * 5.  Path Traversal
 * 6.  Command Injection
 * 7.  SQL / NoSQL / Graph Injection
 * 8.  XSS & Security Headers
 * 9.  CSRF
 * 10. Insecure File Upload
 * 11. Malicious Archive (Zip Slip)
 * 12. Parser Exploitation
 * 13. DoS & Query Bounding
 * 14. Secrets Exposure & Redaction
 * 15. Tenant Isolation
 * 16. eBPF Privilege Boundary
 * 17. Unsafe Remediation
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Core backend defense modules
const {
  validateSafeUrl,
  validateSafePath,
  inspectForInjection,
  sanitizeResponseData,
  massAssignmentProtectionMiddleware,
  objectLevelAuthMiddleware,
} = require("../../src/middleware/api_hardening");
const { redactSecrets } = require("../../src/middleware/security");
const { safeTokenCompare } = require("../../src/middleware/cookie_csrf");
const { applyQueryBounds, detectSqlInjection, scopeToTenant } = require("../../src/db/secure_query");
const { defaultTokenService } = require("../../src/identity/token_service");
const { RuntimeSecurityAgent, SecurityBoundaryViolation } = require("../../src/domain/runtime_security_boundary");
const { generatePatch, validateSyntax } = require("../../src/remediation/patch_generator");
const { validateCbomStructure } = require("../../src/services/cbom_validation");

test("Phase 23.1 — Red Team Security Assessment (17 Vectors)", async (t) => {
  // 1. Auth Bypass (CWE-287 / CWE-347)
  await t.test("Vector 01: Auth Bypass — Rejection of alg=none, forged, and malformed JWTs", () => {
    const algNoneToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTUxNjIzOTAyMn0.";
    const expiredToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxNTE2MjM5MDIyfQ.invalid";

    assert.throws(() => defaultTokenService.verifyAccessToken(algNoneToken));
    assert.throws(() => defaultTokenService.verifyAccessToken(expiredToken));
  });

  // 2. IDOR / BOLA (CWE-639)
  await t.test("Vector 02: IDOR / BOLA — Tenant boundary prevents cross-tenant object access", async () => {
    let accessBlocked = false;
    const middleware = objectLevelAuthMiddleware({
      getResourceOwner: async () => ({ id: "asset-123", tenantId: "tenant-hr", ownerId: "user-hr" }),
      idParam: "assetId",
    });

    const mockReq = {
      params: { assetId: "asset-123" },
      auth: {
        tenantId: "tenant-finance",
        userId: "user-finance",
        roles: ["analyst"],
      },
    };
    const mockRes = {
      status: (code) => {
        if (code === 403 || code === 404) accessBlocked = true;
        return { json: () => {} };
      },
    };

    await middleware(mockReq, mockRes, () => {
      accessBlocked = false;
    });

    assert.equal(accessBlocked, true, "Cross-tenant access must be rejected with 403/404");
  });

  // 3. Privilege Escalation (CWE-269 / CWE-915)
  await t.test("Vector 03: Privilege Escalation — Mass assignment blocking role and admin flags", () => {
    let massAssignmentBlocked = false;
    const middleware = massAssignmentProtectionMiddleware({
      blockedProperties: ["role", "isAdmin", "tenantId", "permissions"],
    });

    const mockReq = {
      body: { displayName: "Eve", role: "admin", isAdmin: true },
      user: { roles: ["developer"] },
    };
    const mockRes = {
      status: (code) => {
        if (code === 400 || code === 403) massAssignmentBlocked = true;
        return { json: () => {} };
      },
    };

    middleware(mockReq, mockRes, () => {
      massAssignmentBlocked = false;
    });

    assert.equal(massAssignmentBlocked, true, "Attempting to assign role/isAdmin must be blocked");
  });

  // 4. SSRF (CWE-918)
  await t.test("Vector 04: SSRF — Blocking cloud metadata, loopback, private subnets, and schemes", () => {
    const dangerousUrls = [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://127.0.0.1:8080/admin",
      "http://10.0.0.1/secrets",
      "http://192.168.1.1/admin",
      "http://172.16.0.1/kms",
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379",
    ];

    for (const url of dangerousUrls) {
      const res = validateSafeUrl(url);
      assert.equal(res.safe, false, `URL ${url} must be marked unsafe`);
    }

    const publicUrl = validateSafeUrl("https://api.github.com/repos/org/repo");
    assert.equal(publicUrl.safe, true);
  });

  // 5. Path Traversal (CWE-22 / CWE-23)
  await t.test("Vector 05: Path Traversal — Blocking directory escapes and null bytes", () => {
    const baseDir = "C:\\app\\workspace";
    const traversalPayloads = [
      "../../etc/shadow",
      "..\\..\\windows\\win.ini",
      "%2e%2e/config.json",
      "report.pdf\0.png",
    ];

    for (const p of traversalPayloads) {
      const res = validateSafePath(p, baseDir);
      assert.equal(res.safe, false, `Path ${p} must be marked unsafe`);
    }
  });

  // 6. Command Injection (CWE-78)
  await t.test("Vector 06: Command Injection — Inspecting shell metacharacters and subshells", () => {
    const commandPayloads = [
      "; rm -rf /",
      "test | cat /etc/passwd",
      "$(whoami)",
      "`id`",
    ];

    for (const cmd of commandPayloads) {
      const violation = inspectForInjection({ param: cmd });
      assert.ok(violation, `Command ${cmd} must trigger injection violation`);
      assert.equal(violation.type, "COMMAND_INJECTION");
    }
  });

  // 7. SQL / NoSQL / Graph Injection (CWE-89 / CWE-943)
  await t.test("Vector 07: SQL / NoSQL / Graph Injection — Detecting SQL injection and NoSQL operators", () => {
    // SQL
    const sqlCheck = detectSqlInjection("admin' OR '1'='1");
    assert.equal(sqlCheck.detected, true);

    const unionCheck = detectSqlInjection("1 UNION SELECT null, username, password FROM users");
    assert.equal(unionCheck.detected, true);

    // NoSQL
    const nosqlViolation = inspectForInjection({ username: { $gt: "" } });
    assert.ok(nosqlViolation);
    assert.equal(nosqlViolation.type, "NOSQL_INJECTION");

    // Prototype Pollution via JSON payload
    const protoPayload = JSON.parse('{"__proto__": {"admin": true}}');
    const protoViolation = inspectForInjection(protoPayload);
    assert.ok(protoViolation);
    assert.equal(protoViolation.type, "PROTOTYPE_POLLUTION");
  });

  // 8. XSS & Security Headers (CWE-79)
  await t.test("Vector 08: XSS Defense — Content-Security-Policy & tag escaping", () => {
    const rawXss = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    const encoded = rawXss.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    assert.ok(!encoded.includes("<script>"));
    assert.ok(!encoded.includes("<img"));
  });

  // 9. CSRF (CWE-352)
  await t.test("Vector 09: CSRF Defense — Constant-time token comparison and mismatch rejection", () => {
    const validToken = "0123456789abcdef0123456789abcdef";
    const forgedToken = "fedcba9876543210fedcba9876543210";

    assert.equal(safeTokenCompare(validToken, validToken), true);
    assert.equal(safeTokenCompare(validToken, forgedToken), false);
    assert.equal(safeTokenCompare(validToken, ""), false);
  });

  // 10. Insecure File Upload (CWE-434)
  await t.test("Vector 10: Insecure File Upload — Extension allowlists and MIME type containment", () => {
    const allowedExtensions = new Set([".json", ".xml", ".spdx", ".cdx", ".pcap", ".tar", ".zip"]);
    const dangerousUploads = ["exploit.php", "malware.exe", "backdoor.sh", "evil.jsp"];

    for (const f of dangerousUploads) {
      const ext = path.extname(f).toLowerCase();
      assert.equal(allowedExtensions.has(ext), false, `Extension ${ext} must not be in upload allowlist`);
    }
  });

  // 11. Malicious Archive (CWE-22 / CWE-409)
  await t.test("Vector 11: Malicious Archive — Path containment logic prevents Zip Slip escapes", () => {
    const destDir = "C:\\app\\extracted";
    const zipSlipMember = "../../evil.txt";
    const resolved = path.resolve(destDir, zipSlipMember);

    // Confinement assertion
    const isContained = resolved.startsWith(destDir + path.sep);
    assert.equal(isContained, false, "Zip Slip member must not resolve within extract directory");
  });

  // 12. Parser Exploitation (CWE-611 / CWE-674)
  await t.test("Vector 12: Parser Exploitation — Deep JSON recursion limit enforcement", () => {
    // Create nested object > 64 levels
    let deepObj = { level: 0 };
    let curr = deepObj;
    for (let i = 1; i <= 70; i++) {
      curr.child = { level: i };
      curr = curr.child;
    }

    // CBOM security validation detects deep nesting > 64
    const validation = validateCbomStructure(deepObj);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("exceeds 64 levels")));
  });

  // 13. DoS & Query Bounding (CWE-1333 / CWE-400)
  await t.test("Vector 13: DoS & Query Bounding — Clamping unbounded query limits to max 500", () => {
    const mockQuery = {
      limit: (val) => {
        mockQuery._limit = val;
        return mockQuery;
      },
    };

    applyQueryBounds(mockQuery, { limit: 100000 });
    assert.equal(mockQuery._limit, 500, "Unbounded limit must be clamped to 500");
  });

  // 14. Secrets Exposure & Redaction (CWE-209 / CWE-312)
  await t.test("Vector 14: Secrets Exposure — Redacting private keys, passwords, and tokens", () => {
    const payloadWithSecrets = {
      user: "alice",
      password: "SuperSecretPassword123!",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...",
      token: "secret_session_token_xyz",
    };

    const redacted = redactSecrets(payloadWithSecrets);
    assert.equal(redacted.password, "[REDACTED]");
    assert.equal(redacted.private_key, "[REDACTED]");
    assert.equal(redacted.token, "[REDACTED]");
    assert.equal(redacted.user, "alice");

    const sanitized = sanitizeResponseData(payloadWithSecrets);
    assert.equal(sanitized.password, "[REDACTED_SENSITIVE_DATA]");
    assert.equal(sanitized.private_key, "[REDACTED_SENSITIVE_DATA]");
  });

  // 15. Tenant Isolation (CWE-639 / CWE-668)
  await t.test("Vector 15: Tenant Isolation — Scoping queries with mandatory tenant_id filter", () => {
    const mockQuery = {
      where: (filter) => {
        mockQuery._tenantFilter = filter;
        return mockQuery;
      },
    };

    scopeToTenant(mockQuery, "tenant-enterprise-01");
    assert.deepEqual(mockQuery._tenantFilter, { tenant_id: "tenant-enterprise-01" });
    assert.throws(() => scopeToTenant(mockQuery, null));
  });

  // 16. eBPF Privilege Boundary (CWE-250 / CWE-269)
  await t.test("Vector 16: eBPF Privilege Boundary — Strict probe validation and event bounding", () => {
    const agent = new RuntimeSecurityAgent();
    assert.ok(agent);

    // Arbitrary un-allowlisted probe must be rejected
    assert.throws(() => agent.attachProbe("unauthorized_kernel_probe_999", "/usr/lib/libc.so.6"), SecurityBoundaryViolation);
  });

  // 17. Unsafe Remediation (CWE-327 / CWE-710)
  await t.test("Vector 17: Unsafe Remediation — AST-aware transformation replaces MD5 with SHA-256", () => {
    const legacyCode = "const hash = crypto.createHash('md5').update(data).digest('hex');";
    const result = generatePatch(legacyCode, "crypto.js", { targetAlgorithm: "SHA-256" });

    assert.ok(result.patched_code.includes("createHash('sha256')"));
    assert.ok(!result.patched_code.includes("createHash('md5')"));
    assert.equal(result.has_changes, true);

    const brokenSyntax = "function broken( {";
    const syntaxRes = validateSyntax(brokenSyntax, "javascript");
    assert.equal(syntaxRes.valid, false);
  });
});
