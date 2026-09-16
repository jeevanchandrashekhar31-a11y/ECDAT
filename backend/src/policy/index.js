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
function evaluatePolicy(
  findingsOrSummary = [],
  policyProfile = "standard",
  failOnThreshold = "none",
) {
  let summary = findingsOrSummary;

  if (Array.isArray(findingsOrSummary)) {
    const critical = findingsOrSummary.filter(
      (f) => String(f.severity).toLowerCase() === "critical",
    ).length;
    const high = findingsOrSummary.filter(
      (f) => String(f.severity).toLowerCase() === "high",
    ).length;
    const moscaRisk = findingsOrSummary.filter(
      (f) =>
        f.mosca?.status === "AT_RISK" ||
        f.mosca?.status === "CRITICAL_URGENT" ||
        f.mosca_status === "AT_RISK" ||
        f.mosca_status === "CRITICAL_URGENT",
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
    blockingReasons:
      gateResult.matched && gateResult.reason ? [gateResult.reason] : [],
    violatedRules: gateResult.counts || {},
  });
}

const { PolicyEngine, PolicyValidationError } = require("./policy_engine");
const {
  PolicySecurityController,
  PolicySecurityError,
} = require("./policy_security");

let defaultEngineInstance = null;
function getDefaultEngine() {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new PolicyEngine();
  }
  return defaultEngineInstance;
}

let defaultSecurityInstance = null;
function getDefaultSecurityController() {
  if (!defaultSecurityInstance) {
    defaultSecurityInstance = new PolicySecurityController();
  }
  return defaultSecurityInstance;
}

/**
 * High-level helper to evaluate assets, findings, or CBOM against a policy-as-code document.
 */
function evaluatePolicyAsCode(assetsOrCbom, context = {}, policy = null) {
  return getDefaultEngine().evaluate(assetsOrCbom, context, policy);
}

module.exports = {
  evaluatePolicy,
  evaluateGate,
  checkCiCdGate,
  getRules,
  PolicyEngine,
  PolicyValidationError,
  PolicySecurityController,
  PolicySecurityError,
  getDefaultEngine,
  getDefaultSecurityController,
  evaluatePolicyAsCode,
};
