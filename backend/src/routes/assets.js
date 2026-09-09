const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");

const router = express.Router();

/**
 * GET /api/v1/assets
 * Lists aggregated assets with robust filtering, stable sorting, and safe pagination.
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

    // Pagination bounds check
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize || req.query.limit, 10) || 25),
      100,
    );
    const offset =
      req.query.offset !== undefined
        ? parseInt(req.query.offset, 10)
        : (page - 1) * pageSize;

    const sortBy = req.query.sortBy || req.query.sort || "risk";

    const connected = await isDbConnected();
    if (connected) {
      try {
        // Resolve target scan_id if explicitly specified and not 'all'
        let targetScanId = scanId;
        if (targetScanId === 'all' || targetScanId === 'ALL') {
          targetScanId = null;
        }

        let query = db("assets")
          .join("scans", "assets.scan_id", "scans.id")
          .select(
            "assets.id as asset_id",
            "assets.scan_id",
            "assets.primary_identifier",
            "assets.asset_type",
            "assets.data_sensitivity",
            "assets.business_criticality",
            "assets.highest_severity",
            "assets.at_quantum_risk",
            "assets.cicd_pass",
            "assets.metadata",
            "assets.created_at as asset_created_at",
            "scans.scanner_type as source",
            "scans.policy_profile_id as policy_profile",
            "scans.created_at as scan_created_at",
          );

        if (targetScanId) {
          query = query.where("assets.scan_id", targetScanId);
        }

        if (severity) {
          query = query.whereRaw("LOWER(assets.highest_severity) = LOWER(?)", [
            severity,
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

        if (moscaStatus) {
          const upperMosca = String(moscaStatus).toUpperCase();
          if (upperMosca === "AT_RISK" || upperMosca === "CRITICAL_URGENT") {
            query = query.where("assets.at_quantum_risk", true);
          }
        }

        // Count total matching records
        const countQuery = query
          .clone()
          .clearSelect()
          .count("assets.id as count")
          .first();
        const totalResult = await countQuery;
        const total = parseInt(totalResult?.count || 0, 10);

        // Sorting
        if (sortBy === "name_asc") {
          query = query.orderBy("assets.primary_identifier", "asc");
        } else if (sortBy === "name_desc") {
          query = query.orderBy("assets.primary_identifier", "desc");
        } else if (sortBy === "date" || sortBy === "created_at") {
          query = query.orderBy("assets.created_at", "desc");
        } else {
          // Default risk & severity sorting
          query = query
            .orderByRaw(
              `
            CASE LOWER(assets.highest_severity)
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'medium' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC
          `,
            )
            .orderBy("assets.at_quantum_risk", "desc");
        }

        const rows = await query
          .orderBy("assets.id", "asc")
          .limit(pageSize)
          .offset(offset);

        const assets = rows.map((r) => {
          const meta =
            typeof r.metadata === "string"
              ? JSON.parse(r.metadata)
              : r.metadata || {};
          return {
            asset_id: r.asset_id,
            scan_id: r.scan_id,
            primary_identifier: r.primary_identifier,
            asset_type: r.asset_type,
            data_sensitivity: r.data_sensitivity,
            business_criticality: r.business_criticality,
            highest_severity: r.highest_severity,
            at_quantum_risk: r.at_quantum_risk,
            cicd_pass: r.cicd_pass,
            source: r.source,
            policy_profile: r.policy_profile,
            mosca_status:
              meta.mosca_status || (r.at_quantum_risk ? "AT_RISK" : "SAFE"),
            findings_count: meta.findings_count || 1,
            created_at:
              r.asset_created_at ||
              r.scan_created_at ||
              meta.created_at ||
              new Date().toISOString(),
          };
        });

        return res.status(200).json({
          scan_id: targetScanId || null,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1,
          assets,
        });
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for assets:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scan = scanId ? await getScanById(scanId) : getLatestScan();
    if (!scan) {
      return res.status(200).json({
        scan_id: null,
        total: 0,
        page: 1,
        pageSize,
        totalPages: 0,
        assets: [],
      });
    }

    let assets = scan.top_risky_assets || [];

    if (severity) {
      const targetSev = String(severity).toLowerCase();
      assets = assets.filter(
        (a) => (a.severity || "").toLowerCase() === targetSev,
      );
    }

    if (moscaStatus) {
      const targetM = String(moscaStatus).toUpperCase();
      assets = assets.filter(
        (a) => (a.mosca_status || "").toUpperCase() === targetM,
      );
    }

    if (assetType) {
      const targetType = String(assetType).toLowerCase();
      assets = assets.filter((a) =>
        (a.asset_type || "").toLowerCase().includes(targetType),
      );
    }

    if (source) {
      const targetSrc = String(source).toLowerCase();
      assets = assets.filter((a) =>
        (a.source || scan.scanner_type || "").toLowerCase().includes(targetSrc),
      );
    }

    if (dataSensitivity) {
      const targetSens = String(dataSensitivity).toLowerCase();
      assets = assets.filter(
        (a) => (a.data_sensitivity || "internal").toLowerCase() === targetSens,
      );
    }

    if (businessCriticality) {
      const targetCrit = String(businessCriticality).toLowerCase();
      assets = assets.filter(
        (a) =>
          (a.business_criticality || "medium").toLowerCase() === targetCrit,
      );
    }

    // Apply sorting
    if (sortBy === "name_asc") {
      assets.sort((a, b) =>
        (a.primary_identifier || a.asset_id).localeCompare(
          b.primary_identifier || b.asset_id,
        ),
      );
    } else if (sortBy === "name_desc") {
      assets.sort((a, b) =>
        (b.primary_identifier || b.asset_id).localeCompare(
          a.primary_identifier || a.asset_id,
        ),
      );
    } else if (sortBy === "findings_count") {
      assets.sort((a, b) => (b.findings_count || 1) - (a.findings_count || 1));
    }

    const total = assets.length;
    const paginated = assets.slice(offset, offset + pageSize).map((a) => ({
      asset_id: a.asset_id,
      scan_id: scan.id,
      primary_identifier: a.primary_identifier || a.asset_id,
      asset_type: a.asset_type || "cryptographic_asset",
      data_sensitivity: a.data_sensitivity || "internal",
      business_criticality: a.business_criticality || "medium",
      highest_severity: a.severity || a.highest_severity || "Informational",
      at_quantum_risk:
        a.at_quantum_risk ||
        a.mosca_status === "AT_RISK" ||
        a.mosca_status === "CRITICAL_URGENT",
      cicd_pass: a.cicd_pass !== false,
      source: a.source || scan.scanner_type || "static",
      policy_profile: scan.policy_profile || "default",
      mosca_status: a.mosca_status || "SAFE",
      findings_count: a.findings_count || 1,
      created_at: a.created_at || scan.created_at || new Date().toISOString(),
    }));

    res.status(200).json({
      scan_id: scan.id,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      assets: paginated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/assets/:assetId
 * Retrieves deep evidence, risks, Mosca calculation, and recommendations for a single asset.
 */
