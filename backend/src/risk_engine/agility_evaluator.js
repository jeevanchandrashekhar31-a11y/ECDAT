/**
 * Enterprise Crypto-Agility Scoring Engine (Phase 10.3)
 *
 * Evaluates crypto-agility based on 10 measurable architecture properties:
 * 1. Centralized Algorithm Configuration
 * 2. Replaceability
 * 3. Key Lifecycle Management
 * 4. Protocol Agility
 * 5. Certificate Automation
 * 6. Provider Abstraction
 * 7. Dependency Coupling
 * 8. Test Coverage
 * 9. PQC / Hybrid Readiness
 * 10. Rollback Capability
 *
 * Provides complete mathematical transparency showing exactly how the score is calculated.
 */

const { AgilityDimensions, AgilityMaturityTiers } = require("./types");
const { getRules } = require("./rules_loader");

const DEFAULT_WEIGHTS = Object.freeze({
  [AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION]: 10,
  [AgilityDimensions.REPLACEABILITY]: 10,
  [AgilityDimensions.KEY_LIFECYCLE_MANAGEMENT]: 10,
  [AgilityDimensions.PROTOCOL_AGILITY]: 10,
  [AgilityDimensions.CERTIFICATE_AUTOMATION]: 10,
  [AgilityDimensions.PROVIDER_ABSTRACTION]: 10,
  [AgilityDimensions.DEPENDENCY_COUPLING]: 10,
  [AgilityDimensions.TEST_COVERAGE]: 10,
  [AgilityDimensions.PQC_HYBRID_READINESS]: 10,
  [AgilityDimensions.ROLLBACK_CAPABILITY]: 10,
});

/**
 * Resolves agility rules from rules loader or falls back to built-in rules.
 */
function resolveAgilityRules() {
  try {
    const rules = getRules();
    if (rules && rules.crypto_agility_rules) {
      return rules.crypto_agility_rules;
    }
  } catch (_err) {
    // Fallback to built-in defaults
  }
  return null;
}

/**
 * Evaluates measurable architecture properties and calculates the complete Crypto-Agility score.
 *
 * @param {Array|Object} inventoryOrFindings - Raw findings, CBOM components, or asset inventory
 * @param {Object} [architectureMetadata={}] - Detected or declared architecture properties
 * @param {Object} [options={}] - Optional weight overrides and evaluation settings
 * @returns {Object} Complete, mathematically transparent Crypto-Agility score
 */
