const { getRules } = require("./rules_loader");
const { annotateCbom } = require("./cbom_annotator");
const { Severities, MoscaStatus } = require("./types");

/**
 * Generates an executive summary JSON document tailored for frontends and audit reports.
 *
 * @param {Object} cbomData - CycloneDX 1.6 document
 * @param {Object} [options]
 * @param {string} [options.policyProfile='internal_enterprise']
 * @param {string} [options.scenario='baseline']
 * @returns {Object} Executive summary object
 */
function generateSummary(cbomData, options = {}) {
  const policyProfile = options.policyProfile || "internal_enterprise";
  const scenario = options.scenario || "baseline";
  const rules = getRules();
  const ruleVersion = rules.algorithm_risk?.version || "1.0.0";
  const profileConfig = rules.policy_profiles?.profiles?.[policyProfile] || {};

  const { annotatedBOM, classifiedResults } = annotateCbom(cbomData, {
    policyProfile,
    scenario,
  });

  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };

  const moscaStatusCounts = {
    [MoscaStatus.SAFE]: 0,
    [MoscaStatus.WATCH]: 0,
    [MoscaStatus.AT_RISK]: 0,
    [MoscaStatus.CRITICAL_URGENT]: 0,
  };

  const assetMap = new Map();
  const recommendationMap = new Map();
  const moscaAnalysisTable = [];
  const policyViolations = [];

  for (const item of classifiedResults) {
    // 1. Severity count
    const sevKey = item.severity.toLowerCase();
    if (severityCounts[sevKey] !== undefined) {
      severityCounts[sevKey]++;
    }

    // 2. Mosca count
    const mStatus = item.mosca?.status || MoscaStatus.SAFE;
    if (moscaStatusCounts[mStatus] !== undefined) {
      moscaStatusCounts[mStatus]++;
    }

    // 3. Asset grouping
    const assetId = item.bom_ref || item.algorithm;
    if (!assetMap.has(assetId)) {
      assetMap.set(assetId, {
        asset_id: assetId,
        algorithm: item.algorithm,
        key_size: item.key_size,
        asset_type: item.asset_type,
        severity: item.severity,
        mosca_status: mStatus,
        mosca_margin: item.mosca?.mosca_margin_years ?? null,
        cicd_pass: item.cicd_pass,
        explanation: item.explanation,
        recommendation: item.recommendation,
      });
    }

    // 4. Mosca table row
    if (item.mosca) {
      moscaAnalysisTable.push({
        asset_id: assetId,
        algorithm: item.algorithm,
        key_size: item.key_size,
        data_sensitivity: item.data_sensitivity,
        business_criticality: item.business_criticality,
        X_shelf_life_years: item.mosca.final_values.X_shelf_life_years,
        Y_migration_years: item.mosca.final_values.Y_migration_years,
        Z_threat_years: item.mosca.final_values.Z_quantum_threat_years,
        mosca_total_years: item.mosca.mosca_total_years,
        mosca_margin_years: item.mosca.mosca_margin_years,
        status: item.mosca.status,
        explanation: item.mosca.explanation,
      });
    }

    // 5. Deduplicated recommendations
    if (item.recommendation) {
      const recId =
        item.recommendation.recommendation_id ||
        item.recommendation.recommended_target;
      if (!recommendationMap.has(recId)) {
        recommendationMap.set(recId, {
          ...item.recommendation,
          affected_assets: [assetId],
        });
      } else {
        const existing = recommendationMap.get(recId);
        if (!existing.affected_assets.includes(assetId)) {
          existing.affected_assets.push(assetId);
        }
      }
    }

    // 6. Policy violations
    if (item.policy_violations && item.policy_violations.length > 0) {
      policyViolations.push({
        asset_id: assetId,
        violations: item.policy_violations,
      });
    }
  }

  // Determine top risky assets (ranked by severity then Mosca margin)
  const severityScore = {
    [Severities.CRITICAL]: 100,
    [Severities.HIGH]: 75,
    [Severities.MEDIUM]: 50,
    [Severities.LOW]: 25,
    [Severities.INFORMATIONAL]: 0,
  };

  const allAssets = Array.from(assetMap.values());
  allAssets.sort((a, b) => {
    const scoreA = severityScore[a.severity] || 0;
    const scoreB = severityScore[b.severity] || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.mosca_margin || 0) - (a.mosca_margin || 0);
  });

  const topRiskyAssets = allAssets.slice(0, 10);
  const overallCicdPass = allAssets.every((a) => a.cicd_pass);

  return {
    report_metadata: {
      generated_at: new Date().toISOString(),
      rule_version: ruleVersion,
      policy_profile: policyProfile,
      profile_description: profileConfig.description || "",
      scenario: scenario,
    },
    metrics: {
      total_assets: allAssets.length,
      total_findings: classifiedResults.length,
      assets_at_quantum_risk:
        moscaStatusCounts[MoscaStatus.AT_RISK] +
        moscaStatusCounts[MoscaStatus.CRITICAL_URGENT],
      severity_counts: severityCounts,
      mosca_status_counts: moscaStatusCounts,
      overall_cicd_pass: overallCicdPass,
    },
    top_risky_assets: topRiskyAssets,
    mosca_analysis_table: moscaAnalysisTable,
    recommendations: Array.from(recommendationMap.values()),
    policy_violations: policyViolations,
    assumptions: [
      `Assumed quantum threat timeline '${scenario}' (Z = ${rules.mosca_config?.scenarios?.[scenario]?.Z_quantum_threat_years || 9} years).`,
      `Evaluated under '${policyProfile}' policy environment constraints.`,
      `Qualitative performance impact bands applied; local hardware benchmarking disabled.`,
    ],
    annotated_bom: annotatedBOM,
  };
}

module.exports = {
  generateSummary,
};
