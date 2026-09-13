/**
 * Risk Assessment Subsystem Boundary
 * Responsible for multi-dimensional cryptographic risk evaluation:
 * classical vulnerability, quantum relevance (Shor/Grover), and Mosca collapse status.
 */

const { classifyFinding } = require("../risk_engine/classifier");
const { calculateMosca } = require("../risk_engine/mosca_calculator");
const { buildExplanation } = require("../risk_engine/explainability");
const {
  RiskAssessment,
  SeverityLevel,
  QuantumRelevance,
  MoscaStatus,
} = require("../domain/contracts");

/**
 * Assesses complete risk profile for a cryptographic finding under a policy profile.
 * @param {object} finding
 * @param {string} policyProfile
 * @param {object} customParams
 * @returns {RiskAssessment}
 */
function assessRisk(finding, policyProfile = "standard", customParams = {}) {
  const classified = classifyFinding(finding, policyProfile);
  const mosca = calculateMosca(finding, customParams);
  const explanation = buildExplanation({
    canonicalAlgorithm: classified.algorithm || finding.algorithm,
    severity: classified.severity,
    appliedRuleIds: classified.applied_rule_ids || [],
    evidenceUsed: finding.evidence || [],
    assumptions: finding.assumptions || [],
    moscaResult: mosca,
    policyProfileName: policyProfile,
    policyViolations: classified.policy_violations || [],
    recommendation: classified.recommendation,
  });

  const severityMap = {
    critical: SeverityLevel.CRITICAL,
    high: SeverityLevel.HIGH,
    medium: SeverityLevel.MEDIUM,
    low: SeverityLevel.LOW,
    informational: SeverityLevel.INFORMATIONAL,
    unclassified: SeverityLevel.UNCLASSIFIED,
  };

  const quantumMap = {
    shor_vulnerable: QuantumRelevance.SHOR_VULNERABLE,
    grover_sensitive: QuantumRelevance.GROVER_SENSITIVE,
    quantum_safe: QuantumRelevance.QUANTUM_SAFE,
    not_applicable: QuantumRelevance.NOT_APPLICABLE,
  };

  const moscaMap = {
    SAFE: MoscaStatus.SAFE,
    WATCH: MoscaStatus.WATCH,
    AT_RISK: MoscaStatus.AT_RISK,
    CRITICAL_URGENT: MoscaStatus.CRITICAL_URGENT,
  };

  return new RiskAssessment({
    classicalSeverity: severityMap[String(classified.severity).toLowerCase()] || SeverityLevel.INFORMATIONAL,
    classicalScore: Number(classified.risk_score) || 0.0,
    quantumRelevance: quantumMap[classified.quantum_relevance] || QuantumRelevance.NOT_APPLICABLE,
    groverSecurityMargin: classified.grover_security_margin || null,
    shorVulnerable: classified.quantum_relevance === "shor_vulnerable" || Boolean(classified.shor_vulnerable),
    moscaStatus: moscaMap[mosca.status] || MoscaStatus.SAFE,
    moscaCollapseYear: mosca.collapse_year || null,
    explainability: Array.isArray(explanation) ? explanation : [String(explanation)],
  });
}

module.exports = {
  assessRisk,
  classifyFinding,
  calculateMosca,
  buildExplanation,
};
