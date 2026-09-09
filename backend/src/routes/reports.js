const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");

const router = express.Router();

const { generateHtmlReport } = require("../risk_engine/html_reporter");
const { generateSummary } = require("../risk_engine/summary_generator");

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

    if (scan.annotated_bom) {
      try {
        const summary = generateSummary(scan.annotated_bom, {
          policyProfile: scan.policy_profile || "regulated_bfsi",
          scenario: scan.scenario || "baseline",
        });
        scan.summary = summary;
        return res.status(200).json(summary);
      } catch (sumErr) {
        console.warn("Failed to generate summary from annotated BOM:", sumErr.message);
      }
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

    if (!scan) {
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

    // If pre-cached, send directly
    if (scan.html_report) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(scan.html_report);
    }

    // Dynamically generate from summary or annotated CBOM
    let summary = scan.summary;
    if (!summary && scan.annotated_bom) {
      try {
        summary = generateSummary(scan.annotated_bom, {
          policyProfile: scan.policy_profile || "regulated_bfsi",
          scenario: scan.scenario || "baseline",
        });
        scan.summary = summary;
      } catch (sumErr) {
        console.warn("Failed to generate summary for HTML report:", sumErr.message);
      }
    }

    if (summary) {
      try {
        const html = generateHtmlReport(summary);
        scan.html_report = html;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(html);
      } catch (htmlErr) {
        console.warn("Failed to generate HTML report from summary:", htmlErr.message);
      }
    }

    // Fallback minimal HTML report if full summary generation failed
    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ECDAT Cryptographic Report: ${scan.name || scan.id}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; line-height: 1.6; }
          .card { background: #1e293b; border-radius: 12px; padding: 24px; max-width: 900px; margin: 0 auto 20px; border: 1px solid #334155; }
          h1 { color: #38bdf8; margin-bottom: 8px; }
          .stat { font-size: 2rem; font-weight: bold; color: #38bdf8; }
          .badge-fail { background: #ef4444; color: white; padding: 4px 10px; border-radius: 9999px; font-weight: bold; font-size: 0.8rem; }
          .badge-pass { background: #10b981; color: white; padding: 4px 10px; border-radius: 9999px; font-weight: bold; font-size: 0.8rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>${scan.name || 'Cryptographic Scan Report'}</h1>
          <p>Scan ID: <code>${scan.id}</code> | Profile: <b>${scan.policy_profile || 'regulated_bfsi'}</b> | Scenario: <b>${scan.scenario || 'baseline'}</b></p>
        </div>
        <div class="card">
          <h2>Telemetry & Post-Quantum Summary</h2>
          <p>Total Cryptographic Assets: <span class="stat">${scan.metrics?.total_assets || 0}</span></p>
          <p>Assets at Quantum Threat: <b>${scan.metrics?.assets_at_quantum_risk || 0}</b></p>
          <p>Critical Weaknesses: <b>${scan.metrics?.severity_counts?.critical || 0}</b> | High: <b>${scan.metrics?.severity_counts?.high || 0}</b></p>
          <p>Status: ${scan.metrics?.overall_cicd_pass ? '<span class="badge-pass">PASS</span>' : '<span class="badge-fail">FAIL</span>'}</p>
        </div>
      </body>
      </html>
    `;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(fallbackHtml);
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

    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: `Summary report not found for scan '${req.params.id}'`,
      });
    }

    if (scan.summary) {
      return res.status(200).json(scan.summary);
    }

    if (scan.annotated_bom) {
      const summary = generateSummary(scan.annotated_bom, {
        policyProfile: scan.policy_profile || "regulated_bfsi",
        scenario: scan.scenario || "baseline",
      });
      scan.summary = summary;
      return res.status(200).json(summary);
    }

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

module.exports = router;
