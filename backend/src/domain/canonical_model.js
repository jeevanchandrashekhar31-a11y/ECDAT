/**
 * ECDAT Canonical Crypto Asset Model & Inventory (Node.js) - Phase 7.1
 *
 * Covers all 22 required entity types:
 * - Application, Service, Repository, File, Function, Dependency, Library
 * - Algorithm, Key metadata, Certificate, Protocol, Endpoint, Container, Host, Runtime process, Data asset
 * - Owner, Environment, Policy, Finding, Risk, Remediation
 *
 * Guarantees:
 * - Deterministic, collision-resistant URNs via RFC 8785 canonical hash.
 * - Comprehensive provenance tracking (scanner, version, source, location, confidence, timestamp).
 * - Full graph relationship support (USES, PROTECTS, PRESENT_IN, DEPENDS_ON, OBSERVED_BY,
 *   TERMINATES_AT, OWNED_BY, VIOLATES, REMEDIATED_BY).
 */

const {
  AssetType,
  RelationshipType,
  ConfidenceLevel,
  SeverityLevel,
} = require("./contracts");

const {
  generateAssetId,
  generateRelationshipId,
} = require("./identity");

class ProvenanceRecord {
  constructor({
    scannerName = "ecdat-discovery",
    scannerVersion = "1.0.0",
    sourceKind = "source_code",
    locator = "unknown",
    confidence = ConfidenceLevel.HIGH,
    timestamp = new Date().toISOString(),
    scanConfiguration = {},
    hashOrFingerprint = null,
  } = {}) {
    this.scannerName = String(scannerName);
    this.scannerVersion = String(scannerVersion);
    this.sourceKind = String(sourceKind);
    this.locator = String(locator);
    this.confidence = confidence;
    this.timestamp = timestamp;
    this.scanConfiguration = { ...scanConfiguration };
    this.hashOrFingerprint = hashOrFingerprint ? String(hashOrFingerprint) : null;
    Object.freeze(this);
  }

  toJSON() {
    return {
      scanner_name: this.scannerName,
      scanner_version: this.scannerVersion,
      source_kind: this.sourceKind,
      locator: this.locator,
      confidence: this.confidence,
      timestamp: this.timestamp,
      scan_configuration: this.scanConfiguration,
      hash_or_fingerprint: this.hashOrFingerprint,
    };
  }
}

class CanonicalCryptoEntity {
  constructor({
    entityId,
    entityType,
    name,
    provenance,
    tenantId = "default",
    applicationId = "default",
    properties = {},
    tags = [],
  }) {
    if (!entityId) throw new Error("CanonicalCryptoEntity requires entityId");
    if (!entityType) throw new Error("CanonicalCryptoEntity requires entityType");
    this.entityId = String(entityId);
    this.entityType = entityType;
    this.name = String(name || entityId);
    this.provenance = provenance instanceof ProvenanceRecord ? provenance : new ProvenanceRecord(provenance || {});
    this.tenantId = String(tenantId);
    this.applicationId = String(applicationId);
    this.properties = { ...properties };
    this.tags = Array.isArray(tags) ? [...tags] : [];
    Object.freeze(this);
  }

  static create({
    entityType,
    name,
    provenance,
    tenantId = "default",
    applicationId = "default",
    coreProperties = {},
    additionalProperties = {},
    tags = [],
  }) {
    const provRecord = provenance instanceof ProvenanceRecord ? provenance : new ProvenanceRecord(provenance || {});
    const core = { ...coreProperties };
    if (!core.canonical_name) {
      core.canonical_name = String(name).trim();
    }

    const urn = generateAssetId({
      assetType: entityType,
      provenance: {
        kind: provRecord.sourceKind,
        locator: provRecord.locator,
      },
      coreProperties: core,
      tenantId,
      applicationId,
    });

    const allProps = { ...core, ...additionalProperties };

    return new CanonicalCryptoEntity({
      entityId: urn,
      entityType,
      name,
      provenance: provRecord,
      tenantId,
      applicationId,
      properties: allProps,
      tags,
    });
  }

  toJSON() {
    return {
      entity_id: this.entityId,
      entity_type: this.entityType,
      name: this.name,
      tenant_id: this.tenantId,
      application_id: this.applicationId,
      provenance: this.provenance.toJSON(),
      properties: this.properties,
      tags: this.tags,
    };
  }
}

