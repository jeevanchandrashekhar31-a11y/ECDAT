const express = require("express");
const { getScanById, getLatestScan } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");
const { getRules, calculateMosca } = require("../risk_engine");
const { getEnterpriseDashboardViews } = require("../services/dashboard_views_service");

const router = express.Router();

/**
 * GET /api/v1/dashboard/views
 * Enterprise dashboard endpoint returning all 13 specialized views with deep evidence links.
 */
router.get("/views", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const policyProfile = req.query.policyProfile || req.query.policy_profile;
    const scenario = req.query.scenario;
    const data = await getEnterpriseDashboardViews({
      scanId,
      policyProfile,
      scenario,
      tenantContext: req.tenantContext,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

const { buildCryptoRelationshipGraph } = require("../services/crypto_graph_service");

/**
 * GET /api/v1/dashboard/graph
 * Interactive relationship visualization endpoint:
 * Application -> Service -> Certificate -> Protocol -> Algorithm -> Data
 */
router.get("/graph", async (req, res, next) => {
  try {
    const filters = {
      scanId: req.query.scanId || req.query.scan_id,
      severity: req.query.severity,
      owner: req.query.owner,
      environment: req.query.environment,
      algorithm: req.query.algorithm,
      pqcReadiness: req.query.pqcReadiness || req.query.pqc_readiness,
      exposure: req.query.exposure,
      search: req.query.search || req.query.q,
    };
    const data = await buildCryptoRelationshipGraph(filters, req.tenantContext);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/dashboard/summary
 * Returns executive metrics, severity distribution, Mosca status breakdown,
 * top risky assets, findings by source, risk trend, common algorithms,
 * and PQC recommendations for frontend dashboards.
 */
router.get("/summary", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;
    const policyProfile = req.query.policyProfile || req.query.policy_profile;
    const requestedScenario = req.query.scenario
      ? String(req.query.scenario).toLowerCase()
      : null;
    const rules = getRules();
    const ruleVersion = rules?.algorithm_risk?.version || "2026.1";

    const connected = await isDbConnected();
    if (connected) {
      try {
        let scanQuery = db("scans").select("*");
        if (scanId && scanId !== "all" && scanId !== "ALL") {
          scanQuery = scanQuery.where("id", scanId);
        }
        if (policyProfile) {
          scanQuery = scanQuery.whereRaw(
            "LOWER(policy_profile_id) = LOWER(?)",
            [policyProfile],
          );
        }

        const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
        const callerTenant = req.tenantContext?.tenantId;
        if (!isPlatformAdmin) {
          if (callerTenant) {
            scanQuery = scanQuery.where("tenant_id", callerTenant);
          } else {
            scanQuery = scanQuery.whereRaw("1 = 0");
          }
        }

        const scanRow = await scanQuery.orderBy("created_at", "desc").first();

        if (scanRow) {
          const currentScanId = scanRow.id;
          const activeScenario =
            requestedScenario || scanRow.scenario || "baseline";

          // 1. Top Risky Assets
          let assetQuery = db("assets")
            .where("scan_id", currentScanId);
            
          if (currentScanId !== "demo-synthetic-scan") {
            assetQuery = assetQuery.where("is_synthetic", false);
          }

          const assetRows = await assetQuery
            .orderByRaw(
              `
              CASE LOWER(highest_severity)
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
              END ASC
            `,
            )
            .limit(10);

          const topRiskyAssets = assetRows.map((a) => {
            const meta =
              typeof a.metadata === "string"
                ? JSON.parse(a.metadata)
                : a.metadata || {};
            let mStatus = meta.mosca_status || (a.at_quantum_risk ? "AT_RISK" : "SAFE");
            let mMargin = meta.mosca_margin_years ?? (mStatus === "AT_RISK" ? 1.0 : 0.0);

            // Recalculate Mosca if scenario overridden
            if (requestedScenario && requestedScenario !== scanRow.scenario) {
              const recalc = calculateMosca({
                assetType: a.asset_type,
                dataSensitivity: a.data_sensitivity,
                businessCriticality: a.business_criticality,
                scenario: requestedScenario,
              });
              mStatus = recalc.status;
              mMargin = recalc.mosca_margin_years;
            }

            return {
              asset_id: a.id,
              primary_identifier: a.primary_identifier,
              asset_type: a.asset_type,
              data_sensitivity: a.data_sensitivity,
              business_criticality: a.business_criticality,
              severity: a.highest_severity,
              at_quantum_risk:
                mStatus === "AT_RISK" || mStatus === "CRITICAL_URGENT",
              cicd_pass: a.cicd_pass,
              mosca_status: mStatus,
              mosca_margin_years: mMargin,
            };
          });

          // 2. Mosca Status Counts
          const moscaCounts = {
            SAFE: 0,
            WATCH: 0,
            AT_RISK: 0,
            CRITICAL_URGENT: 0,
          };
          if (requestedScenario && requestedScenario !== scanRow.scenario) {
            // Recount based on evaluated assets
            for (const a of topRiskyAssets) {
              if (moscaCounts[a.mosca_status] !== undefined) {
                moscaCounts[a.mosca_status]++;
              }
            }
          } else {
            const moscaRows = await db("risk_assessments")
              .where("scan_id", currentScanId)
              .select("mosca_status")
              .count("id as count")
              .groupBy("mosca_status");

            for (const row of moscaRows) {
              const statusKey = String(row.mosca_status).toUpperCase();
              if (moscaCounts[statusKey] !== undefined) {
                moscaCounts[statusKey] = parseInt(row.count, 10);
              }
            }
          }

          // 3. Top Recommendations
          const allRecRows = await db("recommendations")
            .where("scan_id", currentScanId)
            .orderByRaw(
              `
              CASE LOWER(priority)
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                ELSE 4
              END ASC
            `,
            );
            
          const recRows = [];
          const seenRecs = new Set();
          for (const r of allRecRows) {
            const key = `${r.current_state}|${r.recommended_target}`;
            if (!seenRecs.has(key)) {
              seenRecs.add(key);
              recRows.push(r);
              if (recRows.length >= 10) break;
            }
          }

          // 4. Mosca Analysis Table
          const raRows = await db("risk_assessments")
            .join("findings", "risk_assessments.finding_id", "findings.id")
            .where("risk_assessments.scan_id", currentScanId)
            .select(
              "findings.asset_id",
              "findings.algorithm",
              "risk_assessments.mosca_x_years",
              "risk_assessments.mosca_y_years",
              "risk_assessments.mosca_z_years",
              "risk_assessments.mosca_margin_years",
              "risk_assessments.mosca_status",
            )
            .limit(20);

          const moscaAnalysisTable = raRows.map((r) => {
            let zYears = Number(r.mosca_z_years || 9);
            let marginYears = Number(r.mosca_margin_years || 0);
            let status = r.mosca_status;

            if (requestedScenario && requestedScenario !== scanRow.scenario) {
              const scenarioZ =
                rules?.mosca_config?.scenarios?.[requestedScenario]
                  ?.Z_quantum_threat_years;
              if (scenarioZ !== undefined) {
                zYears = scenarioZ;
                const sum =
                  Number(r.mosca_x_years || 0) + Number(r.mosca_y_years || 0);
                marginYears = sum - zYears;
                status =
                  marginYears > 2.5
                    ? "CRITICAL_URGENT"
                    : marginYears > 0
                      ? "AT_RISK"
                      : marginYears >= -2.0
                        ? "WATCH"
                        : "SAFE";
              }
            }

            return {
              asset_id: r.asset_id,
              algorithm: r.algorithm,
              X_shelf_life_years: Number(r.mosca_x_years || 0),
              Y_migration_years: Number(r.mosca_y_years || 0),
              Z_quantum_threat_years: zYears,
              mosca_sum_years:
                Number(r.mosca_x_years || 0) + Number(r.mosca_y_years || 0),
              mosca_margin_years: marginYears,
              mosca_status: status,
            };
          });

          // 5. Findings by Source
          const sourceRows = await db("findings")
            .where("scan_id", currentScanId)
            .select("finding_type", "location");

          const findingsBySource = {
            network: 0,
            static: 0,
            "binary-container": 0,
          };
          for (const s of sourceRows) {
            const rawType = String(s.finding_type || "").toLowerCase();
            const rawLoc = String(s.location || "").toLowerCase();
            if (
              rawType.includes("network") ||
              rawLoc.includes(":") ||
              rawType.includes("tls") ||
              rawType.includes("ssh")
            ) {
              findingsBySource.network++;
            } else if (
              rawType.includes("container") ||
              rawType.includes("binary") ||
              rawLoc.includes(".tar") ||
              rawLoc.includes("pkg:")
            ) {
              findingsBySource["binary-container"]++;
            } else {
              findingsBySource.static++;
            }
          }

          // 6. Most Common Risky Algorithms
          const algoRows = await db("findings")
            .where("scan_id", currentScanId)
            .select("algorithm")
            .count("id as count")
            .groupBy("algorithm")
            .orderBy("count", "desc")
            .limit(6);

          const mostCommonRiskyAlgorithms = algoRows.map((row) => ({
            algorithm: row.algorithm,
            count: parseInt(row.count, 10),
          }));

          // 7. Top Affected Services
          const serviceRows = await db("assets")
            .where("scan_id", currentScanId)
            .select("primary_identifier", "highest_severity", "asset_type")
            .orderByRaw(
              `
              CASE LOWER(highest_severity)
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
              END ASC
            `,
            )
            .limit(5);

          const topAffectedServices = serviceRows.map((row) => ({
            name: row.primary_identifier,
            severity: row.highest_severity,
            type: row.asset_type,
          }));

          // 8. Percentage of Asset Inventory with Unknown / Unclassified Posture
          const liveAssetsCountRow = await db("assets").where("scan_id", currentScanId).count("id as count").first();
          const totalAssets = parseInt(liveAssetsCountRow?.count || 0, 10);
          
          const liveFindingsCountRow = await db("findings").where("scan_id", currentScanId).count("id as count").first();
          const totalFindings = parseInt(liveFindingsCountRow?.count || 0, 10);
          const unclassifiedRows = await db("assets")
            .where("scan_id", currentScanId)
            .andWhere(function () {
              this.whereRaw("LOWER(highest_severity) = ?", [
                "informational",
              ]).orWhereRaw("LOWER(highest_severity) = ?", ["unknown"]);
            })
            .count("id as count")
            .first();
          const unclassifiedCount = parseInt(unclassifiedRows?.count || 0, 10);
          const unknownPosturePercentage =
            totalAssets > 0
              ? Number(((unclassifiedCount / totalAssets) * 100).toFixed(1))
              : 0;

          // 9. Historical Risk Trend (up to 6 recent scans scoped to caller's tenant)
          let trendQuery = db("scans")
            .select(
              "id",
              "target_name",
              "created_at",
              "critical_count",
              "high_count",
              "quantum_risk_count",
              "total_findings",
            );
          if (!isPlatformAdmin) {
            if (callerTenant) {
              trendQuery = trendQuery.where("tenant_id", callerTenant);
            } else {
              trendQuery = trendQuery.whereRaw("1 = 0");
            }
          }
          const trendRows = await trendQuery
            .orderBy("created_at", "asc")
            .limit(6);

          const riskTrend = trendRows.map((s) => ({
            scan_id: s.id,
            scan_name: s.target_name || s.id.slice(0, 8),
            date: new Date(s.created_at).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            }),
            critical: Number(s.critical_count || 0),
            high: Number(s.high_count || 0),
            quantum_risk: Number(s.quantum_risk_count || 0),
            total_findings: Number(s.total_findings || 0),
          }));

          return res.status(200).json({
            scan_id: scanRow.id,
            scan_name: scanRow.target_name,
            policy_profile: scanRow.policy_profile_id,
            scenario: activeScenario,
            rule_version: ruleVersion,
            created_at: scanRow.created_at,
            status: scanRow.status,
            metrics: {
              total_assets: totalAssets,
              total_findings: totalFindings,
              critical_findings: scanRow.critical_count,
              assets_at_quantum_risk:
                moscaCounts.AT_RISK + moscaCounts.CRITICAL_URGENT,
              assets_at_risk: moscaCounts.AT_RISK,
              assets_critical_urgent: moscaCounts.CRITICAL_URGENT,
              unknown_posture_percentage: unknownPosturePercentage,
              severity_counts: {
                critical: scanRow.critical_count,
                high: scanRow.high_count,
                medium: scanRow.medium_count,
                low: scanRow.low_count,
                informational: scanRow.info_count,
              },
              mosca_status_counts: moscaCounts,
              overall_cicd_pass: scanRow.cicd_pass,
            },
            findings_by_source: findingsBySource,
            most_common_risky_algorithms: mostCommonRiskyAlgorithms,
            top_affected_services: topAffectedServices,
            risk_trend: riskTrend,
            top_risky_assets: topRiskyAssets,
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
            mosca_analysis_table: moscaAnalysisTable,
            assumptions: [
              `Classical cryptography break follows standardized Mosca Theorem parameters under '${activeScenario}' scenario.`,
              "Migration timeline reflects estimated re-engineering, testing, and deployment overhead.",
              "Quantum computing horizon aligns with NIST Post-Quantum Cryptography transition guidance.",
            ],
          });
        } else {
          // Connected to DB and zero scans found in DB -> return zero metrics directly
          return res.status(200).json({
            scan_id: null,
            message: "No scans available. Zero mock data loaded.",
            policy_profile: policyProfile || "internal_enterprise",
            scenario: requestedScenario || "baseline",
            rule_version: ruleVersion,
            metrics: {
              total_assets: 0,
              total_findings: 0,
              critical_findings: 0,
              assets_at_quantum_risk: 0,
              assets_at_risk: 0,
              assets_critical_urgent: 0,
              unknown_posture_percentage: 0,
              severity_counts: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
                informational: 0,
              },
              mosca_status_counts: {
                SAFE: 0,
                WATCH: 0,
                AT_RISK: 0,
                CRITICAL_URGENT: 0,
              },
              overall_cicd_pass: true,
            },
            findings_by_source: { network: 0, static: 0, "binary-container": 0 },
            most_common_risky_algorithms: [],
            top_affected_services: [],
            risk_trend: [],
            top_risky_assets: [],
            recommendations: [],
            mosca_analysis_table: [],
          });
        }
      } catch (dbErr) {
        console.warn(
          "Database query fallback to in-memory for dashboard:",
          dbErr.message,
        );
      }
    }

    // In-memory fallback
    const scan = scanId ? await getScanById(scanId, req.tenantContext) : getLatestScan(req.tenantContext);

    if (!scan) {
      return res.status(200).json({
        scan_id: null,
        message: "No scans available. Please upload or ingest a CBOM first.",
        policy_profile: policyProfile || "internal_enterprise",
        scenario: requestedScenario || "baseline",
        rule_version: ruleVersion,
        metrics: {
          total_assets: 0,
          total_findings: 0,
          critical_findings: 0,
          assets_at_quantum_risk: 0,
          assets_at_risk: 0,
          assets_critical_urgent: 0,
          unknown_posture_percentage: 0,
          severity_counts: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            informational: 0,
          },
          mosca_status_counts: {
            SAFE: 0,
            WATCH: 0,
            AT_RISK: 0,
            CRITICAL_URGENT: 0,
          },
          overall_cicd_pass: true,
        },
        findings_by_source: { network: 0, static: 0, "binary-container": 0 },
        most_common_risky_algorithms: [],
        top_affected_services: [],
        risk_trend: [],
        top_risky_assets: [],
        recommendations: [],
        mosca_analysis_table: [],
      });
    }

    const activeScenario = requestedScenario || scan.scenario || "baseline";
    const rawFindings = scan.classified_findings || [];
    const findingsBySource = { network: 0, static: 0, "binary-container": 0 };
    const algoFreq = {};

    for (const f of rawFindings) {
      const src = String(f.source || "").toLowerCase();
      if (
        src.includes("network") ||
        src.includes("tls") ||
        src.includes("ssh")
      ) {
        findingsBySource.network++;
      } else if (
        src.includes("container") ||
        src.includes("binary") ||
        src.includes("syft")
      ) {
        findingsBySource["binary-container"]++;
      } else {
        findingsBySource.static++;
      }

      if (f.algorithm) {
        algoFreq[f.algorithm] = (algoFreq[f.algorithm] || 0) + 1;
      }
    }

    const mostCommonRiskyAlgorithms = Object.entries(algoFreq)
      .map(([algo, count]) => ({ algorithm: algo, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topAssets = scan.top_risky_assets || [];
    const topAffectedServices = topAssets.slice(0, 5).map((a) => ({
      name: a.primary_identifier || a.asset_id,
      severity: a.severity || "Informational",
      type: a.asset_type || "Unknown",
    }));

    const totalAssets = scan.metrics?.total_assets || topAssets.length || 0;
    const unclassifiedCount = topAssets.filter(
      (a) => String(a.severity).toLowerCase() === "informational",
    ).length;
    const unknownPosturePercentage =
      totalAssets > 0
        ? Number(((unclassifiedCount / totalAssets) * 100).toFixed(1))
        : 0;

    const riskTrend = [
      {
        scan_id: scan.id,
        scan_name: scan.name || "Current Scan",
        date: new Date(scan.created_at).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        }),
        critical: scan.metrics?.severity_counts?.critical || 0,
        high: scan.metrics?.severity_counts?.high || 0,
        quantum_risk: scan.metrics?.assets_at_quantum_risk || 0,
        total_findings: scan.metrics?.total_findings || 0,
      },
    ];

    const moscaCounts = scan.metrics?.mosca_status_counts || {
      SAFE: 0,
      WATCH: 0,
      AT_RISK: 0,
      CRITICAL_URGENT: 0,
    };

    res.status(200).json({
      scan_id: scan.id,
      scan_name: scan.name,
      policy_profile: scan.policy_profile,
      scenario: activeScenario,
      rule_version: ruleVersion,
      created_at: scan.created_at,
      metrics: {
        ...scan.metrics,
        critical_findings: scan.metrics?.severity_counts?.critical || 0,
        assets_at_risk: moscaCounts.AT_RISK || 0,
        assets_critical_urgent: moscaCounts.CRITICAL_URGENT || 0,
        unknown_posture_percentage: unknownPosturePercentage,
      },
      findings_by_source: findingsBySource,
      most_common_risky_algorithms: mostCommonRiskyAlgorithms,
      top_affected_services: topAffectedServices,
      risk_trend: riskTrend,
      top_risky_assets: scan.top_risky_assets || [],
      recommendations: scan.summary?.recommendations || [],
      mosca_analysis_table: scan.summary?.mosca_analysis_table || [],
      assumptions: scan.summary?.assumptions || [],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
