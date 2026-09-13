/**
 * ECDAT Domain Contracts (Node.js)
 * Formal domain models and interfaces establishing explicit domain boundaries
 * between discovery, normalization, risk assessment, policy evaluation, and reporting.
 */

const crypto = require("crypto");

// =====================================================================
// Shared Enumerations
// =====================================================================
const ScanType = Object.freeze({
  STATIC: "static",
  NETWORK: "network",
  BINARY_CONTAINER: "binary_container",
  CBOM_IMPORT: "cbom_import",
  HYBRID: "hybrid",
  RUNTIME: "runtime",
});

const ScanStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  SUCCESS: "success",
  PARTIAL: "partial",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const SeverityLevel = Object.freeze({
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
  UNCLASSIFIED: "Unclassified",
});

const ConfidenceLevel = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

const AssetType = Object.freeze({
  // Core cryptographic primitives & material
  ALGORITHM: "algorithm",
  CERTIFICATE: "certificate",
  KEY_METADATA: "key_metadata",
  HARDCODED_PRIVATE_KEY: "hardcoded_private_key",
  SIGNING_KEY: "signing_key",
  STORED_ENCRYPTED_DATA: "stored_encrypted_data",
  DATA_ASSET: "data_asset",

  // Software & system layers
  APPLICATION: "application",
  SERVICE: "service",
  REPOSITORY: "repository",
  FILE: "file",
  FUNCTION: "function",
  DEPENDENCY: "dependency",
  CRYPTO_LIBRARY: "crypto_library",

  // Network, host, & runtime boundaries
  PROTOCOL: "protocol",
  PROTOCOL_SESSION: "protocol_session",
  NETWORK_ENDPOINT: "network_endpoint",
  ENDPOINT: "endpoint",
  CONTAINER: "container",
  HOST: "host",
  RUNTIME_PROCESS: "runtime_process",

  // Governance, operations, & risk
  OWNER: "owner",
  ENVIRONMENT: "environment",
  POLICY: "policy",
  FINDING: "finding",
  RISK: "risk",
  REMEDIATION: "remediation",
});

const RelationshipType = Object.freeze({
  CONTAINS: "contains",
  DEPENDS_ON: "depends_on",
  SECURES: "secures",
  USES: "uses",
  SIGNS: "signs",
  IMPLEMENTS: "implements",
  // Phase 7.1 Canonical Graph Relationships
  PROTECTS: "protects",
  PRESENT_IN: "present_in",
  OBSERVED_BY: "observed_by"  ,
  TERMINATES_AT: "terminates_at",
  OWNED_BY: "owned_by",
  VIOLATES: "violates",
  REMEDIATED_BY: "remediated_by",
  HOSTS_PROCESS: "hosts_process",
  // First-class hybrid & PQC relationship types (Phase 5.3)
  HAS_CLASSICAL_COMPONENT: "has_classical_component",
  HAS_POST_QUANTUM_COMPONENT: "has_post_quantum_component",
  USES_HYBRID_COMBINER: "uses_hybrid_combiner",
  NEGOTIATED_KEY_EXCHANGE: "negotiated_key_exchange",
  AUTHENTICATED_BY_SIGNATURE: "authenticated_by_signature",
});

const EvidenceSource = Object.freeze({
  STATIC_CONFIGURATION: "static_configuration",
  NETWORK_HANDSHAKE: "network_handshake",
  RUNTIME: "runtime",
});

const QuantumRelevance = Object.freeze({
  SHOR_VULNERABLE: "shor_vulnerable",
  GROVER_SENSITIVE: "grover_sensitive",
  QUANTUM_SAFE: "quantum_safe",
  NOT_APPLICABLE: "not_applicable",
});

const MoscaStatus = Object.freeze({
  SAFE: "SAFE",
  WATCH: "WATCH",
  AT_RISK: "AT_RISK",
  CRITICAL_URGENT: "CRITICAL_URGENT",
});

