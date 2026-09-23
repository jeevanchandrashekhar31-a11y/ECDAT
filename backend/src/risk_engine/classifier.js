const { getRules } = require("./rules_loader");
const {
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
} = require("./normalizer");
const { calculateMosca } = require("./mosca_calculator");
const { getRecommendationForFinding } = require("./recommendations");
const { buildExplanation } = require("./explainability");
const { calculateMultiFactorRisk } = require("./multi_factor");
const {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  EvidenceConfidence,
  RiskConfidence,
  AssetType,
} = require("./types");

const SEVERITY_LEVELS = [
  Severities.INFORMATIONAL,
  Severities.LOW,
  Severities.MEDIUM,
  Severities.HIGH,
  Severities.CRITICAL,
];

function isSeverityGreaterOrEqual(actual, threshold) {
  const actualIdx = SEVERITY_LEVELS.indexOf(actual);
  const threshIdx = SEVERITY_LEVELS.indexOf(threshold);
  if (actualIdx === -1 || threshIdx === -1) return false;
  return actualIdx >= threshIdx;
}

/**
 * Evaluates and classifies a cryptographic finding against rulesets and policy profiles.
 *
 * @param {Object} input
 * @param {string} input.algorithm - Raw or canonical algorithm name
 * @param {number} [input.keySize] - Key size in bits
 * @param {string} [input.assetType] - Asset type (network_session, certificate, etc.)
 * @param {string} [input.dataSensitivity] - 'public', 'internal', 'confidential', 'restricted'
 * @param {string} [input.businessCriticality] - 'low', 'medium', 'high', 'critical'
 * @param {string} [input.evidenceConfidence='high'] - 'high', 'medium', 'low'
 * @param {string} [input.evidenceType] - 'ast', 'regex', 'package_inventory', etc.
 * @param {string} [input.policyProfile='internal_enterprise'] - Environment policy profile
 * @param {string} [input.scenario='baseline'] - Mosca scenario
 * @param {Object} [input.certificateProperties] - { isSelfSigned, isExpired, validityDays }
 * @param {Object} [input.protocolProperties] - { tlsVersion, cipherSuites }
 * @param {string} [input.evidenceContext] - Finding location / origin
 */
