"""
Unit and Integration Tests for Phase 7.1: Canonical Crypto Asset Model & Inventory

Validates:
1. All 22 canonical entity types supported and instantiable with deterministic URNs:
   Application, Service, Repository, File, Function, Dependency, Library, Algorithm,
   Key metadata, Certificate, Protocol, Endpoint, Container, Host, Runtime process,
   Data asset, Owner, Environment, Policy, Finding, Risk, Remediation.
2. Stable deterministic identifiers across repeated runs and platforms.
3. Provenance records for every entity (scanner, version, source kind, locator, confidence, timestamp).
4. Explicit relationship graph:
   USES, PROTECTS, PRESENT_IN, DEPENDS_ON, OBSERVED_BY, TERMINATES_AT, OWNED_BY, VIOLATES, REMEDIATED_BY.
5. CanonicalCryptoInventory query, traversal, and graph serialization.
"""

import pytest
from scanners.domain.contracts import AssetType, ConfidenceLevel, RelationshipType
from scanners.domain.canonical_model import (
    CanonicalCryptoEntity,
    CanonicalCryptoInventory,
    CanonicalRelationship,
    ProvenanceRecord,
)


REQUIRED_ENTITY_TYPES = [
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
]

REQUIRED_RELATIONSHIPS = [
    RelationshipType.USES,
    RelationshipType.PROTECTS,
    RelationshipType.PRESENT_IN,
    RelationshipType.DEPENDS_ON,
    RelationshipType.OBSERVED_BY,
    RelationshipType.TERMINATES_AT,
    RelationshipType.OWNED_BY,
    RelationshipType.VIOLATES,
    RelationshipType.REMEDIATED_BY,
]