const CryptoReachabilityLevel = Object.freeze({
  CAPABILITY_PRESENT: "CAPABILITY_PRESENT",
  TRANSIENT_IMPORT: "TRANSIENT_IMPORT",
  DIRECT_API_CALL: "DIRECT_API_CALL",
  RUNTIME_CONFIRMED: "RUNTIME_CONFIRMED",
});

const CryptoImpactType = Object.freeze({
  KEY_COMPROMISE: "KEY_COMPROMISE",
  ENCRYPTION_BYPASS: "ENCRYPTION_BYPASS",
  SIGNATURE_FORGERY: "SIGNATURE_FORGERY",
  CERT_VALIDATION_BYPASS: "CERT_VALIDATION_BYPASS",
  SIDE_CHANNEL_LEAKAGE: "SIDE_CHANNEL_LEAKAGE",
  WEAK_RANDOMNESS: "WEAK_RANDOMNESS",
  RCE_IN_HANDSHAKE: "RCE_IN_HANDSHAKE",
  DENIAL_OF_SERVICE: "DENIAL_OF_SERVICE",
  INFORMATION_DISCLOSURE: "INFORMATION_DISCLOSURE",
  UNKNOWN: "UNKNOWN",
});

const ExploitabilityStatus = Object.freeze({
  UNREACHABLE: "UNREACHABLE",
  UNCONFIRMED_IMPORT: "UNCONFIRMED_IMPORT",
  POTENTIALLY_EXPLOITABLE: "POTENTIALLY_EXPLOITABLE",
  ACTIVE_IN_PATH: "ACTIVE_IN_PATH",
});



// =====================================================================
// 1. Evidence
// =====================================================================
class Evidence {
  constructor({
    location,
    lineNumber = null,
    columnNumber = null,
    snippet = null,
    proofType = "source_code",
    confidence = ConfidenceLevel.HIGH,
    rawAttributes = {},
  }) {
    if (!location) throw new Error("Evidence requires a valid location");
    this.location = String(location);
    this.lineNumber = lineNumber !== null ? Number(lineNumber) : null;
    this.columnNumber = columnNumber !== null ? Number(columnNumber) : null;
    this.snippet = snippet ? String(snippet) : null;
    this.proofType = String(proofType);
    this.confidence = confidence;
    this.rawAttributes = { ...rawAttributes };
    Object.freeze(this);
  }
}

// =====================================================================
// 2. Observation
// =====================================================================
class Observation {
  constructor({
    observationId,
    discoveryEngine,
    target,
    rawAlgorithm = null,
    rawKeySize = null,
    rawProtocol = null,
    evidence,
    observedAt = new Date().toISOString(),
  }) {
    this.observationId = observationId || `obs_${crypto.randomUUID()}`;
    if (!discoveryEngine) throw new Error("Observation requires discoveryEngine");
    if (!target) throw new Error("Observation requires target");
    this.discoveryEngine = String(discoveryEngine);
    this.target = String(target);
    this.rawAlgorithm = rawAlgorithm ? String(rawAlgorithm) : null;
    this.rawKeySize = rawKeySize !== null && rawKeySize !== undefined ? String(rawKeySize) : null;
    this.rawProtocol = rawProtocol ? String(rawProtocol) : null;
    this.evidence = evidence instanceof Evidence ? evidence : new Evidence(evidence || { location: target });
    this.observedAt = observedAt;
    Object.freeze(this);
  }
}

