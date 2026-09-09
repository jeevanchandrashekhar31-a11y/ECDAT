const express = require("express");
const {
  getAllScans,
  getScanById,
  getScanErrors,
  clearScans,
} = require("../services/cbom_ingestion");

const router = express.Router();

/**
 * GET /api/v1/scans
 * Returns a list of all scans.
 */
router.get("/", async (req, res, next) => {
  try {
    const scans = await getAllScans();
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
 * Clears all scan records for a pure clean state.
 */
router.delete("/", async (req, res, next) => {
  try {
    await clearScans();
    res.status(200).json({
      success: true,
      message: "All scans and cryptographic inventory successfully cleared.",
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
    const scan = await getScanById(req.params.scanId);
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Scan '${req.params.scanId}' not found`,
      });
    }

    res.status(200).json({
      id: scan.id,
      name: scan.name,
      project_id: scan.project_id || "default_project",
      scanner_type: scan.scanner_type || "combined",
      policy_profile: scan.policy_profile,
      scenario: scan.scenario,
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
 * GET /api/v1/scans/:scanId/errors
 * Returns non-fatal scanner errors, validation warnings, or security notices for a scan.
 */
router.get("/:scanId/errors", async (req, res, next) => {
  try {
    const scanId = req.params.scanId;
    const scan = await getScanById(scanId);
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Scan '${scanId}' not found`,
      });
    }

    const errors = await getScanErrors(scanId);
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
