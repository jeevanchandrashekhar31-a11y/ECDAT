const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");

const router = express.Router();

/**
 * GET /api/v1/findings
 * Lists classified findings with parameterized filtering, stable sorting, and safe pagination.
 */
router.get("/", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const severity = req.query.severity;
    const moscaStatus = req.query.moscaStatus || req.query.mosca_status;
    const assetType = req.query.assetType || req.query.asset_type;
    const source = req.query.source || req.query.scanner_type;
    const dataSensitivity =
      req.query.dataSensitivity || req.query.data_sensitivity;
    const businessCriticality =
      req.query.businessCriticality || req.query.business_criticality;
    const policyProfile = req.query.policyProfile || req.query.policy_profile;
    const algorithm = req.query.algorithm;
    const classicalRisk = req.query.classicalRisk || req.query.classical_risk;
    const quantumRelevance =
      req.query.quantumRelevance || req.query.quantum_relevance;

    // Safe pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize || req.query.limit, 10) || 25),
      100,
    );
    const offset =
      req.query.offset !== undefined
        ? parseInt(req.query.offset, 10)
        : (page - 1) * pageSize;

    const connected = await isDbConnected();
    if (connected) {
      try {
        // Resolve target scan_id if explicitly specified and not 'all'
        let targetScanId = scanId;
        if (targetScanId === 'all' || targetScanId === 'ALL') {
          targetScanId = null;
        }

        let query = db("findings")
          .join(
            "risk_assessments",
            "findings.id",
            "risk_assessments.finding_id",
          )
          .leftJoin(
            "recommendations",
            "findings.id",
            "recommendations.finding_id",
          )
          .join("scans", "findings.scan_id", "scans.id")
          .leftJoin("assets", function () {
            this.on("findings.scan_id", "=", "assets.scan_id").andOn(
              "findings.asset_id",
              "=",
              "assets.id",
            );
          })
          .select(
            "findings.id",
            "findings.scan_id",
            "findings.component_id",
            "findings.asset_id",
            "findings.algorithm",
            "findings.key_size",
            "findings.category",
            "findings.finding_type",
            "findings.location",
            "findings.line_number",
            "findings.confidence",
            "risk_assessments.severity",
            "risk_assessments.classical_risk",
            "risk_assessments.quantum_relevance",
            "risk_assessments.mosca_status",
            "risk_assessments.mosca_margin_years",
            "risk_assessments.cicd_pass",
            "risk_assessments.explanation",
            "recommendations.recommended_target",
            "recommendations.pqc_migration",
            "recommendations.priority as recommendation_priority",
            "scans.scanner_type as source",
            "scans.policy_profile_id as policy_profile",
            "assets.asset_type",
            "assets.data_sensitivity",
            "assets.business_criticality",
          );

        const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
        const callerTenant = req.tenantContext?.tenantId;
        if (!isPlatformAdmin) {
          if (callerTenant) {
            query = query.where("scans.tenant_id", callerTenant);
          } else {
            query = query.whereRaw("1 = 0");
          }
        }

        if (targetScanId) {
          query = query.where("findings.scan_id", targetScanId);
        }

        if (severity) {
          query = query.whereRaw(
            "LOWER(risk_assessments.severity) = LOWER(?)",
            [severity],
          );
        }

        if (moscaStatus) {
          query = query.whereRaw(
            "UPPER(risk_assessments.mosca_status) = UPPER(?)",
            [moscaStatus],
          );
        }

        if (algorithm) {
          query = query.whereRaw("LOWER(findings.algorithm) LIKE LOWER(?)", [
            `%${algorithm}%`,
          ]);
        }

        if (assetType) {
          query = query.whereRaw("LOWER(assets.asset_type) LIKE LOWER(?)", [
            `%${assetType}%`,
          ]);
        }

        if (source) {
          const srcLower = String(source).toLowerCase();
          if (srcLower === 'static' || srcLower === 'code') {
            query = query.whereRaw("(LOWER(scans.scanner_type) LIKE '%code%' OR LOWER(scans.scanner_type) LIKE '%static%')");
          } else if (srcLower === 'binary' || srcLower === 'container') {
            query = query.whereRaw("(LOWER(scans.scanner_type) LIKE '%binary%' OR LOWER(scans.scanner_type) LIKE '%container%')");
          } else {
            query = query.whereRaw("LOWER(scans.scanner_type) LIKE LOWER(?)", [
              `%${source}%`,
            ]);
          }
        }

        if (dataSensitivity) {
          query = query.whereRaw("LOWER(assets.data_sensitivity) = LOWER(?)", [
            dataSensitivity,
          ]);
        }

        if (businessCriticality) {
          query = query.whereRaw(
            "LOWER(assets.business_criticality) = LOWER(?)",
            [businessCriticality],
          );
        }

        if (policyProfile) {
          query = query.whereRaw("LOWER(scans.policy_profile_id) = LOWER(?)", [
            policyProfile,
          ]);
        }

        if (classicalRisk) {
          query = query.whereRaw(
            "LOWER(risk_assessments.classical_risk) = LOWER(?)",
            [classicalRisk],
          );
        }

        if (quantumRelevance) {
          query = query.whereRaw(
            "LOWER(risk_assessments.quantum_relevance) = LOWER(?)",
            [quantumRelevance],
          );
        }

        // Count total matching
        const countQuery = query
          .clone()
          .clearSelect()
          .count("findings.id as count")
          .first();
        const totalResult = await countQuery;
        const total = parseInt(totalResult?.count || 0, 10);

        // Stable sorting & pagination
        const rows = await query
          .orderByRaw(
            `
            CASE LOWER(risk_assessments.severity)
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC
          `,
          )
          .orderBy("findings.id", "asc")
          .limit(pageSize)
          .offset(offset);

        return res.status(200).json({
          scan_id: targetScanId || null,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1,
          findings: rows.map((r) => ({
            id: r.id,
            scan_id: r.scan_id,
            component_id: r.component_id,
            asset_id: r.asset_id,
            algorithm: r.algorithm,
            key_size: r.key_size,
            category: r.category,
            finding_type: r.finding_type,
            location: r.location,
            line_number: r.line_number,
            confidence: r.confidence,
            severity: r.severity,
            classical_risk: r.classical_risk,
            quantum_relevance: r.quantum_relevance,
            mosca_status: r.mosca_status,
            mosca_margin_years: Number(r.mosca_margin_years || 0),
            cicd_pass: r.cicd_pass,
            explanation: r.explanation,
            recommendation_target: r.recommended_target,
            pqc_migration: r.pqc_migration,
            recommendation_priority: r.recommendation_priority,
            source: r.source,
            policy_profile: r.policy_profile,
            asset_type: r.asset_type,
            data_sensitivity: r.data_sensitivity,
            business_criticality: r.business_criticality,
          })),
        });
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for findings:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scan = scanId ? await getScanById(scanId, req.tenantContext) : getLatestScan(req.tenantContext);
    if (!scan) {
      return res.status(200).json({
        scan_id: null,
        total: 0,
        page: 1,
        pageSize,
        totalPages: 0,
        findings: [],
      });
    }

    let findings = scan.classified_findings || [];

    if (severity) {
      const targetSev = String(severity).toLowerCase();
      findings = findings.filter(
        (f) => (f.severity || "").toLowerCase() === targetSev,
      );
    }

    if (moscaStatus) {
      const targetMosca = String(moscaStatus).toUpperCase();
      findings = findings.filter((f) => f.mosca?.status === targetMosca);
    }

    if (algorithm) {
      const targetAlg = String(algorithm).toLowerCase();
      findings = findings.filter((f) =>
        (f.algorithm || "").toLowerCase().includes(targetAlg),
      );
    }

    if (assetType) {
      const targetType = String(assetType).toLowerCase();
      findings = findings.filter((f) =>
        (f.asset_type || "").toLowerCase().includes(targetType),
      );
    }

    if (classicalRisk) {
      const targetRisk = String(classicalRisk).toLowerCase();
      findings = findings.filter(
        (f) => (f.classical_risk || "").toLowerCase() === targetRisk,
      );
    }

    if (quantumRelevance) {
      const targetQ = String(quantumRelevance).toLowerCase();
      findings = findings.filter(
        (f) => (f.quantum_relevance || "").toLowerCase() === targetQ,
      );
    }

    const total = findings.length;
    const paginated = findings.slice(offset, offset + pageSize);

    res.status(200).json({
      scan_id: scan.id,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      findings: paginated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/findings/:findingId
 * Retrieves detailed finding evidence, risk analysis, and recommendation without secret leaks.
 */
router.get("/:findingId", async (req, res, next) => {
  try {
    const rawFindingId = req.params.findingId;
    const findingId = decodeURIComponent(rawFindingId);

    const connected = await isDbConnected();
    if (connected) {
      try {
        let findingQuery = db("findings")
          .join("scans", "findings.scan_id", "scans.id")
          .join(
            "risk_assessments",
            "findings.id",
            "risk_assessments.finding_id",
          )
          .leftJoin(
            "recommendations",
            "findings.id",
            "recommendations.finding_id",
          )
          .leftJoin("assets", function () {
            this.on("findings.scan_id", "=", "assets.scan_id").andOn(
              "findings.asset_id",
              "=",
              "assets.id",
            );
          })
          .where("findings.id", findingId);

        const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
        const callerTenant = req.tenantContext?.tenantId;
        if (!isPlatformAdmin) {
          if (callerTenant) {
            findingQuery = findingQuery.andWhere("scans.tenant_id", callerTenant);
          } else {
            findingQuery = findingQuery.whereRaw("1 = 0");
          }
        }

        const findingRow = await findingQuery
          .select(
            "findings.*",
            "risk_assessments.severity",
            "risk_assessments.classical_risk",
            "risk_assessments.quantum_relevance",
            "risk_assessments.mosca_status",
            "risk_assessments.mosca_x_years",
            "risk_assessments.mosca_y_years",
            "risk_assessments.mosca_z_years",
            "risk_assessments.mosca_margin_years",
            "risk_assessments.cicd_pass",
            "risk_assessments.applied_rules",
            "risk_assessments.policy_violations",
            "risk_assessments.explanation",
            "recommendations.priority as rec_priority",
            "recommendations.current_state",
            "recommendations.recommended_target",
            "recommendations.classical_remediation",
            "recommendations.pqc_migration",
            "recommendations.hybrid_transition_recommended",
            "recommendations.migration_complexity",
            "recommendations.latency_impact",
            "recommendations.bandwidth_impact",
            "recommendations.cost_category",
            "recommendations.rationale",
            "scans.target_name",
            "scans.policy_profile_id",
            "scans.scanner_type",
            "assets.primary_identifier",
            "assets.asset_type",
            "assets.data_sensitivity",
            "assets.business_criticality",
          )
          .first();

        if (findingRow) {
          return res.status(200).json({
            finding_id: findingRow.id,
            scan_id: findingRow.scan_id,
            target_name: findingRow.target_name,
            policy_profile: findingRow.policy_profile_id,
            component_id: findingRow.component_id,
            asset_id: findingRow.asset_id,
            algorithm: findingRow.algorithm,
            key_size: findingRow.key_size,
            category: findingRow.category,
            confidence: findingRow.confidence,
            location: findingRow.location,
            line_number: findingRow.line_number,
            risk_assessment: {
              severity: findingRow.severity,
              classical_risk: findingRow.classical_risk,
              quantum_relevance: findingRow.quantum_relevance,
              mosca_status: findingRow.mosca_status,
              mosca_x_years: Number(findingRow.mosca_x_years || 0),
              mosca_y_years: Number(findingRow.mosca_y_years || 0),
              mosca_z_years: Number(findingRow.mosca_z_years || 0),
              mosca_margin_years: Number(findingRow.mosca_margin_years || 0),
              cicd_pass: findingRow.cicd_pass,
              applied_rules:
                typeof findingRow.applied_rules === "string"
                  ? JSON.parse(findingRow.applied_rules)
                  : findingRow.applied_rules,
              policy_violations:
                typeof findingRow.policy_violations === "string"
                  ? JSON.parse(findingRow.policy_violations)
                  : findingRow.policy_violations,
              explanation: findingRow.explanation,
            },
            recommendation: findingRow.recommended_target
              ? {
                  priority: findingRow.rec_priority,
                  current_state: findingRow.current_state,
                  recommended_target: findingRow.recommended_target,
                  classical_remediation: findingRow.classical_remediation,
                  pqc_migration: findingRow.pqc_migration,
                  hybrid_transition_recommended:
                    findingRow.hybrid_transition_recommended,
                  migration_complexity: findingRow.migration_complexity,
                  latency_impact: findingRow.latency_impact,
                  bandwidth_impact: findingRow.bandwidth_impact,
                  cost_category: findingRow.cost_category,
                  rationale: findingRow.rationale,
                }
              : null,
            asset_context: {
              primary_identifier: findingRow.primary_identifier,
              asset_type: findingRow.asset_type,
              data_sensitivity: findingRow.data_sensitivity,
              business_criticality: findingRow.business_criticality,
            },
          });
        }
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for finding detail:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scanId = req.query.scanId || req.query.scan_id;
    const scan = scanId ? await getScanById(scanId, req.tenantContext) : getLatestScan(req.tenantContext);
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: "No scan data available.",
      });
    }

    const finding = (scan.classified_findings || []).find(
      (f) => (f.bom_ref || f.id) === findingId || f.id === findingId,
    );
    if (!finding) {
      return res.status(404).json({
        error: "NotFound",
        message: `Finding '${findingId}' not found.`,
      });
    }

    res.status(200).json({
      finding_id: finding.id || finding.bom_ref,
      scan_id: scan.id,
      algorithm: finding.algorithm,
      key_size: finding.key_size,
      confidence: finding.confidence,
      location: finding.file_path || finding.location,
      risk_assessment: {
        severity: finding.severity,
        classical_risk: finding.classical_risk,
        quantum_relevance: finding.quantum_relevance,
        mosca_status: finding.mosca?.status || "SAFE",
        explanation: finding.explanation,
      },
      recommendation: finding.recommendation || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/findings/:id/suppress
 * Suppresses a finding with tenant boundary checks.
 */
router.post("/:id/suppress", async (req, res, next) => {
  try {
    const findingId = req.params.id;
    const { reason = "Risk accepted" } = req.body || {};
    const isPlatformAdmin = req.tenantContext?.isPlatformAdmin || false;
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    // 1. Check all in-memory scans to see if finding exists in any tenant
    let targetScan = null;
    let finding = null;

    for (const s of require("../services/cbom_ingestion").cbomIngestionService._scans.values()) {
      const f = (s.classified_findings || []).find(
        (x) => (x.bom_ref || x.id) === findingId || x.id === findingId
      );
      if (f) {
        finding = f;
        targetScan = s;
        break;
      }
    }

    // 2. Check DB
    const connected = await isDbConnected();
    if (connected && !finding) {
      try {
        const row = await db("findings")
          .join("scans", "findings.scan_id", "scans.id")
          .where("findings.id", findingId)
          .select("findings.id", "scans.tenant_id")
          .first();
        if (row) {
          finding = row;
          targetScan = { tenantId: row.tenant_id };
        }
      } catch (_err) {}
    }

    if (!targetScan || !finding) {
      return res.status(404).json({ error: "NotFound", message: `Finding '${findingId}' not found.` });
    }

    const findingTenant = targetScan.tenantId || "default-tenant";
    if (!isPlatformAdmin && findingTenant !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot modify finding belonging to tenant '${findingTenant}'`,
      });
    }

    finding.suppressed = true;
    finding.suppressionReason = reason;

    return res.json({ success: true, findingId, suppressed: true, reason });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/findings/:id
 * Deletes a finding verifying caller's tenant boundary.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const findingId = req.params.id;
    const isPlatformAdmin = req.tenantContext?.isPlatformAdmin || false;
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    // 1. Search in-memory scans
    let targetScan = null;
    let findingIdx = -1;

    for (const s of require("../services/cbom_ingestion").cbomIngestionService._scans.values()) {
      const idx = (s.classified_findings || []).findIndex(
        (x) => (x.bom_ref || x.id) === findingId || x.id === findingId
      );
      if (idx !== -1) {
        findingIdx = idx;
        targetScan = s;
        break;
      }
    }

    // 2. Search database
    const connected = await isDbConnected();
    let dbFindingRow = null;
    if (connected && findingIdx === -1) {
      try {
        dbFindingRow = await db("findings")
          .join("scans", "findings.scan_id", "scans.id")
          .where("findings.id", findingId)
          .select("findings.id", "scans.tenant_id")
          .first();
        if (dbFindingRow) {
          targetScan = { tenantId: dbFindingRow.tenant_id };
        }
      } catch (_err) {}
    }

    if (!targetScan || (findingIdx === -1 && !dbFindingRow)) {
      return res.status(404).json({ error: "NotFound", message: `Finding '${findingId}' not found.` });
    }

    const findingTenant = targetScan.tenantId || "default-tenant";
    if (!isPlatformAdmin && findingTenant !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot delete finding belonging to tenant '${findingTenant}'`,
      });
    }

    if (findingIdx !== -1 && targetScan.classified_findings) {
      targetScan.classified_findings.splice(findingIdx, 1);
    }
    if (connected && dbFindingRow) {
      await db("findings").where({ id: dbFindingRow.id }).del().catch(() => {});
    }

    return res.json({ success: true, message: `Finding '${findingId}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
