"""
Unit and Integration Tests for Phase 7.2: Evidence Correlation Engine

Validates:
1. Evidence correlation from all 8 sources:
   - SOURCE, DEPENDENCY, BINARY, FILESYSTEM, NETWORK, RUNTIME, CERTIFICATE, CBOM.
2. Anti-blind-merge: Rejection of false merges based on name alone when key attributes differ (e.g. RSA-1024 vs RSA-2048).
3. Deterministic vs confidence-scored correlation: Exact fingerprint/locator match vs contextual scoring.
4. Provenance tracking: Every relationship answers "Why does ECDAT believe this relationship exists?".
5. Security: Graph injection prevention, query authorization, tenant isolation, and audit trails.
"""

import pytest
from scanners.domain.contracts import AssetType, ConfidenceLevel, RelationshipType
from scanners.domain.canonical_model import (
    CanonicalCryptoEntity,
    CanonicalCryptoInventory,
    ProvenanceRecord,
)
from scanners.domain.correlation_engine import (
    CorrelationEngine,
    CorrelationEvidence,
    EvidenceOrigin,
    GraphSecurityViolation,
)


class TestMultiSourceCorrelation:
    """Validates multi-source ingestion and correlation across all 8 origins."""

    def test_correlate_from_all_8_origins(self):
        engine = CorrelationEngine(tenant_id="bank_corp")
        all_origins = [
            EvidenceOrigin.SOURCE,
            EvidenceOrigin.DEPENDENCY,
            EvidenceOrigin.BINARY,
            EvidenceOrigin.FILESYSTEM,
            EvidenceOrigin.NETWORK,
            EvidenceOrigin.RUNTIME,
            EvidenceOrigin.CERTIFICATE,
            EvidenceOrigin.CBOM,
        ]

        created_entities = []
        for origin in all_origins:
            ev = CorrelationEvidence(
                origin=origin,
                entity_type=AssetType.ALGORITHM,
                canonical_name=f"AES_256_{origin.value.upper()}",
                locator=f"path/to/{origin.value}_artifact",
                tenant_id="bank_corp",
                application_id="payment_app",
                attributes={"key_size": 256, "mode": "GCM"},
            )
            entity, _ = engine.correlate_evidence(ev)
            assert entity is not None
            assert entity.provenance.source_kind == origin.value
            created_entities.append(entity)

        assert len(created_entities) == 8
        assert engine.inventory.to_graph_dict()["entity_count"] == 8

    def test_deterministic_fingerprint_correlation(self):
        engine = CorrelationEngine(tenant_id="cloud_org")

        # 1. Certificate discovered via Filesystem
        cert_ev = CorrelationEvidence(
            origin=EvidenceOrigin.FILESYSTEM,
            entity_type=AssetType.CERTIFICATE,
            canonical_name="internal-ca.crt",
            locator="/etc/ssl/certs/internal-ca.crt",
            tenant_id="cloud_org",
            fingerprint="sha256:aabbccddeeff00112233445566778899",
        )
        cert_entity, _ = engine.correlate_evidence(cert_ev)

        # 2. Later, Network Scanner discovers the exact same certificate during TLS handshake
        net_ev = CorrelationEvidence(
            origin=EvidenceOrigin.NETWORK,
            entity_type=AssetType.CERTIFICATE,
            canonical_name="internal-ca.crt",
            locator="10.0.0.1:443",
            tenant_id="cloud_org",
            fingerprint="sha256:aabbccddeeff00112233445566778899",
        )
        correlated_entity, _ = engine.correlate_evidence(net_ev)

        # Merged into the same canonical entity because fingerprint matched
        assert correlated_entity.entity_id == cert_entity.entity_id
        # Provenance rationale recorded
        correlations = correlated_entity.properties.get("correlations", [])
        assert len(correlations) == 1
        assert "Exact SHA-256 fingerprint match" in correlations[0]["why_ecdat_believes_this_exists"]


