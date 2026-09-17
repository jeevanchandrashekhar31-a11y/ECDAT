"""
Unit & Integration Tests for Phase 5.3: TLS / PQC / Hybrid Analysis

Verifies:
1. Classical, PQC, and Hybrid handshake properties modeled explicitly.
2. Invariant: Packet capture CANNOT reveal plaintext (rejection of false claims).
3. Evidence source differentiation (STATIC_CONFIGURATION, NETWORK_HANDSHAKE, RUNTIME).
4. First-class relationships for hybrid mechanisms (classical component, PQC component, combiner).
5. Versioned catalog loading and resolution (e.g. X25519MLKEM768, SecP256r1MLKEM768, SSH hybrid KEX).
6. CBOM mapping of hybrid handshakes into CycloneDX 1.6.
"""

import json
import pytest
from pathlib import Path

from scanners.network.hybrid_analysis import (
    HybridHandshakeAnalyzer,
    PqcCatalog,
    EvidenceSource,
    HandshakeCategory,
    HybridRelationshipType,
    PlaintextExposureError,
    TlsHandshakeProperties,
    assert_no_pcap_plaintext_claim,
)
from scanners.cbom_mapping import hybrid_analysis_to_cbom, serialize_cbom, validate_cbom_json


class TestPqcCatalog:
    """Tests catalog loading, indexing, and lookup capabilities."""

    def test_catalog_loads_version_and_algorithms(self):
        catalog = PqcCatalog()
        assert catalog.version == "2.0.0"
        assert len(catalog.algorithms) >= 15
        assert "x25519_mlkem768" in catalog.algorithms
        assert "secp256r1_mlkem768" in catalog.algorithms
        assert "mlkem768x25519_sha512" in catalog.algorithms

    def test_catalog_lookup_by_id_and_standard_name(self):
        catalog = PqcCatalog()
        by_id = catalog.lookup("x25519_mlkem768")
        assert by_id is not None
        assert by_id["standard_name"] == "X25519MLKEM768"
        assert by_id["iana_tls_group_id"] == 4588
        assert by_id["nist_quantum_security_level"] == 3

        by_name = catalog.lookup("X25519MLKEM768")
        assert by_name == by_id

        by_alias = catalog.lookup("x25519_kyber768")
        assert by_alias == by_id

    def test_catalog_lookup_ssh_hybrid_kex(self):
        catalog = PqcCatalog()
        ssh_kex = catalog.lookup("sntrup761x25519-sha512@openssh.com")
        assert ssh_kex is not None
        assert ssh_kex["category"] == "hybrid"
        assert ssh_kex["hybrid_components"]["classical_component"] == "x25519"
        assert ssh_kex["hybrid_components"]["post_quantum_component"] == "sntrup761"

    def test_catalog_lookup_iana_group_id(self):
        catalog = PqcCatalog()
        algo = catalog.lookup_group(4588)
        assert algo is not None
        assert algo["standard_name"] == "X25519MLKEM768"

        secp = catalog.lookup_group(4589)
        assert secp is not None
        assert secp["standard_name"] == "SecP256r1MLKEM768"

    def test_catalog_missing_algorithm_returns_none(self):
        catalog = PqcCatalog()
        assert catalog.lookup("non_existent_algo_999") is None
        assert catalog.lookup_group(99999) is None


class TestHybridHandshakeAnalysis:
    """Tests explicit modeling of classical vs PQC vs hybrid handshakes."""

    def test_classical_tls13_handshake(self):
        analyzer = HybridHandshakeAnalyzer()
        props = analyzer.analyze_handshake(
            endpoint="api.legacy.com:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="x25519",
            signature_algorithm="rsa_pss_rsae_sha256",
            evidence_source=EvidenceSource.NETWORK_HANDSHAKE,
        )

        assert props.category == HandshakeCategory.CLASSICAL
        assert props.evidence_source == EvidenceSource.NETWORK_HANDSHAKE
        assert props.harvest_now_decrypt_later_resilient is False
        assert props.quantum_authentication_resilient is False
        assert props.ephemeral_forward_secrecy is True
        assert props.packet_capture_can_reveal_plaintext is False

    def test_standardized_pqc_hybrid_tls13_handshake(self):
        analyzer = HybridHandshakeAnalyzer()
        props = analyzer.analyze_handshake(
            endpoint="pqc.bank.internal:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_256_GCM_SHA384",
            key_exchange_group="X25519MLKEM768",
            signature_algorithm="rsa_pss_rsae_sha256",
            evidence_source=EvidenceSource.NETWORK_HANDSHAKE,
        )

        assert props.category == HandshakeCategory.HYBRID
        assert props.catalog_algorithm_id == "x25519_mlkem768"
        assert props.standard_name == "X25519MLKEM768"
        assert props.iana_group_id == 4588
        assert props.nist_quantum_level == 3
        # Harvest Now Decrypt Later resilient because ML-KEM-768 protects confidentiality
        assert props.harvest_now_decrypt_later_resilient is True
        # Classical signature still used for authentication
        assert props.quantum_authentication_resilient is False
        assert props.packet_capture_can_reveal_plaintext is False

        # Verify first-class relationships
        rel_types = [r.relationship_type for r in props.relationships]
        assert HybridRelationshipType.NEGOTIATED_KEY_EXCHANGE in rel_types
        assert HybridRelationshipType.HAS_CLASSICAL_COMPONENT in rel_types
        assert HybridRelationshipType.HAS_POST_QUANTUM_COMPONENT in rel_types
        assert HybridRelationshipType.USES_HYBRID_COMBINER in rel_types

        # Inspect components
        pqc_rel = next(
            r for r in props.relationships if r.relationship_type == HybridRelationshipType.HAS_POST_QUANTUM_COMPONENT
        )
        assert pqc_rel.target_id == "algo:ml_kem_768"
        assert pqc_rel.properties["quantum_resilient"] is True
        assert pqc_rel.properties["nist_level"] == 3

        classical_rel = next(
            r for r in props.relationships if r.relationship_type == HybridRelationshipType.HAS_CLASSICAL_COMPONENT
        )
        assert classical_rel.target_id == "algo:x25519"
        assert classical_rel.properties["quantum_resilient"] is False

    def test_pure_pqc_handshake(self):
        analyzer = HybridHandshakeAnalyzer()
        props = analyzer.analyze_handshake(
            endpoint="future.gov:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_256_GCM_SHA384",
            key_exchange_group="ML-KEM-1024",
            signature_algorithm="ML-DSA-87",
            evidence_source=EvidenceSource.STATIC_CONFIGURATION,
        )

        assert props.category == HandshakeCategory.POST_QUANTUM
        assert props.evidence_source == EvidenceSource.STATIC_CONFIGURATION
        assert props.harvest_now_decrypt_later_resilient is True
        assert props.quantum_authentication_resilient is True
        assert props.nist_quantum_level == 5


