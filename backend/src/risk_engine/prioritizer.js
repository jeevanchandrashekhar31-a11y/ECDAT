/**
 * Enterprise Risk Prioritization Engine (Phase 9.3)
 *
 * Implements holistic enterprise prioritization across:
 * - Top critical assets
 * - Business-unit risk
 * - Application risk
 * - Internet-facing risk
 * - PQC migration urgency
 * - Certificate urgency
 * - Dependency blast radius
 * - Remediation effort (including quick wins)
 *
 * Provides explainable "Why Now?" reasoning for every priority tier.
 */

const {
  Severities,
  MoscaStatus,
  QuantumRelevance,
  RiskConfidence,
  RemediationEffort,
  AssetType,
} = require("./types");
const { classifyFinding } = require("./classifier");

/**
 * Determines the remediation effort for a cryptographic asset or finding.
 *
 * @param {Object} item - Finding or asset details
 * @returns {string} RemediationEffort (LOW, MEDIUM, HIGH, COMPLEX)
 */
function determineRemediationEffort(item) {
  const assetType = item.asset_type || item.assetType;
  const algo = (item.algorithm || "").toUpperCase();
  const certProps = item.certificateProperties || item.certificate_properties || {};

  if (certProps.isExpired || certProps.daysToExpiry !== undefined || certProps.isSelfSigned) {
    return RemediationEffort.LOW;
  }

  // Disabling a weak/deprecated protocol or cipher suite is a configuration change
  if (["TLS 1.0", "TLS 1.1", "SSLV3", "SSL 3.0", "3DES", "RC4"].some((p) => algo.includes(p))) {
    return RemediationEffort.LOW;
  }

  if (assetType === AssetType.NETWORK_SESSION || assetType === "network_session") {
    // Hybrid PQC key exchange protocol negotiation
    return RemediationEffort.HIGH;
  }

  if (assetType === AssetType.STORED_ENCRYPTED_DATA || assetType === "stored_encrypted_data") {
    // Requires data re-encryption, key distribution, schema migration
    return RemediationEffort.COMPLEX;
  }

  if (assetType === AssetType.HARDCODED_PRIVATE_KEY || assetType === "hardcoded_private_key") {
    // Key rotation and secret management integration
    return RemediationEffort.HIGH;
  }

  if (assetType === AssetType.LIBRARY_PRESENCE || assetType === "library_presence") {
    return RemediationEffort.MEDIUM;
  }

  if (item.mosca?.status === MoscaStatus.CRITICAL_URGENT || item.mosca?.status === MoscaStatus.AT_RISK) {
    return RemediationEffort.COMPLEX;
  }

  if (algo.includes("MD5") || algo.includes("SHA1") || algo.includes("SHA-1") || algo.includes("DES")) {
    return RemediationEffort.HIGH; // Code-level API replacement
  }

  return RemediationEffort.MEDIUM;
}

/**
 * Generates an explainable "Why Now?" justification for an asset or finding.
 *
 * @param {Object} item
 * @returns {Object} { urgency: string, rationale: string, trigger_factors: string[], consequences_of_delay: string }
 */
