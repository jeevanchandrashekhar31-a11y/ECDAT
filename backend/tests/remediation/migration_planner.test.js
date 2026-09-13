const test = require("node:test");
const assert = require("node:assert/strict");

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
} = require("../../src/remediation");

test("Migration Planner - Step 1: identifyWhyRisky detects classical and quantum vulnerabilities", () => {
  // Test classical broken hash
  const md5Risk = identifyWhyRisky({
    algorithm: "MD5",
    is_internet_facing: false,
  });
  assert.ok(md5Risk.classical_weakness.includes("Broken classical algorithm"));
  assert.ok(md5Risk.summary.includes("Broken classical algorithm"));

  // Test weak RSA modulus
  const rsa1024Risk = identifyWhyRisky({
    algorithm: "RSA",
    key_size: 1024,
  });
  assert.ok(rsa1024Risk.classical_weakness.includes("Sub-standard RSA modulus"));
  assert.ok(rsa1024Risk.quantum_vulnerability.includes("Shor's algorithm"));

  // Test quantum-vulnerable ECDH with internet exposure and Mosca deficit
  const ecdhRisk = identifyWhyRisky({
    algorithm: "ECDH",
    is_internet_facing: true,
    mosca: {
      status: "CRITICAL_URGENT",
      final_values: { X_shelf_life_years: 15, Y_migration_years: 4, Z_quantum_threat_years: 8 },
    },
  });
  assert.ok(ecdhRisk.quantum_vulnerability.includes("Shor's algorithm"));
  assert.ok(ecdhRisk.environmental_exposure.includes("Harvest-Now-Decrypt-Later"));
  assert.ok(ecdhRisk.mosca_urgency.includes("Critical Mosca deficit"));
});

