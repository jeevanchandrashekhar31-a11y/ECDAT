const { getRules } = require("./rules_loader");

/**
 * Derives concrete classical remediation steps based on algorithm, key size, and asset context.
 */
function deriveClassicalRemediation(algo, keySize, assetType, finding) {
  const algoUpper = (algo || "").toUpperCase();

  if (algoUpper === "MD5" || algoUpper === "SHA-1") {
    return "Replace immediately with SHA-256, SHA-384, or SHA-3 for digests; migrate passwords to Argon2id (RFC 9106).";
  }
  if (
    algoUpper === "DES" ||
    algoUpper === "3DES" ||
    algoUpper === "RC2" ||
    algoUpper === "RC4"
  ) {
    return "Prohibit legacy cipher immediately; migrate all symmetric encryption to AES-256-GCM or ChaCha20-Poly1305.";
  }
  if (algoUpper === "TLS 1.0" || algoUpper === "TLS 1.1") {
    return "Disable TLS 1.0 and 1.1 across all server and client configurations; enforce TLS 1.2 or TLS 1.3 with AEAD ciphers.";
  }
  if (assetType === "hardcoded_private_key") {
    return "Immediately revoke and purge hardcoded private key from repository commit history; migrate key custody to an HSM or cloud KMS.";
  }
  if (assetType === "certificate") {
    if (finding.certificateProperties?.isSelfSigned) {
      return "Replace self-signed certificate with an enterprise internal CA or public trusted CA certificate.";
    }
    if (finding.certificateProperties?.isExpired) {
      return "Renew expired certificate immediately; automate rotation via ACME or corporate PKI orchestration.";
    }
    if (keySize && keySize < 3072) {
      return "Maintain at least RSA-3072 or ECDSA P-256 during transition if compatibility requires classical public-key cryptography.";
    }
  }
  if (algoUpper === "RSA" && keySize && keySize < 2048) {
    return "Immediately deprecate sub-2048 bit RSA keys; regenerate keypairs using at least RSA-3072 or ECDSA P-256.";
  }
  if (algoUpper === "AES" && keySize === 128) {
    return "Ensure AES-GCM or ChaCha20-Poly1305 authenticated modes with unique nonces; plan upgrade to AES-256 for long-term margin.";
  }
  return "Enforce current classical cryptographic baseline standards (NIST SP 800-57 Part 1 Rev 5).";
}

/**
 * Derives concrete PQC migration steps based on algorithm, category, and asset context.
 */
function derivePqcMigration(algo, matchedRec, assetType) {
  const algoUpper = (algo || "").toUpperCase();

  if (algoUpper === "MD5" || algoUpper === "SHA-1") {
    return "Classical algorithm vulnerability; migration to SHA-256 or SHA-3 provides classical security and sufficient Grover search resistance.";
  }
  if (assetType === "stored_encrypted_data") {
    return "Wrap Data Encryption Keys (DEKs) with hybrid ML-KEM-768 envelopes and upgrade to AES-256 to eliminate retrospective HNDL exposure.";
  }
  if (
    assetType === "network_session" ||
    algoUpper.startsWith("TLS") ||
    algoUpper === "ECDH" ||
    algoUpper === "X25519"
  ) {
    return "Enable TLS 1.3 with X25519MLKEM768 (or SecP256r1MLKEM768) hybrid key exchange group; plan PQC client cert support when trust roots mature.";
  }
  if (algoUpper === "RSA" || algoUpper === "ECDSA" || algoUpper === "DSA") {
    return "Evaluate ML-KEM hybrid key establishment for encryption and ML-DSA-65 / SLH-DSA for digital signing based on ecosystem support.";
  }
  if (algoUpper === "AES" || algoUpper === "DES" || algoUpper === "3DES" || algoUpper === "RC4" || algoUpper === "RC2") {
    return "Upgrade to AES-256 to guarantee 128 bits of post-quantum security margin against Grover exhaustive search.";
  }
  if (assetType === "library_presence") {
    return "Upgrade to library versions with native PQC support (e.g. OpenSSL 3.2+, wolfSSL with liboqs, Go 1.23+).";
  }
  return (
    matchedRec?.proposed_option ||
    "Evaluate NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) migration roadmaps."
  );
}

/**
 * Builds a structured context-aware recommendation for a classified finding.
 *
 * @param {Object} finding
 * @returns {Object} Structured recommendation object
 */
