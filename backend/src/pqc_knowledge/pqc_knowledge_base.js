/**
 * ECDAT Versioned PQC Knowledge Base Service (Phase 10.1)
 *
 * Provides programmatic access and authoritative comparisons for Post-Quantum,
 * Hybrid, and Classical cryptographic standards across multiple international
 * guidance bodies (NIST, ANSSI, BSI, NSA CNSA 2.0, IETF).
 *
 * Avoids single-vendor bias by tracking multi-authority recommendations,
 * precise key/ciphertext/signature footprints, and migration trade-offs.
 */

const fs = require("fs");
const path = require("path");

let cachedCatalog = null;

/**
 * Loads the versioned PQC algorithm catalog from rules/pqc_algorithm_catalog.json.
 */
function getPqcKnowledgeBase(customPath = null) {
  if (cachedCatalog && !customPath) {
    return cachedCatalog;
  }

  const catalogPath =
    customPath ||
    path.resolve(__dirname, "../../../rules/pqc_algorithm_catalog.json");

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`PQC Knowledge Base catalog file not found at: ${catalogPath}`);
  }

  const rawData = fs.readFileSync(catalogPath, "utf-8");
  const parsed = JSON.parse(rawData);
  if (!customPath) {
    cachedCatalog = parsed;
  }
  return parsed;
}

/**
 * Normalizes algorithm query string for robust matching.
 */
