/**
 * Multi-Tenancy REST API Router — Phase 15.4
 *
 * Exposes operations across all 8 tenant-isolated layers.
 */

const express = require("express");
const router = express.Router();
const {
  TenantContext,
  defaultTenantDb,
  defaultTenantStorage,
  defaultTenantCache,
  defaultTenantJobQueue,
  defaultTenantQueue,
  defaultTenantExportEngine,
  defaultTenantAuditLogger,
} = require("../tenancy");
const { requireObjectAuthorization, OBJECT_TYPES } = require("../security/object_authorization");

/**
 * GET /api/v1/tenancy/me
 * Returns authoritative tenant isolation context.
 */
router.get("/me", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  return res.json({
    tenantId: context.tenantId,
    userId: context.userId,
    roles: context.roles,
    isPlatformAdmin: context.isPlatformAdmin,
  });
});

const ALLOWED_TENANCY_COLLECTIONS = Object.freeze(
  new Set(["assets", "findings", "scans", "certificates", "policies", "reports"])
);

/**
 * Database Layer APIs
 */
router.post("/database/records", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    if (!context.tenantId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication with tenant scope required to insert database records.",
      });
    }

    const { collection = "assets", data = {} } = req.body || {};
    if (!ALLOWED_TENANCY_COLLECTIONS.has(String(collection).toLowerCase())) {
      return res.status(400).json({
        error: "InvalidCollection",
        message: `Collection '${collection}' is not permitted. Allowed: ${Array.from(ALLOWED_TENANCY_COLLECTIONS).join(", ")}`,
      });
    }

    const userRoles = (context.roles || []).map((r) => String(r).toLowerCase().replace(/[-_]/g, " "));
    const canWrite =
      context.isPlatformAdmin ||
      userRoles.includes("platform administrator") ||
      userRoles.includes("admin") ||
      userRoles.includes("security administrator") ||
      userRoles.includes("developer");

    if (!canWrite) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Insufficient role permissions to insert tenant database records.",
      });
    }

    const created = await defaultTenantDb.insert(collection, data, context);
    return res.status(201).json(created);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/database/records", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const collection = req.query.collection || "assets";
    const records = await defaultTenantDb.find(collection, {}, context);
    return res.json({
      tenantId: context.tenantId,
      collection,
      count: records.length,
      records,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/database/records/:id", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const collection = req.query.collection || "assets";
    const record = await defaultTenantDb.findById(collection, req.params.id, context);
    if (!record) {
      return res.status(404).json({
        error: "NotFound",
        message: `Record '${req.params.id}' not found in tenant '${context.tenantId}'`,
      });
    }
    return res.json(record);
  } catch (err) {
    if (err.name === "TenantBoundaryViolation") {
      return res.status(403).json({
        error: err.name,
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: err.message,
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Object Storage Layer APIs
 */
router.post("/storage/upload", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const { key, data, metadata } = req.body || {};
    if (!key) return res.status(400).json({ error: "Missing 'key' field" });

    const result = await defaultTenantStorage.putObject(key, data || "", context, metadata);
    return res.status(201).json(result);
  } catch (err) {
    if (err.name === "TenantPathTraversalError") {
      return res.status(403).json({ error: err.name, message: err.message, code: err.code });
    }
    return res.status(400).json({ error: err.message });
  }
});

router.get("/storage/:key", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const item = await defaultTenantStorage.getObject(req.params.key, context);
    return res.json(item);
  } catch (err) {
    if (err.name === "TenantPathTraversalError") {
      return res.status(403).json({ error: err.name, message: err.message, code: err.code });
    }
    return res.status(404).json({ error: err.name, message: err.message });
  }
});

/**
 * Cache Layer APIs
 */
router.post("/cache", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const { key, value, ttl = 300 } = req.body || {};
  if (!key) return res.status(400).json({ error: "Missing 'key' field" });

  defaultTenantCache.set(key, value, ttl, context);
  return res.json({ success: true, key, tenantId: context.tenantId });
});

router.get("/cache/:key", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const val = defaultTenantCache.get(req.params.key, context);
  if (val === null || val === undefined) {
    return res.status(404).json({ error: "NotFound", message: "Cache entry missing or expired" });
  }
  return res.json({ key: req.params.key, value: val, tenantId: context.tenantId });
});

/**
 * Background Jobs Layer APIs
 */
