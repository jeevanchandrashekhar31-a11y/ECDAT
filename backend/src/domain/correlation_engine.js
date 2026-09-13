/**
 * ECDAT Evidence Correlation Engine (Node.js) - Phase 7.2
 *
 * Correlates cryptographic evidence from all 8 discovery sources:
 * - SOURCE, DEPENDENCY, BINARY, FILESYSTEM, NETWORK, RUNTIME, CERTIFICATE, CBOM
 *
 * Guarantees:
 * 1. Anti-Blind-Merge: Never merge entities simply by name without matching key attributes.
 * 2. Deterministic vs Confidence-Scored: Exact locator/fingerprint vs scoring threshold.
 * 3. Explainable Provenance: Every relationship answers "Why does ECDAT believe this exists?".
 * 4. Security: Graph injection prevention, query authorization, tenant isolation, and audit trails.
 */

const {
  AssetType,
  RelationshipType,
  ConfidenceLevel,
} = require("./contracts");

const {
  CanonicalCryptoEntity,
  CanonicalRelationship,
  CanonicalCryptoInventory,
  ProvenanceRecord,
} = require("./canonical_model");

const EvidenceOrigin = Object.freeze({
  SOURCE: "source",
  DEPENDENCY: "dependency",
  BINARY: "binary",
  FILESYSTEM: "filesystem",
  NETWORK: "network",
  RUNTIME: "runtime",
  CERTIFICATE: "certificate",
  CBOM: "cbom",
});

class GraphSecurityViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "GraphSecurityViolation";
  }
}

class CorrelationEvidence {
  constructor({
    origin,
    entityType,
    canonicalName,
    locator,
    tenantId = "default",
    applicationId = "default",
    attributes = {},
    confidence = ConfidenceLevel.HIGH,
    timestamp = Date.now(),
    fingerprint = null,
  }) {
    if (!origin || !entityType || !canonicalName || !locator) {
      throw new Error("CorrelationEvidence requires origin, entityType, canonicalName, and locator");
    }
    this.origin = origin;
    this.entityType = entityType;
    this.canonicalName = String(canonicalName);
    this.locator = String(locator);
    this.tenantId = String(tenantId);
    this.applicationId = String(applicationId);
    this.attributes = { ...attributes };
    this.confidence = confidence;
    this.timestamp = timestamp;
    this.fingerprint = fingerprint ? String(fingerprint) : null;
    Object.freeze(this);
  }
}

class CorrelationEngine {
  constructor({
    tenantId = "default",
    inventory = null,
    minCorrelationConfidence = 0.65,
  } = {}) {
    this.tenantId = String(tenantId);
    this.inventory = inventory || new CanonicalCryptoInventory({ tenantId: this.tenantId });
    this.minCorrelationConfidence = minCorrelationConfidence;
    this.auditLog = [];
    this.locatorIndex = new Map();
    this.fingerprintIndex = new Map();
    this.nameTypeIndex = new Map();
  }

