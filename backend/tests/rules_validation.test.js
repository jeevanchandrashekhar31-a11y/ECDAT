const test = require("node:test");
const assert = require("node:assert");
const { loadAndValidateAllRules } = require("../src/risk_engine/rules_loader");

test("ECDAT Rule Validation - All rule files validate against JSON Schemas", () => {
  const rules = loadAndValidateAllRules();
  assert.ok(rules.algorithm_risk, "algorithm_risk rules loaded");
  assert.ok(rules.mosca_config, "mosca_config rules loaded");
  assert.ok(rules.policy_profiles, "policy_profiles rules loaded");
  assert.ok(rules.pqc_recommendations, "pqc_recommendations rules loaded");
  assert.ok(
    rules.crypto_library_catalog,
    "crypto_library_catalog rules loaded",
  );
});

test("ECDAT Rule Validation - algorithm_risk.json contains all required algorithms and protocols", () => {
  const rules = loadAndValidateAllRules();
  const algos = rules.algorithm_risk.algorithms;
  const ids = algos.map((a) => a.id);

  const required = [
    "md5",
    "sha1",
    "sha224",
    "sha256",
    "sha384",
    "sha512",
    "sha3",
    "rsa",
    "dsa",
    "ecdsa",
    "ecdh",
    "dh",
    "x25519",
    "aes",
    "des",
    "3des",
    "rc2",
    "rc4",
    "chacha20_poly1305",
    "tls10",
    "tls11",
    "tls12",
    "tls13",
  ];

  for (const req of required) {
    assert.ok(ids.includes(req), `Expected algorithm_risk to include '${req}'`);
  }

  // Verify AES is not falsely claimed broken
  const aes = algos.find((a) => a.id === "aes");
  assert.strictEqual(aes.classical_risk_level, "none");
  assert.strictEqual(aes.quantum_relevance, "grover_sensitive");
  assert.ok(
    aes.deprecation_notes.includes("AES is NOT broken by quantum computers"),
  );

  // Verify RSA is marked shor_vulnerable
  const rsa = algos.find((a) => a.id === "rsa");
  assert.strictEqual(rsa.quantum_relevance, "shor_vulnerable");
  assert.ok(rsa.conditions.some((c) => c.key_size_threshold_bits === 2048));
});

test("ECDAT Rule Validation - mosca_config.json contains valid asset types, adjustments, and constraints", () => {
  const rules = loadAndValidateAllRules();
  const mosca = rules.mosca_config;

  // Defaults
  assert.strictEqual(typeof mosca.defaults.X_shelf_life_years, "number");
  assert.strictEqual(typeof mosca.defaults.Y_migration_years, "number");
  assert.strictEqual(typeof mosca.defaults.Z_quantum_threat_years, "number");

  // Scenarios
  assert.ok(mosca.scenarios.optimistic);
  assert.ok(mosca.scenarios.baseline);
  assert.ok(mosca.scenarios.conservative);

  // Asset types
  const requiredAssetTypes = [
    "network_session",
    "certificate",
    "hardcoded_private_key",
    "stored_encrypted_data",
    "signing_key",
    "library_presence",
  ];
  for (const at of requiredAssetTypes) {
    assert.ok(
      mosca.asset_type_defaults[at],
      `Asset type ${at} missing in mosca_config`,
    );
  }

  // Sensitivities & Criticalities
  const sensitivities = ["public", "internal", "confidential", "restricted"];
  for (const s of sensitivities) {
    assert.ok(mosca.sensitivity_adjustments[s], `Sensitivity ${s} missing`);
  }

  const criticalities = ["low", "medium", "high", "critical"];
  for (const c of criticalities) {
    assert.ok(mosca.criticality_adjustments[c], `Criticality ${c} missing`);
  }
});

test("ECDAT Rule Validation - policy_profiles.json contains all 5 required profiles", () => {
  const rules = loadAndValidateAllRules();
  const profiles = rules.policy_profiles.profiles;

  const requiredProfiles = [
    "public_internet",
    "internal_enterprise",
    "regulated_bfsi",
    "government_high_value",
    "iot_ot",
  ];

  for (const p of requiredProfiles) {
    assert.ok(profiles[p], `Policy profile '${p}' missing`);
    assert.ok(profiles[p].tls_policy.minimum_version);
    assert.ok(typeof profiles[p].key_size_policy.min_rsa_bits === "number");
    assert.ok(
      typeof profiles[p].certificate_policy.allow_self_signed === "boolean",
    );
    assert.ok(profiles[p].pqc_policy.mandatory_migration_deadline_year >= 2025);
  }
});

test("ECDAT Rule Validation - pqc_recommendations.json provides context-aware guidance", () => {
  const rules = loadAndValidateAllRules();
  const recs = rules.pqc_recommendations.recommendations;
  const categories = recs.map((r) => r.target_category);

  assert.ok(categories.includes("tls_protocol"));
  assert.ok(categories.includes("key_establishment"));
  assert.ok(categories.includes("digital_signature"));
  assert.ok(categories.includes("ssh_protocol"));
  assert.ok(categories.includes("stored_data_encryption"));
  assert.ok(categories.includes("classical_hash_migration"));
  assert.ok(categories.includes("symmetric_cipher_quantum_margin"));

  for (const rec of recs) {
    assert.ok(rec.recommendation_id);
    assert.ok(rec.proposed_option);
    assert.ok(rec.standard_reference);
    assert.ok(rec.security_rationale);
    assert.ok(["low", "medium", "high"].includes(rec.compatibility_risk));
    assert.ok(
      ["negligible", "minor", "moderate", "significant"].includes(
        rec.latency_impact_category,
      ),
    );
  }
});
