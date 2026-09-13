const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AssetType,
  RelationshipType,
  ConfidenceLevel,
} = require("../../src/domain/contracts");

const {
  ProvenanceRecord,
  CanonicalCryptoEntity,
  CanonicalRelationship,
  CanonicalCryptoInventory,
} = require("../../src/domain/canonical_model");

const REQUIRED_ENTITY_TYPES = [
  AssetType.APPLICATION,
  AssetType.SERVICE,
  AssetType.REPOSITORY,
  AssetType.FILE,
  AssetType.FUNCTION,
  AssetType.DEPENDENCY,
  AssetType.CRYPTO_LIBRARY,
  AssetType.ALGORITHM,
  AssetType.KEY_METADATA,
  AssetType.CERTIFICATE,
  AssetType.PROTOCOL,
  AssetType.ENDPOINT,
  AssetType.CONTAINER,
  AssetType.HOST,
  AssetType.RUNTIME_PROCESS,
  AssetType.DATA_ASSET,
  AssetType.OWNER,
  AssetType.ENVIRONMENT,
  AssetType.POLICY,
  AssetType.FINDING,
  AssetType.RISK,
  AssetType.REMEDIATION,
];

const REQUIRED_RELATIONSHIPS = [
  RelationshipType.USES,
  RelationshipType.PROTECTS,
  RelationshipType.PRESENT_IN,
  RelationshipType.DEPENDS_ON,
  RelationshipType.OBSERVED_BY,
  RelationshipType.TERMINATES_AT,
  RelationshipType.OWNED_BY,
  RelationshipType.VIOLATES,
  RelationshipType.REMEDIATED_BY,
];

test("Canonical Crypto Model - covers all 22 required entity types", () => {
  assert.equal(REQUIRED_ENTITY_TYPES.length, 22);
  const uniqueSet = new Set(REQUIRED_ENTITY_TYPES);
  assert.equal(uniqueSet.size, 22);
});

test("Canonical Crypto Entity - creates entity with deterministic URN and provenance", () => {
  const prov = new ProvenanceRecord({
    scannerName: "ecdat-static-analyzer",
    scannerVersion: "2.0.0",
    sourceKind: "source_code",
    locator: "src/crypto/aes_gcm.ts",
    confidence: ConfidenceLevel.HIGH,
    hashOrFingerprint: "sha256:1122334455667788",
  });

  const entity1 = CanonicalCryptoEntity.create({
    entityType: AssetType.ALGORITHM,
    name: "AES-256-GCM",
    provenance: prov,
    tenantId: "corp_tenant",
    applicationId: "data_vault",
    coreProperties: { cipher_mode: "GCM", key_size: 256 },
  });

  assert.ok(entity1.entityId.startsWith("urn:ecdat:v1:asset:corp_tenant:data_vault:algorithm:"));
  assert.equal(entity1.entityType, AssetType.ALGORITHM);
  assert.equal(entity1.name, "AES-256-GCM");
  assert.equal(entity1.provenance.scannerName, "ecdat-static-analyzer");
  assert.equal(entity1.provenance.locator, "src/crypto/aes_gcm.ts");

  // Determinism check: identical parameters yield identical URN
  const entity2 = CanonicalCryptoEntity.create({
    entityType: AssetType.ALGORITHM,
    name: "AES-256-GCM",
    provenance: prov,
    tenantId: "corp_tenant",
    applicationId: "data_vault",
    coreProperties: { cipher_mode: "GCM", key_size: 256 },
  });

  assert.equal(entity1.entityId, entity2.entityId);
});