class TestCanonicalCryptoModel:
    """Tests the canonical model covering all 22 required entity types and relationships."""

    def test_all_22_entity_types_covered(self):
        assert len(REQUIRED_ENTITY_TYPES) == 22
        # Verify enum uniqueness
        unique_values = {t.value for t in REQUIRED_ENTITY_TYPES}
        assert len(unique_values) == 22

    def test_entity_creation_with_deterministic_urn_and_provenance(self):
        prov = ProvenanceRecord(
            scanner_name="ecdat-ast-scanner",
            scanner_version="1.2.0",
            source_kind="source_code",
            locator="src/auth/token_signer.py",
            confidence=ConfidenceLevel.HIGH,
            hash_or_fingerprint="sha256:abcd1234efgh5678",
        )

        algo_entity = CanonicalCryptoEntity.create(
            entity_type=AssetType.ALGORITHM,
            name="Ed25519",
            provenance=prov,
            tenant_id="acme_corp",
            application_id="identity_service",
            core_properties={"curve": "edwards25519", "key_size": 256},
            additional_properties={"quantum_safe": False},
        )

        assert algo_entity.entity_id.startswith("urn:ecdat:v1:asset:acme_corp:identity_service:algorithm:")
        assert algo_entity.entity_type == AssetType.ALGORITHM
        assert algo_entity.name == "Ed25519"
        assert algo_entity.provenance.scanner_name == "ecdat-ast-scanner"
        assert algo_entity.provenance.locator == "src/auth/token_signer.py"

        # Determinism check: repeated generation yields identical URN
        algo_entity_2 = CanonicalCryptoEntity.create(
            entity_type=AssetType.ALGORITHM,
            name="Ed25519",
            provenance=prov,
            tenant_id="acme_corp",
            application_id="identity_service",
            core_properties={"curve": "edwards25519", "key_size": 256},
        )
        assert algo_entity.entity_id == algo_entity_2.entity_id

    def test_instantiate_all_22_entity_types(self):
        inventory = CanonicalCryptoInventory(tenant_id="test_org", application_id="test_app")
        prov = ProvenanceRecord(
            scanner_name="ecdat-unified",
            scanner_version="1.0.0",
            source_kind="system_catalog",
            locator="cluster/prod-01",
        )

        for e_type in REQUIRED_ENTITY_TYPES:
            entity = CanonicalCryptoEntity.create(
                entity_type=e_type,
                name=f"Test_{e_type.value}",
                provenance=prov,
                tenant_id="test_org",
                application_id="test_app",
                core_properties={"category": e_type.value},
            )
            assert entity.entity_id.startswith(f"urn:ecdat:v1:asset:test_org:test_app:{e_type.value}:")
            inventory.add_entity(entity)

        assert len(inventory.entities) == 22

    def test_canonical_relationships_and_graph_traversal(self):
        inventory = CanonicalCryptoInventory(tenant_id="bank_tenant", application_id="core_banking")
        prov = ProvenanceRecord(
            scanner_name="ecdat-network",
            scanner_version="1.0.0",
            source_kind="network_handshake",
            locator="10.100.0.5:443",
        )

        # 1. Application entity
        app = CanonicalCryptoEntity.create(
            entity_type=AssetType.APPLICATION,
            name="CoreBankingPaymentGateway",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(app)

        # 2. Service entity
        svc = CanonicalCryptoEntity.create(
            entity_type=AssetType.SERVICE,
            name="PaymentProcessingService",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(svc)

        # 3. Endpoint entity
        endpoint = CanonicalCryptoEntity.create(
            entity_type=AssetType.ENDPOINT,
            name="api.payments.bank.internal:8443",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(endpoint)

        # 4. Certificate entity
        cert = CanonicalCryptoEntity.create(
            entity_type=AssetType.CERTIFICATE,
            name="api.payments.bank.internal-tls-cert",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(cert)

        # 5. Algorithm entity
        algo = CanonicalCryptoEntity.create(
            entity_type=AssetType.ALGORITHM,
            name="RSA-2048",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(algo)

        # 6. Policy entity
        policy = CanonicalCryptoEntity.create(
            entity_type=AssetType.POLICY,
            name="Regulated_BFSI_Policy",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(policy)

        # 7. Remediation entity
        remediation = CanonicalCryptoEntity.create(
            entity_type=AssetType.REMEDIATION,
            name="Migrate_To_ML-KEM-768_Hybrid",
            provenance=prov,
            tenant_id="bank_tenant",
            application_id="core_banking",
        )
        inventory.add_entity(remediation)

        # Connect relationships:
        # App USES Service
        r1 = CanonicalRelationship.create(app.entity_id, svc.entity_id, RelationshipType.USES)
        # Service TERMINATES_AT Endpoint
        r2 = CanonicalRelationship.create(svc.entity_id, endpoint.entity_id, RelationshipType.TERMINATES_AT)
        # Certificate PROTECTS Endpoint
        r3 = CanonicalRelationship.create(cert.entity_id, endpoint.entity_id, RelationshipType.PROTECTS)
        # Certificate DEPENDS_ON Algorithm
        r4 = CanonicalRelationship.create(cert.entity_id, algo.entity_id, RelationshipType.DEPENDS_ON)
        # Algorithm VIOLATES Policy
        r5 = CanonicalRelationship.create(algo.entity_id, policy.entity_id, RelationshipType.VIOLATES)
        # Algorithm REMEDIATED_BY Remediation
        r6 = CanonicalRelationship.create(algo.entity_id, remediation.entity_id, RelationshipType.REMEDIATED_BY)

        for rel in [r1, r2, r3, r4, r5, r6]:
            inventory.add_relationship(rel)

        # Traversal verification
        app_outgoing = inventory.get_outgoing_relationships(app.entity_id)
        assert len(app_outgoing) == 1
        assert app_outgoing[0].relationship_type == RelationshipType.USES
        assert app_outgoing[0].target_id == svc.entity_id

        algo_outgoing = inventory.get_outgoing_relationships(algo.entity_id)
        assert len(algo_outgoing) == 2
        algo_rel_types = {r.relationship_type for r in algo_outgoing}
        assert RelationshipType.VIOLATES in algo_rel_types
        assert RelationshipType.REMEDIATED_BY in algo_rel_types

        endpoint_incoming = inventory.get_incoming_relationships(endpoint.entity_id)
        assert len(endpoint_incoming) == 2
        end_rel_types = {r.relationship_type for r in endpoint_incoming}
        assert RelationshipType.TERMINATES_AT in end_rel_types
        assert RelationshipType.PROTECTS in end_rel_types

        # Graph serialization
        graph_dict = inventory.to_graph_dict()
        assert graph_dict["entity_count"] == 7
        assert graph_dict["relationship_count"] == 6
        assert len(graph_dict["entities"]) == 7
        assert len(graph_dict["relationships"]) == 6
