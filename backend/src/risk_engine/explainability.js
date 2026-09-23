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
  threatContext,
  quantumRelevance,
  matchedConditionNote,
  references,
}) {
  const lines = [];

  // Summary headline
  lines.push(`Asset evaluated as [${severity}] under '${policyProfileName}' profile for algorithm '${canonicalAlgorithm}'.\n`);

  // Technical Rationale Section
  lines.push(`[TECHNICAL RATIONALE]`);
  if (matchedConditionNote) {
    lines.push(`- Algorithmic Condition: ${matchedConditionNote}`);
  }
  if (threatContext) {
    lines.push(`- Threat Vector: ${threatContext}`);
  }
  if (quantumRelevance && quantumRelevance !== 'not_applicable') {
    lines.push(`- Quantum Susceptibility: ${quantumRelevance.toUpperCase().replace('_', ' ')}`);
  }
  if (references && references.length > 0) {
    lines.push(`- Regulatory Compliance: ${references.join(", ")}`);
  }

  // Policy Assessment
  if (policyViolations && policyViolations.length > 0) {
    lines.push(`\n[POLICY ASSESSMENT]`);
    lines.push(`- Violations: ${policyViolations.join("; ")}.`);
  }

  // Mosca Theorem (Quantum Risk Metrics)
  if (moscaResult) {
    lines.push(`\n[MOSCA THEOREM (QUANTUM RISK METRICS)]`);
    const { X_shelf_life_years: X, Y_migration_years: Y, Z_quantum_threat_years: Z } = moscaResult.final_values;
    lines.push(`- Status: ${moscaResult.status}`);
    lines.push(`- Variables: Data shelf-life X = ${X} yrs, Migration duration Y = ${Y} yrs, Threat horizon Z = ${Z} yrs`);
    lines.push(`- Formula: Total X+Y = ${moscaResult.mosca_total_years} yrs, Margin = ${moscaResult.mosca_margin_years} yrs`);
    lines.push(`- Conclusion: ${moscaResult.explanation}`);
  }

  // Recommendation highlight
  if (recommendation) {
    lines.push(`\n[REMEDIATION MANDATE]`);
    const complexity = recommendation.migration_complexity || recommendation.estimated_migration_complexity || "medium";
    const latencyImpact = recommendation.latency_impact || recommendation.latency_impact_category || "minor";
    lines.push(`- Target: ${recommendation.proposed_option || recommendation.recommended_target} (${recommendation.standard_reference || "NIST PQC"})`);
    lines.push(`- Impact Vectors: Complexity=${complexity}, Latency=${latencyImpact}`);
  }

  // Assumptions & Evidence
  if ((assumptions && assumptions.length > 0) || (evidenceUsed && evidenceUsed.length > 0)) {
    lines.push(`\n[ASSUMPTIONS & EVIDENCE]`);
    if (evidenceUsed && evidenceUsed.length > 0) {
      lines.push(`- Evidence: ${evidenceUsed.join(", ")}`);
    }
    if (assumptions && assumptions.length > 0) {
      lines.push(`- Scope: ${assumptions.join(" | ")}`);
    }
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