function normalizeQuery(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Looks up an algorithm in the PQC Knowledge Base by ID, standard name, or alias.
 *
 * @param {string} query - e.g. "ML-KEM-768", "Kyber768", "Dilithium3", "X25519MLKEM768", "LMS"
 * @returns {Object|null} Algorithm record or null if not found
 */
function lookupPqcAlgorithm(query) {
  if (!query) return null;
  const kb = getPqcKnowledgeBase();
  const normalized = normalizeQuery(query);

  for (const algo of kb.algorithms) {
    if (normalizeQuery(algo.id) === normalized) return algo;
    if (normalizeQuery(algo.standard_name) === normalized) return algo;
    if (algo.ssh_name && normalizeQuery(algo.ssh_name) === normalized) return algo;
    if (algo.oid && algo.oid === query) return algo;

    if (Array.isArray(algo.aliases)) {
      for (const alias of algo.aliases) {
        if (normalizeQuery(alias) === normalized) return algo;
      }
    }
  }

  return null;
}

/**
 * Lists algorithms filtered by category ('post_quantum', 'hybrid', 'classical').
 */
function listAlgorithmsByCategory(category) {
  const kb = getPqcKnowledgeBase();
  const cat = String(category || "").toLowerCase();
  return kb.algorithms.filter((a) => a.category.toLowerCase() === cat);
}

/**
 * Lists algorithms filtered by usage category (e.g. 'EPHEMERAL_TLS_KEX', 'FIRMWARE_CODE_SIGNING').
 */
function listAlgorithmsByUsage(usageCategory) {
  const kb = getPqcKnowledgeBase();
  const usage = String(usageCategory || "").toUpperCase();
  return kb.algorithms.filter((a) => a.usage_category === usage);
}

/**
 * Returns multi-authority recommendations comparing NIST, ANSSI, BSI, NSA CNSA 2.0, and IETF.
 *
 * @param {string} query - Algorithm ID or alias
 * @returns {Object|null} { algorithm, authorities: { nist, anssi, bsi, nsa_cnsa, ietf } }
 */
function getAuthorityRecommendations(query) {
  const algo = lookupPqcAlgorithm(query);
  if (!algo) return null;

  return {
    id: algo.id,
    standard_name: algo.standard_name,
    standard_reference: algo.standard_reference,
    nist_quantum_security_level: algo.nist_quantum_security_level,
    authorities: algo.authority_recommendations || {},
  };
}

/**
 * Compares two algorithms side-by-side across characteristics, MTU impact, and security levels.
 *
 * @param {string} queryA
 * @param {string} queryB
 * @returns {Object} Comparative analysis
 */
function comparePqcAlgorithms(queryA, queryB) {
  const a = lookupPqcAlgorithm(queryA);
  const b = lookupPqcAlgorithm(queryB);

  if (!a) throw new Error(`Algorithm '${queryA}' not found in PQC Knowledge Base.`);
  if (!b) throw new Error(`Algorithm '${queryB}' not found in PQC Knowledge Base.`);

  return {
    algorithm_a: {
      id: a.id,
      standard_name: a.standard_name,
      category: a.category,
      mechanism_type: a.mechanism_type,
      security_level: a.nist_quantum_security_level,
      characteristics: a.characteristics,
      usage_category: a.usage_category,
      migration_considerations: a.migration_considerations,
      interoperability_considerations: a.interoperability_considerations,
    },
    algorithm_b: {
      id: b.id,
      standard_name: b.standard_name,
      category: b.category,
      mechanism_type: b.mechanism_type,
      security_level: b.nist_quantum_security_level,
      characteristics: b.characteristics,
      usage_category: b.usage_category,
      migration_considerations: b.migration_considerations,
      interoperability_considerations: b.interoperability_considerations,
    },
    comparison_summary: {
      security_level_diff: a.nist_quantum_security_level - b.nist_quantum_security_level,
      public_key_byte_diff: (a.characteristics?.public_key_bytes || 0) - (b.characteristics?.public_key_bytes || 0),
      payload_byte_diff:
        ((a.characteristics?.ciphertext_bytes || a.characteristics?.signature_bytes || 0) -
         (b.characteristics?.ciphertext_bytes || b.characteristics?.signature_bytes || 0)),
    },
  };
}

/**
 * Returns safety and architectural guidelines for stateful hash-based signatures (LMS/XMSS).
 */
function getStatefulHashGuidelines() {
  return {
    schemes: ["LMS/HSS (RFC 8554, NIST SP 800-208)", "XMSS/XMSS^MT (RFC 8391, NIST SP 800-208)"],
    approved_usage: "FIRMWARE_CODE_SIGNING exclusively. Never use for interactive TLS or general PKI.",
    state_management_hazard:
      "CRITICAL: Re-using a state index completely destroys private key security. All signing operations must monotonically increment state on physical non-volatile hardware storage.",
    hardware_security_module_requirements: [
      "Must enforce physical monotonic hardware counter.",
      "Must resist VM snapshot rollback and power-loss interruption during state increment.",
      "Must isolate private key operations within certified FIPS 140-3 Level 3/4 or Common Criteria EAL 5+ cryptographic boundary.",
    ],
    authority_consensus: {
      nist: "NIST SP 800-208 strictly restricts stateful hash schemes to software and firmware signing.",
      nsa_cnsa: "Mandated under CNSA 2.0 for firmware and software signing; transition starts 2025.",
      anssi: "Permitted strictly for firmware verification in certified hardware.",
    },
  };
}

/**
 * Returns operational guidance for TLS 1.3 hybrid key exchange mechanisms.
 */
function getHybridTlsGuidelines() {
  const hybridGroups = listAlgorithmsByUsage("EPHEMERAL_TLS_KEX");

  return {
    standards_track: "IETF draft-ietf-tls-hybrid-design",
    primary_recommended_group: "X25519MLKEM768 (IANA codepoint 0x11ec / 4588)",
    fips_regulated_group: "SecP256r1MLKEM768 (IANA codepoint 0x11ed / 4589)",
    high_assurance_group: "SecP384r1MLKEM1024 (IANA codepoint 0x11ef / 4591)",
    supported_groups: hybridGroups.map((g) => ({
      name: g.standard_name,
      iana_id: g.iana_tls_group_id,
      iana_hex: g.iana_tls_group_hex,
      classical_component: g.hybrid_components?.classical_component,
      pqc_component: g.hybrid_components?.post_quantum_component,
      combiner: g.hybrid_components?.combiner_function,
      status: g.deprecation_status,
    })),
    combiner_requirements:
      "NIST SP 800-56C Rev 2 & IETF draft-ietf-tls-hybrid-design specify HKDF-Extract and Expand combiner where shared secret = HKDF-Extract(classical_ss || pqc_ss). Compromise of either component does not break session confidentiality.",
    fallback_policy:
      "If peer does not negotiate hybrid codepoint, seamlessly fall back to classical curve without negotiation failure, while logging transition telemetry.",
  };
}

module.exports = {
  getPqcKnowledgeBase,
  lookupPqcAlgorithm,
  listAlgorithmsByCategory,
  listAlgorithmsByUsage,
  getAuthorityRecommendations,
  comparePqcAlgorithms,
  getStatefulHashGuidelines,
  getHybridTlsGuidelines,
};