function generateWhyNowReasoning(item) {
  const triggerFactors = [];
  let urgency = "SCHEDULED";
  let rationale = "Standard remediation schedule based on baseline policy.";
  let consequences = "Accumulation of technical debt and gradual policy non-compliance.";

  const isInternet = Boolean(item.is_internet_facing || item.isInternetExposed);
  const certProps = item.certificateProperties || item.certificate_properties || {};
  const isExpiredCert = Boolean(certProps.isExpired || (certProps.daysToExpiry !== undefined && certProps.daysToExpiry <= 0));
  const isExpiringSoon = certProps.daysToExpiry !== undefined && certProps.daysToExpiry > 0 && certProps.daysToExpiry <= 14;
  const isMoscaUrgent = item.mosca?.status === MoscaStatus.CRITICAL_URGENT;
  const isMoscaAtRisk = item.mosca?.status === MoscaStatus.AT_RISK;
  const isBrokenClassical = ["MD5", "DES", "RC4", "3DES", "TLS 1.0", "TLS 1.1", "SSLV3", "SSL 3.0"].some((b) => (item.algorithm || "").toUpperCase().includes(b));
  const blastRadius = parseInt(item.dependency_blast_radius || item.dependencyBlastRadius || 1, 10);
  const effort = item.remediation_effort || determineRemediationEffort(item);
  const riskScore = Number(item.risk_score || 0);

  if (isInternet) triggerFactors.push("internet_facing");
  if (isExpiredCert) triggerFactors.push("certificate_expired");
  if (isExpiringSoon) triggerFactors.push("certificate_expiring_imminently");
  if (isMoscaUrgent) triggerFactors.push("mosca_quantum_deficit");
  if (isMoscaAtRisk) triggerFactors.push("mosca_quantum_at_risk");
  if (isBrokenClassical) triggerFactors.push("broken_classical_algorithm");
  if (blastRadius >= 5) triggerFactors.push("high_blast_radius");

  // Immediate urgency conditions
  if (isExpiredCert || isExpiringSoon) {
    urgency = "IMMEDIATE";
    const days = certProps.daysToExpiry !== undefined ? certProps.daysToExpiry : 0;
    rationale = isExpiredCert
      ? `Certificate is expired on ${isInternet ? "public internet" : "internal"} endpoint; actively causing TLS handshake terminations.`
      : `Certificate expires in ${days} day(s); automated connection failures will begin immediately upon expiration.`;
    consequences = "Immediate production service outages, broken mTLS integrations, and customer browser security blocks.";
  } else if ((isBrokenClassical && isInternet) || (isInternet && riskScore >= 75)) {
    urgency = "IMMEDIATE";
    rationale = `Broken or deprecated algorithm/protocol (${item.algorithm}) exposed directly on public internet endpoint. Adversaries can exploit known weaknesses or harvest traffic without authentication.`;
    consequences = "Active adversary compromise, session decryption, and immediate compliance failure under PCI-DSS / ISO 27001.";
  } else if (isMoscaUrgent) {
    urgency = "IMMEDIATE";
    const X = item.mosca?.final_values?.X_shelf_life_years ?? 10;
    const Y = item.mosca?.final_values?.Y_migration_years ?? 3;
    const Z = item.mosca?.final_values?.Z_quantum_threat_years ?? 9;
    const margin = item.mosca?.mosca_margin_years ?? (X + Y - Z);
    rationale = `Quantum transition deficit: Migration time (${Y} yrs) + data shelf life (${X} yrs) exceeds quantum threat arrival (${Z} yrs) by ${margin} year(s). Encrypted data intercepted today via Harvest-Now-Decrypt-Later (HNDL) will be compromised before secrecy requirements expire.`;
    consequences = "Irreversible exposure of long-lived confidential data and intellectual property to quantum adversaries.";
  } else if (blastRadius >= 5 && isBrokenClassical) {
    urgency = "HIGH";
    rationale = `Centrally shared dependency (${item.algorithm}) impacts ${blastRadius} downstream applications. Remediating this package eliminates risk for the entire dependency graph in a single coordinated update.`;
    consequences = "Vulnerability multiplies across microservices, increasing incident blast radius and future refactoring costs.";
  } else if (isMoscaAtRisk) {
    urgency = "HIGH";
    rationale = `Quantum threat horizon window is closing (margin: ${item.mosca?.mosca_margin_years ?? 1} yr). Because cryptographic migrations require multi-year engineering cycles, planning and hybrid pilot deployment must begin in the current development cycle.`;
    consequences = "Forced emergency migration under adversary threat with high operational risk and downtime.";
  } else if (effort === RemediationEffort.LOW && riskScore >= 50) {
    urgency = "HIGH";
    rationale = `Quick Win: Substantial risk reduction (${riskScore}/100) achievable with low engineering effort (configuration change or cipher toggle). Immediate return on security investment.`;
    consequences = "Unnecessary ongoing risk exposure that could be eliminated with trivial operational friction.";
  } else if (riskScore >= 70) {
    urgency = "HIGH";
    rationale = `High multi-factor enterprise risk score (${riskScore}/100) across data sensitivity, reachability, and key strength.`;
    consequences = "Elevated risk profile contributing to overall enterprise audit findings.";
  } else if (riskScore >= 40) {
    urgency = "MEDIUM";
    rationale = `Moderate risk finding scheduled for remediation in next milestone sprint.`;
    consequences = "Accumulation of technical debt.";
  }

  return {
    urgency,
    rationale,
    trigger_factors: triggerFactors,
    consequences_of_delay: consequences,
  };
}