// =====================================================================
// 3. Finding
// =====================================================================
class Finding {
  constructor({
    findingId,
    assetId,
    algorithmStandard,
    primitiveType = "unknown",
    keySizeBits = null,
    curveName = null,
    mode = null,
    severity = SeverityLevel.INFORMATIONAL,
    confidence = ConfidenceLevel.HIGH,
    evidence,
    analysisSource = "ast",
    needsHumanReview = false,
    reviewReason = null,
  }) {
    this.findingId = findingId || `fnd_${crypto.randomUUID()}`;
    this.assetId = String(assetId || "global");
    if (!algorithmStandard) throw new Error("Finding requires algorithmStandard");
    this.algorithmStandard = String(algorithmStandard);
    this.primitiveType = String(primitiveType);
    this.keySizeBits = keySizeBits !== null && keySizeBits !== undefined ? Number(keySizeBits) : null;
    this.curveName = curveName ? String(curveName) : null;
    this.mode = mode ? String(mode) : null;
    this.severity = severity;
    this.confidence = confidence;
    this.evidence = evidence instanceof Evidence ? evidence : new Evidence(evidence || { location: this.assetId });
    this.analysisSource = String(analysisSource);
    this.needsHumanReview = Boolean(needsHumanReview);
    this.reviewReason = reviewReason ? String(reviewReason) : null;
    Object.freeze(this);
  }
}

// =====================================================================
// 4. CryptoAsset
// =====================================================================
class CryptoAsset {
  constructor({
    assetId,
    primaryIdentifier,
    assetType = AssetType.ALGORITHM,
    dataSensitivity = "internal",
    businessCriticality = "medium",
    highestSeverity = SeverityLevel.INFORMATIONAL,
    atQuantumRisk = false,
    findingsCount = 0,
    components = [],
    properties = {},
  }) {
    if (!assetId) throw new Error("CryptoAsset requires assetId");
    this.assetId = String(assetId);
    this.primaryIdentifier = String(primaryIdentifier || assetId);
    this.assetType = assetType;
    this.dataSensitivity = String(dataSensitivity);
    this.businessCriticality = String(businessCriticality);
    this.highestSeverity = highestSeverity;
    this.atQuantumRisk = Boolean(atQuantumRisk);
    this.findingsCount = Number(findingsCount) || 0;
    this.components = [...components];
    this.properties = { ...properties };
    Object.freeze(this);
  }
}

// =====================================================================
// 5. AssetRelationship
// =====================================================================
class AssetRelationship {
  constructor({ sourceId, targetId, relationshipType = RelationshipType.CONTAINS, metadata = {} }) {
    if (!sourceId || !targetId) throw new Error("AssetRelationship requires sourceId and targetId");
    this.sourceId = String(sourceId);
    this.targetId = String(targetId);
    this.relationshipType = relationshipType;
    this.metadata = { ...metadata };
    Object.freeze(this);
  }
}

// =====================================================================
// 6. RiskAssessment
// =====================================================================
class RiskAssessment {
  constructor({
    classicalSeverity = SeverityLevel.INFORMATIONAL,
    classicalScore = 0.0,
    quantumRelevance = QuantumRelevance.NOT_APPLICABLE,
    groverSecurityMargin = null,
    shorVulnerable = false,
    moscaStatus = MoscaStatus.SAFE,
    moscaCollapseYear = null,
    explainability = [],
  }) {
    this.classicalSeverity = classicalSeverity;
    this.classicalScore = Number(classicalScore) || 0.0;
    this.quantumRelevance = quantumRelevance;
    this.groverSecurityMargin = groverSecurityMargin !== null ? Number(groverSecurityMargin) : null;
    this.shorVulnerable = Boolean(shorVulnerable);
    this.moscaStatus = moscaStatus;
    this.moscaCollapseYear = moscaCollapseYear !== null ? Number(moscaCollapseYear) : null;
    this.explainability = [...explainability];
    Object.freeze(this);
  }
}

// =====================================================================
// 7. PolicyEvaluation
// =====================================================================
class PolicyEvaluation {
  constructor({
    policyProfile = "standard",
    failOnThreshold = "none",
    passed = true,
    blockingReasons = [],
    violatedRules = [],
  }) {
    this.policyProfile = String(policyProfile);
    this.failOnThreshold = String(failOnThreshold);
    this.passed = Boolean(passed);
    this.blockingReasons = Array.isArray(blockingReasons) ? [...blockingReasons] : [String(blockingReasons)];
    this.violatedRules = Array.isArray(violatedRules)
      ? [...violatedRules]
      : typeof violatedRules === "object" && violatedRules !== null
        ? Object.entries(violatedRules).map(([k, v]) => ({ rule: k, count: v }))
        : [];
    Object.freeze(this);
  }
}

