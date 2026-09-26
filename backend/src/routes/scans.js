const express = require("express");
const {
  getAllScans,
  getScanById,
  getScanErrors,
  clearScans,
  deleteScanById,
} = require("../services/cbom_ingestion");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/v1/scans
 * Returns a list of all scans scoped to caller's tenant.
 */
router.get("/", async (req, res, next) => {
  try {
    const scans = await getAllScans(req.tenantContext);
    res.status(200).json({
      total: scans.length,
      scans,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/scans
 * Clears scan records scoped to caller's tenant.
 */
router.delete("/", requireRole(["platform administrator", "security administrator"]), async (req, res, next) => {
  try {
    await clearScans(req.tenantContext);
    res.status(200).json({
      success: true,
      message: "Scans and cryptographic inventory successfully cleared.",
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
 * DELETE /api/v1/scans/:scanId
 * Deletes a specific scan verifying caller's tenant boundary.
 */
router.delete("/:scanId", requireRole(["platform administrator", "security administrator"]), async (req, res, next) => {
  try {
    const isPlatformAdmin = req.tenantContext?.isPlatformAdmin || false;
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    // Lookup scan in system to verify existence and check cross-tenant boundary
    const scan = await getScanById(req.params.scanId, { isPlatformAdmin: true });
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Scan '${req.params.scanId}' not found`,
      });
    }
    if (!isPlatformAdmin && scan.tenantId && scan.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot delete scan belonging to tenant '${scan.tenantId}'`,
      });
    }

    // Delete scan record
    await deleteScanById(req.params.scanId, req.tenantContext);
    res.status(200).json({
      success: true,
      message: `Scan '${req.params.scanId}' deleted successfully.`,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: "NotFound", message: err.message });
    }
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
