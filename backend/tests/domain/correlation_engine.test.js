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

const {
  EvidenceOrigin,
  GraphSecurityViolation,
  CorrelationEvidence,
  CorrelationEngine,
} = require("../../src/domain/correlation_engine");

test("Correlation Engine - ingests evidence across all 8 origins", () => {
  const engine = new CorrelationEngine({ tenantId: "bank_corp" });
  const allOrigins = [
    EvidenceOrigin.SOURCE,
    EvidenceOrigin.DEPENDENCY,
    EvidenceOrigin.BINARY,
    EvidenceOrigin.FILESYSTEM,
    EvidenceOrigin.NETWORK,
    EvidenceOrigin.RUNTIME,
    EvidenceOrigin.CERTIFICATE,
    EvidenceOrigin.CBOM,
  ];

  const createdEntities = [];
  for (const origin of allOrigins) {
    const ev = new CorrelationEvidence({
      origin,
      entityType: AssetType.ALGORITHM,
      canonicalName: `AES_256_${origin.toUpperCase()}`,
      locator: `path/to/${origin}_artifact`,
      tenantId: "bank_corp",
      applicationId: "payment_app",
      attributes: { key_size: 256, mode: "GCM" },
    });
    const { entity } = engine.correlateEvidence(ev);
    assert.ok(entity);
    assert.equal(entity.provenance.sourceKind, origin);
    createdEntities.push(entity);
  }

  assert.equal(createdEntities.length, 8);
  assert.equal(engine.inventory.toGraphDict().entity_count, 8);
});

test("Correlation Engine - deterministic fingerprint correlation merges matching certificates", () => {
  const engine = new CorrelationEngine({ tenantId: "cloud_org" });

  // 1. Certificate discovered via Filesystem
  const certEv = new CorrelationEvidence({
    origin: EvidenceOrigin.FILESYSTEM,
    entityType: AssetType.CERTIFICATE,
    canonicalName: "internal-ca.crt",
    locator: "/etc/ssl/certs/internal-ca.crt",
    tenantId: "cloud_org",
    fingerprint: "sha256:aabbccddeeff00112233445566778899",
  });
  const { entity: certEntity } = engine.correlateEvidence(certEv);

  // 2. Certificate observed on network port 443 with identical fingerprint
  const netEv = new CorrelationEvidence({
    origin: EvidenceOrigin.NETWORK,
    entityType: AssetType.CERTIFICATE,
    canonicalName: "internal-ca.crt",
    locator: "10.0.0.1:443",
    tenantId: "cloud_org",
    fingerprint: "sha256:aabbccddeeff00112233445566778899",
  });
  const { entity: correlatedEntity } = engine.correlateEvidence(netEv);

  // Merged into same entity
  assert.equal(correlatedEntity.entityId, certEntity.entityId);
  const correlations = correlatedEntity.properties.correlations || [];
  assert.equal(correlations.length, 1);
  assert.ok(correlations[0].why_ecdat_believes_this_exists.includes("Exact SHA-256 fingerprint match"));
  assert.equal(correlations[0].correlation_confidence, 1.0);
});

test("Correlation Engine - anti-blind-merge: rejects merge when key sizes conflict", () => {
  const engine = new CorrelationEngine({ tenantId: "security_firm" });

  // Ingest weak RSA-1024
  const evWeak = new CorrelationEvidence({
    origin: EvidenceOrigin.SOURCE,
    entityType: AssetType.ALGORITHM,
    canonicalName: "RSA",
    locator: "src/legacy_signer.py",
    tenantId: "security_firm",
    applicationId: "crypto_vault",
    attributes: { key_size: 1024 },
  });
  const { entity: entityWeak } = engine.correlateEvidence(evWeak);

  // Ingest strong RSA-2048 in same application
  const evStrong = new CorrelationEvidence({
    origin: EvidenceOrigin.BINARY,
    entityType: AssetType.ALGORITHM,
    canonicalName: "RSA",
    locator: "bin/crypto_service",
    tenantId: "security_firm",
    applicationId: "crypto_vault",
    attributes: { key_size: 2048 },
  });
  const { entity: entityStrong } = engine.correlateEvidence(evStrong);

  // Must not merge because key sizes conflict
  assert.notEqual(entityWeak.entityId, entityStrong.entityId);
  assert.equal(engine.inventory.toGraphDict().entity_count, 2);
});