// =====================================================================
// 8. RemediationAction & 9. RemediationPlan
// =====================================================================
class RemediationAction {
  constructor({
    actionId,
    assetId,
    priority = 1,
    title,
    description,
    targetStandard,
    recommendedYear = new Date().getFullYear(),
    effortEstimate = "medium",
  }) {
    this.actionId = actionId || `act_${crypto.randomUUID()}`;
    this.assetId = String(assetId);
    this.priority = Number(priority) || 1;
    this.title = String(title || "Remediate Cryptographic Finding");
    this.description = String(description || "");
    this.targetStandard = String(targetStandard || "Post-Quantum Standard");
    this.recommendedYear = Number(recommendedYear);
    this.effortEstimate = String(effortEstimate);
    Object.freeze(this);
  }
}

class RemediationPlan {
  constructor({ planId, scanId, totalActions = 0, actions = [], createdAt = new Date().toISOString() }) {
    this.planId = planId || `plan_${crypto.randomUUID()}`;
    this.scanId = String(scanId);
    this.actions = actions.map((a) => (a instanceof RemediationAction ? a : new RemediationAction(a)));
    this.totalActions = this.actions.length || Number(totalActions) || 0;
    this.createdAt = createdAt;
    Object.freeze(this);
  }
}

// =====================================================================
// 10. ScanRequest & 11. ScanContext
// =====================================================================
class ScanRequest {
  constructor({
    scanType = ScanType.STATIC,
    target,
    policyProfile = "standard",
    failOn = "none",
    includeExtensions = [],
    excludeDirectories = [],
    maxFileSizeBytes = 5 * 1024 * 1024,
    maxFiles = 10000,
    timeoutSeconds = 300,
    options = {},
  }) {
    if (!target) throw new Error("ScanRequest requires target");
    this.scanType = scanType;
    this.target = String(target);
    this.policyProfile = String(policyProfile);
    this.failOn = String(failOn);
    this.includeExtensions = [...includeExtensions];
    this.excludeDirectories = [...excludeDirectories];
    this.maxFileSizeBytes = Number(maxFileSizeBytes);
    this.maxFiles = Number(maxFiles);
    this.timeoutSeconds = Number(timeoutSeconds);
    this.options = { ...options };
    Object.freeze(this);
  }
}

class ScanContext {
  constructor({
    scanId,
    request,
    startedAt = new Date().toISOString(),
    tempDir = null,
    isCancelled = false,
    progressPercent = 0,
  }) {
    this.scanId = scanId || `scan_${crypto.randomUUID()}`;
    if (!request) throw new Error("ScanContext requires request");
    this.request = request instanceof ScanRequest ? request : new ScanRequest(request);
    this.startedAt = startedAt;
    this.tempDir = tempDir ? String(tempDir) : null;
    this.isCancelled = Boolean(isCancelled);
    this.progressPercent = Math.min(100, Math.max(0, Number(progressPercent) || 0));
  }
}

// =====================================================================
// 12. ScanResult
// =====================================================================
class ScanResult {
  constructor({
    scanId,
    scanType = ScanType.STATIC,
    target,
    status = ScanStatus.SUCCESS,
    engineName = "ECDAT Core Engine",
    engineVersion = "2.0.0",
    durationSeconds = 0.0,
    assets = [],
    findings = [],
    relationships = [],
    observations = [],
    policyEvaluation = null,
    remediationPlan = null,
    summaryMetrics = {},
    errors = [],
  }) {
    if (!scanId) throw new Error("ScanResult requires scanId");
    this.scanId = String(scanId);
    this.scanType = scanType;
    this.target = String(target || "Unknown Target");
    this.status = status;
    this.engineName = String(engineName);
    this.engineVersion = String(engineVersion);
    this.durationSeconds = Number(durationSeconds) || 0.0;
    this.assets = assets.map((a) => (a instanceof CryptoAsset ? a : new CryptoAsset(a)));
    this.findings = findings.map((f) => (f instanceof Finding ? f : new Finding(f)));
    this.relationships = relationships.map((r) => (r instanceof AssetRelationship ? r : new AssetRelationship(r)));
    this.observations = observations.map((o) => (o instanceof Observation ? o : new Observation(o)));
    this.policyEvaluation =
      policyEvaluation instanceof PolicyEvaluation ? policyEvaluation : policyEvaluation ? new PolicyEvaluation(policyEvaluation) : null;
    this.remediationPlan =
      remediationPlan instanceof RemediationPlan ? remediationPlan : remediationPlan ? new RemediationPlan(remediationPlan) : null;
    this.summaryMetrics = { ...summaryMetrics };
    this.errors = [...errors];
    Object.freeze(this);
  }
}

