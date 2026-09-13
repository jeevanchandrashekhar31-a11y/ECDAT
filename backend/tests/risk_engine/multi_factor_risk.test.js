const test = require("node:test");
const assert = require("node:assert");

const {
  calculateMultiFactorRisk,
  classifyFinding,
} = require("../../src/risk_engine");

test("Multi-Factor Risk - Evaluates all 17 risk dimensions with explainable score and breakdown", () => {
  const context = {
    algorithm: "MD5",
    keySize: 128,
    assetType: "hardcoded_private_key",
    protocol: "TLS",
    tlsVersion: "TLS 1.0",
    isInternetExposed: true,
    businessCriticality: "critical",
    dataLifetimeYears: 15,
    reachability: "RUNTIME_CONFIRMED",
    hasActiveCve: true,
    dependencyBlastRadius: 15,
    migrationComplexity: "high",
    owner: "unassigned",
    compensatingControls: [],
  };

  const result = calculateMultiFactorRisk(context);

  assert.ok(result.score >= 60, `Expected score >= 60, got ${result.score}`);
  assert.strictEqual(result.severity, "High");
  assert.strictEqual(result.evaluated_factors_count, 17);

  // Check factor breakdown
  const bd = result.breakdown;
  assert.ok(bd.algorithm_weakness.weighted_score >= 18);
  assert.ok(bd.protocol_weakness.weighted_score >= 15);
  assert.ok(bd.internet_exposure.weighted_score >= 9);
  assert.ok(bd.business_criticality.weighted_score >= 6);
  assert.ok(bd.reachability.weighted_score >= 9);
  assert.strictEqual(bd.ownership.raw_score, 5);

  // Check explanation presence
  assert.ok(result.explanation.includes("Primary drivers"));
});

test("Multi-Factor Risk - Mosca D + T > Q reasoning is retained as first-class quantum dimension", () => {
  const context = {
    algorithm: "RSA",
    keySize: 2048,
    dataLifetimeYears: 8,
    migrationTimeYears: 4,
    quantumThreatYears: 10,
  };

  const result = calculateMultiFactorRisk(context);
  const qDim = result.quantum_dimension;

  assert.strictEqual(qDim.is_shor_vulnerable, true);
  assert.strictEqual(qDim.data_lifetime_years, 8);
  assert.strictEqual(qDim.migration_time_years, 4);
  assert.strictEqual(qDim.quantum_threat_years, 10);
  // D (8) + T (4) = 12 > Q (10) -> z = 10 - 12 = -2
  assert.strictEqual(qDim.z_margin_years, -2);
  assert.strictEqual(qDim.mosca_status, "CRITICAL_URGENT");
  assert.ok(qDim.explanation.includes("CRITICAL MOSCA VIOLATION"));
});

test("Multi-Factor Risk - Compensating controls provide defense-in-depth risk mitigation", () => {
  const baseContext = {
    algorithm: "RSA",
    keySize: 2048,
    isInternetExposed: true,
    businessCriticality: "high",
    reachability: "RUNTIME_CONFIRMED",
  };

  const unmitigated = calculateMultiFactorRisk(baseContext);
  const mitigated = calculateMultiFactorRisk({
    ...baseContext,
    compensatingControls: ["mTLS", "WAF", "Hardware_Security_Module"],
  });

  assert.ok(
    mitigated.score < unmitigated.score,
    `Mitigated score (${mitigated.score}) must be lower than unmitigated score (${unmitigated.score})`,
  );
  assert.strictEqual(mitigated.breakdown.compensating_controls.active_controls.length, 3);
});

test("Multi-Factor Risk - Reachability modulates score without overstating dormant packages", () => {
  const dormantContext = {
    algorithm: "AES",
    keySize: 128,
    reachability: "CAPABILITY_PRESENT",
  };
  const activeContext = {
    algorithm: "AES",
    keySize: 128,
    reachability: "RUNTIME_CONFIRMED",
  };

  const dormantResult = calculateMultiFactorRisk(dormantContext);
  const activeResult = calculateMultiFactorRisk(activeContext);

  assert.ok(
    activeResult.breakdown.reachability.raw_score > dormantResult.breakdown.reachability.raw_score,
  );
});

test("Multi-Factor Risk - Custom weights allow enterprise-specific tuning", () => {
  const context = {
    algorithm: "MD5",
    businessCriticality: "low",
  };

  // Turn off algorithm weakness weight
  const tuned = calculateMultiFactorRisk(context, { algorithm_weakness: 0 });
  assert.strictEqual(tuned.breakdown.algorithm_weakness.weighted_score, 0);
});

test("Multi-Factor Risk - Integrated with classifyFinding API", () => {
  const finding = classifyFinding({
    algorithm: "DES",
    keySize: 56,
    policyProfile: "internal_enterprise",
    reachabilityLevel: "RUNTIME_CONFIRMED",
  });

  assert.ok(finding.multi_factor);
  assert.ok(finding.risk_score > 0);
  assert.ok(finding.factor_breakdown.algorithm_weakness);
});