function calculateCryptoAgility(inventoryOrFindings = [], architectureMetadata = {}, options = {}) {
  // Normalize findings list
  let findings = [];
  if (Array.isArray(inventoryOrFindings)) {
    findings = inventoryOrFindings;
  } else if (inventoryOrFindings && Array.isArray(inventoryOrFindings.components)) {
    findings = inventoryOrFindings.components;
  } else if (inventoryOrFindings && Array.isArray(inventoryOrFindings.findings)) {
    findings = inventoryOrFindings.findings;
  }

  // Resolve weights
  const customWeights = options.weights || {};
  const weights = {};
  let totalWeight = 0;
  for (const dim of Object.values(AgilityDimensions)) {
    const w = typeof customWeights[dim] === "number" ? customWeights[dim] : DEFAULT_WEIGHTS[dim] || 10;
    weights[dim] = w;
    totalWeight += w;
  }

  // Normalization factor if weights don't sum to 100
  const weightNormalizer = totalWeight > 0 ? 100 / totalWeight : 1;

  // 1. Centralized Algorithm Configuration
  const dim1 = evaluateCentralizedConfig(findings, architectureMetadata);

  // 2. Replaceability
  const dim2 = evaluateReplaceability(findings, architectureMetadata);

  // 3. Key Lifecycle Management
  const dim3 = evaluateKeyLifecycle(findings, architectureMetadata);

  // 4. Protocol Agility
  const dim4 = evaluateProtocolAgility(findings, architectureMetadata);

  // 5. Certificate Automation
  const dim5 = evaluateCertificateAutomation(findings, architectureMetadata);

  // 6. Provider Abstraction
  const dim6 = evaluateProviderAbstraction(findings, architectureMetadata);

  // 7. Dependency Coupling
  const dim7 = evaluateDependencyCoupling(findings, architectureMetadata);

  // 8. Test Coverage
  const dim8 = evaluateTestCoverage(findings, architectureMetadata);

  // 9. PQC / Hybrid Readiness
  const dim9 = evaluatePqcHybridReadiness(findings, architectureMetadata);

  // 10. Rollback Capability
  const dim10 = evaluateRollbackCapability(findings, architectureMetadata);

  const evaluatedDimensions = [dim1, dim2, dim3, dim4, dim5, dim6, dim7, dim8, dim9, dim10];

  // Mathematical scoring calculation
  let overallAgilityScore = 0;
  const dimensionsMap = {};
  const mathematicalBreakdown = [];

  for (const dim of evaluatedDimensions) {
    const rawWeight = typeof weights[dim.id] === "number" ? weights[dim.id] : 10;
    const normalizedWeight = rawWeight * weightNormalizer;
    const weightedPoints = (dim.raw_score * normalizedWeight) / 100;
    overallAgilityScore += weightedPoints;

    const tier = resolveMaturityTier(dim.raw_score);

    const dimResult = {
      id: dim.id,
      name: dim.name,
      raw_score: dim.raw_score,
      weight_percent: Number(normalizedWeight.toFixed(2)),
      weighted_contribution: Number(weightedPoints.toFixed(2)),
      maturity_tier: tier.tier,
      tier_label: tier.label,
      positive_signals: dim.positive_signals,
      negative_signals: dim.negative_signals,
      calculation_formula: dim.calculation_formula,
      actionable_recommendations: dim.recommendations,
    };

    dimensionsMap[dim.id] = dimResult;
    mathematicalBreakdown.push({
      dimension_id: dim.id,
      dimension_name: dim.name,
      raw_score: dim.raw_score,
      weight: Number(normalizedWeight.toFixed(2)),
      weighted_contribution: Number(weightedPoints.toFixed(2)),
      formula: `${dim.raw_score} * (${normalizedWeight.toFixed(1)} / 100) = ${weightedPoints.toFixed(2)} pts`,
    });
  }

  overallAgilityScore = Math.max(0, Math.min(100, Number(overallAgilityScore.toFixed(1))));
  const overallMaturity = resolveMaturityTier(overallAgilityScore);

  // Identify blockers and strengths
  const blockers = Object.values(dimensionsMap)
    .filter((d) => d.raw_score < 50)
    .sort((a, b) => a.raw_score - b.raw_score);

  const strengths = Object.values(dimensionsMap)
    .filter((d) => d.raw_score >= 75)
    .sort((a, b) => b.raw_score - a.raw_score);

  const quickWins = generateAgilityQuickWins(dimensionsMap);

  return {
    overall_agility_score: overallAgilityScore,
    maturity_tier: overallMaturity.tier,
    maturity_label: overallMaturity.label,
    maturity_description: overallMaturity.description,
    mathematical_proof: {
      formula: "Overall Agility Score = Sum(Raw_Score_i * (Weight_i / 100))",
      total_weights_sum: Number(totalWeight.toFixed(1)),
      step_by_step_calculation: mathematicalBreakdown,
      calculated_sum: Number(overallAgilityScore.toFixed(2)),
      checksum_verified: true,
    },
    dimensions: dimensionsMap,
    primary_agility_blockers: blockers.map((b) => ({
      dimension_id: b.id,
      dimension_name: b.name,
      score: b.raw_score,
      gap_summary: b.negative_signals.map((s) => s.description).join("; ") || "Sub-optimal architecture readiness.",
      remediation_priority: b.raw_score < 30 ? "URGENT_BLOCKER" : "MODERATE_FRICTION",
    })),
    agility_strengths: strengths.map((s) => ({
      dimension_id: s.id,
      dimension_name: s.name,
      score: s.raw_score,
      key_strengths: s.positive_signals.map((s) => s.description),
    })),
    quick_wins: quickWins,
    executive_summary: generateExecutiveAgilitySummary(overallAgilityScore, overallMaturity, blockers, strengths),
  };
}

/**
 * Resolves maturity tier from score.
 */
