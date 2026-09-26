const { MoscaStatus, QuantumRelevance } = require("./types");

/**
 * Calculates Mosca's Theorem status for Quantum Readiness.
 * Formula:
 *   mosca_total = X + Y
 *   mosca_margin = (X + Y) - Z
 *
 * Status determination:
 *   If quantumRelevance !== SHOR_VULNERABLE -> SAFE
 *   If moscaMargin > 2.5 -> CRITICAL_URGENT
 *   If moscaMargin > 0 -> AT_RISK
 *   If moscaMargin >= -urgencyDeltaThreshold or (Z - moscaTotal <= 2.0) -> WATCH
 *   Else -> SAFE
 */
function evaluatePqcReadiness(X, Y, Z, quantumRelevance, urgencyDeltaThreshold = 0) {
  if (quantumRelevance !== QuantumRelevance.SHOR_VULNERABLE) {
    return {
      status: MoscaStatus.SAFE,
      moscaTotal: 0,
      moscaMargin: 0,
    };
  }

  // Round to 1 decimal place
  const finalX = Math.round(X * 10) / 10;
  const finalY = Math.round(Y * 10) / 10;
  const moscaTotal = Math.round((finalX + finalY) * 10) / 10;
  const moscaMargin = Math.round((moscaTotal - Z) * 10) / 10;

  let status = MoscaStatus.SAFE;

  if (moscaMargin > 2.5) {
    status = MoscaStatus.CRITICAL_URGENT;
  } else if (moscaMargin > 0) {
    status = MoscaStatus.AT_RISK;
  } else if (moscaMargin >= -Math.abs(urgencyDeltaThreshold) || Z - moscaTotal <= 2.0) {
    status = MoscaStatus.WATCH;
  } else {
    status = MoscaStatus.SAFE;
  }

  return {
    status,
    moscaTotal,
    moscaMargin,
  };
}

module.exports = {
  evaluatePqcReadiness,
};
