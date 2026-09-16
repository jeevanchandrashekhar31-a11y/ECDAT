const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLES,
  PERMISSIONS,
  hasPermission,
  getUserPermissions,
  normalizeRole,
  requirePermission,
} = require("../../src/middleware/rbac");

const {
  TenantContext,
  TenantBoundaryViolation,
  TenantScopedDatabase,
  TenantScopedObjectStorage,
  TenantScopedCache,
  TenantScopedJobQueue,
  TenantScopedQueue,
  TenantScopedExportEngine,
  TenantScopedAuditLogger,
} = require("../../src/tenancy");

test("Phase 22.1 — Subsystem 9: Deep RBAC & Multi-Tenancy Authorization Tests", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. RBAC Hierarchy and Granular Permission Matrix
  // ---------------------------------------------------------------------------
  await t.test("1. RBAC Hierarchy and Permission Matrix", () => {
    // 1. Platform Administrator (Wildcard superuser)
    assert.equal(hasPermission(ROLES.PLATFORM_ADMIN, PERMISSIONS.PLATFORM_MANAGE), true);
    assert.equal(hasPermission(ROLES.PLATFORM_ADMIN, PERMISSIONS.POLICY_APPROVE), true);
    assert.equal(hasPermission(ROLES.PLATFORM_ADMIN, PERMISSIONS.SECRETS_ROTATE), true);

    // 2. Security Administrator (Policy, Remediation, Audits, Approvals)
    assert.equal(hasPermission(ROLES.SECURITY_ADMIN, PERMISSIONS.POLICY_APPROVE), true);
    assert.equal(hasPermission(ROLES.SECURITY_ADMIN, PERMISSIONS.REMEDIATION_APPROVE), true);
    assert.equal(hasPermission(ROLES.SECURITY_ADMIN, PERMISSIONS.FINDINGS_SUPPRESS), true);
    assert.equal(hasPermission(ROLES.SECURITY_ADMIN, PERMISSIONS.PLATFORM_MANAGE), false);

    // 3. Developer (Remediation propose/apply, Scans trigger, Assets write)
    assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.SCANS_TRIGGER), true);
    assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.REMEDIATION_PROPOSE), true);
    assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.POLICY_APPROVE), false);
    assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.REMEDIATION_APPROVE), false);

    // 4. Auditor (Compliance read/export, Audit read/verify)
    assert.equal(hasPermission(ROLES.AUDITOR, PERMISSIONS.COMPLIANCE_READ), true);
    assert.equal(hasPermission(ROLES.AUDITOR, PERMISSIONS.AUDIT_VERIFY), true);
    assert.equal(hasPermission(ROLES.AUDITOR, PERMISSIONS.SCANS_TRIGGER), false);
    assert.equal(hasPermission(ROLES.AUDITOR, PERMISSIONS.POLICY_CREATE), false);

    // 5. Viewer (Strict Read-Only)
    assert.equal(hasPermission(ROLES.VIEWER, PERMISSIONS.ASSETS_READ), true);
    assert.equal(hasPermission(ROLES.VIEWER, PERMISSIONS.CBOM_READ), true);
    assert.equal(hasPermission(ROLES.VIEWER, PERMISSIONS.SCANS_TRIGGER), false);
    assert.equal(hasPermission(ROLES.VIEWER, PERMISSIONS.POLICY_CREATE), false);
    assert.equal(hasPermission(ROLES.VIEWER, PERMISSIONS.REMEDIATION_APPLY), false);
  });

  // ---------------------------------------------------------------------------
  // 2. Vertical Privilege Escalation (VPE) Defenses
  // ---------------------------------------------------------------------------
  await t.test("2. Vertical Privilege Escalation (VPE) Defense", () => {
    // Unprivileged roles attempting privileged operations
    const forbiddenAttempts = [
      { role: ROLES.VIEWER, perm: PERMISSIONS.POLICY_APPROVE, action: "Approve Policy" },
      { role: ROLES.VIEWER, perm: PERMISSIONS.REMEDIATION_APPROVE, action: "Approve Remediation" },
      { role: ROLES.VIEWER, perm: PERMISSIONS.SECRETS_ROTATE, action: "Rotate Secrets" },
      { role: ROLES.DEVELOPER, perm: PERMISSIONS.POLICY_APPROVE, action: "Approve Policy" },
      { role: ROLES.DEVELOPER, perm: PERMISSIONS.POLICY_DELETE, action: "Delete Policy" },
      { role: ROLES.DEVELOPER, perm: PERMISSIONS.SECRETS_ROTATE, action: "Rotate Secrets" },
      { role: ROLES.AUDITOR, perm: PERMISSIONS.SCANS_DELETE, action: "Delete Scan" },
      { role: ROLES.AUDITOR, perm: PERMISSIONS.POLICY_CREATE, action: "Create Policy" },
    ];

    for (const attempt of forbiddenAttempts) {
      assert.equal(
        hasPermission(attempt.role, attempt.perm),
        false,
        `VPE Violation: Role '${attempt.role}' must NOT have permission to ${attempt.action}`
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Multi-Tenant Isolation Across All 8 Layers (Tenant A vs Tenant B)
  // ---------------------------------------------------------------------------
  await t.test("3. Multi-Tenant Isolation Across All 8 Layers", async () => {
    const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
    const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

    // Layer 1: Database Isolation & Cross-Tenant IDOR defense
    const db = new TenantScopedDatabase();
    const alphaAsset = await db.insert("assets", { name: "Alpha Kyber Vault", alg: "ML-KEM-768" }, ctxAlpha);
    const betaAsset = await db.insert("assets", { name: "Beta Dilithium", alg: "ML-DSA-65" }, ctxBeta);

    assert.equal(await db.findById("assets", betaAsset.id, ctxAlpha), null); // Alpha cannot IDOR Beta!
    assert.equal((await db.findById("assets", alphaAsset.id, ctxAlpha)).name, "Alpha Kyber Vault");

    // Cross-tenant update must be rejected with TenantBoundaryViolation
    await assert.rejects(
      async () => db.update("assets", betaAsset.id, { name: "Pawned" }, ctxAlpha),
      TenantBoundaryViolation
    );

    // Layer 2: Object Storage Isolation
    const storage = new TenantScopedObjectStorage();
    await storage.putObject("reports/crypto_audit.json", '{"findings": 15}', ctxAlpha);
    const alphaObj = await storage.getObject("reports/crypto_audit.json", ctxAlpha);
    assert.ok(alphaObj.data.includes("15"));
    await assert.rejects(
      async () => storage.getObject("reports/crypto_audit.json", ctxBeta),
      TenantBoundaryViolation
    );

    // Layer 3: Cache Isolation
    const cache = new TenantScopedCache();
    cache.set("rate_limit", 42, 300, ctxAlpha);
    assert.equal(cache.get("rate_limit", ctxAlpha), 42);
    assert.equal(cache.get("rate_limit", ctxBeta), null);

    // Layer 4: Job Queue Isolation
    const jobQueue = new TenantScopedJobQueue();
    jobQueue.enqueue("scan_repo", { repo: "alpha-repo" }, ctxAlpha);
    const bJobs = jobQueue.getJobs(ctxBeta);
    assert.equal(bJobs.length, 0);
    const aJobs = jobQueue.getJobs(ctxAlpha);
    assert.equal(aJobs.length, 1);

    // Layer 5: Queue Isolation
    const queue = new TenantScopedQueue();
    queue.publish("events", { event: "CRYPTO_FOUND" }, ctxAlpha);
    assert.equal(queue.consume("events", ctxBeta), null);
    const consumedA = queue.consume("events", ctxAlpha);
    assert.equal(consumedA.payload.event, "CRYPTO_FOUND");

    // Layer 6: Export Engine Isolation
    const exportDb = new TenantScopedDatabase();
    await exportDb.insert("assets", { name: "Alpha Kyber Vault" }, ctxAlpha);
    const exportEngine = new TenantScopedExportEngine(exportDb, storage);
    const alphaExport = await exportEngine.exportCbom(ctxAlpha);
    assert.equal(alphaExport.tenantId, "tenant-alpha");
    assert.equal(alphaExport.totalAssets, 1);

    const betaExport = await exportEngine.exportCbom(ctxBeta);
    assert.equal(betaExport.tenantId, "tenant-beta");
    assert.equal(betaExport.totalAssets, 0); // Beta sees zero assets in CBOM export!

    // Layer 7: Audit Log Isolation
    const auditLogger = new TenantScopedAuditLogger();
    auditLogger.logEvent({ eventType: "POLICY_APPLIED" }, ctxAlpha);
    assert.equal(auditLogger.getRecentEvents(50, ctxBeta).length, 0);
    assert.equal(auditLogger.getRecentEvents(50, ctxAlpha).length, 1);
  });

  // ---------------------------------------------------------------------------
  // 4. Invariant: Client-Supplied tenantId Must Never Be Trusted as Authorization
  // ---------------------------------------------------------------------------
  await t.test("4. Client-Supplied tenantId Rejection Invariant", () => {
    // Calling middleware with spoofed tenantId
    const req = {
      user: { tenantId: "tenant-alpha", sub: "user-1", roles: ["developer"] },
      headers: { "x-tenant-id": "tenant-victim" },
      id: "req-123",
    };
    let statusCode = 0;
    let jsonBody = null;
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(b) {
        jsonBody = b;
        return this;
      },
    };
    const { tenantIsolationMiddleware } = require("../../src/tenancy");
    tenantIsolationMiddleware(req, res, () => {});

    assert.equal(statusCode, 403);
    assert.equal(jsonBody.code, "TENANT_SPOOFING_VIOLATION");
    assert.equal(jsonBody.authoritativeTenantId, "tenant-alpha");
    assert.equal(jsonBody.suppliedTenantId, "tenant-victim");
  });
});