/**
 * Normalizes input items into a standardized asset structure for prioritization.
 */
function normalizeAssetForPrioritization(item) {
  const assetId = item.asset_id || item.bom_ref || item["bom-ref"] || item.name || item.algorithm || "crypto-asset";
  const algorithm = item.algorithm || item.name || "Unknown";
  const keySize = item.key_size || item.keySize || null;
  const assetType = item.asset_type || item.assetType || "file";
  const application = item.application || item.service || item.app_name || (item.bom_ref && item.bom_ref.includes(":") ? item.bom_ref.split(":")[0] : "Enterprise App");
  const businessUnit = item.business_unit || item.bu || item.businessUnit || "Enterprise Core";
  const owner = item.owner || "Security & Infrastructure";

  // Check internet exposure
  const isInternet = Boolean(
    item.is_internet_facing ||
    item.isInternetExposed ||
    item.policy_profile === "public_internet" ||
    (item.properties && item.properties.some((p) => p.name === "ecdat:internet_exposed" && p.value === "true")) ||
    (typeof assetId === "string" && (assetId.startsWith("net:ext") || assetId.includes("public") || assetId.includes("internet")))
  );

  const certProps = item.certificateProperties || item.certificate_properties || {};
  const mosca = item.mosca || null;
  const multiFactor = item.multi_factor || null;
  const riskScore = item.risk_score !== undefined ? Number(item.risk_score) : (multiFactor?.score !== undefined ? Number(multiFactor.score) : 50);
  const severity = item.risk_severity || item.severity || Severities.INFORMATIONAL;
  const confidence = item.risk_confidence || RiskConfidence.HIGH;
  const blastRadius = parseInt(item.dependency_blast_radius || item.blast_radius || 1, 10);
  const reachability = item.reachability || item.reachabilityLevel || "DIRECT_API_CALL";

  const remediationEffort = determineRemediationEffort({
    ...item,
    algorithm,
    asset_type: assetType,
    certificateProperties: certProps,
    mosca,
  });

  const whyNow = generateWhyNowReasoning({
    ...item,
    algorithm,
    is_internet_facing: isInternet,
    certificateProperties: certProps,
    mosca,
    remediation_effort: remediationEffort,
    risk_score: riskScore,
    dependency_blast_radius: blastRadius,
  });

  // Calculate unified Priority Score (0 - 150 scale for ranking)
  // Base = risk score (0-100)
  // Multiplied by confidence weight (Confirmed: 1.1, High: 1.0, Med: 0.8, Low: 0.5)
  // Boosted by Internet Exposure (+20) and Urgency (+25 for Immediate, +15 for High)
  let confMultiplier = 1.0;
  if (confidence === RiskConfidence.CONFIRMED) confMultiplier = 1.1;
  else if (confidence === RiskConfidence.MEDIUM) confMultiplier = 0.8;
  else if (confidence === RiskConfidence.LOW || confidence === RiskConfidence.HEURISTIC) confMultiplier = 0.5;

  let priorityScore = Math.round(riskScore * confMultiplier);
  if (isInternet) priorityScore += 20;
  if (whyNow.urgency === "IMMEDIATE") priorityScore += 25;
  else if (whyNow.urgency === "HIGH") priorityScore += 15;

  return {
    asset_id: assetId,
    algorithm,
    key_size: keySize,
    asset_type: assetType,
    application,
    business_unit: businessUnit,
    owner,
    risk_score: riskScore,
    priority_score: priorityScore,
    risk_severity: severity,
    risk_confidence: confidence,
    is_uncertain_detection: Boolean(item.is_uncertain_detection || confidence === RiskConfidence.LOW || confidence === RiskConfidence.HEURISTIC),
    is_internet_facing: isInternet,
    reachability,
    dependency_blast_radius: blastRadius,
    remediation_effort: remediationEffort,
    mosca,
    certificate_properties: certProps,
    why_now: whyNow,
    recommendation: item.recommendation || null,
    explanation: item.explanation || "",
    // Phase 1 Explicit Properties Passthrough
    primitive: item.primitive || null,
    usage: item.usage || null,
    location: item.location || null,
    service: item.service || item.application || null,
    protocol: item.protocol || null,
    certificate: item.certificate || null,
    confidence: typeof item.confidence === 'number' ? item.confidence : 1.0,
    source: item.source || null,
    is_synthetic: Boolean(item.is_synthetic),
  };
}

