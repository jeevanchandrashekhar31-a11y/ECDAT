/**
 * Multi-Tenancy Isolation Subsystem — Phase 15.4
 *
 * Enforces strict, end-to-end tenant isolation across all 8 enterprise layers:
 * 1. API Layer: Authoritative context, client parameter rejection, spoofing defense
 * 2. Database Layer: Row-level tenant discriminator filtering & mutation guard
 * 3. Object Storage Layer: Sandboxed tenant prefixes & path traversal prevention
 * 4. Background Jobs Layer: Immutable tenant-bound job envelopes & execution context
 * 5. Caches Layer: Tenant-prefixed keyspace partitioning (tenant:{tenantId}:{key})
 * 6. Queues Layer: Partitioned message channels & tenant-scoped publish/consume
 * 7. Exports Layer: Tenant-filtered SARIF, CBOM, and report generation
 * 8. Logs & Audit Layer: Tenant-scoped audit trails & cryptographic ledger verification
 *
 * Golden Invariant:
 * "A tenant ID supplied by a client must never be trusted as authorization."
 */

const crypto = require("crypto");
const path = require("path");

class TenantBoundaryViolation extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TenantBoundaryViolation";
    this.code = details.code || "CROSS_TENANT_FORBIDDEN";
    this.details = details;
  }
}

class TenantPathTraversalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TenantPathTraversalError";
    this.code = "PATH_TRAVERSAL_DETECTED";
    this.details = details;
  }
}

/**
 * Encapsulates the immutable security context of the authenticated tenant.
 */
class TenantContext {
  constructor({
    tenantId = "default-tenant",
    userId = "anonymous",
    roles = ["viewer"],
    isPlatformAdmin = false,
  } = {}) {
    this.tenantId = tenantId !== null && tenantId !== undefined ? String(tenantId).trim().toLowerCase() : null;
    this.userId = String(userId);
    this.roles = Array.isArray(roles) ? [...roles] : [String(roles)];
    this.isPlatformAdmin = Boolean(isPlatformAdmin);
    this.hasTenantScope = Boolean(this.tenantId);
    Object.freeze(this);
  }

  static fromRequest(req) {
    let tenantId = null;
    let userId = "anonymous";
    let roles = [];
    let isPlatformAdmin = false;

    if (req.user) {
      tenantId = req.user.tenantId || req.user.tenant_id || "default-tenant";
      userId = req.user.sub || req.user.userId || userId;
      roles = req.user.roles || (req.user.role ? [req.user.role] : ["viewer"]);
    } else if (req.auth && req.auth.authenticated) {
      if (req.auth.user) {
        tenantId = req.auth.user.tenantId || req.auth.user.tenant_id || "default-tenant";
        userId = req.auth.user.sub || req.auth.user.userId || userId;
        roles = req.auth.user.roles || (req.auth.user.role ? [req.auth.user.role] : ["viewer"]);
      } else {
        roles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
        tenantId = req.auth.tenantId || req.auth.tenant_id || "default-tenant";
      }
    } else if (req.auth && req.auth.mode === "open") {
      tenantId = "default-tenant";
      userId = "dev-user";
      roles = ["admin"];
      isPlatformAdmin = true;
    }

    const normRoles = roles.map((r) => String(r).toLowerCase().replace(/[-_]/g, " "));
    isPlatformAdmin = normRoles.some(
      (r) => r === "platform administrator" || r === "platform admin" || r === "platform_admin" || r === "superuser"
    );

    return new TenantContext({
      tenantId,
      userId,
      roles,
      isPlatformAdmin,
    });
  }
}

// ============================================================================
// LAYER 1: API LAYER — TENANT ISOLATION MIDDLEWARE
// ============================================================================

/**
 * Express middleware that enforces:
 * 1. Derives authoritative tenant exclusively from verified security principal.
 * 2. "A tenant ID supplied by a client must never be trusted as authorization."
 *    Rejects client attempts to pass a different tenant ID in params, query, body, or headers.
 * 3. Sanitizes body to prevent mass-assignment tenant tampering.
 */
