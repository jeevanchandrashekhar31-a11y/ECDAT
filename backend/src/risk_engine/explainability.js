/**
 * Generates transparent, human-readable explanations for risk assessments.
 */

function buildExplanation({
  canonicalAlgorithm,
  severity,
  appliedRuleIds,
  evidenceUsed,
  assumptions,
  moscaResult,
  policyProfileName,
  policyViolations,
  recommendation,
}) {
  const lines = [];

  // Summary headline
  lines.push(
    `Asset evaluated as [${severity}] under '${policyProfileName}' profile for algorithm '${canonicalAlgorithm}'.`,
  );

  // Policy & Classical findings
  if (policyViolations && policyViolations.length > 0) {
    lines.push(`Policy Violations: ${policyViolations.join("; ")}.`);
  }

  // Mosca breakdown
  if (moscaResult) {
    const {
      X_shelf_life_years: X,
      Y_migration_years: Y,
      Z_quantum_threat_years: Z,
    } = moscaResult.final_values;
    lines.push(
      `Mosca Theorem Evaluation: Status = ${moscaResult.status} ` +
        `(Data shelf-life X = ${X} yrs, Migration duration Y = ${Y} yrs, Threat horizon Z = ${Z} yrs). ` +
        `Total X+Y = ${moscaResult.mosca_total_years} yrs, Margin = ${moscaResult.mosca_margin_years} yrs. ` +
        `${moscaResult.explanation}`,
    );
  }

  // Recommendation highlight
  if (recommendation) {
    const complexity =
      recommendation.migration_complexity ||
      recommendation.estimated_migration_complexity ||
      "medium";
    const latencyImpact =
      recommendation.latency_impact ||
      recommendation.latency_impact_category ||
      "minor";
    lines.push(
      `Recommended Action: ${recommendation.proposed_option || recommendation.recommended_target} (${recommendation.standard_reference || "NIST PQC"}). ` +
        `Complexity: ${complexity}, Latency impact: ${latencyImpact}.`,
    );
  }

  // Assumptions
  if (assumptions && assumptions.length > 0) {
    lines.push(`Assumptions: ${assumptions.join(" ")}`);
  }

  return {
    summary: lines.join("\n"),
    appliedRuleIds,
    evidenceUsed,
    assumptions,
    moscaInputs: moscaResult?.final_values || null,
    moscaMargin: moscaResult?.mosca_margin_years ?? null,
  };
}

module.exports = {
  buildExplanation,
};
