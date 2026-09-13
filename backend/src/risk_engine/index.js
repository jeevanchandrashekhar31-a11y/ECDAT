const { loadAndValidateAllRules, getRules } = require("./rules_loader");
const {
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
} = require("./normalizer");
const { calculateMosca } = require("./mosca_calculator");
const { classifyFinding, calculateMultiFactorRisk } = require("./classifier");
const { getRecommendationForFinding } = require("./recommendations");
const { buildExplanation } = require("./explainability");
const {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
  RiskConfidence,
  RemediationEffort,
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
        risk_severity: classified.risk_severity || classified.severity,
        risk_confidence: classified.risk_confidence || "HIGH",
        is_uncertain_detection: Boolean(classified.is_uncertain_detection),
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
      assetGroup.risk_severity = classified.risk_severity || classified.severity;
      assetGroup.risk_confidence = classified.risk_confidence || "HIGH";
      assetGroup.is_uncertain_detection = Boolean(classified.is_uncertain_detection);
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

  const confidenceCounts = {
    confirmed: 0,
    high: 0,
    medium: 0,
    low: 0,
    heuristic: 0,
  };

  const confidenceMatrix = {
    critical: { confirmed: 0, high: 0, medium: 0, low: 0, heuristic: 0 },
    high: { confirmed: 0, high: 0, medium: 0, low: 0, heuristic: 0 },
    medium: { confirmed: 0, high: 0, medium: 0, low: 0, heuristic: 0 },
    low: { confirmed: 0, high: 0, medium: 0, low: 0, heuristic: 0 },
    informational: { confirmed: 0, high: 0, medium: 0, low: 0, heuristic: 0 },
  };

  let uncertainFindingsCount = 0;

  for (const f of classifiedFindings) {
    const sevKey = (f.risk_severity || f.severity || "informational").toLowerCase();
    const confKey = (f.risk_confidence || "high").toLowerCase();

    if (severityCounts[sevKey] !== undefined) {
      severityCounts[sevKey]++;
    }
    if (confidenceCounts[confKey] !== undefined) {
      confidenceCounts[confKey]++;
    }
    if (confidenceMatrix[sevKey] && confidenceMatrix[sevKey][confKey] !== undefined) {
      confidenceMatrix[sevKey][confKey]++;
    }
    if (f.is_uncertain_detection) {
      uncertainFindingsCount++;
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
      confidence_counts: confidenceCounts,
      confidence_matrix: confidenceMatrix,
      uncertain_detections_count: uncertainFindingsCount,
      overall_cicd_pass: overallCicdPass,
    },
    assets: Array.from(assetMap.values()),
    findings: classifiedFindings,
    prioritization: prioritizeEnterpriseRisk(classifiedFindings, options),
    crypto_agility: calculateCryptoAgility(classifiedFindings, options.architectureMetadata || {}, options),
  };
}

const { annotateCbom } = require("./cbom_annotator");
const { generateSummary } = require("./summary_generator");
const { generateHtmlReport } = require("./html_reporter");
const { VALID_FAIL_ON, evaluateGate } = require("./gate");
const {
  prioritizeEnterpriseRisk,
  determineRemediationEffort,
  generateWhyNowReasoning,
} = require("./prioritizer");
const {
  calculateCryptoAgility,
  resolveMaturityTier,
} = require("./agility_evaluator");
const { AgilityDimensions, AgilityMaturityTiers } = require("./types");

module.exports = {
  loadAndValidateAllRules,
  getRules,
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
  calculateMosca,
  classifyFinding,
  calculateMultiFactorRisk,
  getRecommendationForFinding,
  buildExplanation,
  assessFindings,
  annotateCbom,
  generateSummary,
  generateHtmlReport,
  VALID_FAIL_ON,
  evaluateGate,
  prioritizeEnterpriseRisk,
  determineRemediationEffort,
  generateWhyNowReasoning,
  calculateCryptoAgility,
  resolveMaturityTier,
  AgilityDimensions,
  AgilityMaturityTiers,
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
  RiskConfidence,
  RemediationEffort,
};
