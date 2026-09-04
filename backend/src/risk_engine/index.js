const { loadAndValidateAllRules, getRules } = require("./rules_loader");
const {
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
} = require("./normalizer");
const { calculateMosca } = require("./mosca_calculator");
const { classifyFinding } = require("./classifier");
const { getRecommendationForFinding } = require("./recommendations");
const { buildExplanation } = require("./explainability");
const {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
} = require("./types");

/**
 * Assesses an entire list of findings (e.g. from a CBOM or combined discovery scan),
 * evaluating each finding individually and grouping by asset identifier to avoid
 * double-counting risks in aggregated dashboard metrics.
 *
 * @param {Array<Object>} rawFindings - Array of raw findings
 * @param {Object} [options]
 * @param {string} [options.policyProfile='internal_enterprise']
 * @param {string} [options.scenario='baseline']
 */
function assessFindings(rawFindings = [], options = {}) {
  const policyProfile = options.policyProfile || "internal_enterprise";
  const scenario = options.scenario || "baseline";

  const classifiedFindings = [];
  const assetMap = new Map();

  for (const raw of rawFindings) {
    const classified = classifyFinding({
      ...raw,
      policyProfile,
      scenario,
    });

    const assetId =
      raw.assetId ||
      raw.bom_ref ||
      raw.host ||
      raw.file_path ||
      raw.target ||
      "global";
    classified.asset_id = assetId;

    classifiedFindings.push(classified);

    // Asset-level aggregation
    if (!assetMap.has(assetId)) {
      assetMap.set(assetId, {
        asset_id: assetId,
        highest_severity: classified.severity,
        findings: [],
        at_quantum_risk:
          classified.mosca?.status === MoscaStatus.AT_RISK ||
          classified.mosca?.status === MoscaStatus.CRITICAL_URGENT,
        cicd_pass: classified.cicd_pass,
      });
    }

    const assetGroup = assetMap.get(assetId);
    assetGroup.findings.push(classified);

    // Update highest severity on the asset
    const severityRank = {
      [Severities.CRITICAL]: 5,
      [Severities.HIGH]: 4,
      [Severities.MEDIUM]: 3,
      [Severities.LOW]: 2,
      [Severities.INFORMATIONAL]: 1,
      [Severities.UNCLASSIFIED]: 0,
    };

    if (
      severityRank[classified.severity] >
      severityRank[assetGroup.highest_severity]
    ) {
      assetGroup.highest_severity = classified.severity;
    }
    if (!classified.cicd_pass) {
      assetGroup.cicd_pass = false;
    }
    if (
      classified.mosca?.status === MoscaStatus.AT_RISK ||
      classified.mosca?.status === MoscaStatus.CRITICAL_URGENT
    ) {
      assetGroup.at_quantum_risk = true;
    }
  }

  // Aggregate metrics (deduplicated by asset where appropriate)
  const severityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };

  for (const f of classifiedFindings) {
    const key = f.severity.toLowerCase();
    if (severityCounts[key] !== undefined) {
      severityCounts[key]++;
    }
  }

  let overallCicdPass = true;
  let assetsAtQuantumRiskCount = 0;

  for (const asset of assetMap.values()) {
    if (!asset.cicd_pass) overallCicdPass = false;
    if (asset.at_quantum_risk) assetsAtQuantumRiskCount++;
  }

  return {
    policy_profile: policyProfile,
    scenario,
    metrics: {
      total_findings: classifiedFindings.length,
      total_assets: assetMap.size,
      assets_at_quantum_risk: assetsAtQuantumRiskCount,
      severity_counts: severityCounts,
      overall_cicd_pass: overallCicdPass,
    },
    assets: Array.from(assetMap.values()),
    findings: classifiedFindings,
  };
}

const { annotateCbom } = require("./cbom_annotator");
const { generateSummary } = require("./summary_generator");
const { generateHtmlReport } = require("./html_reporter");
const { VALID_FAIL_ON, evaluateGate } = require("./gate");

module.exports = {
  loadAndValidateAllRules,
  getRules,
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
  calculateMosca,
  classifyFinding,
  getRecommendationForFinding,
  buildExplanation,
  assessFindings,
  annotateCbom,
  generateSummary,
  generateHtmlReport,
  VALID_FAIL_ON,
  evaluateGate,
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
};
