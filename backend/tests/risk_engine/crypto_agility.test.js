const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateCryptoAgility,
  resolveMaturityTier,
  AgilityDimensions,
  AgilityMaturityTiers,
  assessFindings,
} = require("../../src/risk_engine");

test("Crypto-Agility Engine - Evaluates all 10 architecture dimensions", () => {
  const result = calculateCryptoAgility([]);

  assert.ok(result.overall_agility_score >= 0 && result.overall_agility_score <= 100);
  assert.ok(result.maturity_tier);
  assert.ok(result.mathematical_proof);

  const dims = Object.keys(result.dimensions);
  assert.equal(dims.length, 10);

  const expectedDimensions = [
    AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION,
    AgilityDimensions.REPLACEABILITY,
    AgilityDimensions.KEY_LIFECYCLE_MANAGEMENT,
    AgilityDimensions.PROTOCOL_AGILITY,
    AgilityDimensions.CERTIFICATE_AUTOMATION,
    AgilityDimensions.PROVIDER_ABSTRACTION,
    AgilityDimensions.DEPENDENCY_COUPLING,
    AgilityDimensions.TEST_COVERAGE,
    AgilityDimensions.PQC_HYBRID_READINESS,
    AgilityDimensions.ROLLBACK_CAPABILITY,
  ];

  for (const expected of expectedDimensions) {
    assert.ok(result.dimensions[expected], `Missing dimension: ${expected}`);
    const dim = result.dimensions[expected];
    assert.ok(typeof dim.raw_score === "number");
    assert.ok(typeof dim.weight_percent === "number");
    assert.ok(typeof dim.weighted_contribution === "number");
    assert.ok(dim.calculation_formula);
    assert.ok(Array.isArray(dim.actionable_recommendations));
  }
});

test("Crypto-Agility Engine - Mathematical transparency shows exactly how score was calculated", () => {
  const meta = {
    centralized_config: { has_crypto_policy_file: true },
    replaceability: { interface_based_crypto_design: true },
    key_lifecycle: { kms_hsm_integration: true },
    protocol_agility: { tls_1_3_dynamic_groups: true },
    certificate_automation: { acme_automated_renewal: true },
    provider_abstraction: { standard_provider_framework: true },
    dependency_coupling: { isolated_crypto_service_module: true },
    test_coverage: { known_answer_tests_kat: true },
    pqc_hybrid_readiness: { pqc_capable_library_dependency: true },
    rollback_capability: { runtime_feature_flag_rollback: true },
  };

  const result = calculateCryptoAgility([], meta);
  const proof = result.mathematical_proof;

  assert.ok(proof.formula.includes("Overall Agility Score = Sum"));
  assert.equal(proof.checksum_verified, true);
  assert.equal(proof.step_by_step_calculation.length, 10);

  // Verify that mathematical sum of step contributions equals overall score within rounding tolerance
  let manualSum = 0;
  for (const step of proof.step_by_step_calculation) {
    manualSum += step.weighted_contribution;
    assert.ok(step.formula.includes("="));
  }

  assert.ok(Math.abs(manualSum - result.overall_agility_score) < 0.2);
});

test("Crypto-Agility Engine - Modern agile architecture yields OPTIMAL or HIGH agility rating", () => {
  const meta = {
    has_crypto_policy_file: true,
    has_central_registry: true,
    uses_interfaces: true,
    uses_algorithm_factory: true,
    uses_kms: true,
    automated_key_rotation: true,
    tls_1_3_enabled: true,
    acme_enabled: true,
    short_lived_certs: true,
    uses_standard_provider: true,
    isolated_crypto_service: true,
    crypto_blast_radius: 1,
    has_kat_tests: true,
    has_downgrade_tests: true,
    has_pqc_library: true,
    hybrid_supported: true,
    has_feature_flags: true,
    dual_stack_supported: true,
  };

  const findings = [
    { algorithm: "X25519MLKEM768", asset_type: "protocol" },
  ];

  const result = calculateCryptoAgility(findings, meta);

  assert.ok(result.overall_agility_score >= 85, `Expected score >= 85, got ${result.overall_agility_score}`);
  assert.ok([AgilityMaturityTiers.OPTIMAL, AgilityMaturityTiers.HIGH].includes(result.maturity_tier));
  assert.equal(result.primary_agility_blockers.length, 0);
  assert.ok(result.agility_strengths.length >= 7);
  assert.ok(result.executive_summary.includes(result.maturity_label));
});