test("Migration Planner - Step 2: identifyReplacementCandidates matches appropriate PQC algorithms", () => {
  // Key exchange replacement candidates
  const tlsAsset = { algorithm: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", asset_type: "protocol" };
  const tlsCandidates = identifyReplacementCandidates(tlsAsset);
  assert.ok(tlsCandidates.some((c) => c.algorithm === "X25519MLKEM768"));
  assert.ok(tlsCandidates.some((c) => c.algorithm === "SecP256r1MLKEM768"));

  // Signing key replacement candidates
  const rsaCert = { algorithm: "RSA-2048", asset_type: "certificate" };
  const rsaCandidates = identifyReplacementCandidates(rsaCert);
  assert.ok(rsaCandidates.some((c) => c.algorithm === "ML-DSA-65"));
  assert.ok(rsaCandidates.some((c) => c.algorithm === "SLH-DSA-SHA2-128s"));

  // Firmware signing replacement candidates (Stateful Hash LMS/HSS)
  const fwAsset = { algorithm: "RSA-3072", asset_type: "firmware" };
  const fwCandidates = identifyReplacementCandidates(fwAsset);
  assert.ok(fwCandidates.some((c) => c.algorithm === "LMS/HSS"));
});

test("Migration Planner - Step 3: identifyDependencies detects library, hardware, and protocol needs", () => {
  const asset = { algorithm: "ECDH" };
  const candidate = { algorithm: "X25519MLKEM768" };
  const hybridPlan = identifyDependencies(asset, candidate);

  assert.ok(hybridPlan.protocols.some((p) => p.includes("TLS 1.3")));
  assert.ok(hybridPlan.cryptographic_libraries.some((l) => l.includes("OpenSSL")));

  // LMS/HSS must identify physical monotonic counter HSM requirement
  const lmsAsset = { algorithm: "RSA", asset_type: "firmware" };
  const lmsCandidate = { algorithm: "LMS/HSS" };
  const lmsPlan = identifyDependencies(lmsAsset, lmsCandidate);
  assert.ok(lmsPlan.hardware_requirements.some((h) => h.includes("monotonic")));
});

test("Migration Planner - Step 4: identifyAffectedServices maps blast radius", () => {
  const affected = identifyAffectedServices({
    asset_id: "cert_edge_gateway",
    application: "api-gateway",
    dependency_blast_radius: 3,
    is_internet_facing: true,
  });
  assert.equal(affected.primary_application, "api-gateway");
  assert.ok(affected.affected_services.includes("api-gateway"));
  assert.equal(affected.total_dependent_services, 3);
  assert.equal(affected.external_clients_affected, true);
});

test("Migration Planner - Step 5: estimateMigrationComplexity calculates effort and timeline", () => {
  const asset = { algorithm: "RSA-1024", reachability: "reachable" };
  const candidate = { algorithm: "ML-DSA-65" };
  const complexity = estimateMigrationComplexity(asset, candidate);

  assert.ok(complexity.complexity_score >= 1 && complexity.complexity_score <= 10);
  assert.ok(["LOW", "MEDIUM", "HIGH", "COMPLEX"].includes(complexity.effort_level));
  assert.ok(complexity.estimated_person_days > 0);
  assert.ok(complexity.breakdown.length > 0);
});

test("Migration Planner - Step 6: identifyTestingRequirements defines 4 testing pillars", () => {
  const asset = { algorithm: "ECDH", is_internet_facing: true };
  const candidate = { algorithm: "X25519MLKEM768" };
  const testing = identifyTestingRequirements(asset, candidate);

  assert.ok(testing.functional_tests.length > 0);
  assert.ok(testing.interoperability_tests.some((t) => t.includes("MTU") || t.includes("fragmentation")));
  assert.ok(testing.performance_benchmarks.length > 0);
  assert.ok(testing.rollback_smoke_tests.length > 0);
});

test("Migration Planner - Step 7: proposeStagedRollout creates 4 progression gates", () => {
  const asset = { asset_id: "asset_tls_ingress" };
  const candidate = { algorithm: "X25519MLKEM768" };
  const rollout = proposeStagedRollout(asset, candidate);

  assert.equal(rollout.length, 4);
  assert.equal(rollout[0].phase, 1);
  assert.equal(rollout[1].phase, 2);
  assert.equal(rollout[2].phase, 3);
  assert.equal(rollout[3].phase, 4);
  for (const s of rollout) {
    assert.ok(s.name);
    assert.ok(s.duration_weeks > 0);
    assert.ok(s.exit_criteria);
  }
});

test("Migration Planner - Step 8: defineRollback provides zero-downtime safety", () => {
  const rollback = defineRollback({
    asset_id: "asset_tls_ingress",
    algorithm: "ECDHE-RSA",
  });
  assert.ok(rollback.pre_condition_triggers.some((t) => t.includes("Handshake error rate")));
  assert.ok(rollback.pre_condition_triggers.some((t) => t.includes("packet fragmentation")));
  assert.ok(rollback.automated_procedure.length >= 3);
  assert.equal(rollback.zero_downtime_guaranteed, true);
});

test("Migration Planner - Step 9: defineRescanVerification includes CBOM diff and absence disclaimer", () => {
  const asset = { asset_id: "asset_tls_ingress", algorithm: "RSA-1024" };
  const candidate = { algorithm: "ML-DSA-65" };
  const verification = defineRescanVerification(asset, candidate);

  assert.ok(verification.verification_trigger.includes("CI/CD"));
  assert.ok(verification.absence_proof_disclaimer.includes("Never treat absence of a finding as proof"));
  assert.equal(verification.expected_cbom_diff.removed_components[0].algorithm, "RSA-1024");
  assert.equal(verification.expected_cbom_diff.new_components[0].algorithm, "ML-DSA-65");
  assert.ok(verification.regression_checks.length > 0);
});

test("Migration Planner - planAssetMigration integrates all 9 requirements", () => {
  const fullPlan = planAssetMigration({
    asset_id: "cert_prod_1",
    algorithm: "RSA",
    key_size: 2048,
    asset_type: "certificate",
    is_internet_facing: true,
  });

  assert.equal(fullPlan.asset_id, "cert_prod_1");
  assert.ok(fullPlan.why_risky);
  assert.ok(fullPlan.replacement_candidates.length > 0);
  assert.ok(fullPlan.selected_candidate);
  assert.ok(fullPlan.dependencies);
  assert.ok(fullPlan.affected_services);
  assert.ok(fullPlan.migration_complexity);
  assert.ok(fullPlan.testing_requirements);
  assert.ok(fullPlan.staged_rollout);
  assert.ok(fullPlan.rollback_plan);
  assert.ok(fullPlan.rescan_verification);
});

test("Migration Planner - Lifecycle: createEnterpriseMigrationPlan executes DISCOVER to VERIFY", () => {
  const sampleInventory = [
    {
      asset_id: "web_tls",
      algorithm: "ECDH",
      key_size: 256,
      asset_type: "protocol",
      is_internet_facing: true,
      services_dependent: ["frontend-web", "mobile-api"],
    },
    {
      asset_id: "jwt_signer",
      algorithm: "RSA",
      key_size: 1024,
      asset_type: "signing_key",
      is_internet_facing: false,
      services_dependent: ["auth-service"],
    },
    {
      asset_id: "legacy_hasher",
      algorithm: "MD5",
      asset_type: "hash",
      is_internet_facing: false,
    },
  ];

  const plan = createEnterpriseMigrationPlan(sampleInventory, {
    policyProfile: "internal_enterprise",
    scenario: "baseline",
  });

  // Verify all 6 phases are supported and present
  assert.deepEqual(plan.lifecycle_phases_supported, [
    MigrationLifecyclePhases.DISCOVER,
    MigrationLifecyclePhases.ASSESS,
    MigrationLifecyclePhases.PLAN,
    MigrationLifecyclePhases.SIMULATE,
    MigrationLifecyclePhases.REMEDIATE,
    MigrationLifecyclePhases.VERIFY,
  ]);

  // DISCOVER phase checks
  assert.equal(plan.discover_phase.discovered_assets_count, 3);

  // ASSESS phase checks
  assert.equal(plan.assess_phase.assessed_assets_count, 3);
  assert.ok(plan.assess_phase.critical_migration_urgency_count >= 1);

  // PLAN phase checks
  assert.equal(plan.plan_phase.asset_plans.length, 3);
  assert.ok(plan.plan_phase.asset_plans[0].why_risky);
  assert.ok(plan.plan_phase.asset_plans[0].rollback_plan);

  // SIMULATE phase checks (MTU checks and simulation flags)
  assert.equal(plan.simulate_phase.simulation_results.length, 3);
  for (const sim of plan.simulate_phase.simulation_results) {
    assert.equal(sim.simulation_passed, true);
    assert.ok(sim.middlebox_fragmentation_risk);
  }

  // REMEDIATE phase checks (Actionable code snippets)
  assert.ok(plan.remediate_phase.recipes.length >= 2);
  const tlsRecipe = plan.remediate_phase.recipes.find((r) => r.asset_id === "web_tls");
  assert.ok(tlsRecipe.remediation_snippet.includes("ssl_protocols TLSv1.3"));

  // VERIFY phase checks
  assert.equal(plan.verify_phase.total_assets_to_verify, 3);
  assert.ok(plan.verify_phase.automated_rules.length >= 4);
});