function getRecommendationForFinding(finding) {
  const rules = getRules();
  const recommendations = rules.pqc_recommendations?.recommendations || [];
  const algo = finding.canonicalAlgorithm || finding.algorithm || "Unknown";
  const algoUpper = algo.toUpperCase();
  const assetType =
    finding.assetType || finding.asset_type || "network_session";
  const category = finding.category || "";
  const keySize = finding.keySize || finding.key_size || null;

  let matchedRec = null;

  // 1. Classical Hash Broken (MD5, SHA-1)
  if (algoUpper === "MD5" || algoUpper === "SHA-1") {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_classical_hash_broken",
    );
  }
  // 2. Hardcoded Key
  else if (assetType === "hardcoded_private_key") {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_hardcoded_key_remediation",
    );
  }
  // 3. Stored Encrypted Data (HNDL exposure)
  else if (assetType === "stored_encrypted_data") {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_stored_data_envelope",
    );
  }
  // 4. SSH Protocol
  else if (
    finding.protocol === "SSH" ||
    finding.evidence?.some?.((e) => String(e).toLowerCase().includes("ssh"))
  ) {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_ssh_hybrid_kex",
    );
  }
  // 5. TLS Protocol / Session Hybrid KEX
  else if (
    assetType === "network_session" ||
    category === "protocol" ||
    algoUpper.startsWith("TLS") ||
    category === "key_exchange"
  ) {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_kem_hybrid_tls",
    );
  }
  // 6. Certificates & PKI
  else if (assetType === "certificate") {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_certificate_pki",
    );
  }
  // 7. Library Presence
  else if (assetType === "library_presence") {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_library_inventory",
    );
  }
  // 8. Digital Signatures & Firmware
  else if (
    category === "digital_signature" ||
    assetType === "signing_key" ||
    algoUpper === "DSA" ||
    algoUpper === "ECDSA"
  ) {
    if (finding.isFirmware || finding.isBootloader) {
      matchedRec = recommendations.find(
        (r) => r.recommendation_id === "rec_sig_stateful_firmware",
      );
    } else {
      matchedRec = recommendations.find(
        (r) => r.recommendation_id === "rec_sig_general_pqc",
      );
    }
  }
  // 9. Asymmetric Key Encapsulation (General)
  else if (
    category === "asymmetric_encryption" ||
    algoUpper === "RSA" ||
    algoUpper === "DIFFIE-HELLMAN"
  ) {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_kem_general_key_exchange",
    );
  }
  // 10. Symmetric Quantum Margin (AES-128)
  else if (algoUpper === "AES" && keySize === 128) {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_symmetric_quantum_margin",
    );
  }
  // 11. Symmetric Legacy (DES, 3DES, RC4)
  else if (
    algoUpper === "DES" ||
    algoUpper === "3DES" ||
    algoUpper === "RC2" ||
    algoUpper === "RC4"
  ) {
    matchedRec = recommendations.find(
      (r) => r.recommendation_id === "rec_symmetric_quantum_margin",
    );
  }

  // Fallback to first matching algorithm
  if (!matchedRec) {
    matchedRec =
      recommendations.find((r) => r.applies_to_algorithms?.includes(algo)) ||
      recommendations[0];
  }

  // Determine Priority
  let priority = "medium";
  const sev = (finding.severity || "").toLowerCase();
  const moscaStatus = finding.mosca?.status;

  if (sev === "critical" || moscaStatus === "CRITICAL_URGENT") {
    priority = "critical";
  } else if (sev === "high" || moscaStatus === "AT_RISK") {
    priority = "high";
  } else if (sev === "medium" || moscaStatus === "WATCH") {
    priority = "medium";
  } else if (sev === "low") {
    priority = "low";
  } else {
    priority = "informational";
  }

  // Construct readable current state
  const sensitivity =
    finding.dataSensitivity || finding.data_sensitivity || "internal";
  const keyStr = keySize ? `-${keySize}` : "";
  const assetName = assetType.replace(/_/g, " ");
  const currentState = `${algo}${keyStr} ${assetName} used for a ${sensitivity} service`;

  // Build assumptions list
  const assumptions = [];
  if (matchedRec.confidence_and_assumptions) {
    assumptions.push(matchedRec.confidence_and_assumptions);
  }
  assumptions.push(`Data sensitivity classified as '${sensitivity}'`);
  if (finding.mosca?.adjustments?.scenario) {
    assumptions.push(
      `Modeled under '${finding.mosca.adjustments.scenario}' quantum threat timeline`,
    );
  }

  const classicalRemediation = deriveClassicalRemediation(
    algo,
    keySize,
    assetType,
    finding,
  );
  const pqcMigration = derivePqcMigration(algo, matchedRec, assetType);

  return {
    recommendation_id: matchedRec.recommendation_id,
    priority,
    current_state: currentState,
    recommended_target: matchedRec.proposed_option,
    proposed_option: matchedRec.proposed_option,
    classical_remediation: classicalRemediation,
    pqc_migration: pqcMigration,
    hybrid_transition_recommended: Boolean(
      matchedRec.hybrid_transition_recommended,
    ),
    migration_complexity: matchedRec.estimated_migration_complexity || "medium",
    latency_impact: matchedRec.latency_impact_category || "minor",
    bandwidth_impact: matchedRec.bandwidth_storage_impact_category || "minor",
    cost_category: matchedRec.cost_category || "low",
    rationale: matchedRec.security_rationale,
    assumptions,
    references: [matchedRec.standard_reference],
    standard_reference: matchedRec.standard_reference,
    benchmark_available: false,
    performance_measurement_mode: "qualitative_estimated",
  };
}

module.exports = {
  getRecommendationForFinding,
  deriveClassicalRemediation,
  derivePqcMigration,
};
