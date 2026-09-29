const { getRules } = require("./rules_loader");
const { lookupPqcAlgorithm, listAlgorithmsByCategory } = require("../pqc_knowledge");

function deriveClassicalRemediation(algo, keySize, assetType, finding) {
  const algoUpper = (algo || "").toUpperCase();

  if (algoUpper === "MD5" || algoUpper === "SHA-1") {
    return "Replace immediately with SHA-256, SHA-384, or SHA-3 for digests; migrate passwords to Argon2id (RFC 9106).";
  }
  if (["DES", "3DES", "RC2", "RC4"].includes(algoUpper)) {
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

function derivePqcMigration(algoUpper, matchedRec, assetType) {
  if (algoUpper === "MD5" || algoUpper === "SHA-1") {
    return "Classical algorithm vulnerability; migration to SHA-256 or SHA-3 provides classical security and sufficient Grover search resistance.";
  }
  if (assetType === "stored_encrypted_data") {
    return "Wrap Data Encryption Keys (DEKs) with hybrid ML-KEM-768 envelopes and upgrade to AES-256 to eliminate retrospective HNDL exposure.";
  }
  if (assetType === "network_session" || algoUpper.startsWith("TLS") || algoUpper === "ECDH" || algoUpper === "X25519") {
    return "Enable TLS 1.3 with X25519MLKEM768 (or SecP256r1MLKEM768) hybrid key exchange group; plan PQC client cert support when trust roots mature.";
  }
  if (algoUpper === "RSA" || algoUpper === "ECDSA" || algoUpper === "DSA") {
    return "Evaluate ML-KEM hybrid key establishment for encryption and ML-DSA-65 / SLH-DSA for digital signing based on ecosystem support.";
  }
  if (["AES", "DES", "3DES", "RC4", "RC2"].includes(algoUpper)) {
    return "Upgrade to AES-256 to guarantee 128 bits of post-quantum security margin against Grover exhaustive search.";
  }
  if (assetType === "library_presence") {
    return "Upgrade to library versions with native PQC support (e.g. OpenSSL 3.2+, wolfSSL with liboqs, Go 1.23+).";
  }
  return matchedRec?.proposed_option ? `Migrate to ${matchedRec.proposed_option} per NIST guidelines.` : "Evaluate NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) migration roadmaps.";
}

function getRecommendationForFinding(finding) {
  const algo = finding.canonicalAlgorithm || finding.algorithm || "Unknown";
  const algoUpper = algo.toUpperCase();
  const assetType = finding.assetType || finding.asset_type || "network_session";
  const category = finding.category || "";
  const keySize = finding.keySize || finding.key_size || null;

  const currentInfo = lookupPqcAlgorithm(algo);

  let proposed_option = "Unknown";
  let hybrid_transition_recommended = false;
  let estimated_migration_complexity = "medium";
  let standard_reference = "Derived from ECDAT ruleset";
  let security_rationale = "";

  // DYNAMIC COMPUTATION FROM CATALOG
  if (currentInfo) {
    if (["MD5", "SHA1", "SHA-1"].includes(algoUpper)) {
      proposed_option = "SHA-256";
      security_rationale = "Hash is classically broken. Upgrade to SHA-256 or SHA-3.";
    } else if (currentInfo.category === "classical" && currentInfo.mechanism_type === "digital_signature") {
      proposed_option = "ML-DSA-65";
      estimated_migration_complexity = "high";
      standard_reference = "NIST FIPS 204";
      security_rationale = "Classical signature is vulnerable to Shor's algorithm. Migrate to lattice-based ML-DSA.";
    } else if (currentInfo.category === "classical" && currentInfo.mechanism_type === "key_exchange") {
      const hybridOptions = listAlgorithmsByCategory("hybrid").filter(a => 
        a.hybrid_components && 
        a.hybrid_components.classical_component && 
        a.hybrid_components.classical_component.toUpperCase() === currentInfo.standard_name.toUpperCase()
      );
      if (hybridOptions.length > 0) {
        proposed_option = hybridOptions[0].standard_name;
        hybrid_transition_recommended = true;
        standard_reference = hybridOptions[0].standard_reference;
        security_rationale = hybridOptions[0].authority_recommendations?.nist || "Use hybrid key exchange to protect against HNDL while retaining classical security.";
      } else {
        proposed_option = "X25519MLKEM768";
        hybrid_transition_recommended = true;
        standard_reference = "NIST FIPS 203 & IETF draft-ietf-tls-hybrid-design";
        security_rationale = "Use hybrid key exchange (e.g. X25519MLKEM768) to protect against Harvest-Now-Decrypt-Later.";
      }
    } else if (currentInfo.mechanism_type === "symmetric_cipher") {
      proposed_option = "AES-256-GCM";
      estimated_migration_complexity = "low";
      security_rationale = "Symmetric ciphers require 256-bit keys to maintain 128-bit quantum security margin under Grover's algorithm.";
      standard_reference = "NIST SP 800-38D";
    }
  } else {
     // Fallbacks if not precisely found
     if (algoUpper.includes("RSA") || algoUpper.includes("ECDSA") || algoUpper.includes("DSA")) {
       proposed_option = "ML-DSA-65";
       standard_reference = "NIST FIPS 204";
     } else if (algoUpper.includes("AES") || algoUpper.includes("DES")) {
       proposed_option = "AES-256-GCM";
       standard_reference = "NIST FIPS 197";
     } else {
       proposed_option = "ML-KEM-768";
       standard_reference = "NIST FIPS 203";
       hybrid_transition_recommended = true;
     }
  }

  const matchedRec = {
    recommendation_id: `rec_dynamic_${algoUpper}`,
    proposed_option,
    hybrid_transition_recommended,
    estimated_migration_complexity,
    standard_reference,
    security_rationale,
    latency_impact_category: "minor",
    bandwidth_storage_impact_category: "minor",
    cost_category: "low",
  };

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

  const sensitivity = finding.dataSensitivity || finding.data_sensitivity || "internal";
  const keyStr = keySize ? `-${keySize}` : "";
  const assetName = assetType.replace(/_/g, " ");
  const currentState = `${algo}${keyStr} ${assetName} used for a ${sensitivity} service`;

  const assumptions = [];
  if (matchedRec.security_rationale) {
    assumptions.push(matchedRec.security_rationale);
  }
  assumptions.push(`Data sensitivity classified as '${sensitivity}'`);
  if (finding.mosca?.adjustments?.threatHorizon) {
    assumptions.push(`Modeled under '${finding.mosca.adjustments.threatHorizon}' quantum threat timeline`);
  }

  const classicalRemediation = deriveClassicalRemediation(algo, keySize, assetType, finding);
  const pqcMigration = derivePqcMigration(algoUpper, matchedRec, assetType);

  return {
    recommendation_id: matchedRec.recommendation_id,
    priority,
    current_state: currentState,
    recommended_target: matchedRec.proposed_option,
    proposed_option: matchedRec.proposed_option,
    classical_remediation: classicalRemediation,
    pqc_migration: pqcMigration,
    hybrid_transition_recommended: Boolean(matchedRec.hybrid_transition_recommended),
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
