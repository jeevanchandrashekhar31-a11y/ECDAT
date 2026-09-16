/**
 * Explicit Cross-Tenant Attack & Multi-Tenancy Isolation Test Suite — Phase 15.4
 *
 * Requirements:
 * 1. Enforce tenant isolation across all 8 enterprise layers:
 *    - API
 *    - Database
 *    - Object storage
 *    - Jobs
 *    - Caches
 *    - Queues
 *    - Exports
 *    - Logs
 * 2. Explicit cross-tenant attack tests.
 * 3. Invariant: "A tenant ID supplied by a client must never be trusted as authorization."
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const { defaultTokenService } = require("../../src/identity");
const {
  TenantContext,
  TenantBoundaryViolation,
  TenantPathTraversalError,
  tenantIsolationMiddleware,
  TenantScopedDatabase,
  TenantScopedObjectStorage,
  TenantScopedCache,
  TenantScopedJobQueue,
  TenantScopedQueue,
  TenantScopedExportEngine,
  TenantScopedAuditLogger,
  defaultTenantDb,
  defaultTenantStorage,
  defaultTenantCache,
  defaultTenantJobQueue,
  defaultTenantQueue,
  defaultTenantExportEngine,
  defaultTenantAuditLogger,
} = require("../../src/tenancy");

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

function createToken(userId, roles, tenantId) {
  const tokenPair = defaultTokenService.issueTokenPair({
    userId,
    roles,
    customClaims: { tenantId },
  });
  return tokenPair.accessToken;
}

// ============================================================================
// INVARIANT & LAYER 1: API LAYER — CLIENT TENANT SPOOFING DEFENSE
// ============================================================================

test("Multi-Tenancy 15.4 - Invariant: Client-supplied tenant ID is NEVER trusted as authorization", async () => {
  await withServer(async (baseUrl) => {
    const alphaToken = createToken("attacker-user", ["developer"], "tenant-alpha");

    // Attack 1: Attacker sends X-Tenant-ID header pointing to victim 'tenant-beta'
    const res1 = await fetch(`${baseUrl}/api/v1/tenancy/me`, {
      headers: {
        Authorization: `Bearer ${alphaToken}`,
        "X-Tenant-ID": "tenant-beta",
      },
    });

    assert.equal(res1.status, 403, "API must reject spoofed tenant header with 403 Forbidden");
    const body1 = await res1.json();
    assert.equal(body1.code, "TENANT_SPOOFING_VIOLATION");
    assert.equal(body1.authoritativeTenantId, "tenant-alpha");
    assert.equal(body1.suppliedTenantId, "tenant-beta");

    // Attack 2: Attacker sends query parameter ?tenantId=tenant-gamma
    const res2 = await fetch(`${baseUrl}/api/v1/tenancy/database/records?tenantId=tenant-gamma`, {
      headers: {
        Authorization: `Bearer ${alphaToken}`,
      },
    });
    assert.equal(res2.status, 403, "API must reject spoofed tenant query parameter with 403 Forbidden");

    // Attack 3: Attacker attempts mass-assignment in body targeting tenant-omega
    const res3 = await fetch(`${baseUrl}/api/v1/tenancy/database/records`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collection: "assets",
        tenantId: "tenant-omega", // Tamper attempt
        data: { name: "PQC Key" },
      }),
    });
    assert.equal(res3.status, 403, "API must reject body tenant tampering with 403 Forbidden");
  });
});

test("Multi-Tenancy 15.4 - Platform Admin cross-tenant governance exception", async () => {
  await withServer(async (baseUrl) => {
    const adminToken = createToken("root-admin", ["platform administrator"], "system-admin-tenant");

    // Platform administrator CAN specify target tenant to query / inspect
    const res = await fetch(`${baseUrl}/api/v1/tenancy/me`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "X-Tenant-ID": "tenant-target",
      },
    });

    assert.equal(res.status, 200, "Platform admin is permitted cross-tenant inspection");
    const body = await res.json();
    assert.equal(body.isPlatformAdmin, true);
  });
});

// ============================================================================
// LAYER 2: DATABASE LAYER — ROW-LEVEL ISOLATION & IDOR ATTACK DEFENSE
// ============================================================================

test("Multi-Tenancy 15.4 - Database Layer: Prevents Cross-Tenant IDOR and Data Leakage", async () => {
  const db = new TenantScopedDatabase();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha", userId: "alice" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta", userId: "bob" });

  // 1. Insert records for both tenants
  const alphaAsset = await db.insert("assets", { name: "Alpha Kyber Vault", alg: "ML-KEM-768" }, ctxAlpha);
  const betaAsset = await db.insert("assets", { name: "Beta Secret Dilithium", alg: "ML-DSA-65" }, ctxBeta);

  assert.equal(alphaAsset.tenant_id, "tenant-alpha");
  assert.equal(betaAsset.tenant_id, "tenant-beta");

  // 2. Alpha querying records cannot see Beta's records
  const alphaRecords = await db.find("assets", {}, ctxAlpha);
  assert.equal(alphaRecords.length, 1);
  assert.equal(alphaRecords[0].name, "Alpha Kyber Vault");
  assert.equal(alphaRecords.some((r) => r.tenant_id === "tenant-beta"), false);

  // 3. Beta querying records cannot see Alpha's records
  const betaRecords = await db.find("assets", {}, ctxBeta);
  assert.equal(betaRecords.length, 1);
  assert.equal(betaRecords[0].name, "Beta Secret Dilithium");

  // 4. Cross-Tenant IDOR: Alpha attempts to find Beta asset directly by ID
  const directAccess = await db.findById("assets", betaAsset.id, ctxAlpha);
  assert.equal(directAccess, null, "Direct IDOR lookup of other tenant's record must return null");

  // 5. Cross-Tenant Update IDOR: Alpha attempts to update Beta's record
  await assert.rejects(
    async () => {
      await db.update("assets", betaAsset.id, { name: "Pawned by Alpha" }, ctxAlpha);
    },
    (err) => err instanceof TenantBoundaryViolation,
    "Updating record in different tenant must throw TenantBoundaryViolation"
  );

  // 6. Cross-Tenant Delete IDOR: Alpha attempts to delete Beta's record
  await assert.rejects(
    async () => {
      await db.delete("assets", betaAsset.id, ctxAlpha);
    },
    (err) => err instanceof TenantBoundaryViolation,
    "Deleting record in different tenant must throw TenantBoundaryViolation"
  );

  // Verify Beta's record was untouched
  const betaCheck = await db.findById("assets", betaAsset.id, ctxBeta);
  assert.equal(betaCheck.name, "Beta Secret Dilithium");
});

// ============================================================================
// LAYER 3: OBJECT STORAGE LAYER — DIRECTORY TRAVERSAL & ESCAPE DEFENSE
// ============================================================================

test("Multi-Tenancy 15.4 - Object Storage: Path Traversal and Tenant Escape Defenses", async () => {
  const storage = new TenantScopedObjectStorage();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

  // Upload valid file for Alpha
  await storage.putObject("certs/root.pem", "-----BEGIN CERTIFICATE-----", ctxAlpha);

  // Attack 1: Directory Traversal attack using ../ to escape sandbox
  await assert.rejects(
    async () => {
      await storage.putObject("../tenant-beta/certs/hacked.pem", "EVIL DATA", ctxAlpha);
    },
    (err) => err instanceof TenantPathTraversalError,
    "Storage must reject ../ path traversal attack"
  );

  // Attack 2: Null-byte injection attack
  await assert.rejects(
    async () => {
      await storage.putObject("certs/root.pem\0.jpg", "EVIL DATA", ctxAlpha);
    },
    (err) => err instanceof TenantPathTraversalError,
    "Storage must reject null-byte injection"
  );

  // Attack 3: Leading slash escape attack
  await assert.rejects(
    async () => {
      await storage.putObject("/etc/passwd", "EVIL DATA", ctxAlpha);
    },
    (err) => err instanceof TenantPathTraversalError,
    "Storage must reject leading slash absolute path attack"
  );

  // Read isolation: Beta cannot read Alpha's cert
  await assert.rejects(
    async () => {
      await storage.getObject("certs/root.pem", ctxBeta);
    },
    (err) => err instanceof TenantBoundaryViolation,
    "Beta cannot read Alpha's object storage item"
  );

  // Alpha lists objects: only sees Alpha objects
  const listAlpha = await storage.listObjects("certs", ctxAlpha);
  assert.equal(listAlpha.length, 1);
  assert.equal(listAlpha[0].key, "certs/root.pem");

  const listBeta = await storage.listObjects("certs", ctxBeta);
  assert.equal(listBeta.length, 0);
});

// ============================================================================
// LAYER 4: BACKGROUND JOBS LAYER — WORKER EXECUTION CONTEXT CONFINEMENT
// ============================================================================

test("Multi-Tenancy 15.4 - Background Jobs: Worker context is locked to job tenantId", async () => {
  const jobQueue = new TenantScopedJobQueue();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha", userId: "alice" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta", userId: "bob" });

  const jobAlpha = jobQueue.enqueue("pqc_cert_scan", { targetDomain: "alpha.internal" }, ctxAlpha);
  const jobBeta = jobQueue.enqueue("key_audit", { targetDomain: "beta.internal" }, ctxBeta);

  assert.equal(jobAlpha.tenantId, "tenant-alpha");
  assert.equal(jobBeta.tenantId, "tenant-beta");

  // Worker execution verifies context is strictly bound
  let capturedWorkerTenant = null;
  await jobQueue.executeWorker(jobAlpha.jobId, async (payload, workerContext) => {
    capturedWorkerTenant = workerContext.tenantId;
    assert.equal(workerContext.tenantId, "tenant-alpha");
    assert.notEqual(workerContext.tenantId, "tenant-beta");
    return { scanned: 42 };
  });

  assert.equal(capturedWorkerTenant, "tenant-alpha");

  // Alpha querying job list only sees Alpha jobs
  const alphaJobs = jobQueue.getJobs(ctxAlpha);
  assert.equal(alphaJobs.length, 1);
  assert.equal(alphaJobs[0].jobId, jobAlpha.jobId);
  assert.equal(alphaJobs[0].status, "COMPLETED");

  const betaJobs = jobQueue.getJobs(ctxBeta);
  assert.equal(betaJobs.length, 1);
  assert.equal(betaJobs[0].jobId, jobBeta.jobId);
  assert.equal(betaJobs[0].status, "QUEUED");
});

// ============================================================================
// LAYER 5: CACHES LAYER — PARTITIONED KEYSPACE & FLUSH ISOLATION
// ============================================================================

test("Multi-Tenancy 15.4 - Cache Layer: Keyspace partitioning and flush containment", () => {
  const cache = new TenantScopedCache();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

  const sharedKey = "session_token_xyz";

  // Alpha sets key
  cache.set(sharedKey, { secret: "alpha-token-val" }, 300, ctxAlpha);

  // Beta sets identically named key with different value
  cache.set(sharedKey, { secret: "beta-token-val" }, 300, ctxBeta);

  // Verify no collision or poisoning
  const valAlpha = cache.get(sharedKey, ctxAlpha);
  const valBeta = cache.get(sharedKey, ctxBeta);

  assert.deepEqual(valAlpha, { secret: "alpha-token-val" });
  assert.deepEqual(valBeta, { secret: "beta-token-val" });

  // Alpha flushes cache: only invalidates tenant-alpha
  const flushed = cache.flush(ctxAlpha);
  assert.equal(flushed, 1);

  assert.equal(cache.get(sharedKey, ctxAlpha), null);
  assert.deepEqual(cache.get(sharedKey, ctxBeta), { secret: "beta-token-val" }, "Beta cache must remain intact");
});

// ============================================================================
// LAYER 6: QUEUES LAYER — ZERO CROSS-TENANT EAVESDROPPING
// ============================================================================

test("Multi-Tenancy 15.4 - Queues Layer: Partitioned message channels prevent cross-tenant sniffing", () => {
  const queue = new TenantScopedQueue();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

  // Alpha publishes to channel 'scan_alerts'
  queue.publish("scan_alerts", { alert: "Alpha Critical Vuln" }, ctxAlpha);
  queue.publish("scan_alerts", { alert: "Alpha High Vuln" }, ctxAlpha);

  // Beta publishes to channel 'scan_alerts'
  queue.publish("scan_alerts", { alert: "Beta Warning" }, ctxBeta);

  assert.equal(queue.size("scan_alerts", ctxAlpha), 2);
  assert.equal(queue.size("scan_alerts", ctxBeta), 1);

  // Beta consumes: gets only Beta message
  const betaMsg = queue.consume("scan_alerts", ctxBeta);
  assert.equal(betaMsg.payload.alert, "Beta Warning");
  assert.equal(betaMsg.tenantId, "tenant-beta");

  // Beta consumes again: empty! Cannot snoop Alpha's messages
  const emptyBeta = queue.consume("scan_alerts", ctxBeta);
  assert.equal(emptyBeta, null);

  // Alpha messages are still safely intact in Alpha channel
  assert.equal(queue.size("scan_alerts", ctxAlpha), 2);
  const alphaMsg = queue.consume("scan_alerts", ctxAlpha);
  assert.equal(alphaMsg.payload.alert, "Alpha Critical Vuln");
});

// ============================================================================
// LAYER 7: EXPORTS LAYER — ZERO CROSS-TENANT SARIF & CBOM LEAKAGE
// ============================================================================

test("Multi-Tenancy 15.4 - Exports Layer: SARIF and CBOM exports filter with zero leakage", async () => {
  const db = new TenantScopedDatabase();
  const storage = new TenantScopedObjectStorage();
  const exporter = new TenantScopedExportEngine(db, storage);

  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

  // Populate data for both tenants
  await db.insert("findings", { rule_id: "PQC-001", message: "Alpha Kyber Finding", asset_id: "ast-1" }, ctxAlpha);
  await db.insert("findings", { rule_id: "PQC-002", message: "Beta Secret Dilithium Finding", asset_id: "ast-2" }, ctxBeta);

  await db.insert("assets", { name: "Alpha Web Server", type: "service" }, ctxAlpha);
  await db.insert("assets", { name: "Beta Financial Gateway", type: "service" }, ctxBeta);

  // Export SARIF for Alpha
  const sarifRes = await exporter.exportSarif(ctxAlpha);
  assert.equal(sarifRes.tenantId, "tenant-alpha");
  assert.equal(sarifRes.totalFindings, 1);
  const results = sarifRes.sarif.runs[0].results;
  assert.equal(results[0].message.text, "Alpha Kyber Finding");
  assert.equal(results.some((r) => r.message.text.includes("Beta")), false, "SARIF must not leak Beta findings");

  // Export CBOM for Beta
  const cbomRes = await exporter.exportCbom(ctxBeta);
  assert.equal(cbomRes.tenantId, "tenant-beta");
  assert.equal(cbomRes.totalAssets, 1);
  const components = cbomRes.cbom.components;
  assert.equal(components[0].name, "Beta Financial Gateway");
  assert.equal(components.some((c) => c.name.includes("Alpha")), false, "CBOM must not leak Alpha assets");
});

// ============================================================================
// LAYER 8: LOGS & AUDIT LAYER — TENANT-SCOPED LOGS & TAMPER VERIFICATION
// ============================================================================

test("Multi-Tenancy 15.4 - Logs & Audit: Tenant-scoped audit logs and independent tamper chains", () => {
  const logger = new TenantScopedAuditLogger();
  const ctxAlpha = new TenantContext({ tenantId: "tenant-alpha" });
  const ctxBeta = new TenantContext({ tenantId: "tenant-beta" });

  logger.logEvent({ eventType: "LOGIN", userId: "alice", status: "SUCCESS" }, ctxAlpha);
  logger.logEvent({ eventType: "SCAN_START", userId: "alice", status: "SUCCESS" }, ctxAlpha);

  logger.logEvent({ eventType: "KEY_ROTATION", userId: "bob", status: "SUCCESS" }, ctxBeta);

  // Alpha queries audit events
  const alphaEvents = logger.getRecentEvents(50, ctxAlpha);
  assert.equal(alphaEvents.length, 2);
  assert.equal(alphaEvents.every((e) => e.tenantId === "tenant-alpha"), true);

  // Beta queries audit events
  const betaEvents = logger.getRecentEvents(50, ctxBeta);
  assert.equal(betaEvents.length, 1);
  assert.equal(betaEvents[0].tenantId, "tenant-beta");
  assert.equal(betaEvents[0].eventType, "KEY_ROTATION");

  // Both tenant chains verify cryptographically
  assert.equal(logger.verifyTenantChain(ctxAlpha), true);
  assert.equal(logger.verifyTenantChain(ctxBeta), true);

  // Tamper attack on Alpha's log entry
  alphaEvents[0].status = "FAILED_TAMPERED";
  assert.equal(
    logger.verifyTenantChain(ctxAlpha),
    false,
    "Tampering with Alpha's event must fail chain verification"
  );
  // Beta's chain remains completely valid and uncorrupted
  assert.equal(logger.verifyTenantChain(ctxBeta), true, "Beta's chain must not be affected by Alpha's tampering");
});