test("Correlation Engine - confidence-scored correlation succeeds when attributes and context align", () => {
  const engine = new CorrelationEngine({ tenantId: "fintech", minCorrelationConfidence: 0.6 });

  // Source scan finds AES-GCM 256
  const srcEv = new CorrelationEvidence({
    origin: EvidenceOrigin.SOURCE,
    entityType: AssetType.ALGORITHM,
    canonicalName: "AES",
    locator: "services/payment/encryptor.py",
    tenantId: "fintech",
    applicationId: "checkout_service",
    attributes: { key_size: 256, mode: "GCM" },
  });
  const { entity: srcEntity } = engine.correlateEvidence(srcEv);

  // Binary scan finds AES-GCM 256 in related binary
  const binEv = new CorrelationEvidence({
    origin: EvidenceOrigin.BINARY,
    entityType: AssetType.ALGORITHM,
    canonicalName: "AES",
    locator: "services/payment/libpayment.so",
    tenantId: "fintech",
    applicationId: "checkout_service",
    attributes: { key_size: 256, mode: "GCM" },
  });
  const { entity: binEntity } = engine.correlateEvidence(binEv);

  // Successfully merged
  assert.equal(binEntity.entityId, srcEntity.entityId);
  const correlations = binEntity.properties.correlations || [];
  assert.equal(correlations.length, 1);
  assert.ok(correlations[0].why_ecdat_believes_this_exists.includes("Matching key size"));
});

test("Correlation Engine - runtime evidence generates cross-layer relationship with justification", () => {
  const engine = new CorrelationEngine({ tenantId: "prod_corp" });

  // Ingest algorithm
  const algoEv = new CorrelationEvidence({
    origin: EvidenceOrigin.SOURCE,
    entityType: AssetType.ALGORITHM,
    canonicalName: "ChaCha20-Poly1305",
    locator: "src/crypto/stream.py",
    tenantId: "prod_corp",
    applicationId: "stream_app",
    attributes: { key_size: 256, mode: "Stream" },
  });
  const { entity: algoEntity } = engine.correlateEvidence(algoEv);

  // Ingest runtime observation with matching attributes and process_id
  const rtEv = new CorrelationEvidence({
    origin: EvidenceOrigin.RUNTIME,
    entityType: AssetType.ALGORITHM,
    canonicalName: "ChaCha20-Poly1305",
    locator: "src/crypto/stream.py",
    tenantId: "prod_corp",
    applicationId: "stream_app",
    attributes: { key_size: 256, mode: "Stream", process_id: 4321 },
  });
  const { entity: rtEntity, relationships } = engine.correlateEvidence(rtEv);

  assert.equal(rtEntity.entityId, algoEntity.entityId);
  assert.equal(relationships.length, 1);
  const rel = relationships[0];
  assert.equal(rel.relationshipType, RelationshipType.USES);
  assert.equal(rel.targetId, algoEntity.entityId);
  assert.ok(rel.properties.why_ecdat_believes_this_exists.includes("PID 4321 executing"));
});

test("Correlation Engine - security: rejects graph injection attempts", () => {
  const engine = new CorrelationEngine({ tenantId: "tenant_safe" });
  const prov = new ProvenanceRecord({
    scannerName: "scanner",
    version: "1.0",
    sourceKind: "source",
    locator: "file.py",
  });

  const maliciousEntity = new CanonicalCryptoEntity({
    entityId: "urn:ecdat:v1:asset:tenant_safe:app:algorithm:1234",
    entityType: AssetType.ALGORITHM,
    name: "AES<script>alert(1)</script>",
    provenance: prov,
    tenantId: "tenant_safe",
  });

  assert.throws(
    () => engine.ingestEntity(maliciousEntity),
    (err) => err instanceof GraphSecurityViolation && err.message.includes("Graph Injection Attempt Detected")
  );
});

