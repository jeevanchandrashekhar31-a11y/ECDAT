const { getRules } = require("./rules_loader");
const { MoscaStatus, QuantumRelevance } = require("./types");
const { evaluatePqcReadiness } = require("./pqc_readiness");

/**
 * Computes Mosca theorem values and risk status for an asset.
 *
 * Formula:
 *   mosca_total = X + Y
 *   mosca_margin = (X + Y) - Z
 *
 * @param {Object} params
 * @param {string} params.assetType - Normalized asset type
 * @param {string} params.dataSensitivity - 'public', 'internal', 'confidential', 'restricted'
 * @param {string} params.businessCriticality - 'low', 'medium', 'high', 'critical'
 * @param {string} [params.scenario='baseline'] - 'optimistic', 'baseline', 'conservative'
 * @param {string} [params.quantumRelevance='shor_vulnerable'] - Quantum status of algorithm
 * @param {boolean} [params.isIntegrityOnly=false] - True if asset only performs signing/integrity
 * @param {number} [params.customX=null] - Optional asset-level override for X
 * @param {number} [params.customY=null] - Optional asset-level override for Y
 * @param {number} [params.customZ=null] - Optional override for Z (threat horizon)
 * @param {Object} [params.policyProfile=null] - Environmental policy profile
 */
function calculateMosca({
  assetType = "network_session",
  dataSensitivity = "internal",
  businessCriticality = "medium",
  scenario = "baseline_2033",
  quantumRelevance = QuantumRelevance.SHOR_VULNERABLE,
  isIntegrityOnly = false,
  customX = null,
  customY = null,
  customZ = null,
  policyProfile = null,
}) {
  const rules = getRules();
  const config = rules.mosca_config;

  const scenarioConfig =
    config.scenarios[scenario] || config.scenarios.baseline_2033;
  const assetDefaults =
    config.asset_type_defaults[assetType] ||
    config.asset_type_defaults.network_session;
  const sensitivityAdj =
    config.sensitivity_adjustments[dataSensitivity] ||
    config.sensitivity_adjustments.internal;
  const criticalityAdj =
    config.criticality_adjustments[businessCriticality] ||
    config.criticality_adjustments.medium;

  // 1. Determine X (Data confidentiality shelf-life)
  let baseX = assetDefaults.X_shelf_life_years;
  let finalX;

  if (customX !== null && customX !== undefined) {
    finalX = Number(customX);
  } else if (isIntegrityOnly) {
    // Integrity-only data (e.g. signature verification) does not suffer from HNDL traffic recording
    // Shelf-life relates to certificate/signature lifespan rather than perpetual secrecy
    finalX = Math.min(baseX, 3);
  } else {
    // Apply sensitivity modifier: base_X from sensitivity or multiplier on asset defaults
    if (dataSensitivity === "public") {
      finalX = 0;
    } else {
      finalX =
        Math.max(baseX, sensitivityAdj.base_X_years) *
        sensitivityAdj.shelf_life_multiplier;
    }
  }

  // 2. Determine Y (Migration duration)
  let baseY = assetDefaults.Y_migration_years;
  let finalY;

  if (customY !== null && customY !== undefined) {
    finalY = Number(customY);
  } else {
    // Scaled by criticality urgency multiplier and scenario multiplier
    const scenarioYMult = scenarioConfig.Y_multiplier || 1.0;
    const critUrgencyMult = criticalityAdj.migration_urgency_multiplier || 1.0;
    finalY = baseY * critUrgencyMult * scenarioYMult;
  }

  // Non-Shor vulnerable assets (symmetric ciphers, hashes, protocols, quantum-safe schemes)
  // do not suffer from polynomial-time quantum cryptanalysis or quantum HNDL shelf-life exposure.
  if (quantumRelevance !== QuantumRelevance.SHOR_VULNERABLE) {
    finalX = 0;
    finalY = 0;
  }

  // 3. Determine Z (Time until CRQC)
  const finalZ = (customZ !== null && customZ !== undefined) 
      ? Number(customZ) 
      : scenarioConfig.Z_quantum_threat_years;

  // 4. Calculate Total & Margin
  // 5. Determine Policy Urgency Threshold (Watch zone)
  const urgencyDeltaThreshold =
    policyProfile?.pqc_rules?.urgency_mosca_delta_threshold_years ?? 0.0;

  // 6. Calculate via PQC Readiness Engine
  const pqcResult = evaluatePqcReadiness(finalX, finalY, finalZ, quantumRelevance, urgencyDeltaThreshold);
  const { status, moscaTotal, moscaMargin } = pqcResult;

  let reason = "";

  if (quantumRelevance !== QuantumRelevance.SHOR_VULNERABLE) {
    reason =
      "Algorithm is not vulnerable to Shor's algorithm. Mosca theorem (X + Y > Z) applies specifically to public-key cryptography subject to polynomial-time quantum cryptanalysis.";
  } else if (moscaMargin > 2.5) {
    reason = `Critical urgency: (X + Y = ${moscaTotal} yrs) materially exceeds quantum threat horizon Z = ${finalZ} yrs by ${moscaMargin} yrs. Immediate migration required.`;
  } else if (moscaMargin > 0) {
    reason = `At risk: Combined shelf-life and migration duration (${moscaTotal} yrs) exceeds threat timeline Z (${finalZ} yrs) by ${moscaMargin} yrs.`;
  } else if (
    moscaMargin >= -Math.abs(urgencyDeltaThreshold) ||
    finalZ - moscaTotal <= 2.0
  ) {
    if (moscaMargin === 0) {
      reason = `Watch: Margin is exactly 0. Migration must begin immediately to avoid falling behind the threat horizon.`;
    } else {
      reason = `Watch: Mosca margin (${moscaMargin} yrs) is within policy urgency buffer. Migration preparation must begin soon.`;
    }
  } else {
    reason = `Safe: Safe quantum margin of ${Math.abs(moscaMargin)} yrs remaining before CRQC estimated arrival.`;
  }

  return {
    status,
    mosca_total_years: moscaTotal,
    mosca_margin_years: moscaMargin,
    base_values: {
      X_shelf_life_years: baseX,
      Y_migration_years: baseY,
      Z_quantum_threat_years: config.defaults.Z_quantum_threat_years,
    },
    final_values: {
      X_shelf_life_years: finalX,
      Y_migration_years: finalY,
      Z_quantum_threat_years: finalZ,
    },
    adjustments: {
      scenario,
      data_sensitivity: dataSensitivity,
      sensitivity_multiplier: sensitivityAdj.shelf_life_multiplier,
      business_criticality: businessCriticality,
      criticality_multiplier: criticalityAdj.migration_urgency_multiplier,
      is_integrity_only: isIntegrityOnly,
    },
    explanation: reason,
  };
}

module.exports = {
  calculateMosca,
};
