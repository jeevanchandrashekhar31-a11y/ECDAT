/**
 * Remediation Subsystem Boundary
 * Responsible for generating contextual Post-Quantum Cryptography (PQC)
 * and classical cryptographic migration roadmaps.
 */

const { getRecommendationForFinding } = require("../risk_engine/recommendations");
const { RemediationPlan, RemediationAction } = require("../domain/contracts");

/**
 * Builds a structured domain RemediationPlan from an array of classified findings.
 * @param {string} scanId
 * @param {Array<object>} findings
 * @returns {RemediationPlan}
 */
function buildRemediationPlan(scanId, findings = []) {
  const actions = [];
  let actionCounter = 1;

  for (const f of findings) {
    const rec = getRecommendationForFinding(f);
    if (!rec) continue;

    const action = new RemediationAction({
      actionId: `act_${scanId}_${actionCounter++}`,
      assetId: String(f.asset_id || f.bom_ref || "global"),
      priority: String(f.severity).toLowerCase() === "critical" ? 1 : String(f.severity).toLowerCase() === "high" ? 2 : 3,
      title: rec.action || `Remediate ${f.algorithm || "Cryptographic Asset"}`,
      description: rec.rationale || rec.classical_remediation || rec.pqc_migration || "",
      targetStandard: rec.target_algorithm || rec.target_standard || "Post-Quantum Standard",
      recommendedYear: rec.recommended_target_year || new Date().getFullYear(),
      effortEstimate: rec.migration_complexity || rec.estimated_effort || "medium",
    });

    actions.push(action);
  }

  return new RemediationPlan({
    planId: `plan_${scanId}`,
    scanId,
    totalActions: actions.length,
    actions,
  });
}

const {
  MigrationLifecyclePhases,
  identifyWhyRisky,
  identifyReplacementCandidates,
  identifyDependencies,
  identifyAffectedServices,
  estimateMigrationComplexity,
  identifyTestingRequirements,
  proposeStagedRollout,
  defineRollback,
  defineRescanVerification,
  planAssetMigration,
  createEnterpriseMigrationPlan,
} = require("./migration_planner");

module.exports = {
  buildRemediationPlan,
  getRecommendationForFinding,
  MigrationLifecyclePhases,
  identifyWhyRisky,
  identifyReplacementCandidates,
  identifyDependencies,
  identifyAffectedServices,
  estimateMigrationComplexity,
  identifyTestingRequirements,
  proposeStagedRollout,
  defineRollback,
  defineRescanVerification,
  planAssetMigration,
  createEnterpriseMigrationPlan,
};