class TestEvidenceSourceDifferentiation:
    """Ensures static configuration, active network handshake, and runtime evidence are distinct."""

    def test_evidence_source_distinction(self):
        analyzer = HybridHandshakeAnalyzer()

        static_props = analyzer.analyze_handshake(
            endpoint="nginx.conf:ssl_ecdh_curve",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="X25519MLKEM768",
            evidence_source=EvidenceSource.STATIC_CONFIGURATION,
        )
        assert static_props.evidence_source == EvidenceSource.STATIC_CONFIGURATION

        net_props = analyzer.analyze_handshake(
            endpoint="10.0.0.5:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="X25519MLKEM768",
            evidence_source=EvidenceSource.NETWORK_HANDSHAKE,
        )
        assert net_props.evidence_source == EvidenceSource.NETWORK_HANDSHAKE

        runtime_props = analyzer.analyze_handshake(
            endpoint="pid:1248:worker",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="X25519MLKEM768",
            evidence_source=EvidenceSource.RUNTIME,
        )
        assert runtime_props.evidence_source == EvidenceSource.RUNTIME


class TestPacketCapturePlaintextInvariant:
    """
    Enforces the cryptographic invariant:
    Packet capture CANNOT reveal plaintext for ephemeral/hybrid key exchange.
    """

    def test_pcap_cannot_reveal_plaintext_invariant(self):
        analyzer = HybridHandshakeAnalyzer()
        props = analyzer.analyze_handshake(
            endpoint="target.com:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="X25519MLKEM768",
        )
        assert props.packet_capture_can_reveal_plaintext is False
        assert "Passive packet capture alone CANNOT reveal" in props.pcap_plaintext_disclaimer

    def test_direct_rejection_of_false_plaintext_claim_in_props(self):
        props = TlsHandshakeProperties(
            endpoint="test:443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_128_GCM_SHA256",
            key_exchange_group="x25519",
            signature_algorithm="rsa",
            category=HandshakeCategory.CLASSICAL,
            evidence_source=EvidenceSource.NETWORK_HANDSHAKE,
            packet_capture_can_reveal_plaintext=True,  # Illegal claim
        )
        with pytest.raises(PlaintextExposureError) as exc_info:
            props.validate_pcap_invariants()
        assert "False plaintext exposure claim detected" in str(exc_info.value)

    def test_assert_no_pcap_plaintext_claim_guard(self):
        valid_finding = {
            "finding_id": "FIND-01",
            "packet_capture_can_reveal_plaintext": False,
            "description": "TLS 1.3 session observed with ephemeral X25519MLKEM768 key share.",
        }
        # Should not raise
        assert_no_pcap_plaintext_claim(valid_finding)

        invalid_finding = {
            "finding_id": "FIND-02",
            "description": "Passive packet capture reveals plaintext data due to missing authentication.",
        }
        with pytest.raises(PlaintextExposureError) as exc_info:
            assert_no_pcap_plaintext_claim(invalid_finding)
        assert "Packet capture alone cannot reveal plaintext" in str(exc_info.value)


class TestCbomMappingWithHybridHandshake:
    """Verifies that hybrid analysis produces valid CycloneDX 1.6 CBOM with constituent components."""

    def test_hybrid_analysis_cbom_generation(self):
        analyzer = HybridHandshakeAnalyzer()
        props = analyzer.analyze_handshake(
            endpoint="auth.internal.corp:8443",
            tls_version="TLSv1.3",
            cipher_suite="TLS_AES_256_GCM_SHA384",
            key_exchange_group="SecP256r1MLKEM768",
            signature_algorithm="rsa_pss_rsae_sha384",
            evidence_source=EvidenceSource.NETWORK_HANDSHAKE,
        )

        cbom = hybrid_analysis_to_cbom(props)
        assert cbom is not None

        # Components present: Endpoint, SecP256r1MLKEM768, secp256r1, ML-KEM-768, HKDF-SHA256
        comp_names = [c.name for c in cbom.components]
        assert "auth.internal.corp:8443" in comp_names
        assert "SecP256r1MLKEM768" in comp_names
        assert "secp256r1" in comp_names
        assert "ML-KEM-768" in comp_names
        assert "HKDF-SHA256" in comp_names

        # Serialize and check valid CDX 1.6 JSON
        serialized = serialize_cbom(cbom)
        assert validate_cbom_json(serialized) is True

        parsed = json.loads(serialized)
        assert parsed["specVersion"] in ("1.6", "1.7")
        assert parsed["bomFormat"] == "CycloneDX"