function tenantIsolationMiddleware(req, res, next) {
  const context = TenantContext.fromRequest(req);
  req.tenantContext = context;

  // Extract any client-supplied tenant ID
  const suppliedTenantId =
    (req.params && (req.params.tenantId || req.params.tenant_id)) ||
    (req.query && (req.query.tenantId || req.query.tenant_id)) ||
    (req.body && (req.body.tenantId || req.body.tenant_id)) ||
    req.headers["x-tenant-id"] ||
    req.headers["x-tenant"];

  if (suppliedTenantId) {
    const cleanSupplied = String(suppliedTenantId).trim().toLowerCase();

    // If client supplied a tenant ID that differs from their authoritative tenant
    if (cleanSupplied !== context.tenantId) {
      // Only platform administrator may manage cross-tenant operations
      if (!context.isPlatformAdmin) {
        try {
          const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
          defaultAuditService.logEvent({
            category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
            action: AUDIT_ACTIONS.TENANT_ISOLATION_VIOLATION,
            status: AUDIT_STATUSES.DENIED,
            actor: {
              id: context.userId || "unknown",
              username: context.userId || "unknown",
              role: context.roles[0] || "viewer",
              ipAddress: req.ip,
            },
            tenantId: context.tenantId,
            target: { type: "tenant", id: cleanSupplied, name: req.originalUrl || req.path },
            details: {
              code: "TENANT_SPOOFING_VIOLATION",
              authoritativeTenantId: context.tenantId,
              suppliedTenantId: cleanSupplied,
              path: req.originalUrl || req.path,
              method: req.method,
              requestId: req.id,
            },
          }).catch(() => {});
        } catch {
          // Fail-safe
        }

        return res.status(403).json({
          error: "TenantBoundaryViolation",
          code: "TENANT_SPOOFING_VIOLATION",
          message: `Client-supplied tenant ID '${cleanSupplied}' does not match authoritative context '${context.tenantId}'. Access denied.`,
          authoritativeTenantId: context.tenantId,
          suppliedTenantId: cleanSupplied,
          requestId: req.id,
        });
      }
    }
  }

  // Sanitize body against tenant tampering for non-platform-admins
  if (req.body && typeof req.body === "object" && !context.isPlatformAdmin) {
    if ("tenantId" in req.body) req.body.tenantId = context.tenantId;
    if ("tenant_id" in req.body) req.body.tenant_id = context.tenantId;
  }

  next();
}

// ============================================================================
// LAYER 2: DATABASE LAYER — TENANT-SCOPED QUERIES
// ============================================================================

class TenantScopedDatabase {
  constructor(mockStore = new Map()) {
    this.store = mockStore; // tableName -> Array of records
  }

  _ensureTable(tableName) {
    if (!this.store.has(tableName)) {
      this.store.set(tableName, []);
    }
    return this.store.get(tableName);
  }

  async insert(tableName, record, tenantContext) {
    const table = this._ensureTable(tableName);
    const stamped = {
      ...record,
      id: record.id || `rec_${crypto.randomUUID()}`,
      tenant_id: tenantContext.tenantId,
      createdAt: new Date().toISOString(),
    };
    table.push(stamped);
    return { ...stamped };
  }

  async find(tableName, query = {}, tenantContext) {
    const table = this._ensureTable(tableName);
    return table
      .filter((rec) => {
        if (!tenantContext.isPlatformAdmin && rec.tenant_id !== tenantContext.tenantId) {
          return false;
        }
        for (const [k, v] of Object.entries(query)) {
          if (rec[k] !== v) return false;
        }
        return true;
      })
      .map((r) => ({ ...r }));
  }

  async findById(tableName, id, tenantContext) {
    const table = this._ensureTable(tableName);
    const rec = table.find((r) => {
      if (!tenantContext.isPlatformAdmin && r.tenant_id !== tenantContext.tenantId) {
        return false;
      }
      return r.id === id;
    });
    return rec ? { ...rec } : null;
  }

  async update(tableName, id, updates, tenantContext) {
    const table = this._ensureTable(tableName);
    const idx = table.findIndex((r) => {
      if (!tenantContext.isPlatformAdmin && r.tenant_id !== tenantContext.tenantId) {
        return false;
      }
      return r.id === id;
    });

    if (idx === -1) {
      throw new TenantBoundaryViolation(`Record '${id}' not found in tenant '${tenantContext.tenantId}'`);
    }

    // Never permit mutating the tenant_id
    const safeUpdates = { ...updates };
    delete safeUpdates.tenant_id;
    delete safeUpdates.tenantId;

    table[idx] = { ...table[idx], ...safeUpdates, updatedAt: new Date().toISOString() };
    return { ...table[idx] };
  }