/**
 * Main Enterprise Prioritization function.
 *
 * @param {Array|Object} findingsOrCbom - Raw findings array, classified results, or CycloneDX CBOM
 * @param {Object} [options]
 * @param {string} [options.policyProfile='internal_enterprise']
 * @param {string} [options.threatHorizon='baseline']
 * @returns {Object} Complete enterprise prioritization insights
 */
function prioritizeEnterpriseRisk(findingsOrCbom, options = {}) {
  let rawList = [];

  // Handle CBOM object or summary object
  if (findingsOrCbom && Array.isArray(findingsOrCbom.components)) {
    rawList = findingsOrCbom.components;
  } else if (findingsOrCbom && Array.isArray(findingsOrCbom.findings)) {
    rawList = findingsOrCbom.findings;
  } else if (findingsOrCbom && Array.isArray(findingsOrCbom.top_risky_assets)) {
    rawList = findingsOrCbom.top_risky_assets;
  } else if (Array.isArray(findingsOrCbom)) {
    rawList = findingsOrCbom;
  }

  // Classify any unclassified raw items if needed
  const normalizedAssets = rawList.map((item) => {
    let classified = item;
    if (!item.multi_factor && !item.risk_score && !item.mosca) {
      classified = classifyFinding({
        algorithm: item.algorithm || item.name,
        keySize: item.key_size || item.keySize,
        assetType: item.asset_type || item.assetType,
        policyProfile: options.policyProfile || "internal_enterprise",
        threatHorizon: options.threatHorizon || "baseline",
        evidenceConfidence: item.confidence,
        evidenceType: item.evidenceType,
        reachability: item.reachability,
      });
      classified.asset_id = item.asset_id || item.bom_ref || item["bom-ref"] || item.name;
      classified.application = item.application || item.service;
      classified.business_unit = item.business_unit || item.bu;
      classified.is_internet_facing = item.is_internet_facing || item.isInternetExposed;
      classified.dependency_blast_radius = item.dependency_blast_radius || item.blast_radius;
      classified.certificateProperties = item.certificateProperties || item.certificate_properties;
    }
    return normalizeAssetForPrioritization(classified);
  });

  // 1. TOP CRITICAL ASSETS (Ranked by unified priority score)
  const topCriticalAssets = [...normalizedAssets].sort((a, b) => b.priority_score - a.priority_score).slice(0, 10);

  // 2. BUSINESS-UNIT RISK
  const buMap = new Map();
  for (const a of normalizedAssets) {
    const buName = a.business_unit;
    if (!buMap.has(buName)) {
      buMap.set(buName, {
        business_unit: buName,
        total_assets: 0,
        risk_scores: [],
        critical_count: 0,
        high_count: 0,
        internet_facing_count: 0,
        pqc_urgent_count: 0,
        cert_urgent_count: 0,
        applications: new Set(),
        top_assets: [],
      });
    }
    const bu = buMap.get(buName);
    bu.total_assets++;
    bu.risk_scores.push(a.risk_score);
    if (a.risk_severity === Severities.CRITICAL) bu.critical_count++;
    if (a.risk_severity === Severities.HIGH) bu.high_count++;
    if (a.is_internet_facing) bu.internet_facing_count++;
    if (a.mosca?.status === MoscaStatus.CRITICAL_URGENT || a.mosca?.status === MoscaStatus.AT_RISK) bu.pqc_urgent_count++;
    const cert = a.certificate_properties;
    if (cert.isExpired || (cert.daysToExpiry !== undefined && cert.daysToExpiry <= 30)) bu.cert_urgent_count++;
    bu.applications.add(a.application);
    bu.top_assets.push(a);
  }

  const businessUnitRisk = Array.from(buMap.values()).map((bu) => {
    const avgScore = bu.risk_scores.length > 0 ? Math.round(bu.risk_scores.reduce((sum, s) => sum + s, 0) / bu.risk_scores.length) : 0;
    const maxScore = bu.risk_scores.length > 0 ? Math.max(...bu.risk_scores) : 0;
    const compositeScore = Math.round(avgScore * 0.4 + maxScore * 0.6);

    let whyNow = `Business unit manages ${bu.total_assets} cryptographic asset(s) across ${bu.applications.size} application(s).`;
    if (bu.critical_count > 0 || bu.internet_facing_count > 0) {
      whyNow += ` Immediate executive attention required: ${bu.critical_count} critical finding(s) and ${bu.internet_facing_count} internet-exposed asset(s) threaten perimeter security and compliance.`;
    } else if (bu.pqc_urgent_count > 0) {
      whyNow += ` Migration planning required: ${bu.pqc_urgent_count} asset(s) require transition to post-quantum cryptography under Mosca horizon.`;
    }

    return {
      business_unit: bu.business_unit,
      composite_risk_score: compositeScore,
      average_risk_score: avgScore,
      peak_risk_score: maxScore,
      total_assets: bu.total_assets,
      critical_count: bu.critical_count,
      high_count: bu.high_count,
      internet_facing_count: bu.internet_facing_count,
      pqc_urgent_count: bu.pqc_urgent_count,
      cert_urgent_count: bu.cert_urgent_count,
      application_count: bu.applications.size,
      applications: Array.from(bu.applications),
      why_now: whyNow,
    };
  }).sort((a, b) => b.composite_risk_score - a.composite_risk_score);

  // 3. APPLICATION RISK
  const appMap = new Map();
  for (const a of normalizedAssets) {
    const appName = a.application;
    if (!appMap.has(appName)) {
      appMap.set(appName, {
        application: appName,
        business_unit: a.business_unit,
        total_assets: 0,
        risk_scores: [],
        critical_count: 0,
        high_count: 0,
        is_internet_exposed: false,
        max_blast_radius: 1,
        algorithms: new Set(),
        efforts: [],
      });
    }
    const app = appMap.get(appName);
    app.total_assets++;
    app.risk_scores.push(a.risk_score);
    if (a.risk_severity === Severities.CRITICAL) app.critical_count++;
    if (a.risk_severity === Severities.HIGH) app.high_count++;
    if (a.is_internet_facing) app.is_internet_exposed = true;
    if (a.dependency_blast_radius > app.max_blast_radius) app.max_blast_radius = a.dependency_blast_radius;
    app.algorithms.add(a.algorithm);
    app.efforts.push(a.remediation_effort);
  }

  const applicationRisk = Array.from(appMap.values()).map((app) => {
    const avgScore = app.risk_scores.length > 0 ? Math.round(app.risk_scores.reduce((s, x) => s + x, 0) / app.risk_scores.length) : 0;
    const maxScore = app.risk_scores.length > 0 ? Math.max(...app.risk_scores) : 0;
    const appScore = Math.round(avgScore * 0.4 + maxScore * 0.6);

    let whyNow = `Application contains ${app.total_assets} cryptographic asset(s) (${Array.from(app.algorithms).slice(0, 3).join(", ")}).`;
    if (app.is_internet_exposed && app.critical_count > 0) {
      whyNow += ` Critical internet-facing exposure: actively reachable by external adversaries.`;
    } else if (app.max_blast_radius >= 5) {
      whyNow += ` Central hub dependency: impacts ${app.max_blast_radius} dependent services.`;
    } else {
      whyNow += ` Scheduled for remediation in application maintenance window.`;
    }

    return {
      application: app.application,
      business_unit: app.business_unit,
      risk_score: appScore,
      critical_count: app.critical_count,
      high_count: app.high_count,
      total_assets: app.total_assets,
      is_internet_exposed: app.is_internet_exposed,
      dependency_blast_radius: app.max_blast_radius,
      primary_algorithms: Array.from(app.algorithms),
      why_now: whyNow,
    };
  }).sort((a, b) => b.risk_score - a.risk_score);

  // 4. INTERNET-FACING RISK
  const internetAssets = normalizedAssets
    .filter((a) => a.is_internet_facing)
    .sort((a, b) => b.priority_score - a.priority_score);

  const internetFacingRisk = {
    total_exposed_assets: internetAssets.length,
    critical_exposed_count: internetAssets.filter((a) => a.risk_severity === Severities.CRITICAL).length,
    high_exposed_count: internetAssets.filter((a) => a.risk_severity === Severities.HIGH).length,
    assets: internetAssets,
    why_now: internetAssets.length > 0
      ? `${internetAssets.length} asset(s) are directly exposed to unauthenticated public internet traffic. Adversaries actively harvest network handshakes and probe for broken ciphers and expired certificates.`
      : "No publicly exposed cryptographic assets identified.",
  };

  // 5. PQC MIGRATION URGENCY
  const pqcAssets = normalizedAssets
    .filter((a) => a.mosca && a.mosca.status !== MoscaStatus.SAFE)
    .sort((a, b) => {
      const order = { [MoscaStatus.CRITICAL_URGENT]: 3, [MoscaStatus.AT_RISK]: 2, [MoscaStatus.WATCH]: 1 };
      const statusDiff = (order[b.mosca.status] || 0) - (order[a.mosca.status] || 0);
      if (statusDiff !== 0) return statusDiff;
      return (b.mosca.mosca_margin_years || 0) - (a.mosca.mosca_margin_years || 0);
    });

  const pqcMigrationUrgency = {
    critical_urgent_count: pqcAssets.filter((a) => a.mosca.status === MoscaStatus.CRITICAL_URGENT).length,
    at_risk_count: pqcAssets.filter((a) => a.mosca.status === MoscaStatus.AT_RISK).length,
    watch_count: pqcAssets.filter((a) => a.mosca.status === MoscaStatus.WATCH).length,
    assets: pqcAssets.map((a) => ({
      asset_id: a.asset_id,
      algorithm: a.algorithm,
      key_size: a.key_size,
      application: a.application,
      status: a.mosca.status,
      shelf_life_years: a.mosca.final_values?.X_shelf_life_years,
      migration_years: a.mosca.final_values?.Y_migration_years,
      quantum_threat_years: a.mosca.final_values?.Z_quantum_threat_years,
      mosca_margin_years: a.mosca.mosca_margin_years,
      why_now: a.why_now.rationale,
      consequences_of_delay: a.why_now.consequences_of_delay,
      recommendation: a.recommendation?.recommended_target || "Migrate to NIST FIPS 203/204 hybrid scheme",
    })),
    why_now: pqcAssets.some((a) => a.mosca.status === MoscaStatus.CRITICAL_URGENT)
      ? "CRITICAL QUANTUM DEFICIT: Data shelf life plus migration timeline exceeds quantum threat horizon. Harvest-Now-Decrypt-Later (HNDL) attacks are ongoing."
      : "Quantum threat horizon window requires multi-year transition planning before CRQC (Cryptanalytically Relevant Quantum Computer) capability matures.",
  };

  // 6. CERTIFICATE URGENCY
  const certAssets = normalizedAssets
    .filter((a) => a.asset_type === AssetType.CERTIFICATE || a.asset_type === "certificate" || a.certificate_properties.daysToExpiry !== undefined || a.certificate_properties.isExpired)
    .sort((a, b) => {
      const daysA = a.certificate_properties.daysToExpiry ?? 999;
      const daysB = b.certificate_properties.daysToExpiry ?? 999;
      return daysA - daysB;
    });

  const expiredCount = certAssets.filter((a) => a.certificate_properties.isExpired || (a.certificate_properties.daysToExpiry !== undefined && a.certificate_properties.daysToExpiry <= 0)).length;
  const expiring14d = certAssets.filter((a) => a.certificate_properties.daysToExpiry !== undefined && a.certificate_properties.daysToExpiry > 0 && a.certificate_properties.daysToExpiry <= 14).length;
  const expiring30d = certAssets.filter((a) => a.certificate_properties.daysToExpiry !== undefined && a.certificate_properties.daysToExpiry > 14 && a.certificate_properties.daysToExpiry <= 30).length;
  const selfSignedCount = certAssets.filter((a) => a.certificate_properties.isSelfSigned).length;

  const certificateUrgency = {
    total_certificates: certAssets.length,
    expired_count: expiredCount,
    expiring_within_14_days: expiring14d,
    expiring_within_30_days: expiring30d,
    self_signed_count: selfSignedCount,
    certificates: certAssets.map((c) => ({
      asset_id: c.asset_id,
      application: c.application,
      algorithm: c.algorithm,
      days_to_expiry: c.certificate_properties.daysToExpiry ?? (c.certificate_properties.isExpired ? 0 : "N/A"),
      is_expired: Boolean(c.certificate_properties.isExpired || (c.certificate_properties.daysToExpiry !== undefined && c.certificate_properties.daysToExpiry <= 0)),
      is_self_signed: Boolean(c.certificate_properties.isSelfSigned),
      is_internet_facing: c.is_internet_facing,
      urgency: c.why_now.urgency,
      why_now: c.why_now.rationale,
    })),
    why_now: expiredCount > 0 || expiring14d > 0
      ? `${expiredCount + expiring14d} certificate(s) are expired or expiring within 14 days. Renewal must occur immediately to prevent active service blackouts and connection rejections.`
      : "All tracked certificates have sufficient validity window (> 30 days).",
  };

  // 7. DEPENDENCY BLAST RADIUS
  const highBlastAssets = normalizedAssets
    .filter((a) => a.dependency_blast_radius >= 2 || a.asset_type === AssetType.LIBRARY_PRESENCE || a.asset_type === "library_presence")
    .sort((a, b) => b.dependency_blast_radius - a.dependency_blast_radius);

  const dependencyBlastRadius = {
    total_shared_components: highBlastAssets.length,
    high_blast_count: highBlastAssets.filter((a) => a.dependency_blast_radius >= 5).length,
    components: highBlastAssets.map((d) => ({
      asset_id: d.asset_id,
      algorithm: d.algorithm,
      application: d.application,
      reachability: d.reachability,
      blast_radius: d.dependency_blast_radius,
      risk_severity: d.risk_severity,
      why_now: `Shared by ${d.dependency_blast_radius} service(s). Remediating centrally eliminates vulnerability across the entire downstream dependency graph in one deployment.`,
    })),
    why_now: highBlastAssets.some((a) => a.dependency_blast_radius >= 5)
      ? "Central crypto packages with high fan-out multiply risk across the enterprise. Prioritize upstream library updates for maximum security leverage."
      : "Dependencies have isolated blast radius with limited downstream fan-out.",
  };

  // 8. REMEDIATION EFFORT & QUICK WINS
  const quickWins = normalizedAssets.filter(
    (a) => a.remediation_effort === RemediationEffort.LOW && (a.risk_score >= 50 || a.risk_severity === Severities.CRITICAL || a.risk_severity === Severities.HIGH)
  );
  const lowEffort = normalizedAssets.filter((a) => a.remediation_effort === RemediationEffort.LOW);
  const mediumEffort = normalizedAssets.filter((a) => a.remediation_effort === RemediationEffort.MEDIUM);
  const highEffort = normalizedAssets.filter((a) => a.remediation_effort === RemediationEffort.HIGH);
  const complexEffort = normalizedAssets.filter((a) => a.remediation_effort === RemediationEffort.COMPLEX);

  const remediationEffort = {
    quick_wins_count: quickWins.length,
    quick_wins: quickWins.map((q) => ({
      asset_id: q.asset_id,
      algorithm: q.algorithm,
      application: q.application,
      risk_score: q.risk_score,
      risk_severity: q.risk_severity,
      action: q.certificate_properties.isExpired || q.certificate_properties.daysToExpiry !== undefined
        ? "Renew / rotate X.509 certificate"
        : "Disable weak protocol/cipher via configuration",
      why_now: "Quick Win: High risk reduction achievable with configuration-only changes in current sprint.",
    })),
    effort_breakdown: {
      [RemediationEffort.LOW]: lowEffort.length,
      [RemediationEffort.MEDIUM]: mediumEffort.length,
      [RemediationEffort.HIGH]: highEffort.length,
      [RemediationEffort.COMPLEX]: complexEffort.length,
    },
    why_now: quickWins.length > 0
      ? `Execute ${quickWins.length} Quick Win(s) immediately for maximum risk reduction with minimal engineering overhead, while scheduling Complex PQC and data re-encryption initiatives in parallel.`
      : "Remediation efforts require standard code updates and planned migration phases.",
  };

  return {
    top_critical_assets: topCriticalAssets,
    business_unit_risk: businessUnitRisk,
    application_risk: applicationRisk,
    internet_facing_risk: internetFacingRisk,
    pqc_migration_urgency: pqcMigrationUrgency,
    certificate_urgency: certificateUrgency,
    dependency_blast_radius: dependencyBlastRadius,
    remediation_effort: remediationEffort,
  };
}

module.exports = {
  prioritizeEnterpriseRisk,
  determineRemediationEffort,
  generateWhyNowReasoning,
};
