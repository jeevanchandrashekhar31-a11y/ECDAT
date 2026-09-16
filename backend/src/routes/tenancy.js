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

/**
 * Database Layer APIs
 */
router.post("/database/records", async (req, res) => {
  try {
    const context = req.tenantContext || TenantContext.fromRequest(req);
    const { collection = "assets", data = {} } = req.body || {};
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
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const { taskName = "pqc_scan", payload = {} } = req.body || {};

  const job = defaultTenantJobQueue.enqueue(taskName, payload, context);
  return res.status(201).json(job);
});

router.get("/jobs", (req, res) => {
  const context = req.tenantContext || TenantContext.fromRequest(req);
  const jobs = defaultTenantJobQueue.getJobs(context);
  return res.json({ tenantId: context.tenantId, jobs });
});

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

module.exports = router;