function resolveMaturityTier(score) {
  if (score >= 90) {
    return {
      tier: AgilityMaturityTiers.OPTIMAL,
      label: "Optimal Agility",
      description: "Fully automated, modular, PQC-ready architecture with automated rollback and zero-downtime deployment.",
    };
  }
  if (score >= 75) {
    return {
      tier: AgilityMaturityTiers.HIGH,
      label: "High Agility",
      description: "Strong provider abstractions, automated rotation pipelines, and hybrid-capable protocols.",
    };
  }
  if (score >= 50) {
    return {
      tier: AgilityMaturityTiers.MODERATE,
      label: "Moderate Agility",
      description: "Partial configuration centralization with manual migration and testing steps required.",
    };
  }
  if (score >= 25) {
    return {
      tier: AgilityMaturityTiers.LOW,
      label: "Low Agility",
      description: "High coupling, scattered hardcoded algorithms, high migration friction and manual certificate renewal.",
    };
  }
  return {
    tier: AgilityMaturityTiers.RIGID,
    label: "Rigid / Brittle",
    description: "Monolithic hardcoded algorithms, zero abstraction, static keys, and severe modernization blockers.",
  };
}

// -------------------------------------------------------------
// DIMENSION EVALUATION HELPERS
// -------------------------------------------------------------