test("Crypto-Agility Engine - Brittle legacy architecture triggers deductions, blockers, and quick wins", () => {
  const meta = {
    centralized_config: { hardcoded_algorithm_strings_inline: true },
    replaceability: { concrete_class_coupling: true, fixed_size_signature_buffer: true },
    key_lifecycle: { hardcoded_static_keys: true },
    protocol_agility: { pinned_legacy_protocol: true },
    certificate_automation: { manual_certificate_provisioning: true, expired_or_imminent_expiration: true },
    provider_abstraction: { vendor_lock_in_api: true },
    dependency_coupling: { high_blast_radius_sprawl: true },
    test_coverage: { zero_crypto_test_coverage: true },
    pqc_hybrid_readiness: { pqc_intolerant_buffer_limits: true },
    rollback_capability: { irreversible_crypto_migration: true },
  };

  const findings = [
    { algorithm: "DES", asset_type: "hardcoded_private_key", is_hardcoded: true },
    { algorithm: "TLS 1.0", asset_type: "protocol" },
    { algorithm: "RSA-1024", certificate_properties: { isExpired: true } },
  ];

  const result = calculateCryptoAgility(findings, meta);

  assert.ok(result.overall_agility_score <= 25, `Expected score <= 25, got ${result.overall_agility_score}`);
  assert.equal(result.maturity_tier, AgilityMaturityTiers.RIGID);
  assert.ok(result.primary_agility_blockers.length >= 8);

  // Check urgent blocker priorities
  const urgent = result.primary_agility_blockers.filter((b) => b.remediation_priority === "URGENT_BLOCKER");
  assert.ok(urgent.length >= 5);

  // Quick wins must be provided
  assert.ok(result.quick_wins.length >= 2);
  assert.ok(result.quick_wins.some((q) => q.effort === "LOW"));
});

test("Crypto-Agility Engine - Custom weights correctly modulate dimension influence", () => {
  // Give PQC hybrid readiness and rollback capability 50% weight each (total 100)
  const customWeights = {
    [AgilityDimensions.PQC_HYBRID_READINESS]: 50,
    [AgilityDimensions.ROLLBACK_CAPABILITY]: 50,
    [AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION]: 0,
    [AgilityDimensions.REPLACEABILITY]: 0,
    [AgilityDimensions.KEY_LIFECYCLE_MANAGEMENT]: 0,
    [AgilityDimensions.PROTOCOL_AGILITY]: 0,
    [AgilityDimensions.CERTIFICATE_AUTOMATION]: 0,
    [AgilityDimensions.PROVIDER_ABSTRACTION]: 0,
    [AgilityDimensions.DEPENDENCY_COUPLING]: 0,
    [AgilityDimensions.TEST_COVERAGE]: 0,
  };

  const meta = {
    pqc_hybrid_readiness: { pqc_capable_library_dependency: true, hybrid_key_exchange_support: true },
    rollback_capability: { runtime_feature_flag_rollback: true, dual_stack_fallback: true },
  };

  const result = calculateCryptoAgility([], meta, { weights: customWeights });

  assert.equal(result.dimensions[AgilityDimensions.PQC_HYBRID_READINESS].weight_percent, 50);
  assert.equal(result.dimensions[AgilityDimensions.ROLLBACK_CAPABILITY].weight_percent, 50);
  assert.equal(result.dimensions[AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION].weight_percent, 0);

  // Weighted score must reflect the 50/50 split
  assert.ok(result.overall_agility_score >= 80);
});

test("Crypto-Agility Engine - Integrated with assessFindings API", () => {
  const sampleFindings = [
    {
      algorithm: "ECDH",
      key_size: 256,
      asset_type: "protocol",
      host: "api.internal.net",
    },
    {
      algorithm: "MD5",
      asset_type: "hash",
      file_path: "/src/legacy_hash.js",
      evidence_type: "ast",
    },
  ];

  const assessment = assessFindings(sampleFindings, {
    policyProfile: "internal_enterprise",
    architectureMetadata: {
      has_crypto_policy_file: true,
      uses_interfaces: true,
    },
  });

  assert.ok(assessment.crypto_agility);
  assert.ok(typeof assessment.crypto_agility.overall_agility_score === "number");
  assert.ok(assessment.crypto_agility.mathematical_proof);
  assert.ok(assessment.crypto_agility.dimensions[AgilityDimensions.CENTRALIZED_ALGORITHM_CONFIGURATION]);
});