router.get("/:assetId", async (req, res, next) => {
  try {
    const rawAssetId = req.params.assetId;
    const targetId = decodeURIComponent(rawAssetId);
    const scanId = req.query.scanId || req.query.scan_id;

    const connected = await isDbConnected();
    if (connected) {
      try {
        let assetQuery = db("assets")
          .join("scans", "assets.scan_id", "scans.id")
          .where("assets.id", targetId)
          .select(
            "assets.*",
            "scans.target_name",
            "scans.policy_profile_id",
            "scans.scanner_type",
          );

        if (scanId) {
          assetQuery = assetQuery.andWhere("assets.scan_id", scanId);
        }

        const assetRow = await assetQuery
          .orderBy("assets.created_at", "desc")
          .first();

        if (assetRow) {
          const currentScanId = assetRow.scan_id;

          // 1. Evidence (Components & Findings)
          const findingsRows = await db("findings").where({
            scan_id: currentScanId,
            asset_id: targetId,
          });

          // 2. Risk Assessments
          const findingIds = findingsRows.map((f) => f.id);
          const riskRows = await db("risk_assessments").whereIn(
            "finding_id",
            findingIds,
          );

          // 3. Recommendations
          const recRows = await db("recommendations").whereIn(
            "finding_id",
            findingIds,
          );

          const meta =
            typeof assetRow.metadata === "string"
              ? JSON.parse(assetRow.metadata)
              : assetRow.metadata || {};

          // Format Mosca object
          const primaryRisk = riskRows[0] || {};
          const mosca = {
            status:
              primaryRisk.mosca_status ||
              meta.mosca_status ||
              (assetRow.at_quantum_risk ? "AT_RISK" : "SAFE"),
            margin_years: Number(
              primaryRisk.mosca_margin_years ?? meta.mosca_margin_years ?? 0,
            ),
            shelf_life_X: Number(
              primaryRisk.mosca_x_years ?? meta.mosca_x_years ?? 5,
            ),
            migration_time_Y: Number(
              primaryRisk.mosca_y_years ?? meta.mosca_y_years ?? 3,
            ),
            quantum_threat_Z: Number(
              primaryRisk.mosca_z_years ?? meta.mosca_z_years ?? 9,
            ),
            explanation:
              primaryRisk.explanation ||
              "Mosca calculation based on algorithm and sensitivity parameters.",
          };

          return res.status(200).json({
            asset_id: assetRow.id,
            scan_id: assetRow.scan_id,
            target_name: assetRow.target_name,
            primary_identifier: assetRow.primary_identifier,
            asset_type: assetRow.asset_type,
            data_sensitivity: assetRow.data_sensitivity,
            business_criticality: assetRow.business_criticality,
            highest_severity: assetRow.highest_severity,
            at_quantum_risk: assetRow.at_quantum_risk,
            cicd_pass: assetRow.cicd_pass,
            policy_profile: assetRow.policy_profile_id,
            evidence: findingsRows.map((f) => ({
              finding_id: f.id,
              component_id: f.component_id,
              algorithm: f.algorithm,
              key_size: f.key_size,
              category: f.category,
              confidence: f.confidence,
              location: f.location,
              line_number: f.line_number,
            })),
            risks: riskRows.map((r) => ({
              severity: r.severity,
              classical_risk: r.classical_risk,
              quantum_relevance: r.quantum_relevance,
              applied_rules:
                typeof r.applied_rules === "string"
                  ? JSON.parse(r.applied_rules)
                  : r.applied_rules,
              policy_violations:
                typeof r.policy_violations === "string"
                  ? JSON.parse(r.policy_violations)
                  : r.policy_violations,
              explanation: r.explanation,
            })),
            mosca,
            recommendations: recRows.map((rec) => ({
              priority: rec.priority,
              current_state: rec.current_state,
              recommended_target: rec.recommended_target,
              classical_remediation: rec.classical_remediation,
              pqc_migration: rec.pqc_migration,
              hybrid_transition_recommended: rec.hybrid_transition_recommended,
              migration_complexity: rec.migration_complexity,
              latency_impact: rec.latency_impact,
              bandwidth_impact: rec.bandwidth_impact,
              cost_category: rec.cost_category,
              rationale: rec.rationale,
            })),
          });
        }
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for asset detail:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scan = scanId ? await getScanById(scanId) : getLatestScan();
    if (!scan) {
      return res.status(404).json({
        error: "NotFound",
        message: "No scan data available.",
      });
    }

    const asset = (scan.top_risky_assets || []).find(
      (a) => a.asset_id === targetId || a.primary_identifier === targetId,
    );
    if (!asset) {
      return res.status(404).json({
        error: "NotFound",
        message: `Asset '${targetId}' not found in scan '${scan.id}'`,
      });
    }

    const assetFindings = (scan.classified_findings || []).filter(
      (f) => (f.asset_id || f.bom_ref) === targetId,
    );

    res.status(200).json({
      asset_id: asset.asset_id,
      scan_id: scan.id,
      primary_identifier: asset.asset_id,
      asset_type: asset.asset_type,
      data_sensitivity: asset.data_sensitivity || "internal",
      business_criticality: asset.business_criticality || "medium",
      highest_severity: asset.severity || "Informational",
      at_quantum_risk:
        asset.mosca_status === "AT_RISK" ||
        asset.mosca_status === "CRITICAL_URGENT",
      cicd_pass: asset.cicd_pass !== false,
      evidence: assetFindings.map((f) => ({
        algorithm: f.algorithm,
        key_size: f.key_size,
        confidence: f.confidence,
        location: f.file_path || f.location,
      })),
      risks: assetFindings.map((f) => ({
        severity: f.severity,
        classical_risk: f.classical_risk,
        quantum_relevance: f.quantum_relevance,
        explanation: f.explanation,
      })),
      mosca: {
        status: asset.mosca_status || "SAFE",
        margin_years: asset.mosca_margin_years || 0,
        explanation: "Mosca calculus evaluated via rules engine.",
      },
      recommendations: assetFindings
        .map((f) => f.recommendation)
        .filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