function classifyFinding(input) {
  const rules = getRules();
  const profiles = rules.policy_profiles?.profiles || {};

  // 1. Resolve Policy Profile
  const profileName = input.policyProfile || "internal_enterprise";
  const profile = profiles[profileName] || profiles.internal_enterprise;

  // 2. Normalize Inputs
  const normalizedAlgo = normalizeAlgorithm(input.algorithm, input.keySize);
  const assetType = normalizeAssetType(input.assetType);
  const dataSensitivity = normalizeDataSensitivity(
    input.dataSensitivity || profile.default_data_sensitivity,
  );
  const businessCriticality = normalizeBusinessCriticality(
    input.businessCriticality || profile.default_business_criticality,
  );
  const confidence = input.evidenceConfidence || EvidenceConfidence.HIGH;
  const isPackageInventory = input.evidenceType === "package_inventory";

  const appliedRuleIds = [];
  const policyViolations = [];
  const assumptions = [];
  const evidenceUsed = [];

  if (input.evidenceContext) evidenceUsed.push(input.evidenceContext);
  if (input.keySize) evidenceUsed.push(`keySize: ${input.keySize} bits`);
  if (input.certificateProperties)
    evidenceUsed.push(
      `certProps: ${JSON.stringify(input.certificateProperties)}`,
    );

  const matchedRule = normalizedAlgo.matchedRule;
  let classicalRisk = matchedRule?.classical_risk_level || "none";
  const quantumRelevance =
    matchedRule?.quantum_relevance || QuantumRelevance.NOT_APPLICABLE;

  if (matchedRule) {
    appliedRuleIds.push(matchedRule.id);
  }

  // 3. Evaluate Key Size & Algorithm Conditions
  const keySize = normalizedAlgo.keySize;
  if (matchedRule?.conditions && keySize) {
    for (const cond of matchedRule.conditions) {
      if (cond.key_size_threshold_bits !== undefined && cond.operator) {
        let matches = false;
        if (cond.operator === "<" && keySize < cond.key_size_threshold_bits)
          matches = true;
        else if (
          cond.operator === "<=" &&
          keySize <= cond.key_size_threshold_bits
        )
          matches = true;
        else if (
          cond.operator === "==" &&
          keySize === cond.key_size_threshold_bits
        )
          matches = true;
        else if (
          cond.operator === ">=" &&
          keySize >= cond.key_size_threshold_bits
        )
          matches = true;
        else if (
          cond.operator === ">" &&
          keySize > cond.key_size_threshold_bits
        )
          matches = true;

        if (matches) {
          classicalRisk = cond.classical_risk_level;
          appliedRuleIds.push(
            `${matchedRule.id}_cond_${cond.operator}_${cond.key_size_threshold_bits}`,
          );
          normalizedAlgo.matchedConditionNote = cond.note;
          break;
        }
      }
    }
  }

  // 4. Evaluate Policy Profile Constraints
  // Key size policy
  if (keySize) {
    if (
      normalizedAlgo.canonicalName === "RSA" &&
      keySize < profile.key_size_policy.min_rsa_bits
    ) {
      policyViolations.push(
        `RSA key size ${keySize} bits is below profile requirement (${profile.key_size_policy.min_rsa_bits} bits)`,
      );
    }
    if (
      ["ECDSA", "ECDH"].includes(normalizedAlgo.canonicalName) &&
      keySize < profile.key_size_policy.min_ecc_bits
    ) {
      policyViolations.push(
        `ECC key size ${keySize} bits is below profile requirement (${profile.key_size_policy.min_ecc_bits} bits)`,
      );
    }
    if (
      normalizedAlgo.canonicalName === "Diffie-Hellman" &&
      keySize < profile.key_size_policy.min_dh_bits
    ) {
      policyViolations.push(
        `DH group ${keySize} bits is below profile requirement (${profile.key_size_policy.min_dh_bits} bits)`,
      );
    }
  }

  // TLS protocol policy
  const protoVersion =
    input.protocolProperties?.tlsVersion ||
    (normalizedAlgo.canonicalName.startsWith("TLS")
      ? normalizedAlgo.canonicalName
      : null);
  if (protoVersion) {
    if (profile.tls_policy.prohibited_versions.includes(protoVersion)) {
      policyViolations.push(
        `Protocol ${protoVersion} is prohibited under '${profileName}' policy`,
      );
      classicalRisk = "critical";
    }
  }

  // Certificate policy
  const certProps = input.certificateProperties || {};
  if (certProps.isSelfSigned) {
    if (!profile.certificate_policy.allow_self_signed) {
      if (profile.certificate_policy.allow_self_signed_with_exception) {
        policyViolations.push(
          "Self-signed certificate in use (acceptable under documented internal exception)",
        );
      } else {
        policyViolations.push(
          "Self-signed certificate is strictly prohibited in this environment",
        );
      }
    }
  }
  if (certProps.isExpired) {
    policyViolations.push("Certificate is expired");
    if (classicalRisk !== "critical") classicalRisk = "high";
  }

  // 5. Evaluate Mosca Quantum Risk
  const isIntegrityOnly =
    (matchedRule?.category === "digital_signature" ||
      matchedRule?.category === "hash" ||
      assetType === AssetType.CERTIFICATE ||
      input.category === "digital_signature") &&
    input.category !== "key_exchange" &&
    assetType !== AssetType.NETWORK_SESSION;
  const moscaResult = calculateMosca({
    assetType,
    dataSensitivity,
    businessCriticality,
    scenario: input.scenario || "baseline",
    quantumRelevance,
    isIntegrityOnly,
    customX: input.customX,
    customY: input.customY,
    policyProfile: profile,
  });

  // 6. Resolve Overall Severity
  let severity = Severities.INFORMATIONAL;

  if (
    classicalRisk === "critical" ||
    policyViolations.some(
      (v) => v.includes("prohibited") && !v.includes("exception"),
    )
  ) {
    severity = Severities.CRITICAL;
  } else if (
    moscaResult.status === MoscaStatus.CRITICAL_URGENT &&
    (dataSensitivity === "restricted" || dataSensitivity === "confidential")
  ) {
    severity = Severities.CRITICAL;
  } else if (classicalRisk === "high" || certProps.isExpired) {
    severity = Severities.HIGH;
  } else if (
    moscaResult.status === MoscaStatus.AT_RISK &&
    dataSensitivity !== "public"
  ) {
    severity = Severities.HIGH;
  } else if (policyViolations.length > 0) {
    severity =
      profileName === "regulated_bfsi" ||
      profileName === "government_high_value" ||
      profile?.cicd_fail_threshold === "medium"
        ? Severities.HIGH
        : Severities.MEDIUM;
  } else if (
    classicalRisk === "medium" ||
    moscaResult.status === MoscaStatus.WATCH
  ) {
    severity = Severities.MEDIUM;
  } else if (
    classicalRisk === "low" ||
    (normalizedAlgo.canonicalName === "AES" && keySize === 128)
  ) {
    severity = Severities.LOW;
  } else {
    severity = Severities.INFORMATIONAL;
  }

  // Discount / caveat for package inventory
  if (isPackageInventory) {
    assumptions.push(
      "Library presence confirmed via package inventory; does not prove active cryptographic invocation.",
    );
    if (severity === Severities.CRITICAL) {
      // Lower package-only detection to High unless active runtime exploitation proof exists
      severity = Severities.HIGH;
    }
  }

  if (confidence === EvidenceConfidence.LOW) {
    assumptions.push(
      "Finding confidence is LOW; requires manual security verification.",
    );
  }

  // 6.5. Override Mosca Status if classical severity is Critical/High (prevent SAFE + Critical contradictions)
  if (severity === Severities.CRITICAL) {
    moscaResult.status = MoscaStatus.CRITICAL_URGENT;
    moscaResult.explanation = "Critical classical vulnerability supersedes Mosca status urgency.";
  } else if (severity === Severities.HIGH && moscaResult.status !== MoscaStatus.CRITICAL_URGENT) {
    moscaResult.status = MoscaStatus.AT_RISK;
    moscaResult.explanation = "High classical vulnerability supersedes Mosca status urgency.";
  }

  // 7. Get Context-Aware Recommendation
  const protocolName =
    input.protocol || input.protocolProperties?.protocol || protoVersion;
  const recommendation = getRecommendationForFinding({
    canonicalAlgorithm: normalizedAlgo.canonicalName,
    algorithm: normalizedAlgo.canonicalName,
    assetType,
    keySize,
    category: matchedRule?.category,
    protocol: protocolName,
    evidence: evidenceUsed,
    severity,
    mosca: moscaResult,
    dataSensitivity,
    businessCriticality,
    certificateProperties: certProps,
  });

  // 8. CI/CD Pass / Fail Gate
  const failThreshold = profile.cicd_fail_threshold || "high";
  let cicdPass = true;
  if (failThreshold !== "none") {
    const thresholdSeverity =
      failThreshold.charAt(0).toUpperCase() + failThreshold.slice(1);
    if (isSeverityGreaterOrEqual(severity, thresholdSeverity)) {
      cicdPass = false;
    }
  }

  // 9. Build Explainability
  const explanation = buildExplanation({
    canonicalAlgorithm: normalizedAlgo.canonicalName,
    severity,
    appliedRuleIds,
    evidenceUsed,
    assumptions,
    moscaResult,
    policyViolations,
    recommendation,
    threatContext: matchedRule?.deprecation_notes,
    quantumRelevance,
    matchedConditionNote: normalizedAlgo.matchedConditionNote,
    references: matchedRule?.references || [],
  });

  // 10. Multi-Factor Risk Assessment (Phase 9.1)
  const multiFactorResult = calculateMultiFactorRisk(
    {
      algorithm: normalizedAlgo.canonicalName,
      keySize,
      assetType,
      protocol: input.protocolProperties?.type || input.protocol,
      tlsVersion: input.protocolProperties?.version || input.tlsVersion,
      cipherSuites: input.protocolProperties?.cipherSuites,
      certificateProperties: input.certificateProperties,
      policyProfile: profileName,
      businessCriticality,
      dataSensitivity,
      reachability: input.reachability || input.reachabilityLevel,
      isInternetExposed: input.isInternetExposed || profileName === "public_internet",
      owner: input.owner,
      compensatingControls: input.compensatingControls,
      hasActiveCve: input.hasActiveCve,
      dependencyBlastRadius: input.dependencyBlastRadius,
    },
    input.customWeights,
  );

  // 11. Separate Risk Severity from Risk Confidence (Phase 9.2)
  let riskConfidence = RiskConfidence.HIGH;
  let confidenceScore = 0.85;
  let confidenceRationale = "Deterministic static or verified detection.";

  const rawConf = String(input.evidenceConfidence || input.confidence || "").toUpperCase();
  const evidenceType = String(input.evidenceType || "").toLowerCase();
  const reachability = String(input.reachability || input.reachabilityLevel || "").toUpperCase();

  if (reachability === "RUNTIME_CONFIRMED" || rawConf === "CONFIRMED") {
    riskConfidence = RiskConfidence.CONFIRMED;
    confidenceScore = 1.0;
    confidenceRationale = "Active runtime execution or negotiated network handshake positively confirmed.";
  } else if (rawConf === "LOW" || evidenceType.includes("regex") || evidenceType.includes("heuristic") || isPackageInventory) {
    riskConfidence = RiskConfidence.LOW;
    confidenceScore = 0.35;
    confidenceRationale = isPackageInventory
      ? "Library presence confirmed via package inventory only; does not prove active cryptographic invocation."
      : "Single pattern or heuristic match; uncertain detection requiring manual security verification.";
  } else if (rawConf === "MEDIUM" || reachability === "TRANSIENT_IMPORT" || evidenceType.includes("symbol")) {
    riskConfidence = RiskConfidence.MEDIUM;
    confidenceScore = 0.6;
    confidenceRationale = "Binary symbol or transitive import identified without direct call-graph or live trace.";
  } else if (evidenceType.includes("ast") || reachability === "DIRECT_API_CALL" || rawConf === "HIGH") {
    riskConfidence = RiskConfidence.HIGH;
    confidenceScore = 0.85;
    confidenceRationale = "Direct call-graph or deterministic syntax tree match verified.";
  }

  const isUncertainDetection = riskConfidence === RiskConfidence.LOW || riskConfidence === RiskConfidence.HEURISTIC;

  return {
    algorithm: normalizedAlgo.canonicalName,
    key_size: keySize,
    asset_type: assetType,
    data_sensitivity: dataSensitivity,
    business_criticality: businessCriticality,
    policy_profile: profileName,
    classical_risk: classicalRisk,
    quantum_relevance: quantumRelevance,
    severity,
    risk_severity: severity,
    risk_confidence: riskConfidence,
    confidence,
    confidence_score: confidenceScore,
    confidence_rationale: confidenceRationale,
    is_uncertain_detection: isUncertainDetection,
    action_guidance: isUncertainDetection
      ? "Uncertain detection: Verify actively before treating as confirmed fact."
      : "Verified detection: Proceed with remediation planning.",
    cicd_pass: cicdPass,
    policy_violations: policyViolations,
    mosca: moscaResult,
    recommendation,
    explanation: explanation.summary,
    applied_rule_ids: appliedRuleIds,
    multi_factor: multiFactorResult,
    risk_score: multiFactorResult.score,
    factor_breakdown: multiFactorResult.breakdown,
  };
}

module.exports = {
  classifyFinding,
  calculateMultiFactorRisk,
};