router.post("/jobs", (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const { taskName = "pqc_scan", payload = {} } = req.body || {};

    const job = defaultTenantJobQueue.enqueue(taskName, payload, context);
    return res.status(201).json(job);
  } catch (err) {
    if (err.name === "QueueDepthExceededError" || err.code === "QUEUE_DEPTH_EXCEEDED") {
      return res.status(429).json({
        error: "TooManyRequests",
        code: err.code || "QUEUE_DEPTH_EXCEEDED",
        message: err.message,
        details: err.details,
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.get("/jobs", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const jobs = defaultTenantJobQueue.getJobs(context);
  return res.json({ tenantId: context.tenantId, jobs });
});

/**
 * GET /api/v1/tenancy/jobs/:jobId
 * Retrieves a specific background job enforcing server-side state verification and tenant isolation.
 */
router.get(
  "/jobs/:jobId",
  requireObjectAuthorization(OBJECT_TYPES.JOB, { idParam: "jobId" }),
  (req, res) => {
    const job = req.resolvedObject;
    return res.json({
      jobId: job.id,
      tenantId: job.tenantId,
      status: job.status,
    });
  }
);

/**
 * DELETE /api/v1/tenancy/jobs/:jobId
 * Cancels/removes a job enforcing server-side state verification and tenant isolation.
 */
router.delete(
  "/jobs/:jobId",
  requireObjectAuthorization(OBJECT_TYPES.JOB, { idParam: "jobId" }),
  (req, res) => {
    const job = req.resolvedObject;
    defaultTenantJobQueue.jobs.delete(job.id);
    return res.json({
      success: true,
      message: `Job '${job.id}' cancelled successfully`,
    });
  }
);

/**
 * Queues Layer APIs
 */
router.post("/queues/publish", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const { channel = "scanner_events", message = {} } = req.body || {};

  const published = defaultTenantQueue.publish(channel, message, context);
  return res.status(201).json(published);
});

router.post("/queues/consume", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const { channel = "scanner_events" } = req.body || {};

  const msg = defaultTenantQueue.consume(channel, context);
  if (!msg) {
    return res.status(204).send();
  }
  return res.json(msg);
});

/**
 * Exports Layer APIs
 */
router.get("/exports/sarif", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const result = await defaultTenantExportEngine.exportSarif(context);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/exports/cbom", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const result = await defaultTenantExportEngine.exportCbom(context);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Logs & Audit Layer APIs
 */
router.get("/audit", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const limit = parseInt(req.query.limit || "50", 10);
  const events = defaultTenantAuditLogger.getRecentEvents(limit, context);
  const chainValid = defaultTenantAuditLogger.verifyTenantChain(context);

  return res.json({
    tenantId: context.tenantId,
    chainValid,
    totalEvents: events.length,
    events,
  });
});

/**
 * POST /api/v1/tenancy/switch
 * Changes or switches active tenant context (enforces cross-tenant authorization and emits TENANT_CHANGED audit event).
 */
router.post("/switch", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const { targetTenantId, tenantId, reason } = req.body || {};
    const newTenant = String(targetTenantId || tenantId || "").trim().toLowerCase();

    if (!newTenant) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Missing 'targetTenantId' in request body",
      });
    }

    const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");

    // Enforce authorization: only platform admin or current tenant member can switch
    if (!context.isPlatformAdmin && context.tenantId !== newTenant) {
      await defaultAuditService.logEvent({
        category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
        action: AUDIT_ACTIONS.AUTHORIZATION_FAILURE,
        actor: {
          id: context.userId || "anonymous",
          username: context.userId || "anonymous",
          role: context.roles?.[0] || "viewer",
          ipAddress: req.ip,
        },
        tenant: context.tenantId,
        target: { type: "tenant", id: newTenant, name: newTenant },
        requestId: req.id || req.headers["x-request-id"],
        result: AUDIT_STATUSES.DENIED,
        reason: `Cross-tenant switch to '${newTenant}' denied: insufficient privileges`,
        sourceIp: req.ip,
      });

      return res.status(403).json({
        error: "Forbidden",
        code: "CROSS_TENANT_ACCESS_DENIED",
        message: "Only platform administrators can switch between different tenants.",
      });
    }

    const oldTenant = context.tenantId;

    await defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
      action: AUDIT_ACTIONS.TENANT_CHANGED,
      actor: {
        id: context.userId || "system",
        username: context.userId || "system",
        role: context.roles?.[0] || "admin",
        ipAddress: req.ip,
      },
      tenant: newTenant,
      target: { type: "tenant", id: newTenant, name: newTenant },
      requestId: req.id || req.headers["x-request-id"],
      result: AUDIT_STATUSES.SUCCESS,
      reason: reason || `Active tenant context switched from '${oldTenant}' to '${newTenant}'`,
      sourceIp: req.ip,
      details: {
        previousTenantId: oldTenant,
        newTenantId: newTenant,
        userId: context.userId,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Switched active tenant from '${oldTenant}' to '${newTenant}'`,
      previousTenantId: oldTenant,
      currentTenantId: newTenant,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
