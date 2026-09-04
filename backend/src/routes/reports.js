const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");

const router = express.Router();

/**
 * GET /api/v1/reports/summary
 * Retrieves the raw executive summary JSON for a scan (supports ?scanId or latest).
 */
router.get("/summary", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const scan = scanId ? await getScanById(scanId) : getLatestScan();

    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: "No scan data available.",
      });
    }

    if (scan.summary) {
      return res.status(200).json(scan.summary);
    }

    // If loaded from PostgreSQL without cached summary
    res.status(200).json({
      scan_id: scan.id,
      scan_name: scan.name,
      policy_profile: scan.policy_profile,
      scenario: scan.scenario,
      created_at: scan.created_at,
      metrics: scan.metrics,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/cbom/:scanId
 * Retrieves the stored CycloneDX CBOM document for a scan.
 * Supports ?type=annotated (default) or ?type=raw.
 */
router.get("/cbom/:scanId", async (req, res, next) => {
  try {
    const scanId = req.params.scanId;
    const type = req.query.type === "raw" ? "raw_json" : "annotated_json";

    const connected = await isDbConnected();
    if (connected) {
      try {
        const row = await db("cboms").where("scan_id", scanId).first();
        if (row) {
          const content =
            typeof row[type] === "string" ? JSON.parse(row[type]) : row[type];
          return res.status(200).json(content);
        }
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for report cbom:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scan = await getScanById(scanId);
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `CBOM report not found for scan '${scanId}'`,
      });
    }

    res.status(200).json(scan.annotated_bom || scan.raw_cbom || {});
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/:id/html
 * Serves the standalone static HTML risk assessment report.
 */
router.get("/:id/html", async (req, res, next) => {
  try {
    const scan =
      req.params.id === "latest"
        ? getLatestScan()
        : await getScanById(req.params.id);

    if (!scan || !scan.html_report) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Report Not Found</title></head>
        <body style="font-family:sans-serif; background:#0f172a; color:#fff; padding:2rem; text-align:center;">
          <h2>Report Not Found</h2>
          <p>No report exists for scan ID: <code>${req.params.id}</code></p>
        </body>
        </html>
      `);
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(scan.html_report);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/:id/summary (backwards-compatible alias for /summary?scanId=:id)
 */
router.get("/:id/summary", async (req, res, next) => {
  try {
    const scan =
      req.params.id === "latest"
        ? getLatestScan()
        : await getScanById(req.params.id);

    if (!scan || !scan.summary) {
      return res.status(404).json({
        error: "NotFound",
        message: `Summary report not found for scan '${req.params.id}'`,
      });
    }

    res.status(200).json(scan.summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
