/**
 * CI gate evaluation that is intentionally independent of a policy profile's
 * default threshold.  Callers can therefore make an explicit, auditable gate
 * decision for each pipeline run.
 */

const VALID_FAIL_ON = Object.freeze(["none", "critical", "high", "mosca-risk"]);

function evaluateGate(summary, failOn = "none") {
  if (!VALID_FAIL_ON.includes(failOn)) {
    throw new Error(
      `Unsupported --fail-on value '${failOn}'. Choose from: ${VALID_FAIL_ON.join(", ")}`,
    );
  }

  const metrics = summary?.metrics || {};
  const severity = metrics.severity_counts || {};
  const mosca = metrics.mosca_status_counts || {};
  const critical = Number(severity.critical || 0);
  const high = Number(severity.high || 0);
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

  return { failOn, matched, reason, counts: { critical, high, moscaRisk } };
}

module.exports = { VALID_FAIL_ON, evaluateGate };