  async delete(tableName, id, tenantContext) {
    const table = this._ensureTable(tableName);
    const idx = table.findIndex((r) => {
      if (!tenantContext.isPlatformAdmin && r.tenant_id !== tenantContext.tenantId) {
        return false;
      }
      return r.id === id;
    });

    if (idx === -1) {
      throw new TenantBoundaryViolation(`Record '${id}' not found in tenant '${tenantContext.tenantId}'`);
    }

    const [deleted] = table.splice(idx, 1);
    return { ...deleted };
  }
}

// ============================================================================
// LAYER 3: OBJECT STORAGE LAYER — TENANT-SCOPED PREFIXES & PATH DEFENSE
// ============================================================================

class TenantScopedObjectStorage {
  constructor(basePrefix = "/storage") {
    this.basePrefix = basePrefix;
    this.objects = new Map(); // Full namespaced key -> data
  }

  _sanitizeAndResolveKey(key, tenantId) {
    if (!key || typeof key !== "string") {
      throw new Error("Storage key must be a non-empty string");
    }

    // Rejects null bytes, backslashes, or directory traversal tokens
    if (/\0/.test(key) || /\.\./.test(key) || key.startsWith("/") || key.startsWith("\\")) {
      throw new TenantPathTraversalError(`Path traversal or invalid characters in key: '${key}'`);
    }

    const tenantPrefix = `${this.basePrefix}/${tenantId}/`;
    const fullPath = path.posix.normalize(`${tenantPrefix}${key}`);

    if (!fullPath.startsWith(tenantPrefix)) {
      throw new TenantPathTraversalError(`Key '${key}' escapes tenant storage boundary '${tenantPrefix}'`);
    }

    return fullPath;
  }

  async putObject(key, data, tenantContext, metadata = {}) {
    const fullKey = this._sanitizeAndResolveKey(key, tenantContext.tenantId);
    this.objects.set(fullKey, {
      data,
      metadata,
      tenantId: tenantContext.tenantId,
      updatedAt: new Date().toISOString(),
    });
    return { key, fullKey, tenantId: tenantContext.tenantId };
  }

  async getObject(key, tenantContext) {
    const fullKey = this._sanitizeAndResolveKey(key, tenantContext.tenantId);
    const item = this.objects.get(fullKey);

    if (!item) {
      throw new TenantBoundaryViolation(`Object '${key}' not found in tenant storage '${tenantContext.tenantId}'`);
    }

    if (!tenantContext.isPlatformAdmin && item.tenantId !== tenantContext.tenantId) {
      throw new TenantBoundaryViolation(`Cross-tenant storage access forbidden.`);
    }

    return { key, data: item.data, metadata: item.metadata };
  }

  async deleteObject(key, tenantContext) {
    const fullKey = this._sanitizeAndResolveKey(key, tenantContext.tenantId);
    if (!this.objects.has(fullKey)) {
      throw new TenantBoundaryViolation(`Object '${key}' not found in tenant storage`);
    }
    this.objects.delete(fullKey);
    return { success: true, key };
  }

  async listObjects(prefix = "", tenantContext) {
    const tenantPrefix = `${this.basePrefix}/${tenantContext.tenantId}/`;
    const searchPrefix = path.posix.normalize(`${tenantPrefix}${prefix}`);
    const results = [];

    for (const [k, v] of this.objects.entries()) {
      if (k.startsWith(searchPrefix)) {
        if (tenantContext.isPlatformAdmin || v.tenantId === tenantContext.tenantId) {
          results.push({
            key: k.substring(tenantPrefix.length),
            tenantId: v.tenantId,
            updatedAt: v.updatedAt,
          });
        }
      }
    }

    return results;
  }
}

// ============================================================================
// LAYER 4: BACKGROUND JOBS LAYER — TENANT-BOUND JOB ENVELOPES
// ============================================================================

class TenantScopedJobQueue {
  constructor() {
    this.jobs = new Map(); // jobId -> JobEnvelope
  }