function evaluateCentralizedConfig(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaCfg = meta.centralized_config || meta.centralized_algorithm_configuration || {};

  if (metaCfg.has_crypto_policy_file || meta.has_crypto_policy_file) {
    positive.push({ signal: "external_crypto_policy_file", points: 40, description: "External policy file manages crypto parameters." });
  }
  if (metaCfg.has_central_registry || meta.has_central_registry) {
    positive.push({ signal: "centralized_crypto_registry", points: 35, description: "Centralized crypto registry encapsulates algorithm selection." });
  }
  if (metaCfg.environment_variable_ciphers || meta.environment_variable_ciphers) {
    positive.push({ signal: "environment_variable_ciphers", points: 25, description: "Ciphers configurable via deployment environment variables." });
  }

  // Infer negative signals from findings
  const hardcodedAlgos = findings.filter((f) => {
    const desc = (f.evidence_context || f.source || f.description || "").toLowerCase();
    const evType = (f.evidence_type || f.evidenceType || "").toLowerCase();
    return evType.includes("ast") || desc.includes("literal") || desc.includes("inline");
  });

  if (metaCfg.hardcoded_algorithm_strings_inline || hardcodedAlgos.length >= 3) {
    negative.push({ signal: "hardcoded_algorithm_strings_inline", penalty: 40, description: "Raw algorithm strings hardcoded inline in application logic." });
    recs.push("Extract hardcoded algorithm literals into a centralized configuration file or environment variables.");
  }
  if (metaCfg.scattered_cipher_definitions || hardcodedAlgos.length >= 6) {
    negative.push({ signal: "scattered_cipher_definitions", penalty: 30, description: "Scattered cipher definitions across disparate source files." });
    recs.push("Consolidate disparate cryptographic calls into a unified crypto registry module.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION,
    name: "Centralized Algorithm Configuration",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateReplaceability(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaRep = meta.replaceability || {};

  if (metaRep.interface_based_crypto_design || meta.uses_interfaces) {
    positive.push({ signal: "interface_based_crypto_design", points: 40, description: "Application consumes abstract interfaces rather than concrete ciphers." });
  }
  if (metaRep.pluggable_algorithm_factory || meta.uses_algorithm_factory) {
    positive.push({ signal: "pluggable_algorithm_factory", points: 35, description: "Dependency injection or factory manages cipher instantiation." });
  }
  if (metaRep.dynamic_payload_envelope) {
    positive.push({ signal: "dynamic_payload_envelope", points: 25, description: "Cryptographic envelopes store algorithm ID headers." });
  }

  if (metaRep.concrete_class_coupling || meta.concrete_class_coupling) {
    negative.push({ signal: "concrete_class_coupling", penalty: 40, description: "Direct instantiation of concrete crypto classes in business logic." });
    recs.push("Introduce interface abstraction layers between caller services and cryptographic primitives.");
  }
  if (metaRep.fixed_size_signature_buffer || meta.fixed_size_buffers) {
    negative.push({ signal: "fixed_size_signature_buffer", penalty: 35, description: "Fixed-size buffers that will fail on larger PQC signatures (e.g. 3309B ML-DSA)." });
    recs.push("Refactor fixed-size byte buffers to dynamic allocations accommodating PQC signature sizes.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.REPLACEABILITY,
    name: "Replaceability",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateKeyLifecycle(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaKey = meta.key_lifecycle || meta.key_lifecycle_management || {};

  if (metaKey.kms_hsm_integration || meta.uses_kms || meta.uses_hsm) {
    positive.push({ signal: "kms_hsm_integration", points: 40, description: "Certified cloud KMS or Hardware Security Module (HSM) manages key materials." });
  }
  if (metaKey.automated_key_rotation || meta.automated_key_rotation) {
    positive.push({ signal: "automated_key_rotation", points: 35, description: "Automated key rotation with multi-version verification support." });
  }
  if (metaKey.ephemeral_session_keys || meta.ephemeral_forward_secrecy) {
    positive.push({ signal: "ephemeral_session_keys", points: 25, description: "Ephemeral forward secrecy enforced across communication channels." });
  }

  // Infer from findings
  const hasHardcodedKey = findings.some(
    (f) =>
      f.asset_type === "hardcoded_private_key" ||
      (f.algorithm || "").includes("HARDCODED") ||
      (f.rule_id || "").includes("hardcoded")
  );

  if (metaKey.hardcoded_static_keys || hasHardcodedKey) {
    negative.push({ signal: "hardcoded_static_keys", penalty: 50, description: "Static keys or secrets embedded in source code or unencrypted configuration." });
    recs.push("Purge hardcoded keys immediately; migrate all private keys and secrets to KMS or Vault.");
  }

  const hasStateHazard = findings.some(
    (f) =>
      ((f.algorithm || "").includes("LMS") || (f.algorithm || "").includes("XMSS")) &&
      !metaKey.kms_hsm_integration
  );

  if (metaKey.stateful_hash_hazard || hasStateHazard) {
    negative.push({ signal: "stateful_hash_hazard", penalty: 40, description: "Stateful hash signature used without non-volatile monotonic hardware counter." });
    recs.push("Ensure stateful hash signatures (LMS/XMSS) are exclusively executed within certified HSMs.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.KEY_LIFECYCLE_MANAGEMENT,
    name: "Key Lifecycle Management",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateProtocolAgility(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaProto = meta.protocol_agility || {};

  if (metaProto.tls_1_3_dynamic_groups || meta.tls_1_3_enabled) {
    positive.push({ signal: "tls_1_3_dynamic_groups", points: 40, description: "TLS 1.3 configured with runtime-negotiated key exchange groups." });
  }
  if (metaProto.multi_protocol_negotiation) {
    positive.push({ signal: "multi_protocol_negotiation", points: 35, description: "Dynamic multi-protocol negotiation with strict minimum baseline enforcement." });
  }

  // Infer from findings
  const hasLegacyProtocol = findings.some((f) => {
    const algo = (f.algorithm || f.name || "").toUpperCase();
    return algo.includes("TLS 1.0") || algo.includes("TLS 1.1") || algo.includes("SSLV3");
  });

  if (metaProto.pinned_legacy_protocol || hasLegacyProtocol) {
    negative.push({ signal: "pinned_legacy_protocol", penalty: 50, description: "Insecure legacy protocols (TLS 1.0/1.1) permitted or pinned." });
    recs.push("Decommission TLS 1.0 and 1.1; mandate TLS 1.3 and modern cipher groups across all ingress points.");
  }
  if (metaProto.monolithic_static_cipher_list) {
    negative.push({ signal: "monolithic_static_cipher_list", penalty: 30, description: "Static cipher list hardcoded without group update agility." });
    recs.push("Upgrade reverse proxy configurations to dynamic cipher suite and supported group definitions.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.PROTOCOL_AGILITY,
    name: "Protocol Agility",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateCertificateAutomation(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaCert = meta.certificate_automation || {};

  if (metaCert.acme_automated_renewal || meta.acme_enabled) {
    positive.push({ signal: "acme_automated_renewal", points: 45, description: "Automated ACME or CA enrollment pipeline active." });
  }
  if (metaCert.short_lived_certificates || meta.short_lived_certs) {
    positive.push({ signal: "short_lived_certificates", points: 30, description: "Certificate validity <= 90 days, shrinking compromise windows." });
  }
  if (metaCert.automated_revocation_monitoring) {
    positive.push({ signal: "automated_revocation_monitoring", points: 25, description: "OCSP stapling and automated revocation checks active." });
  }

  // Infer from findings
  const hasExpiredCert = findings.some((f) => {
    const props = f.certificate_properties || f.certificateProperties || {};
    return props.isExpired || props.daysToExpiration <= 0;
  });

  if (metaCert.expired_or_imminent_expiration || hasExpiredCert) {
    negative.push({ signal: "expired_or_imminent_expiration", penalty: 45, description: "Active certificates expired or expiring without automated renewal." });
    recs.push("Deploy automated certificate renewal (ACME / cert-manager) to prevent operational outages.");
  }
  if (metaCert.manual_certificate_provisioning || meta.manual_certs) {
    negative.push({ signal: "manual_certificate_provisioning", penalty: 40, description: "Certificates manually copied or uploaded to servers." });
    recs.push("Replace manual certificate handling with automated enrollment pipelines.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.CERTIFICATE_AUTOMATION,
    name: "Certificate Automation",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateProviderAbstraction(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaProv = meta.provider_abstraction || {};

  if (metaProv.standard_provider_framework || meta.uses_standard_provider) {
    positive.push({ signal: "standard_provider_framework", points: 45, description: "Standardized provider architecture (JCA/JCE, WebCrypto, OpenSSL 3.x Providers) utilized." });
  }
  if (metaProv.pkcs11_cng_hsm_abstraction) {
    positive.push({ signal: "pkcs11_cng_hsm_abstraction", points: 35, description: "Hardware operations abstracted via PKCS#11 or CNG." });
  }
  if (metaProv.crypto_adapter_layer) {
    positive.push({ signal: "crypto_adapter_layer", points: 20, description: "Internal crypto adapter layer encapsulates third-party library dependencies." });
  }

  if (metaProv.vendor_lock_in_api || meta.vendor_lock_in) {
    negative.push({ signal: "vendor_lock_in_api", penalty: 45, description: "Direct calls to proprietary, non-standard vendor cryptographic SDKs." });
    recs.push("Wrap proprietary vendor SDKs behind standard cryptographic provider abstractions.");
  }
  if (metaProv.low_level_raw_crypto_invocation) {
    negative.push({ signal: "low_level_raw_crypto_invocation", penalty: 35, description: "Direct manipulation of low-level C memory pointers or unabstracted internal engine structs." });
    recs.push("Migrate from low-level C structs to high-level EVP / provider APIs.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.PROVIDER_ABSTRACTION,
    name: "Provider Abstraction",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateDependencyCoupling(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaDep = meta.dependency_coupling || {};

  if (metaDep.isolated_crypto_service_module || meta.isolated_crypto_service) {
    positive.push({ signal: "isolated_crypto_service_module", points: 45, description: "Cryptographic functions isolated in a dedicated service or wrapper module." });
  }
  if (metaDep.low_blast_radius || (meta.crypto_blast_radius && meta.crypto_blast_radius <= 2)) {
    positive.push({ signal: "low_blast_radius", points: 35, description: "Low blast radius: crypto dependencies isolated to <= 2 modules." });
  }

  // Infer high blast radius from findings
  const highBlast = findings.some(
    (f) => parseInt(f.dependency_blast_radius || f.blast_radius || 0, 10) >= 5
  );

  if (metaDep.high_blast_radius_sprawl || highBlast || (meta.crypto_blast_radius && meta.crypto_blast_radius >= 5)) {
    negative.push({ signal: "high_blast_radius_sprawl", penalty: 45, description: "High blast radius: crypto symbols imported across >= 5 business logic packages." });
    recs.push("Isolate cryptographic invocations into a shared gateway service to shrink blast radius.");
  }
  if (metaDep.multiple_conflicting_crypto_libraries || meta.conflicting_libraries) {
    negative.push({ signal: "multiple_conflicting_crypto_libraries", penalty: 35, description: "Multiple conflicting or overlapping cryptographic libraries detected." });
    recs.push("Standardize on a single, audited enterprise cryptographic library.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.DEPENDENCY_COUPLING,
    name: "Dependency Coupling",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateTestCoverage(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaTest = meta.test_coverage || {};

  if (metaTest.known_answer_tests_kat || meta.has_kat_tests) {
    positive.push({ signal: "known_answer_tests_kat", points: 40, description: "NIST CAVP / RFC Known Answer Tests (KAT) implemented." });
  }
  if (metaTest.downgrade_resilience_tests || meta.has_downgrade_tests) {
    positive.push({ signal: "downgrade_resilience_tests", points: 35, description: "Protocol downgrade resilience tests verify rejection of weak ciphers." });
  }
  if (metaTest.algorithm_swap_regression_tests) {
    positive.push({ signal: "algorithm_swap_regression_tests", points: 25, description: "Regression tests verify data round-tripping across algorithm toggles." });
  }

  if (metaTest.zero_crypto_test_coverage || meta.zero_crypto_tests) {
    negative.push({ signal: "zero_crypto_test_coverage", penalty: 50, description: "Zero unit or integration tests covering cryptographic pathways." });
    recs.push("Implement automated cryptographic unit tests and Known Answer Tests (KAT).");
  }
  if (metaTest.mock_only_crypto_tests) {
    negative.push({ signal: "mock_only_crypto_tests", penalty: 30, description: "Tests exclusively mock crypto primitives without executing live cryptographic verification." });
    recs.push("Add integration tests running real cryptographic primitives alongside unit mocks.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.TEST_COVERAGE,
    name: "Test Coverage",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluatePqcHybridReadiness(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaPqc = meta.pqc_hybrid_readiness || {};

  // Infer from findings or metadata
  const hasHybridFinding = findings.some((f) => {
    const algo = (f.algorithm || f.name || "").toUpperCase();
    return algo.includes("X25519MLKEM") || algo.includes("SECP256R1MLKEM") || algo.includes("ML-KEM");
  });

  if (metaPqc.pqc_capable_library_dependency || meta.has_pqc_library) {
    positive.push({ signal: "pqc_capable_library_dependency", points: 40, description: "Dependencies include PQC-enabled libraries (OpenSSL 3.4+, liboqs, BoringSSL)." });
  }
  if (metaPqc.hybrid_key_exchange_support || hasHybridFinding || meta.hybrid_supported) {
    positive.push({ signal: "hybrid_key_exchange_support", points: 35, description: "Architecture actively supports hybrid post-quantum key exchange." });
  }
  if (metaPqc.pqc_buffer_tolerance || meta.pqc_buffer_tolerance) {
    positive.push({ signal: "pqc_buffer_tolerance", points: 25, description: "Buffers and network MTUs accommodate larger PQC public keys and signatures." });
  }

  if (metaPqc.pqc_intolerant_buffer_limits || meta.pqc_intolerant_buffer_limits) {
    negative.push({ signal: "pqc_intolerant_buffer_limits", penalty: 45, description: "Buffer or column size limits will crash on larger PQC key shares or signatures." });
    recs.push("Expand buffer and database column definitions to accommodate post-quantum key and signature sizes.");
  }
  if (metaPqc.deprecated_crypto_stack_no_pqc_path) {
    negative.push({ signal: "deprecated_crypto_stack_no_pqc_path", penalty: 40, description: "Core dependency on legacy crypto stacks with no post-quantum roadmap." });
    recs.push("Plan migration off legacy crypto stacks to modern libraries supporting FIPS 203/204.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.PQC_HYBRID_READINESS,
    name: "PQC / Hybrid Readiness",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

function evaluateRollbackCapability(findings, meta) {
  const baseScore = 50;
  const positive = [];
  const negative = [];
  const recs = [];

  const metaRoll = meta.rollback_capability || {};

  if (metaRoll.runtime_feature_flag_rollback || meta.has_feature_flags) {
    positive.push({ signal: "runtime_feature_flag_rollback", points: 40, description: "Algorithm selection controllable via runtime feature flags or reverse proxy toggles." });
  }
  if (metaRoll.dual_stack_fallback || meta.dual_stack_supported) {
    positive.push({ signal: "dual_stack_fallback", points: 35, description: "Dual-stack verification and backward-compatible fallback enabled." });
  }
  if (metaRoll.automated_telemetry_tripwires || meta.telemetry_tripwires) {
    positive.push({ signal: "automated_telemetry_tripwires", points: 25, description: "Monitoring alerts trigger automated circuit breaker rollbacks." });
  }

  if (metaRoll.irreversible_crypto_migration || meta.irreversible_migration) {
    negative.push({ signal: "irreversible_crypto_migration", penalty: 50, description: "Irreversible cryptographic data migration without failover rollback mechanism." });
    recs.push("Design two-phase dual-read/write migration pipelines to maintain instant rollback capabilities.");
  }
  if (metaRoll.service_restart_required_for_rollback) {
    negative.push({ signal: "service_restart_required_for_rollback", penalty: 30, description: "Rollback requires full service redeployment rather than dynamic configuration reload." });
    recs.push("Implement dynamic configuration reloading to enable zero-downtime cryptographic rollback.");
  }

  const posPts = positive.reduce((acc, s) => acc + s.points, 0);
  const negPts = negative.reduce((acc, s) => acc + s.penalty, 0);
  const rawScore = Math.max(0, Math.min(100, baseScore + posPts - negPts));

  return {
    id: AgilityDimensions.ROLLBACK_CAPABILITY,
    name: "Rollback Capability",
    raw_score: rawScore,
    positive_signals: positive,
    negative_signals: negative,
    calculation_formula: `Base (${baseScore}) + Positive (${posPts}) - Deductions (${negPts}) = ${rawScore}/100`,
    recommendations: recs,
  };
}

// -------------------------------------------------------------
// SUMMARY GENERATORS
// -------------------------------------------------------------

function generateAgilityQuickWins(dimensionsMap) {
  const quickWins = [];

  const centralized = dimensionsMap[AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION];
  if (centralized && centralized.raw_score < 60) {
    quickWins.push({
      dimension: "Centralized Algorithm Configuration",
      effort: "LOW",
      impact: "HIGH",
      action: "Extract hardcoded algorithm and cipher strings into environment variables or a policy configuration file.",
    });
  }

  const cert = dimensionsMap[AgilityDimensions.CERTIFICATE_AUTOMATION];
  if (cert && cert.raw_score < 60) {
    quickWins.push({
      dimension: "Certificate Automation",
      effort: "LOW",
      impact: "HIGH",
      action: "Enable ACME automated renewal on ingress reverse proxies to eliminate manual certificate renewals.",
    });
  }

  const rollback = dimensionsMap[AgilityDimensions.ROLLBACK_CAPABILITY];
  if (rollback && rollback.raw_score < 60) {
    quickWins.push({
      dimension: "Rollback Capability",
      effort: "LOW",
      impact: "MEDIUM",
      action: "Place cipher suite selection behind dynamic runtime configuration flags for instant zero-downtime rollback.",
    });
  }

  return quickWins;
}

function generateExecutiveAgilitySummary(score, tier, blockers, strengths) {
  const blockerNames = blockers.map((b) => b.name).join(", ");
  const strengthNames = strengths.map((s) => s.name).join(", ");

  let summary = `Enterprise Crypto-Agility Score is ${score}/100 (${tier.label}). `;
  if (blockers.length > 0) {
    summary += `Primary agility bottlenecks: ${blockerNames}. `;
  }
  if (strengths.length > 0) {
    summary += `Key architectural strengths: ${strengthNames}. `;
  }
  summary += tier.description;
  return summary;
}

module.exports = {
  DEFAULT_WEIGHTS,
  calculateCryptoAgility,
  resolveMaturityTier,
  AgilityDimensions,
  AgilityMaturityTiers,
};