test("Correlation Engine - security: enforces tenant isolation on ingestion and query", () => {
  const engine = new CorrelationEngine({ tenantId: "tenant_a" });
  const prov = new ProvenanceRecord({
    scannerName: "scanner",
    version: "1.0",
    sourceKind: "source",
    locator: "file.py",
  });

  const foreignEntity = new CanonicalCryptoEntity({
    entityId: "urn:ecdat:v1:asset:tenant_b:app:algorithm:5678",
    entityType: AssetType.ALGORITHM,
    name: "ValidAlgorithm",
    provenance: prov,
    tenantId: "tenant_b",
  });

  // Ingestion cross-tenant blocked
  assert.throws(
    () => engine.ingestEntity(foreignEntity),
    (err) => err instanceof GraphSecurityViolation && err.message.includes("Tenant Isolation Breach")
  );

  // Ingest valid entity
  const validEntity = new CanonicalCryptoEntity({
    entityId: "urn:ecdat:v1:asset:tenant_a:app:algorithm:9999",
    entityType: AssetType.ALGORITHM,
    name: "ValidAlgorithm",
    provenance: prov,
    tenantId: "tenant_a",
  });
  engine.ingestEntity(validEntity);

  // Cross-tenant query blocked
  assert.throws(
    () =>
      engine.executeAuthorizedQuery({
        actorId: "attacker@rival.com",
        actorTenant: "tenant_rival",
        userRoles: new Set(["admin"]),
        queryType: "query_certificates",
        targetIdOrType: "certificate",
        queryFn: (inv) => inv.findByType(AssetType.ALGORITHM),
      }),
    (err) => err instanceof GraphSecurityViolation && err.message.includes("Unauthorized: Actor tenant")
  );
});

test("Correlation Engine - security: authorizes sensitive queries and maintains audit trail", () => {
  const engine = new CorrelationEngine({ tenantId: "fin_bank" });
  const prov = new ProvenanceRecord({
    scannerName: "scanner",
    version: "1.0",
    sourceKind: "network",
    locator: "api.finbank.com:443",
  });
  const cert = CanonicalCryptoEntity.create({
    entityType: AssetType.CERTIFICATE,
    name: "api.finbank.com-cert",
    provenance: prov,
    tenantId: "fin_bank",
  });
  engine.ingestEntity(cert);

  // 1. Role unauthorized (missing security_analyst/admin/auditor)
  assert.throws(
    () =>
      engine.executeAuthorizedQuery({
        actorId: "dev@finbank.com",
        actorTenant: "fin_bank",
        userRoles: new Set(["developer"]),
        queryType: "query_certificates",
        targetIdOrType: "certificate",
        queryFn: (inv) => inv.findByType(AssetType.CERTIFICATE),
      }),
    (err) => err instanceof GraphSecurityViolation && err.message.includes("Forbidden: Actor 'dev@finbank.com' lacks required roles")
  );

  // 2. Role authorized (auditor)
  const results = engine.executeAuthorizedQuery({
    actorId: "auditor@finbank.com",
    actorTenant: "fin_bank",
    userRoles: new Set(["auditor"]),
    queryType: "query_certificates",
    targetIdOrType: "certificate",
    queryFn: (inv) => inv.findByType(AssetType.CERTIFICATE),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, "api.finbank.com-cert");

  // Audit log contains both attempts
  assert.equal(engine.auditLog.length, 2);
  assert.equal(engine.auditLog[0].authorized, false);
  assert.equal(engine.auditLog[1].authorized, true);
  assert.equal(engine.auditLog[1].actorId, "auditor@finbank.com");
});