class CanonicalRelationship {
  constructor({
    relationshipId,
    sourceId,
    targetId,
    relationshipType,
    confidence = ConfidenceLevel.HIGH,
    provenance = null,
    properties = {},
  }) {
    if (!relationshipId || !sourceId || !targetId || !relationshipType) {
      throw new Error("CanonicalRelationship requires relationshipId, sourceId, targetId, and relationshipType");
    }
    this.relationshipId = String(relationshipId);
    this.sourceId = String(sourceId);
    this.targetId = String(targetId);
    this.relationshipType = relationshipType;
    this.confidence = confidence;
    this.provenance = provenance ? (provenance instanceof ProvenanceRecord ? provenance : new ProvenanceRecord(provenance)) : null;
    this.properties = { ...properties };
    Object.freeze(this);
  }

  static create({
    sourceId,
    targetId,
    relationshipType,
    confidence = ConfidenceLevel.HIGH,
    provenance = null,
    properties = {},
  }) {
    const relId = generateRelationshipId({
      sourceAssetId: sourceId,
      targetAssetId: targetId,
      relationshipType,
    });

    return new CanonicalRelationship({
      relationshipId: relId,
      sourceId,
      targetId,
      relationshipType,
      confidence,
      provenance,
      properties,
    });
  }

  toJSON() {
    return {
      relationship_id: this.relationshipId,
      source_id: this.sourceId,
      target_id: this.targetId,
      relationship_type: this.relationshipType,
      confidence: this.confidence,
      provenance: this.provenance ? this.provenance.toJSON() : null,
      properties: this.properties,
    };
  }
}

class CanonicalCryptoInventory {
  constructor({ tenantId = "default", applicationId = "default" } = {}) {
    this.tenantId = tenantId;
    this.applicationId = applicationId;
    this.entities = new Map();
    this.relationships = new Map();
    this.typeIndex = new Map();
    this.outEdges = new Map();
    this.inEdges = new Map();

    for (const val of Object.values(AssetType)) {
      this.typeIndex.set(val, new Set());
    }
  }

  addEntity(entity) {
    if (!(entity instanceof CanonicalCryptoEntity)) {
      throw new Error("addEntity requires CanonicalCryptoEntity instance");
    }
    this.entities.set(entity.entityId, entity);

    if (!this.typeIndex.has(entity.entityType)) {
      this.typeIndex.set(entity.entityType, new Set());
    }
    this.typeIndex.get(entity.entityType).add(entity.entityId);

    if (!this.outEdges.has(entity.entityId)) {
      this.outEdges.set(entity.entityId, new Set());
    }
    if (!this.inEdges.has(entity.entityId)) {
      this.inEdges.set(entity.entityId, new Set());
    }
    return entity;
  }

  addRelationship(relationship) {
    if (!(relationship instanceof CanonicalRelationship)) {
      throw new Error("addRelationship requires CanonicalRelationship instance");
    }
    this.relationships.set(relationship.relationshipId, relationship);

    if (!this.outEdges.has(relationship.sourceId)) {
      this.outEdges.set(relationship.sourceId, new Set());
    }
    this.outEdges.get(relationship.sourceId).add(relationship.relationshipId);

    if (!this.inEdges.has(relationship.targetId)) {
      this.inEdges.set(relationship.targetId, new Set());
    }
    this.inEdges.get(relationship.targetId).add(relationship.relationshipId);

    return relationship;
  }

  getEntity(entityId) {
    return this.entities.get(entityId) || null;
  }

  findByType(entityType) {
    const ids = this.typeIndex.get(entityType);
    if (!ids) return [];
    const results = [];
    for (const id of ids) {
      if (this.entities.has(id)) {
        results.push(this.entities.get(id));
      }
    }
    return results;
  }

  getOutgoingRelationships(entityId) {
    const relIds = this.outEdges.get(entityId);
    if (!relIds) return [];
    return Array.from(relIds).map((id) => this.relationships.get(id)).filter(Boolean);
  }

  getIncomingRelationships(entityId) {
    const relIds = this.inEdges.get(entityId);
    if (!relIds) return [];
    return Array.from(relIds).map((id) => this.relationships.get(id)).filter(Boolean);
  }

  toGraphDict() {
    return {
      tenant_id: this.tenantId,
      application_id: this.applicationId,
      entity_count: this.entities.size,
      relationship_count: this.relationships.size,
      entities: Array.from(this.entities.values()).map((e) => e.toJSON()),
      relationships: Array.from(this.relationships.values()).map((r) => r.toJSON()),
    };
  }
}

module.exports = {
  ProvenanceRecord,
  CanonicalCryptoEntity,
  CanonicalRelationship,
  CanonicalCryptoInventory,
};