class TestAntiBlindMerge:
    """Anti-Blind-Merge: Never merge similar names if attributes conflict."""

    def test_rejects_blind_merge_when_key_sizes_conflict(self):
        engine = CorrelationEngine(tenant_id="security_firm")

        # Ingest RSA-1024
        ev_weak = CorrelationEvidence(
            origin=EvidenceOrigin.SOURCE,
            entity_type=AssetType.ALGORITHM,
            canonical_name="RSA",
            locator="src/legacy_signer.py",
            tenant_id="security_firm",
            application_id="crypto_vault",
            attributes={"key_size": 1024},
        )
        entity_weak, _ = engine.correlate_evidence(ev_weak)

        # Ingest RSA-2048 in same app
        ev_strong = CorrelationEvidence(
            origin=EvidenceOrigin.BINARY,
            entity_type=AssetType.ALGORITHM,
            canonical_name="RSA",
            locator="bin/crypto_service",
            tenant_id="security_firm",
            application_id="crypto_vault",
            attributes={"key_size": 2048},
        )
        entity_strong, _ = engine.correlate_evidence(ev_strong)

        # ANTI-BLIND-MERGE INVARIANT: Must NOT merge because key sizes conflict (1024 != 2048)
        assert entity_weak.entity_id != entity_strong.entity_id
        assert engine.inventory.to_graph_dict()["entity_count"] == 2

    def test_successful_contextual_correlation_when_attributes_align(self):
        engine = CorrelationEngine(tenant_id="fintech", min_correlation_confidence=0.60)

        # Source scan finds AES-GCM
        src_ev = CorrelationEvidence(
            origin=EvidenceOrigin.SOURCE,
            entity_type=AssetType.ALGORITHM,
            canonical_name="AES",
            locator="services/payment/encryptor.py",
            tenant_id="fintech",
            application_id="checkout_service",
            attributes={"key_size": 256, "mode": "GCM"},
        )
        src_entity, _ = engine.correlate_evidence(src_ev)

        # Binary scanner finds AES with matching key_size and mode in co-located binary
        bin_ev = CorrelationEvidence(
            origin=EvidenceOrigin.BINARY,
            entity_type=AssetType.ALGORITHM,
            canonical_name="AES",
            locator="services/payment/libpayment.so",
            tenant_id="fintech",
            application_id="checkout_service",
            attributes={"key_size": 256, "mode": "GCM"},
        )
        bin_entity, _ = engine.correlate_evidence(bin_ev)

        # Successfully merged due to score >= min_correlation_confidence
        assert bin_entity.entity_id == src_entity.entity_id
        correlations = bin_entity.properties.get("correlations", [])
        assert len(correlations) == 1
        assert "Matching key size" in correlations[0]["why_ecdat_believes_this_exists"]


class TestGraphSecurityAndAuthorization:
    """Validates graph injection protection, tenant isolation, and audited queries."""

    def test_rejects_graph_injection_in_entity_name(self):
        engine = CorrelationEngine(tenant_id="tenant_a")
        prov = ProvenanceRecord("scanner", "1.0", "source", "file.py")

        # Entity name with script injection or semicolon delimiter
        malicious_entity = CanonicalCryptoEntity(
            entity_id="urn:ecdat:v1:asset:tenant_a:app:algorithm:1234",
            entity_type=AssetType.ALGORITHM,
            name="AES<script>alert(1)</script>",
            provenance=prov,
            tenant_id="tenant_a",
        )

        with pytest.raises(GraphSecurityViolation) as exc_info:
            engine.ingest_entity(malicious_entity)
        assert "Graph Injection Attempt Detected" in str(exc_info.value)

    def test_tenant_isolation_enforced_on_ingestion(self):
        engine = CorrelationEngine(tenant_id="tenant_alpha")
        prov = ProvenanceRecord("scanner", "1.0", "source", "file.py")

        foreign_entity = CanonicalCryptoEntity(
            entity_id="urn:ecdat:v1:asset:tenant_beta:app:algorithm:5678",
            entity_type=AssetType.ALGORITHM,
            name="ValidAlgorithm",
            provenance=prov,
            tenant_id="tenant_beta",  # Mismatch
        )

        with pytest.raises(GraphSecurityViolation) as exc_info:
            engine.ingest_entity(foreign_entity)
        assert "Tenant Isolation Breach" in str(exc_info.value)

    def test_authorized_and_audited_graph_queries(self):
        engine = CorrelationEngine(tenant_id="tenant_bank")
        # Ingest clean entity
        prov = ProvenanceRecord("scanner", "1.0", "network", "api.bank.com:443")
        cert = CanonicalCryptoEntity.create(
            entity_type=AssetType.CERTIFICATE,
            name="api.bank.com-cert",
            provenance=prov,
            tenant_id="tenant_bank",
        )
        engine.ingest_entity(cert)

        # 1. Unauthorized tenant query rejected
        with pytest.raises(GraphSecurityViolation) as exc_info:
            engine.execute_authorized_query(
                actor_id="attacker@foreign.com",
                actor_tenant="tenant_rival",
                user_roles={"admin"},
                query_type="query_certificates",
                target_id_or_type="certificate",
                query_fn=lambda inv: inv.find_by_type(AssetType.CERTIFICATE),
            )
        assert "Unauthorized: Actor tenant" in str(exc_info.value)

        # 2. Sensitive query requires security_analyst or admin role
        with pytest.raises(GraphSecurityViolation) as exc_info:
            engine.execute_authorized_query(
                actor_id="intern@bank.com",
                actor_tenant="tenant_bank",
                user_roles={"developer"},  # Missing security_analyst / admin
                query_type="query_certificates",
                target_id_or_type="certificate",
                query_fn=lambda inv: inv.find_by_type(AssetType.CERTIFICATE),
            )
        assert "Forbidden: Actor 'intern@bank.com' lacks required roles" in str(exc_info.value)

        # 3. Authorized query succeeds
        results = engine.execute_authorized_query(
            actor_id="analyst@bank.com",
            actor_tenant="tenant_bank",
            user_roles={"security_analyst"},
            query_type="query_certificates",
            target_id_or_type="certificate",
            query_fn=lambda inv: inv.find_by_type(AssetType.CERTIFICATE),
        )
        assert len(results) == 1
        assert results[0].name == "api.bank.com-cert"

        # Verify audit log contains all 3 query attempts
        assert len(engine.audit_log) == 3
        assert engine.audit_log[0].authorized is False
        assert engine.audit_log[1].authorized is False
        assert engine.audit_log[2].authorized is True
