const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");

const router = express.Router();

const { generateHtmlReport } = require("../risk_engine/html_reporter");
const { generateSummary } = require("../risk_engine/summary_generator");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
const {
  generateExecutiveReport,
  generateExecutiveHtmlReport,
  validateReportTraceability,
} = require("../services/executive_report_service");
const {
  generateTechnicalDrillDownReport,
  generateTechnicalHtmlReport,
  validateTechnicalReportCompleteness,
} = require("../services/technical_report_service");
const {
  buildEvidenceIntegrity,
  validateEvidenceIntegrity,
  ECDAT_VERSION,
  DEFAULT_SCANNER_VERSIONS,
} = require("../services/evidence_integrity_service");

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
 * GET /api/v1/reports/executive
 * Generates the comprehensive executive cryptographic risk report covering all 9 required domains
 * with 100% evidence traceability.
 */
router.get("/executive", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const policyProfile = req.query.policyProfile || req.query.policy_profile || "regulated_bfsi";
    const scenario = req.query.scenario || "baseline";
    const scope = req.query.scope || "enterprise";

    const report = await generateExecutiveReport({
      scanId,
      policyProfile,
      scenario,
      scope,
    });

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.EXPORT,
      action: AUDIT_ACTIONS.EXPORT_REPORT,
      actor: {
        id: req.auth?.role || "user",
        username: req.headers["x-actor-username"] || req.auth?.role || "user",
        role: req.auth?.role || "user",
        ipAddress: req.ip,
      },
      tenantId: req.tenantContext?.tenantId || "default",
      target: report.report_metadata.report_id,
      status: AUDIT_STATUSES.SUCCESS,
      details: { format: "json", scanId: report.report_metadata.scan_id },
    }).catch(() => {});

    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/executive/html
 * Serves the standalone, presentation-ready executive HTML report with dark mode, KPIs, and evidence drill-down.
 */
router.get("/executive/html", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const policyProfile = req.query.policyProfile || req.query.policy_profile || "regulated_bfsi";
    const scenario = req.query.scenario || "baseline";

    const report = await generateExecutiveReport({
      scanId,
      policyProfile,
      scenario,
    });

    const html = generateExecutiveHtmlReport(report);

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.EXPORT,
      action: AUDIT_ACTIONS.EXPORT_REPORT,
      actor: {
        id: req.auth?.role || "user",
        username: req.headers["x-actor-username"] || req.auth?.role || "user",
        role: req.auth?.role || "user",
        ipAddress: req.ip,
      },
      tenantId: req.tenantContext?.tenantId || "default",
      target: report.report_metadata.report_id,
      status: AUDIT_STATUSES.SUCCESS,
      details: { format: "html", scanId: report.report_metadata.scan_id },
    }).catch(() => {});

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/executive/export
 * Downloads the executive report JSON as an attachment with digital signature metadata.
 */
router.get("/executive/export", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const report = await generateExecutiveReport({ scanId });
    const filename = `ecdat_executive_report_${report.report_metadata.scan_id}.json`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(JSON.stringify(report, null, 2));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/technical
 * Generates the granular, developer-grade technical drill-down report across all 12 dimensions:
 * location, scanner, confidence, evidence, algorithm, parameters, dependency, certificate,
 * network endpoint, runtime evidence, risk, and remediation.
 */
router.get("/technical", async (req, res, next) => {
  try {
    const { scanId, severity, algorithm, limit, offset } = req.query;
    const report = await generateTechnicalDrillDownReport({
      scanId,
      severity,
      algorithm,
      limit,
      offset,
    });

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.EXPORT,
      action: AUDIT_ACTIONS.EXPORT_REPORT,
      actor: {
        id: req.auth?.role || "user",
        username: req.headers["x-actor-username"] || req.auth?.role || "user",
        role: req.auth?.role || "user",
        ipAddress: req.ip,
      },
      tenantId: req.tenantContext?.tenantId || "default",
      target: report.metadata.report_id,
      status: AUDIT_STATUSES.SUCCESS,
      details: { format: "json_technical", total: report.metadata.total_findings },
    }).catch(() => {});

    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/technical/html
 * Serves the interactive standalone HTML technical report with code syntax and patch diffs.
 */
router.get("/technical/html", async (req, res, next) => {
  try {
    const { scanId, severity, algorithm, limit } = req.query;
    const report = await generateTechnicalDrillDownReport({
      scanId,
      severity,
      algorithm,
      limit,
    });

    const html = generateTechnicalHtmlReport(report);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/technical/:findingId
 * Returns the deep 12-dimension drill-down details for a specific cryptographic finding.
 */
router.get("/technical/:findingId", async (req, res, next) => {
  try {
    const { findingId } = req.params;
    const { scanId } = req.query;

    const report = await generateTechnicalDrillDownReport({
      scanId,
      findingId,
    });

    if (report.findings.length === 0) {
      return res.status(404).json({
        error: "NotFound",
        message: `Finding '${findingId}' not found.`,
      });
    }

    res.status(200).json(report.findings[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/reports/integrity/verify
 * Validates the evidence integrity block, cryptographic hashes, and anti-misrepresentation disclaimer of an executive or technical report.
 */
router.post("/integrity/verify", async (req, res, next) => {
  try {
    let report = req.body.report;

    if (!report && req.body.scanId) {
      report = await generateExecutiveReport({ scanId: req.body.scanId });
    }

    if (!report) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Request must include either 'report' object or 'scanId' in request body.",
      });
    }

    const verdict = validateEvidenceIntegrity(report);

    res.status(verdict.passed ? 200 : 422).json({
      verified: verdict.passed,
      violations: verdict.violations,
      details: verdict.details,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/reports/integrity/status
 * Returns current system cryptographic baseline integrity parameters, scanner versions, and attestation status.
 */
router.get("/integrity/status", async (req, res, next) => {
  try {
    const sampleBlock = buildEvidenceIntegrity({});
    res.status(200).json({
      ecdat_version: ECDAT_VERSION,
      scanner_versions: DEFAULT_SCANNER_VERSIONS,
      configuration_hash: sampleBlock.configuration.config_hash_sha256,
      policy_hash: sampleBlock.policy_version.policy_hash_sha256,
      cbom_schema_version: sampleBlock.cbom_version.cbom_schema_version,
      independent_attestation: sampleBlock.independent_attestation,
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

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.EXPORT,
      action: AUDIT_ACTIONS.EXPORT_CBOM,
      actor: {
        id: req.auth?.role || "user",
        username: req.headers["x-actor-username"] || req.auth?.role || "user",
        role: req.auth?.role || "user",
        ipAddress: req.ip,
      },
      tenantId: req.tenantContext?.tenantId || "default",
      target: scanId,
      status: AUDIT_STATUSES.SUCCESS,
      details: { scanId, type },
    }).catch(() => {});

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

        defaultAuditService.logEvent({
          category: AUDIT_CATEGORIES.EXPORT,
          action: AUDIT_ACTIONS.EXPORT_REPORT,
          actor: {
            id: req.auth?.role || "user",
            username: req.headers["x-actor-username"] || req.auth?.role || "user",
            role: req.auth?.role || "user",
            ipAddress: req.ip,
          },
          tenantId: req.tenantContext?.tenantId || "default",
          target: req.params.id,
          status: AUDIT_STATUSES.SUCCESS,
          details: { scanId: req.params.id, format: "html" },
        }).catch(() => {});

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