  enqueue(taskName, payload = {}, tenantContext) {
    const tid = tenantContext?.tenantId || "default-tenant";

    // Enforce queue depth governor per tenant and system-wide
    let currentTenantDepth = 0;
    let currentSystemDepth = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "QUEUED" || j.status === "RUNNING") {
        currentSystemDepth += 1;
        if (j.tenantId === tid) {
          currentTenantDepth += 1;
        }
      }
    }

    const { defaultQueueDepthGovernor } = require("../security/resource_governance");
    defaultQueueDepthGovernor.verifyCapacity(currentTenantDepth, currentSystemDepth, tid);

    const jobId = `job_${crypto.randomUUID()}`;
    const job = {
      jobId,
      tenantId: tid,
      taskName,
      payload,
      status: "QUEUED",
      enqueuedAt: new Date().toISOString(),
      result: null,
      error: null,
    };
    this.jobs.set(jobId, job);
    return { ...job };
  }

  async executeWorker(jobId, workerFn) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job '${jobId}' not found`);

    // Lock execution context strictly to the job's tenantId
    const workerContext = new TenantContext({
      tenantId: job.tenantId,
      userId: "system-job-runner",
      roles: ["secops"],
    });

    job.status = "RUNNING";
    try {
      const result = await workerFn(job.payload, workerContext);
      job.status = "COMPLETED";
      job.result = result;
      return result;
    } catch (err) {
      job.status = "FAILED";
      job.error = err.message;
      throw err;
    }
  }

  getJobs(tenantContext) {
    const results = [];
    for (const j of this.jobs.values()) {
      if (tenantContext.isPlatformAdmin || j.tenantId === tenantContext.tenantId) {
        results.push({ ...j });
      }
    }
    return results;
  }
}

// ============================================================================
// LAYER 5: CACHES LAYER — TENANT-PREFIXED KEYSPACE
// ============================================================================

class TenantScopedCache {
  constructor() {
    this.cache = new Map(); // `tenant:{tenantId}:{key}` -> { value, expiresAt }
  }

  _buildKey(key, tenantId) {
    return `tenant:${tenantId}:${key}`;
  }

  get(key, tenantContext) {
    const k = this._buildKey(key, tenantContext.tenantId);
    const entry = this.cache.get(k);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(k);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSec = 300, tenantContext) {
    const k = this._buildKey(key, tenantContext.tenantId);
    const expiresAt = ttlSec > 0 ? Date.now() + ttlSec * 1000 : null;
    this.cache.set(k, { value, expiresAt, tenantId: tenantContext.tenantId });
    return true;
  }

  delete(key, tenantContext) {
    const k = this._buildKey(key, tenantContext.tenantId);
    return this.cache.delete(k);
  }

  flush(tenantContext) {
    const prefix = `tenant:${tenantContext.tenantId}:`;
    let count = 0;
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
        count++;
      }
    }
    return count;
  }
}

// ============================================================================
// LAYER 6: QUEUES LAYER — PARTITIONED MESSAGE CHANNELS
// ============================================================================

class TenantScopedQueue {
  constructor() {
    this.queues = new Map(); // `queue:{tenantId}:{channel}` -> Array of messages
  }

  _buildChannel(channel, tenantId) {
    return `queue:${tenantId}:${channel}`;
  }

  publish(channel, message, tenantContext) {
    const ch = this._buildChannel(channel, tenantContext.tenantId);
    if (!this.queues.has(ch)) {
      this.queues.set(ch, []);
    }
    const envelope = {
      messageId: `msg_${crypto.randomUUID()}`,
      tenantId: tenantContext.tenantId,
      channel,
      payload: message,
      timestamp: new Date().toISOString(),
    };
    this.queues.get(ch).push(envelope);
    return envelope;
  }

  consume(channel, tenantContext) {
    const ch = this._buildChannel(channel, tenantContext.tenantId);
    const q = this.queues.get(ch);
    if (!q || q.length === 0) return null;
    return q.shift();
  }

  size(channel, tenantContext) {
    const ch = this._buildChannel(channel, tenantContext.tenantId);
    const q = this.queues.get(ch);
    return q ? q.length : 0;
  }
}

// ============================================================================
// LAYER 7: EXPORTS LAYER — TENANT-FILTERED REPORT GENERATION
// ============================================================================

class TenantScopedExportEngine {
  constructor(db = new TenantScopedDatabase(), storage = new TenantScopedObjectStorage()) {
    this.db = db;
    this.storage = storage;
  }

  async exportSarif(tenantContext) {
    const findings = await this.db.find("findings", {}, tenantContext);
    const sarif = {
      version: "2.1.0",
      $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cos01/schemas/sarif-schema-2.1.0.json",
      runs: [
        {
          tool: { driver: { name: "ECDAT", version: "1.0.0" } },
          properties: { tenantId: tenantContext.tenantId },
          results: findings.map((f) => ({
            ruleId: f.rule_id || f.ruleId || "PQC-ALGO-001",
            message: { text: f.message || "Cryptographic Finding" },
            properties: { tenantId: tenantContext.tenantId, assetId: f.asset_id || f.assetId },
          })),
        },
      ],
    };

    const fileName = `sarif_export_${Date.now()}.json`;
    await this.storage.putObject(`exports/${fileName}`, JSON.stringify(sarif, null, 2), tenantContext);

    return {
      fileName,
      totalFindings: findings.length,
      tenantId: tenantContext.tenantId,
      sarif,
    };
  }

  async exportCbom(tenantContext) {
    const assets = await this.db.find("assets", {}, tenantContext);
    const cbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: {
        timestamp: new Date().toISOString(),
        properties: [{ name: "tenantId", value: tenantContext.tenantId }],
      },
      components: assets.map((a) => ({
        type: a.type || "cryptographic-asset",
        name: a.name || a.assetName || "Crypto Asset",
        version: a.version || "1.0",
        properties: [{ name: "tenantId", value: tenantContext.tenantId }],
      })),
    };

    const fileName = `cbom_export_${Date.now()}.json`;
    await this.storage.putObject(`exports/${fileName}`, JSON.stringify(cbom, null, 2), tenantContext);

    return {
      fileName,
      totalAssets: assets.length,
      tenantId: tenantContext.tenantId,
      cbom,
    };
  }
}

// ============================================================================
// LAYER 8: LOGS & AUDIT LAYER — TENANT-SCOPED CRYPTOGRAPHIC AUDIT
// ============================================================================

class TenantScopedAuditLogger {
  constructor() {
    this.events = [];
    this.tenantLastHashes = new Map(); // tenantId -> sha256
  }

  logEvent({ eventType, userId = "anonymous", status = "SUCCESS", reason = "", metadata = {} }, tenantContext) {
    const tenantId = tenantContext.tenantId;
    const eventId = `authevt_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    const prevHash = this.tenantLastHashes.get(tenantId) || "0".repeat(64);
    const entryData = JSON.stringify({
      eventId,
      eventType,
      userId,
      tenantId,
      status,
      reason,
      metadata,
      prevHash,
    });

    const hash = crypto.createHash("sha256").update(entryData).digest("hex");
    this.tenantLastHashes.set(tenantId, hash);

    const eventRecord = {
      eventId,
      eventType,
      userId,
      tenantId,
      status,
      reason,
      metadata,
      timestamp,
      prevHash,
      hash,
    };

    this.events.push(eventRecord);
    return eventRecord;
  }

  getRecentEvents(limit = 50, tenantContext) {
    return this.events
      .filter((e) => tenantContext.isPlatformAdmin || e.tenantId === tenantContext.tenantId)
      .slice(-limit);
  }

  verifyTenantChain(tenantContext) {
    const tenantEvents = this.events.filter((e) => e.tenantId === tenantContext.tenantId);
    let prev = "0".repeat(64);

    for (const evt of tenantEvents) {
      if (evt.prevHash !== prev) return false;
      const data = JSON.stringify({
        eventId: evt.eventId,
        eventType: evt.eventType,
        userId: evt.userId,
        tenantId: evt.tenantId,
        status: evt.status,
        reason: evt.reason,
        metadata: evt.metadata,
        prevHash: prev,
      });
      const expectedHash = crypto.createHash("sha256").update(data).digest("hex");
      if (expectedHash !== evt.hash) return false;
      prev = evt.hash;
    }

    return true;
  }
}

// Default singletons
const defaultTenantDb = new TenantScopedDatabase();
const defaultTenantStorage = new TenantScopedObjectStorage();
const defaultTenantCache = new TenantScopedCache();
const defaultTenantJobQueue = new TenantScopedJobQueue();
const defaultTenantQueue = new TenantScopedQueue();
const defaultTenantExportEngine = new TenantScopedExportEngine(defaultTenantDb, defaultTenantStorage);
const defaultTenantAuditLogger = new TenantScopedAuditLogger();

module.exports = {
  TenantBoundaryViolation,
  TenantPathTraversalError,
  TenantContext,
  tenantIsolationMiddleware,
  TenantScopedDatabase,
  defaultTenantDb,
  TenantScopedObjectStorage,
  defaultTenantStorage,
  TenantScopedCache,
  defaultTenantCache,
  TenantScopedJobQueue,
  defaultTenantJobQueue,
  TenantScopedQueue,
  defaultTenantQueue,
  TenantScopedExportEngine,
  defaultTenantExportEngine,
  TenantScopedAuditLogger,
  defaultTenantAuditLogger,
};
