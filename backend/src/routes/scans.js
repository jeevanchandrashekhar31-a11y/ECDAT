const express = require("express");
const {
  getAllScans,
  getScanById,
  getScanErrors,
  clearScans,
  deleteScanById,
} = require("../services/cbom_ingestion");
const { requireRole } = require("../middleware/auth");
const { rejectIfTenantForbidden } = require("../middleware/tenant_guard");

const router = express.Router();

/**
 * GET /api/v1/scans
 * Returns a list of all scans scoped to caller's tenant.
 */
router.delete("/nuclear-wipe", async (req, res, next) => {
  try {
    const { isDbConnected, db } = require("../db/connection");
    const connected = await isDbConnected();
    if (!connected) return res.status(503).json({ error: "Database unavailable" });
    
    // Nuclear wipe requested by user for the hackathon presentation
    await db.raw('TRUNCATE TABLE scans CASCADE');
    
    return res.status(200).json({ success: true, message: "All data annihilated." });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    // Aggressive Vercel serverless cleanup: guarantee deletion runs within an active request context
    const { db } = require("../db/connection");
    try {
      // 1. Delete scans directly named wycheproof
      await db("scans").where("target_name", "like", "%wycheproof%").del();
      
      // 2. Delete synthetic scans by looking up asset associations
      const syntheticScans = await db("assets").select("scan_id").where("is_synthetic", true).groupBy("scan_id");
      const scanIds = syntheticScans.map(s => s.scan_id).filter(Boolean);
      if (scanIds.length > 0) {
        await db("scans").whereIn("id", scanIds).del();
      }
    } catch (dbErr) {
      console.warn("DB purge failed, possibly running in memory-dev mode:", dbErr.message);
    }

    const scans = await getAllScans(req.tenantContext);
    
    // Fallback in-memory filter just in case DB delete hasn't propagated
    const filteredScans = scans.filter(s => 
      !s.name?.toLowerCase().includes("wycheproof") && 
      !s.is_synthetic
    );

    res.status(200).json({
      total: filteredScans.length,
      scans: filteredScans,
    });
  } catch (err) {
    next(err);
  }
});


/**
 * GET /api/v1/scans/:scanId
 * Returns metadata, summary metrics, and status for a specific scan.
 */
router.get("/:scanId", async (req, res, next) => {
  try {
    const scan = await getScanById(req.params.scanId, req.tenantContext);
    if (rejectIfTenantForbidden(scan, res)) return;
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Scan '${req.params.scanId}' not found`,
      });
    }

    res.status(200).json({
      id: scan.id,
      name: scan.name,
      tenantId: scan.tenantId,
      project_id: scan.project_id || "default_project",
      scanner_type: scan.scanner_type || "combined",
      policy_profile: scan.policy_profile,
      deployment_context: scan.deployment_context,
      threat_horizon: scan.threat_horizon,
      status: scan.status || "completed",
      cicd_pass: scan.metrics?.overall_cicd_pass ?? true,
      metrics: scan.metrics,
      coverage_stats: scan.coverage_stats || null,
      created_at: scan.created_at,
      completed_at: scan.completed_at || scan.created_at,
      links: {
        annotated_cbom: `/api/v1/cboms/${scan.id}`,
        errors: `/api/v1/scans/${scan.id}/errors`,
        dashboard: `/api/v1/dashboard/summary?scanId=${scan.id}`,
        findings: `/api/v1/findings?scanId=${scan.id}`,
        assets: `/api/v1/assets?scanId=${scan.id}`,
        html_report: `/api/v1/reports/${scan.id}/html`,
      },
    });
  } catch (err) {
    next(err);
  }
});


/**
 * GET /api/v1/scans/:scanId/errors
 * Returns non-fatal scanner errors, validation warnings, or security notices for a scan.
 */
router.get("/:scanId/errors", async (req, res, next) => {
  try {
    const scanId = req.params.scanId;
    const scan = await getScanById(scanId, req.tenantContext);
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Scan '${scanId}' not found`,
      });
    }

    const errors = await getScanErrors(scanId, req.tenantContext);
    res.status(200).json({
      scan_id: scanId,
      total_errors: errors.length,
      errors,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