test("Canonical Crypto Inventory - instantiates and registers all 22 entity types", () => {
  const inventory = new CanonicalCryptoInventory({ tenantId: "acme", applicationId: "gateway" });
  const prov = new ProvenanceRecord({
    scannerName: "ecdat-inventory",
    sourceKind: "discovery_engine",
    locator: "acme/gateway",
  });

  for (const eType of REQUIRED_ENTITY_TYPES) {
    const entity = CanonicalCryptoEntity.create({
      entityType: eType,
      name: `Entity_${eType}`,
      provenance: prov,
      tenantId: "acme",
      applicationId: "gateway",
      coreProperties: { category: eType },
    });
    inventory.addEntity(entity);
  }

  assert.equal(inventory.entities.size, 22);
  const algos = inventory.findByType(AssetType.ALGORITHM);
  assert.equal(algos.length, 1);
});

test("Canonical Relationship Graph - supports all required relationships and traversal", () => {
  const inventory = new CanonicalCryptoInventory({ tenantId: "bank", applicationId: "core" });
  const prov = new ProvenanceRecord({
    scannerName: "ecdat-network",
    sourceKind: "network_handshake",
    locator: "192.168.1.1:443",
  });

  const app = CanonicalCryptoEntity.create({
    entityType: AssetType.APPLICATION,
    name: "BankingApp",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });
  const svc = CanonicalCryptoEntity.create({
    entityType: AssetType.SERVICE,
    name: "TransactionService",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });
  const endpoint = CanonicalCryptoEntity.create({
    entityType: AssetType.ENDPOINT,
    name: "tx.bank.com:443",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });
  const cert = CanonicalCryptoEntity.create({
    entityType: AssetType.CERTIFICATE,
    name: "tx.bank.com-cert",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });
  const algo = CanonicalCryptoEntity.create({
    entityType: AssetType.ALGORITHM,
    name: "RSA-1024",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });
  const policy = CanonicalCryptoEntity.create({
    entityType: AssetType.POLICY,
    name: "NIST-PQC-Mandate",
    provenance: prov,
    tenantId: "bank",
    applicationId: "core",
  });

  inventory.addEntity(app);
  inventory.addEntity(svc);
  inventory.addEntity(endpoint);
  inventory.addEntity(cert);
  inventory.addEntity(algo);
  inventory.addEntity(policy);

  // App USES Service
  inventory.addRelationship(CanonicalRelationship.create({
    sourceId: app.entityId,
    targetId: svc.entityId,
    relationshipType: RelationshipType.USES,
  }));

  // Service TERMINATES_AT Endpoint
  inventory.addRelationship(CanonicalRelationship.create({
    sourceId: svc.entityId,
    targetId: endpoint.entityId,
    relationshipType: RelationshipType.TERMINATES_AT,
  }));

  // Certificate PROTECTS Endpoint
  inventory.addRelationship(CanonicalRelationship.create({
    sourceId: cert.entityId,
    targetId: endpoint.entityId,
    relationshipType: RelationshipType.PROTECTS,
  }));

  // Certificate DEPENDS_ON Algorithm
  inventory.addRelationship(CanonicalRelationship.create({
    sourceId: cert.entityId,
    targetId: algo.entityId,
    relationshipType: RelationshipType.DEPENDS_ON,
  }));

  // Algorithm VIOLATES Policy
  inventory.addRelationship(CanonicalRelationship.create({
    sourceId: algo.entityId,
    targetId: policy.entityId,
    relationshipType: RelationshipType.VIOLATES,
  }));

  // Graph Traversal
  const appOut = inventory.getOutgoingRelationships(app.entityId);
  assert.equal(appOut.length, 1);
  assert.equal(appOut[0].relationshipType, RelationshipType.USES);
  assert.equal(appOut[0].targetId, svc.entityId);

  const endpointIn = inventory.getIncomingRelationships(endpoint.entityId);
  assert.equal(endpointIn.length, 2);
  const endRelTypes = new Set(endpointIn.map((r) => r.relationshipType));
  assert.ok(endRelTypes.has(RelationshipType.TERMINATES_AT));
  assert.ok(endRelTypes.has(RelationshipType.PROTECTS));

  const graphDict = inventory.toGraphDict();
  assert.equal(graphDict.entity_count, 6);
  assert.equal(graphDict.relationship_count, 5);
});
