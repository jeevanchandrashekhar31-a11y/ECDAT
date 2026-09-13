/**
 * Policy Evaluation Subsystem Boundary
 * Responsible for evaluating scan results against organizational policy profiles
 * and determining CI/CD quality gate pass/fail status.
 */

const { evaluateGate, checkCiCdGate } = require("../risk_engine/gate");
const { getRules } = require("../risk_engine/rules_loader");
const { PolicyEvaluation } = require("../domain/contracts");

/**
 * Evaluates findings or a summary object against an explicit policy profile and threshold.
 * @param {Array<object>|object} findingsOrSummary
 * @param {string} policyProfile
 * @param {string} failOnThreshold
 * @returns {PolicyEvaluation}
 */
function evaluatePolicy(findingsOrSummary = [], policyProfile = "standard", failOnThreshold = "none") {
  let summary = findingsOrSummary;

  if (Array.isArray(findingsOrSummary)) {
    const critical = findingsOrSummary.filter((f) => String(f.severity).toLowerCase() === "critical").length;
    const high = findingsOrSummary.filter((f) => String(f.severity).toLowerCase() === "high").length;
    const moscaRisk = findingsOrSummary.filter((f) =>
      f.mosca?.status === "AT_RISK" || f.mosca?.status === "CRITICAL_URGENT" ||
      f.mosca_status === "AT_RISK" || f.mosca_status === "CRITICAL_URGENT"
    ).length;

    summary = {
      metrics: {
        severity_counts: { critical, high },
        mosca_status_counts: { AT_RISK: moscaRisk },
      },
    };
  }

  const gateResult = evaluateGate(summary, failOnThreshold);

  return new PolicyEvaluation({
    policyProfile,
    failOnThreshold,
    passed: !gateResult.matched,
    blockingReasons: gateResult.matched && gateResult.reason ? [gateResult.reason] : [],
    violatedRules: gateResult.counts || {},
  });
}

module.exports = {
  evaluatePolicy,
  evaluateGate,
  checkCiCdGate,
  getRules,
};