  _validateEntitySecurity(entity) {
    if (entity.tenantId !== this.tenantId) {
      throw new GraphSecurityViolation(
        `Tenant Isolation Breach: Cannot insert entity from tenant '${entity.tenantId}' into inventory for tenant '${this.tenantId}'.`
      );
    }
    if (/[<>";\x00-\x1f]/.test(entity.name)) {
      throw new GraphSecurityViolation(
        `Graph Injection Attempt Detected: Entity name contains illegal characters: '${entity.name}'.`
      );
    }
  }

  _validateRelationshipSecurity(relationship) {
    if (relationship.sourceId === relationship.targetId) {
      throw new GraphSecurityViolation(
        `Graph Injection Detected: Self-referential loop on entity '${relationship.sourceId}'.`
      );
    }
  }

  ingestEntity(entity) {
    this._validateEntitySecurity(entity);
    this.inventory.addEntity(entity);

    if (entity.provenance && entity.provenance.locator) {
      const normLoc = entity.provenance.locator.replace(/\\/g, "/").toLowerCase();
      this.locatorIndex.set(normLoc, entity.entityId);
    }

    const fp = entity.provenance.hashOrFingerprint || entity.properties.fingerprint || entity.properties.sha256;
    if (fp) {
      this.fingerprintIndex.set(String(fp).toLowerCase(), entity.entityId);
    }

    const key = `${entity.name.toLowerCase()}:${entity.entityType}`;
    if (!this.nameTypeIndex.has(key)) {
      this.nameTypeIndex.set(key, new Set());
    }
    this.nameTypeIndex.get(key).add(entity.entityId);

    return entity;
  }

  correlateEvidence(evidence, createIfMissing = true) {
    if (evidence.tenantId !== this.tenantId) {
      throw new GraphSecurityViolation(
        `Tenant mismatch: Evidence tenant '${evidence.tenantId}' != Engine tenant '${this.tenantId}'`
      );
    }

    let matchedEntity = null;
    let correlationReason = "";
    let confidenceScore = 1.0;

    // 1. Exact Fingerprint Match
    if (evidence.fingerprint) {
      const fpClean = evidence.fingerprint.toLowerCase();
      const matchedId = this.fingerprintIndex.get(fpClean);
      if (matchedId) {
        matchedEntity = this.inventory.getEntity(matchedId);
        correlationReason = `Exact SHA-256 fingerprint match '${evidence.fingerprint}'`;
        confidenceScore = 1.0;
      }
    }

    // 2. Exact Locator Match
    if (!matchedEntity && evidence.locator) {
      const normLoc = evidence.locator.replace(/\\/g, "/").toLowerCase();
      const matchedId = this.locatorIndex.get(normLoc);
      if (matchedId) {
        const cand = this.inventory.getEntity(matchedId);
        if (cand && cand.entityType === evidence.entityType) {
          matchedEntity = cand;
          correlationReason = `Exact locator match '${evidence.locator}' for ${evidence.entityType}`;
          confidenceScore = 0.95;
        }
      }
    }

    // 3. Confidence-Scored Contextual Correlation
    if (!matchedEntity) {
      const scored = this._scoreContextualCorrelation(evidence);
      matchedEntity = scored.candidate;
      confidenceScore = scored.score;
      correlationReason = scored.reason;
    }

    // 4. Create Entity if unmerged
    let newlyCreated = false;
    if (!matchedEntity) {
      if (!createIfMissing) return { entity: null, relationships: [] };

      const prov = new ProvenanceRecord({
        scannerName: `ecdat-${evidence.origin}`,
        sourceKind: evidence.origin,
        locator: evidence.locator,
        confidence: evidence.confidence,
        hashOrFingerprint: evidence.fingerprint,
      });

      matchedEntity = CanonicalCryptoEntity.create({
        entityType: evidence.entityType,
        name: evidence.canonicalName,
        provenance: prov,
        tenantId: this.tenantId,
        applicationId: evidence.applicationId,
        coreProperties: {
          canonical_name: evidence.canonicalName,
          ...evidence.attributes,
        },
      });
      this.ingestEntity(matchedEntity);
      newlyCreated = true;
    }

    // 5. Establish Inferred Relationships & Provenance Rationale
    const createdRelationships = [];
    if (!newlyCreated && matchedEntity && correlationReason) {
      const rationale = {
        why_ecdat_believes_this_exists: `Correlated evidence from ${evidence.origin} with ${matchedEntity.name}. Justification: ${correlationReason} (confidence: ${confidenceScore.toFixed(2)}).`,
        evidence_origin: evidence.origin,
        correlation_confidence: confidenceScore,
        matched_at: Date.now(),
      };
      if (!matchedEntity.properties.correlations) {
        matchedEntity.properties.correlations = [];
      }
      matchedEntity.properties.correlations.push(rationale);
    }

    // Infer relationships across layers (e.g. Runtime Process -> Algorithm)
    if (evidence.origin === EvidenceOrigin.RUNTIME && matchedEntity.entityType === AssetType.ALGORITHM) {
      const pid = evidence.attributes.process_id;
      if (pid) {
        const procRef = `urn:ecdat:v1:asset:${this.tenantId}:${evidence.applicationId}:runtime_process:pid_${pid}`;
        const rel = CanonicalRelationship.create({
          sourceId: procRef,
          targetId: matchedEntity.entityId,
          relationshipType: RelationshipType.USES,
          confidence: ConfidenceLevel.HIGH,
          properties: {
            why_ecdat_believes_this_exists: `Live eBPF uprobe observed PID ${pid} executing cryptographic operation for ${matchedEntity.name}.`,
            evidence_source: "runtime",
          },
        });
        this._validateRelationshipSecurity(rel);
        this.inventory.addRelationship(rel);
        createdRelationships.push(rel);
      }
    }

    return { entity: matchedEntity, relationships: createdRelationships };
  }

  _scoreContextualCorrelation(evidence) {
    const key = `${evidence.canonicalName.toLowerCase()}:${evidence.entityType}`;
    const candidates = this.nameTypeIndex.get(key);
    if (!candidates || candidates.size === 0) {
      return { candidate: null, score: 0.0, reason: "" };
    }

    let bestCand = null;
    let bestScore = 0.0;
    let bestReason = "";

    for (const cid of candidates) {
      const cand = this.inventory.getEntity(cid);
      if (!cand) continue;

      let score = 0.0;
      const reasons = [];

      // Key size
      const evKsize = evidence.attributes.key_size || evidence.attributes.key_length;
      const cdKsize = cand.properties.key_size || cand.properties.key_length;
      if (evKsize && cdKsize) {
        if (String(evKsize) === String(cdKsize)) {
          score += 0.3;
          reasons.push(`Matching key size (${evKsize} bits)`);
        } else {
          continue; // Anti-blind-merge: conflicting key size
        }
      }

      // Mode or Curve
      const evMode = evidence.attributes.mode || evidence.attributes.curve;
      const cdMode = cand.properties.mode || cand.properties.curve;
      if (evMode && cdMode) {
        if (String(evMode).toUpperCase() === String(cdMode).toUpperCase()) {
          score += 0.25;
          reasons.push(`Matching mode/curve (${evMode})`);
        }
      }

      // Application boundary
      if (evidence.applicationId === cand.applicationId && evidence.applicationId !== "default") {
        score += 0.25;
        reasons.push(`Shared application boundary (${cand.applicationId})`);
      }

      // Locator proximity
      if (evidence.locator && cand.provenance.locator) {
        const normEv = evidence.locator.replace(/\\/g, "/").toLowerCase();
        const normCd = cand.provenance.locator.replace(/\\/g, "/").toLowerCase();
        if (normEv.includes(normCd) || normCd.includes(normEv)) {
          score += 0.2;
          reasons.push("Co-located source artifact");
        }
      }

      if (score >= this.minCorrelationConfidence && score > bestScore) {
        bestScore = score;
        bestCand = cand;
        bestReason = reasons.join("; ");
      }
    }

    if (bestCand && bestScore >= this.minCorrelationConfidence) {
      return { candidate: bestCand, score: bestScore, reason: bestReason };
    }

    return { candidate: null, score: 0.0, reason: "" };
  }

  executeAuthorizedQuery({
    actorId,
    actorTenant,
    userRoles = new Set(),
    queryType,
    targetIdOrType,
    queryFn,
  }) {
    const timestamp = Date.now();
    const isSensitive = ["sensitive_inspect", "export_secrets", "query_private_keys", "query_certificates"].includes(queryType);

    if (actorTenant !== this.tenantId) {
      this.auditLog.push({
        timestamp,
        actorId,
        actorTenant,
        action: queryType,
        targetIdOrType,
        authorized: false,
        details: { error: `Tenant mismatch: Actor '${actorTenant}' cannot query tenant '${this.tenantId}'` },
      });
      throw new GraphSecurityViolation(
        `Unauthorized: Actor tenant '${actorTenant}' cannot access graph data belonging to tenant '${this.tenantId}'.`
      );
    }

    const authorized = !isSensitive || ["security_analyst", "admin", "auditor"].some((r) => userRoles.has(r));

    this.auditLog.push({
      timestamp,
      actorId,
      actorTenant,
      action: queryType,
      targetIdOrType,
      authorized,
      details: { roles: Array.from(userRoles), sensitive: isSensitive },
    });

    if (!authorized) {
      throw new GraphSecurityViolation(
        `Forbidden: Actor '${actorId}' lacks required roles (security_analyst, admin, auditor) for sensitive query '${queryType}'.`
      );
    }

    return queryFn(this.inventory);
  }
}

module.exports = {
  EvidenceOrigin,
  GraphSecurityViolation,
  CorrelationEvidence,
  CorrelationEngine,
};
