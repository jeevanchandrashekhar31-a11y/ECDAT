/**
 * Multi-Factor Risk Engine (Phase 9.1)
 *
 * Implements an explainable multi-factor risk model covering all 17 enterprise risk dimensions:
 * 1.  algorithm_weakness
 * 2.  key_strength
 * 3.  protocol_weakness
 * 4.  certificate_state
 * 5.  quantum_vulnerability
 * 6.  data_lifetime
 * 7.  harvest_now_decrypt_later_exposure
 * 8.  internet_exposure
 * 9.  business_criticality
 * 10. asset_criticality
 * 11. exploitability
 * 12. reachability
 * 13. dependency_blast_radius
 * 14. migration_complexity
 * 15. compliance_impact
 * 16. ownership
 * 17. compensating_controls
 *
 * Retains Mosca-style D + T > Q reasoning as one quantum-readiness dimension.
 * Every score includes an explainable breakdown.
 */

const { Severities, MoscaStatus, QuantumRelevance } = require("./types");

// Default configurable weights for each factor
const DEFAULT_FACTOR_WEIGHTS = {
  algorithm_weakness: 1.0,
  key_strength: 1.0,
  protocol_weakness: 1.0,
  certificate_state: 1.0,
  quantum_vulnerability: 1.0,
  data_lifetime: 0.8,
  harvest_now_decrypt_later_exposure: 0.9,
  internet_exposure: 0.9,
  business_criticality: 0.8,
  asset_criticality: 0.8,
  exploitability: 1.0,
  reachability: 1.0,
  dependency_blast_radius: 0.7,
  migration_complexity: 0.6,
  compliance_impact: 0.9,
  ownership: 0.5,
  compensating_controls: 1.0, // Risk reduction factor
};

/**
 * Calculates multi-factor risk score and detailed factor breakdown.
 *
 * @param {Object} context - Cryptographic asset context and environmental attributes
 * @param {Object} [customWeights] - Custom weight overrides for enterprise tuning
 * @returns {Object} { score: number, severity: string, breakdown: Object, quantumDimension: Object, explanation: string }
 */