// =====================================================================
// 13. DiscoveryEngine Abstract Interface
// =====================================================================
class DiscoveryEngine {
  constructor(name = "AbstractDiscoveryEngine", version = "2.0.0") {
    if (new.target === DiscoveryEngine) {
      throw new TypeError("Cannot instantiate abstract class DiscoveryEngine directly");
    }
    this.name = name;
    this.version = version;
  }

  /**
   * Must be implemented by concrete discovery engines.
   * @param {ScanRequest} _request
   * @param {ScanContext} _context
   * @returns {Promise<ScanResult>}
   */
  async scan(_request, _context) {
    throw new Error("Method scan() must be implemented by subclass");
  }
}

// =====================================================================
// 14. DependencyVulnerabilityCorrelation
// =====================================================================
class DependencyVulnerabilityCorrelation {
  constructor({
    id,
    vulnerability,
    affectedPackage,
    version,
    reachabilityConfidence,
    cryptoImpact,
    application,
    riskContribution,
    exploitability,
    scanId = null,
    createdAt = null,
  }) {
    if (!vulnerability) throw new Error("DependencyVulnerabilityCorrelation requires vulnerability");
    if (!affectedPackage) throw new Error("DependencyVulnerabilityCorrelation requires affectedPackage");
    if (!version) throw new Error("DependencyVulnerabilityCorrelation requires version");

    this.id = id || `corr_${crypto.randomUUID()}`;
    this.vulnerability = Object.freeze({ ...vulnerability });
    this.affectedPackage = String(affectedPackage);
    this.version = String(version);
    this.reachabilityConfidence = Object.freeze({ ...reachabilityConfidence });
    this.cryptoImpact = Object.freeze({ ...cryptoImpact });
    this.application = Object.freeze({ ...application });
    this.riskContribution = Object.freeze({ ...riskContribution });
    
    // Strict requirement: "Do not claim exploitability automatically"
    const expl = exploitability || {};
    this.exploitability = Object.freeze({
      status: expl.status || ExploitabilityStatus.UNREACHABLE,
      isExploitableClaimed: false, // Invariant: never automatically claimed
      claimRejectedRationale: expl.claimRejectedRationale || "Automatic exploitability claiming is forbidden; reachability and code execution evidence required.",
      notes: expl.notes || null,
    });
    this.scanId = scanId ? String(scanId) : null;
    this.createdAt = createdAt || new Date().toISOString();
    Object.freeze(this);
  }
}

module.exports = {
  ScanType,
  ScanStatus,
  SeverityLevel,
  ConfidenceLevel,
  AssetType,
  RelationshipType,
  EvidenceSource,
  QuantumRelevance,
  MoscaStatus,
  CryptoReachabilityLevel,
  CryptoImpactType,
  ExploitabilityStatus,
  DependencyVulnerabilityCorrelation,
  Evidence,
  Observation,
  Finding,
  CryptoAsset,
  AssetRelationship,
  RiskAssessment,
  PolicyEvaluation,
  RemediationAction,
  RemediationPlan,
  ScanRequest,
  ScanContext,
  ScanResult,
  DiscoveryEngine,
};

