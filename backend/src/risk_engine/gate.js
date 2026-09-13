/**
 * CI gate evaluation that is intentionally independent of a policy profile's
 * default threshold.  Callers can therefore make an explicit, auditable gate
 * decision for each pipeline run.
 */

const VALID_FAIL_ON = Object.freeze(["none", "critical", "high", "mosca-risk"]);

function evaluateGate(summary, failOn = "none", options = {}) {
  if (!VALID_FAIL_ON.includes(failOn)) {
    throw new Error(
      `Unsupported --fail-on value '${failOn}'. Choose from: ${VALID_FAIL_ON.join(", ")}`,
    );
  }

  const minConfidence = (options.minConfidence || "any").toLowerCase();
  const metrics = summary?.metrics || {};
  const severity = metrics.severity_counts || {};
  const matrix = metrics.confidence_matrix;
  const mosca = metrics.mosca_status_counts || {};

  let critical = Number(severity.critical || 0);
  let high = Number(severity.high || 0);
  let uncertainCritical = 0;
  let uncertainHigh = 0;

  if (matrix && minConfidence !== "any") {
    if (minConfidence === "confirmed") {
      const confCrit = Number(matrix.critical?.confirmed || 0);
      const confHigh = Number(matrix.high?.confirmed || 0);
      uncertainCritical = critical - confCrit;
      uncertainHigh = high - confHigh;
      critical = confCrit;
      high = confHigh;
    } else if (minConfidence === "high") {
      const confCrit = Number(matrix.critical?.confirmed || 0) + Number(matrix.critical?.high || 0);
      const confHigh = Number(matrix.high?.confirmed || 0) + Number(matrix.high?.high || 0);
      uncertainCritical = critical - confCrit;
      uncertainHigh = high - confHigh;
      critical = confCrit;
      high = confHigh;
    }
  }

  const moscaRisk =
    Number(mosca.AT_RISK || 0) + Number(mosca.CRITICAL_URGENT || 0);

  const matched =
    (failOn === "critical" && critical > 0) ||
    (failOn === "high" && (critical > 0 || high > 0)) ||
    (failOn === "mosca-risk" && moscaRisk > 0);

  let reason = "No configured gate was exceeded.";
  if (matched && failOn === "critical")
    reason = `${critical} Critical finding(s) detected.`;
  if (matched && failOn === "high")
    reason = `${critical} Critical and ${high} High finding(s) detected.`;
  if (matched && failOn === "mosca-risk")
    reason = `${moscaRisk} Mosca AT_RISK or CRITICAL_URGENT finding(s) detected.`;

  if (!matched && (uncertainCritical > 0 || uncertainHigh > 0)) {
    reason += ` (${uncertainCritical + uncertainHigh} uncertain finding(s) excluded from gate enforcement due to minConfidence=${minConfidence}).`;
  }

  return {
    failOn,
    matched,
    reason,
    minConfidence,
    counts: { critical, high, moscaRisk, uncertainCritical, uncertainHigh },
  };
}

module.exports = { VALID_FAIL_ON, evaluateGate };

