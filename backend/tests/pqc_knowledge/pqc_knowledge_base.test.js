const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getPqcKnowledgeBase,
  lookupPqcAlgorithm,
  listAlgorithmsByCategory,
  listAlgorithmsByUsage,
  getAuthorityRecommendations,
  comparePqcAlgorithms,
  getStatefulHashGuidelines,
  getHybridTlsGuidelines,
} = require("../../src/pqc_knowledge");

test("PQC Knowledge Base - Loads versioned 2.0.0 catalog with tracked authorities", () => {
  const kb = getPqcKnowledgeBase();
  assert.equal(kb.catalog_version, "2.0.0");
  assert.ok(kb.algorithms.length >= 15);
  assert.ok(kb.authorities_tracked.nist);
  assert.ok(kb.authorities_tracked.anssi);
  assert.ok(kb.authorities_tracked.bsi);
  assert.ok(kb.authorities_tracked.nsa_cnsa);
  assert.ok(kb.authorities_tracked.ietf);
});

test("PQC Knowledge Base - ML-KEM tracks FIPS 203 standards and characteristics", () => {
  const mlkem768 = lookupPqcAlgorithm("ML-KEM-768");
  assert.ok(mlkem768);
  assert.equal(mlkem768.standard_reference, "NIST FIPS 203");
  assert.equal(mlkem768.nist_quantum_security_level, 3);
  assert.equal(mlkem768.harvest_now_decrypt_later_resilient, true);
  assert.equal(mlkem768.characteristics.public_key_bytes, 1184);
  assert.equal(mlkem768.characteristics.ciphertext_bytes, 1088);
  assert.ok(mlkem768.migration_considerations.mtu_impact.includes("MTU"));
  assert.ok(mlkem768.interoperability_considerations.client_server_support.includes("OpenSSL"));

  // Verify alias lookup
  const byKyber = lookupPqcAlgorithm("Kyber768");
  assert.equal(byKyber.id, "ml_kem_768");
});

test("PQC Knowledge Base - ML-DSA tracks FIPS 204 signatures and signature sizes", () => {
  const mldsa65 = lookupPqcAlgorithm("ML-DSA-65");
  assert.ok(mldsa65);
  assert.equal(mldsa65.standard_reference, "NIST FIPS 204");
  assert.equal(mldsa65.mechanism_type, "digital_signature");
  assert.equal(mldsa65.characteristics.signature_bytes, 3309);
  assert.equal(mldsa65.characteristics.public_key_bytes, 1952);
  assert.ok(mldsa65.migration_considerations.crypto_agility_guidance.includes("PKI"));

  const byDilithium = lookupPqcAlgorithm("Dilithium3");
  assert.equal(byDilithium.id, "ml_dsa_65");
});

test("PQC Knowledge Base - SLH-DSA tracks FIPS 205 stateless hash signatures", () => {
  const slhdsa = lookupPqcAlgorithm("SLH-DSA-SHA2-128s");
  assert.ok(slhdsa);
  assert.equal(slhdsa.standard_reference, "NIST FIPS 205");
  assert.equal(slhdsa.characteristics.public_key_bytes, 32);
  assert.equal(slhdsa.characteristics.signature_bytes, 7856);
  assert.ok(slhdsa.migration_considerations.state_management.includes("Stateless"));
  assert.ok(slhdsa.authority_recommendations.anssi.includes("hash-based"));
});

test("PQC Knowledge Base - Stateful hash signatures enforce strict state management warnings", () => {
  const lms = lookupPqcAlgorithm("LMS/HSS");
  assert.ok(lms);
  assert.equal(lms.mechanism_type, "stateful_hash_signature");
  assert.equal(lms.usage_category, "FIRMWARE_CODE_SIGNING");
  assert.ok(lms.migration_considerations.state_management.includes("CRITICAL HAZARD"));
  assert.ok(lms.migration_considerations.crypto_agility_guidance.includes("FORBIDDEN for ephemeral TLS"));

  const guidelines = getStatefulHashGuidelines();
  assert.ok(guidelines.state_management_hazard.includes("completely destroys private key security"));
  assert.ok(guidelines.hardware_security_module_requirements.some((r) => r.includes("monotonic")));
});

test("PQC Knowledge Base - Hybrid key establishment tracks IETF TLS and SSH standards", () => {
  const tlsHybrid = lookupPqcAlgorithm("X25519MLKEM768");
  assert.ok(tlsHybrid);
  assert.equal(tlsHybrid.iana_tls_group_id, 4588);
  assert.equal(tlsHybrid.iana_tls_group_hex, "0x11ec");
  assert.equal(tlsHybrid.hybrid_components.classical_component, "x25519");
  assert.equal(tlsHybrid.hybrid_components.post_quantum_component, "ml_kem_768");
  assert.equal(tlsHybrid.hybrid_components.combiner_function, "HKDF-SHA256");

  const sshHybrid = lookupPqcAlgorithm("mlkem768x25519-sha512@openssh.com");
  assert.ok(sshHybrid);
  assert.equal(sshHybrid.category, "hybrid");
});

test("PQC Knowledge Base - Does not hardcode single vendor truth: Multi-authority comparisons", () => {
  const recs = getAuthorityRecommendations("ML-KEM-1024");
  assert.ok(recs);
  assert.ok(recs.authorities.nist, "NIST guidance present");
  assert.ok(recs.authorities.anssi, "ANSSI guidance present");
  assert.ok(recs.authorities.bsi, "BSI guidance present");
  assert.ok(recs.authorities.nsa_cnsa, "NSA CNSA 2.0 guidance present");

  // Verify explicit divergence between CNSA 2.0 (mandates Level 5 exclusively) and general NIST/IETF
  assert.ok(recs.authorities.nsa_cnsa.includes("MANDATORY"));
  const mlkem768Recs = getAuthorityRecommendations("ML-KEM-768");
  assert.ok(mlkem768Recs.authorities.nsa_cnsa.includes("NOT approved"));
  assert.ok(mlkem768Recs.authorities.nist.includes("Primary recommended"));
});

test("PQC Knowledge Base - Compares algorithms side-by-side across characteristics", () => {
  const comp = comparePqcAlgorithms("ML-KEM-768", "ML-KEM-1024");
  assert.equal(comp.algorithm_a.standard_name, "ML-KEM-768");
  assert.equal(comp.algorithm_b.standard_name, "ML-KEM-1024");
  assert.equal(comp.comparison_summary.security_level_diff, -2);
  assert.ok(comp.comparison_summary.public_key_byte_diff < 0);
});

test("PQC Knowledge Base - TLS Hybrid guidelines detail fallback and combiner requirements", () => {
  const tls = getHybridTlsGuidelines();
  assert.equal(tls.primary_recommended_group, "X25519MLKEM768 (IANA codepoint 0x11ec / 4588)");
  assert.ok(tls.supported_groups.some((g) => g.iana_hex === "0x11ec"));
  assert.ok(tls.combiner_requirements.includes("HKDF-Extract"));
  assert.ok(tls.fallback_policy.includes("fall back to classical curve"));
});