function calculateMultiFactorRisk(context = {}, customWeights = {}) {
  const weights = { ...DEFAULT_FACTOR_WEIGHTS, ...customWeights };
  const breakdown = {};
  let totalRawScore = 0;
  let maxPossibleRaw = 0;

  // Helper to record factor evaluation
  function recordFactor(key, points, maxPoints, rationale, details = {}) {
    const w = weights[key] !== undefined ? weights[key] : 1.0;
    const weightedPoints = Math.round(points * w * 10) / 10;
    const weightedMax = Math.round(maxPoints * w * 10) / 10;

    breakdown[key] = {
      raw_score: points,
      max_score: maxPoints,
      weight: w,
      weighted_score: weightedPoints,
      rationale,
      ...details,
    };

    if (key !== "compensating_controls") {
      totalRawScore += weightedPoints;
      maxPossibleRaw += weightedMax;
    } else {
      // Compensating controls subtract points (risk mitigant)
      totalRawScore = Math.max(0, totalRawScore - weightedPoints);
    }
  }

  const algo = (context.algorithm || "").toUpperCase();
  const keySize = parseInt(context.keySize || context.key_size, 10);
  const protocol = (context.protocol || "").toUpperCase();
  const tlsVersion = (context.tlsVersion || context.tls_version || "").toUpperCase();
  const cert = context.certificateProperties || {};

  // 1. ALGORITHM WEAKNESS (0 - 20 pts)
  let algoPts = 0;
  let algoRationale = "Standard, modern cryptographic algorithm.";
  if (["MD5", "DES", "RC4", "3DES"].some((w) => algo.includes(w))) {
    algoPts = 20;
    algoRationale = `Broken / compromised algorithm (${algo}) with known practical collisions or key recoveries.`;
  } else if (["SHA1", "SHA-1"].some((w) => algo.includes(w))) {
    algoPts = 14;
    algoRationale = `Deprecated algorithm (${algo}) susceptible to chosen-prefix collisions.`;
  } else if (["BLOWFISH", "IDEA", "CAST5"].some((w) => algo.includes(w))) {
    algoPts = 8;
    algoRationale = `Legacy 64-bit block cipher (${algo}) vulnerable to birthday/Sweet32 attacks.`;
  }
  recordFactor("algorithm_weakness", algoPts, 20, algoRationale);

  // 2. KEY STRENGTH (0 - 18 pts)
  let keyPts = 0;
  let keyRationale = "Key strength meets or exceeds enterprise standards.";
  if (!isNaN(keySize)) {
    if (algo.includes("RSA") || algo.includes("DSA") || algo.includes("DH")) {
      if (keySize < 1024) {
        keyPts = 18;
        keyRationale = `Critical key size: ${keySize}-bit asymmetric key factorable in real time.`;
      } else if (keySize < 2048) {
        keyPts = 15;
        keyRationale = `Substandard key size: ${keySize}-bit key below minimum industry baseline (2048-bit).`;
      } else if (keySize < 3072 && context.policyProfile === "regulated_bfsi") {
        keyPts = 7;
        keyRationale = `${keySize}-bit key fails BFSI requirement of >= 3072 bits.`;
      }
    } else if (algo.includes("ECC") || algo.includes("ECDSA") || algo.includes("ECDH")) {
      if (keySize < 224) {
        keyPts = 15;
        keyRationale = `ECC key size ${keySize}-bit below 224-bit security boundary.`;
      }
    } else if (algo.includes("AES")) {
      if (keySize < 128) {
        keyPts = 18;
        keyRationale = `Symmetric key size ${keySize}-bit vulnerable to brute-force.`;
      }
    }
  }
  recordFactor("key_strength", keyPts, 18, keyRationale);

  // 3. PROTOCOL WEAKNESS (0 - 18 pts)
  let protoPts = 0;
  let protoRationale = "Protocol version and parameters satisfy modern security standards.";
  if (
    tlsVersion.includes("SSL") ||
    tlsVersion.includes("TLS 1.0") ||
    tlsVersion.includes("TLS 1.1") ||
    protocol.includes("SSH1")
  ) {
    protoPts = 18;
    protoRationale = `Deprecated protocol version (${tlsVersion || protocol}) prohibited by PCI-DSS and NIST.`;
  } else if (tlsVersion.includes("TLS 1.2")) {
    const cipherSuites = context.cipherSuites || context.cipher_suites || [];
    const hasCbc = cipherSuites.some((cs) => cs.toUpperCase().includes("CBC"));
    if (hasCbc) {
      protoPts = 8;
      protoRationale = "TLS 1.2 negotiating CBC-mode cipher suites vulnerable to timing/padding oracles.";
    }
  }
  recordFactor("protocol_weakness", protoPts, 18, protoRationale);

  // 4. CERTIFICATE STATE (0 - 15 pts)
  let certPts = 0;
  let certRationale = "Certificate is valid, unexpired, and properly signed.";
  if (cert.isExpired === true) {
    certPts = 15;
    certRationale = "Certificate is expired, causing authentication failure and trust warnings.";
  } else if (cert.isSelfSigned === true) {
    if (context.isInternetExposed || context.environment === "production") {
      certPts = 12;
      certRationale = "Self-signed certificate deployed in public/production environment without verifiable trust anchor.";
    } else {
      certPts = 5;
      certRationale = "Self-signed certificate in internal environment.";
    }
  } else if (cert.daysUntilExpiration !== undefined && cert.daysUntilExpiration <= 7) {
    certPts = 8;
    certRationale = `Certificate expires critically soon (${cert.daysUntilExpiration} days remaining).`;
  }
  recordFactor("certificate_state", certPts, 15, certRationale);

  // 5. QUANTUM VULNERABILITY (0 - 15 pts)
  let qPts = 0;
  let qRationale = "Cryptographic asset is quantum-resilient or post-quantum native.";
  const isShor = ["RSA", "ECC", "ECDSA", "ECDH", "DH", "DSA", "ED25519", "X25519"].some((w) => algo.includes(w));
  const isGrover = algo.includes("AES") && (keySize === 128 || (!keySize && algo.includes("128")));

  if (isShor) {
    qPts = 15;
    qRationale = `Shor algorithm vulnerable: ${algo} asymmetric primitives completely broken by a Cryptanalytically Relevant Quantum Computer (CRQC).`;
  } else if (isGrover) {
    qPts = 6;
    qRationale = "Grover algorithm sensitive: AES-128 security halved to 64-bit quantum equivalent.";
  }
  recordFactor("quantum_vulnerability", qPts, 15, qRationale, {
    quantum_relevance: isShor ? QuantumRelevance.SHOR_VULNERABLE : isGrover ? QuantumRelevance.GROVER_SENSITIVE : QuantumRelevance.QUANTUM_SAFE,
  });

  // 6. DATA LIFETIME (0 - 10 pts)
  const lifetimeYears = parseInt(context.dataLifetimeYears || context.data_lifetime || 5, 10);
  let dlPts = 0;
  let dlRationale = "Data lifetime is brief (< 2 years).";
  if (lifetimeYears >= 10) {
    dlPts = 10;
    dlRationale = `High data lifetime (${lifetimeYears} years) extends well into expected CRQC availability horizons.`;
  } else if (lifetimeYears >= 3) {
    dlPts = 5;
    dlRationale = `Moderate data lifetime (${lifetimeYears} years).`;
  }
  recordFactor("data_lifetime", dlPts, 10, dlRationale, { lifetime_years: lifetimeYears });

  // 7. HARVEST-NOW-DECRYPT-LATER EXPOSURE (0 - 12 pts)
  let hndlPts = 0;
  let hndlRationale = "Asset not susceptible to passive eavesdropping / HNDL.";
  const isTransmitted = context.assetType === "network_session" || context.protocol === "TLS" || context.protocol === "SSH";
  if (isTransmitted && isShor) {
    if (context.isInternetExposed || context.environment === "production") {
      hndlPts = 12;
      hndlRationale = "CRITICAL HNDL EXPOSURE: Traffic over public channels can be captured today and decrypted when CRQC is available.";
    } else {
      hndlPts = 6;
      hndlRationale = "Internal network session with asymmetric key exchange vulnerable to internal capture and future decryption.";
    }
  }
  recordFactor("harvest_now_decrypt_later_exposure", hndlPts, 12, hndlRationale);

  // 8. INTERNET EXPOSURE (0 - 10 pts)
  let expPts = 0;
  let expRationale = "Internal, isolated network perimeter.";
  if (context.isInternetExposed === true || context.policyProfile === "public_internet") {
    expPts = 10;
    expRationale = "Publicly accessible endpoint directly exposed to untrusted internet adversaries.";
  } else if (context.isDmz === true) {
    expPts = 5;
    expRationale = "DMZ / partner boundary exposure.";
  }
  recordFactor("internet_exposure", expPts, 10, expRationale);

  // 9. BUSINESS CRITICALITY (0 - 8 pts)
  const bCrit = (context.businessCriticality || context.business_criticality || "medium").toLowerCase();
  let bCritPts = 2;
  let bCritRationale = "Standard business operation.";
  if (bCrit === "critical") {
    bCritPts = 8;
    bCritRationale = "Mission-critical system supporting core revenue, safety, or transactional integrity.";
  } else if (bCrit === "high") {
    bCritPts = 5;
    bCritRationale = "High business criticality system.";
  }
  recordFactor("business_criticality", bCritPts, 8, bCritRationale);

  // 10. ASSET CRITICALITY (0 - 8 pts)
  const aType = (context.assetType || "").toLowerCase();
  let aCritPts = 2;
  let aCritRationale = "Standard application cryptographic asset.";
  if (aType === "hardcoded_private_key" || aType === "signing_key") {
    aCritPts = 8;
    aCritRationale = "Private key or signing credential represents master authority / zero-trust root.";
  } else if (aType === "certificate") {
    aCritPts = 5;
    aCritRationale = "Public key identity credential.";
  }
  recordFactor("asset_criticality", aCritPts, 8, aCritRationale);

  // 11. EXPLOITABILITY (0 - 12 pts)
  let expbPts = 0;
  let expbRationale = "No known public exploit for this configuration.";
  if (context.hasActiveCve || context.hasKnownExploit) {
    expbPts = 12;
    expbRationale = "Known CVE with active public exploit target identified.";
  } else if (algoPts >= 14) {
    expbPts = 8;
    expbRationale = "Theoretical attack published with demonstrated proof-of-concept.";
  }
  recordFactor("exploitability", expbPts, 12, expbRationale);

  // 12. REACHABILITY (0 - 10 pts)
  const reach = (context.reachability || context.reachabilityLevel || "CAPABILITY_PRESENT").toUpperCase();
  let rPts = 2;
  let rRationale = "CAPABILITY_PRESENT: Dormant or transient package presence without active execution confirmation.";
  if (reach === "RUNTIME_CONFIRMED") {
    rPts = 10;
    rRationale = "RUNTIME_CONFIRMED: Cryptographic algorithm actively confirmed executing in memory and live process.";
  } else if (reach === "DIRECT_API_CALL") {
    rPts = 7;
    rRationale = "DIRECT_API_CALL: Static call-graph confirms direct invocation of cryptographic API.";
  } else if (reach === "TRANSIENT_IMPORT") {
    rPts = 4;
    rRationale = "TRANSIENT_IMPORT: Transitive dependency imported by application.";
  }
  recordFactor("reachability", rPts, 10, rRationale, { reachability: reach });

  // 13. DEPENDENCY BLAST RADIUS (0 - 8 pts)
  const blastRadius = parseInt(context.dependencyBlastRadius || context.blast_radius || 1, 10);
  let blastPts = 1;
  let blastRationale = "Isolated asset with single dependent.";
  if (blastRadius >= 10) {
    blastPts = 8;
    blastRationale = `High blast radius: ${blastRadius} downstream services depend on this cryptographic asset.`;
  } else if (blastRadius >= 3) {
    blastPts = 4;
    blastRationale = `Moderate blast radius: ${blastRadius} downstream services dependent.`;
  }
  recordFactor("dependency_blast_radius", blastPts, 8, blastRationale, { blast_radius: blastRadius });

  // 14. MIGRATION COMPLEXITY (0 - 6 pts)
  const migComp = (context.migrationComplexity || "medium").toLowerCase();
  let migPts = 2;
  let migRationale = "Manageable migration complexity.";
  if (migComp === "high") {
    migPts = 6;
    migRationale = "High migration complexity: requires data store re-encryption and coordinated client migrations.";
  } else if (migComp === "low") {
    migPts = 1;
    migRationale = "Low migration complexity: configurable parameter or cipher suite toggle.";
  }
  recordFactor("migration_complexity", migPts, 6, migRationale);

  // 15. COMPLIANCE IMPACT (0 - 10 pts)
  let compPts = 0;
  let compRationale = "Compliant with active regulatory baseline.";
  if (algoPts >= 14 || protoPts >= 14) {
    compPts = 10;
    compRationale = "Direct violation of mandatory cybersecurity standards (e.g. PCI-DSS 4.0, NIST SP 800-131A).";
  } else if (context.policyProfile === "regulated_bfsi" && isShor) {
    compPts = 6;
    compRationale = "BFSI guidance requires documented PQC migration roadmap for asymmetric assets.";
  }
  recordFactor("compliance_impact", compPts, 10, compRationale);

  // 16. OWNERSHIP (0 - 5 pts)
  const hasOwner = context.owner && context.owner !== "unassigned";
  const ownPts = hasOwner ? 0 : 5;
  const ownRationale = hasOwner
    ? `Assigned owner: ${context.owner}.`
    : "Orphaned cryptographic asset: No assigned owner or responsible security team.";
  recordFactor("ownership", ownPts, 5, ownRationale);

  // 17. COMPENSATING CONTROLS (Risk Mitigation: 0 - 15 pts subtracted)
  const controls = context.compensatingControls || context.compensating_controls || [];
  let ccPts = 0;
  let ccRationale = "No compensating controls registered.";
  if (controls.length > 0) {
    ccPts = Math.min(15, controls.length * 5);
    ccRationale = `Compensating controls active (${controls.join(", ")}) providing defense-in-depth risk mitigation.`;
  }
  recordFactor("compensating_controls", ccPts, 15, ccRationale, { active_controls: controls });

  // Compute final normalized score (0 - 100)
  const finalScore = Math.min(100, Math.max(0, Math.round((totalRawScore / maxPossibleRaw) * 100)));

  // Derive Severity Level
  let severity = Severities.INFORMATIONAL;
  if (finalScore >= 75) {
    severity = Severities.CRITICAL;
  } else if (finalScore >= 55) {
    severity = Severities.HIGH;
  } else if (finalScore >= 35) {
    severity = Severities.MEDIUM;
  } else if (finalScore >= 15) {
    severity = Severities.LOW;
  }

  // Mosca D + T > Q reasoning (dedicated quantum readiness dimension)
  const migrationTimeYears = parseInt(context.migrationTimeYears || context.migration_time || 3, 10);
  const quantumThreatYears = parseInt(context.quantumThreatYears || context.quantum_threat || 10, 10);
  const moscaSum = lifetimeYears + migrationTimeYears;
  const moscaZ = quantumThreatYears - moscaSum;

  let moscaStatus = MoscaStatus.SAFE;
  let moscaExplanation = "Mosca inequality D + T <= Q: migration can be completed before quantum threat window.";
  if (isShor) {
    if (moscaZ < 0) {
      moscaStatus = MoscaStatus.CRITICAL_URGENT;
      moscaExplanation = `CRITICAL MOSCA VIOLATION: D (${lifetimeYears}y) + T (${migrationTimeYears}y) = ${moscaSum}y > Q (${quantumThreatYears}y). Data will be exposed to quantum decryption!`;
    } else if (moscaZ <= 2) {
      moscaStatus = MoscaStatus.AT_RISK;
      moscaExplanation = `Mosca migration horizon tight (Z = ${moscaZ}y). Immediate PQC migration recommended.`;
    } else if (moscaZ <= 5) {
      moscaStatus = MoscaStatus.WATCH;
      moscaExplanation = `Mosca watch status: migration should begin planning within ${moscaZ} years.`;
    }
  }

  const quantumDimension = {
    is_shor_vulnerable: isShor,
    is_grover_sensitive: isGrover,
    data_lifetime_years: lifetimeYears,
    migration_time_years: migrationTimeYears,
    quantum_threat_years: quantumThreatYears,
    z_margin_years: moscaZ,
    mosca_status: moscaStatus,
    mosca_formula: `${lifetimeYears} (D) + ${migrationTimeYears} (T) ${moscaSum > quantumThreatYears ? ">" : "<="} ${quantumThreatYears} (Q)`,
    explanation: moscaExplanation,
  };

  // Human-readable summary explanation
  const topRisks = Object.entries(breakdown)
    .filter(([k, v]) => k !== "compensating_controls" && v.weighted_score > 5)
    .sort((a, b) => b[1].weighted_score - a[1].weighted_score)
    .map(([k, v]) => `${k.replace(/_/g, " ")} (${v.weighted_score} pts: ${v.rationale})`);

  const explanation = topRisks.length > 0
    ? `Overall score ${finalScore}/100 (${severity}). Primary drivers: ${topRisks.slice(0, 3).join("; ")}.`
    : `Overall score ${finalScore}/100 (${severity}). Minimal cryptographic risk detected.`;

  return {
    score: finalScore,
    severity,
    breakdown,
    quantum_dimension: quantumDimension,
    explanation,
    evaluated_factors_count: Object.keys(breakdown).length,
  };
}

module.exports = {
  calculateMultiFactorRisk,
  DEFAULT_FACTOR_WEIGHTS,
};
