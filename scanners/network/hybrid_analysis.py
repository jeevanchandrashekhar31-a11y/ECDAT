"""
ECDAT TLS / PQC / Hybrid Handshake Analysis Engine (Phase 5.3)

Key Capabilities:
1. Model classical, PQC, and hybrid handshake properties explicitly.
2. Formally enforce the cryptographic invariant:
   Packet capture (PCAP) DOES NOT reveal plaintext without ephemeral session secrets.
3. Differentiate evidence sources:
   - STATIC_CONFIGURATION
   - NETWORK_HANDSHAKE
   - RUNTIME
4. Represent hybrid mechanisms as first-class relationships:
   - HAS_CLASSICAL_COMPONENT
   - HAS_POST_QUANTUM_COMPONENT
   - USES_HYBRID_COMBINER
5. Versioned PQC algorithm catalog integration without hardcoded algorithm rewrites.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


class EvidenceSource(str, Enum):
    """
    Source of cryptographic observation or finding.
    Differentiates static configuration, active network handshake observation,
    and running process / memory runtime evidence.
    """

    STATIC_CONFIGURATION = "static_configuration"
    NETWORK_HANDSHAKE = "network_handshake"
    RUNTIME = "runtime"


class HandshakeCategory(str, Enum):
    CLASSICAL = "classical"
    HYBRID = "hybrid"
    POST_QUANTUM = "post_quantum"


class HybridRelationshipType(str, Enum):
    HAS_CLASSICAL_COMPONENT = "has_classical_component"
    HAS_POST_QUANTUM_COMPONENT = "has_post_quantum_component"
    USES_HYBRID_COMBINER = "uses_hybrid_combiner"
    NEGOTIATED_KEY_EXCHANGE = "negotiated_key_exchange"
    AUTHENTICATED_BY_SIGNATURE = "authenticated_by_signature"


class PlaintextExposureError(ValueError):
    """Raised when an analyzer or user falsely claims passive packet capture reveals plaintext."""

    pass


@dataclass
class HybridRelationship:
    """
    Represents a first-class graph relationship connecting a composite/hybrid mechanism
    to its constituent classical algorithm, post-quantum algorithm, or combiner.
    """

    source_id: str
    target_id: str
    relationship_type: HybridRelationshipType
    properties: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "relationship_type": self.relationship_type.value,
            "properties": self.properties,
        }


@dataclass
class TlsHandshakeProperties:
    """
    Explicit model of TLS / SSH handshake cryptographic properties.
    """

    endpoint: str
    tls_version: str
    cipher_suite: str
    key_exchange_group: Optional[str]
    signature_algorithm: Optional[str]
    category: HandshakeCategory
    evidence_source: EvidenceSource
    catalog_algorithm_id: Optional[str] = None
    standard_name: Optional[str] = None
    standard_reference: Optional[str] = None
    iana_group_id: Optional[int] = None
    nist_quantum_level: Optional[int] = None
    harvest_now_decrypt_later_resilient: bool = False
    quantum_authentication_resilient: bool = False
    ephemeral_forward_secrecy: bool = True
    # Cryptographic invariant: passive packet capture cannot reveal plaintext
    packet_capture_can_reveal_plaintext: bool = False
    pcap_plaintext_disclaimer: str = (
        "Cryptographic Invariant: Passive packet capture alone CANNOT reveal application plaintext "
        "for sessions utilizing forward-secret (PFS) or hybrid ephemeral key exchange. "
        "Compromise of the long-term private signing/identity key does not permit retroactive "
        "decryption of ephemeral sessions without per-session ephemeral pre-master secret logs (SSLKEYLOGFILE)."
    )
    relationships: List[HybridRelationship] = field(default_factory=list)

    def validate_pcap_invariants(self) -> None:
        """
        Enforces that packet capture does not falsely claim plaintext revelation.
        """
        if self.packet_capture_can_reveal_plaintext:
            raise PlaintextExposureError(
                f"False plaintext exposure claim detected for endpoint {self.endpoint}: "
                f"Passive packet capture cannot expose plaintext for {self.cipher_suite} / {self.key_exchange_group}."
            )

    def to_dict(self) -> Dict[str, Any]:
        self.validate_pcap_invariants()
        return {
            "endpoint": self.endpoint,
            "tls_version": self.tls_version,
            "cipher_suite": self.cipher_suite,
            "key_exchange_group": self.key_exchange_group,
            "signature_algorithm": self.signature_algorithm,
            "category": self.category.value,
            "evidence_source": self.evidence_source.value,
            "catalog_algorithm_id": self.catalog_algorithm_id,
            "standard_name": self.standard_name,
            "standard_reference": self.standard_reference,
            "iana_group_id": self.iana_group_id,
            "nist_quantum_level": self.nist_quantum_level,
            "harvest_now_decrypt_later_resilient": self.harvest_now_decrypt_later_resilient,
            "quantum_authentication_resilient": self.quantum_authentication_resilient,
            "ephemeral_forward_secrecy": self.ephemeral_forward_secrecy,
            "packet_capture_can_reveal_plaintext": self.packet_capture_can_reveal_plaintext,
            "pcap_plaintext_disclaimer": self.pcap_plaintext_disclaimer,
            "relationships": [r.to_dict() for r in self.relationships],
        }


class PqcCatalog:
    """
    Versioned registry loader and query interface for PQC, hybrid, and classical algorithms.
    """

    def __init__(self, catalog_path: Optional[Path] = None):
        if catalog_path is None:
            # Default to rules/pqc_algorithm_catalog.json
            repo_root = Path(__file__).resolve().parent.parent.parent
            catalog_path = repo_root / "rules" / "pqc_algorithm_catalog.json"

        self.catalog_path = catalog_path
        self.version: str = "0.0.0"
        self.algorithms: Dict[str, Dict[str, Any]] = {}
        self.alias_map: Dict[str, str] = {}
        self.group_map: Dict[int, str] = {}
        self.load_catalog()

    def load_catalog(self) -> None:
        if not self.catalog_path.exists():
            raise FileNotFoundError(f"PQC algorithm catalog not found at: {self.catalog_path}")

        with open(self.catalog_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.version = data.get("catalog_version", "1.0.0")
        self.last_updated = data.get("last_updated", "")
        self.algorithms.clear()
        self.alias_map.clear()
        self.group_map.clear()

        for algo in data.get("algorithms", []):
            algo_id = algo["id"]
            self.algorithms[algo_id] = algo

            # Map standard name and id (case-insensitive)
            self.alias_map[algo_id.lower()] = algo_id
            self.alias_map[algo["standard_name"].lower()] = algo_id

            for alias in algo.get("aliases", []):
                self.alias_map[alias.lower()] = algo_id

            if algo.get("ssh_name"):
                self.alias_map[algo["ssh_name"].lower()] = algo_id

            if algo.get("iana_tls_group_id") is not None:
                self.group_map[algo["iana_tls_group_id"]] = algo_id

    def lookup(self, name_or_alias: str) -> Optional[Dict[str, Any]]:
        """Finds algorithm specification by identifier, name, or alias."""
        if not name_or_alias:
            return None
        clean = name_or_alias.strip().lower()
        algo_id = self.alias_map.get(clean)
        if algo_id:
            return self.algorithms.get(algo_id)
        return None

    def lookup_group(self, group_id: int) -> Optional[Dict[str, Any]]:
        """Finds algorithm specification by IANA TLS group ID (numeric)."""
        algo_id = self.group_map.get(group_id)
        if algo_id:
            return self.algorithms.get(algo_id)
        return None


class HybridHandshakeAnalyzer:
    """
    Analyzes TLS, SSH, and network handshakes or static configs for classical vs PQC/hybrid properties.
    Builds explicit first-class relationships and guarantees no false PCAP plaintext disclosure claims.
    """

    def __init__(self, catalog: Optional[PqcCatalog] = None):
        self.catalog = catalog or PqcCatalog()

    def analyze_handshake(
        self,
        endpoint: str,
        tls_version: str,
        cipher_suite: str,
        key_exchange_group: Optional[str] = None,
        signature_algorithm: Optional[str] = None,
        evidence_source: EvidenceSource = EvidenceSource.NETWORK_HANDSHAKE,
        assert_pcap_safety: bool = True,
    ) -> TlsHandshakeProperties:
        """
        Models handshake properties explicitly, checks catalog, and constructs first-class relationships.
        """
        # Determine candidate key exchange algorithm entry
        kex_algo = None
        if key_exchange_group:
            kex_algo = self.catalog.lookup(key_exchange_group)
        if not kex_algo and cipher_suite:
            # Check if cipher_suite itself maps to an algorithm or contains hints
            kex_algo = self.catalog.lookup(cipher_suite)

        # Categorize handshake
        category = HandshakeCategory.CLASSICAL
        if kex_algo:
            cat_str = kex_algo.get("category", "classical")
            if cat_str == "hybrid":
                category = HandshakeCategory.HYBRID
            elif cat_str == "post_quantum":
                category = HandshakeCategory.POST_QUANTUM
            else:
                category = HandshakeCategory.CLASSICAL
        else:
            # Fallback heuristic if unknown to catalog
            combined_text = f"{key_exchange_group or ''} {cipher_suite}".lower()
            if any(k in combined_text for k in ["mlkem", "kyber", "sntrup761", "frodo", "bikel"]):
                if any(c in combined_text for c in ["x25519", "p256", "p384", "secp256r1", "rsa"]):
                    category = HandshakeCategory.HYBRID
                else:
                    category = HandshakeCategory.POST_QUANTUM

        # Forward secrecy determination
        has_forward_secrecy = True
        c_upper = cipher_suite.upper()
        if (
            c_upper.startswith("TLS_RSA_")
            or c_upper.startswith("RSA_")
            or ("-SHA" in c_upper and not any(k in c_upper for k in ["ECDHE", "DHE", "ECDH", "DH"]))
        ):
            has_forward_secrecy = False

        # Invariant enforcement: packet capture cannot reveal plaintext
        # Even without forward secrecy (e.g. static RSA), packet capture ALONE cannot reveal plaintext
        # without the private key, and ECDAT strictly forbids claiming PCAP reveals plaintext.
        props = TlsHandshakeProperties(
            endpoint=endpoint,
            tls_version=tls_version,
            cipher_suite=cipher_suite,
            key_exchange_group=key_exchange_group,
            signature_algorithm=signature_algorithm,
            category=category,
            evidence_source=evidence_source,
            ephemeral_forward_secrecy=has_forward_secrecy,
            packet_capture_can_reveal_plaintext=False,
        )

        if kex_algo:
            props.catalog_algorithm_id = kex_algo["id"]
            props.standard_name = kex_algo["standard_name"]
            props.standard_reference = kex_algo.get("standard_reference")
            props.iana_group_id = kex_algo.get("iana_tls_group_id")
            props.nist_quantum_level = kex_algo.get("nist_quantum_security_level")
            props.harvest_now_decrypt_later_resilient = kex_algo.get("harvest_now_decrypt_later_resilient", False)
            props.quantum_authentication_resilient = kex_algo.get("quantum_authentication_resilient", False)

        # Signature algorithm check for quantum authentication resilience
        if signature_algorithm:
            sig_algo = self.catalog.lookup(signature_algorithm)
            if sig_algo and sig_algo.get("category") in ["post_quantum", "hybrid"]:
                props.quantum_authentication_resilient = True

        # Build first-class relationships
        relationships = self._build_first_class_relationships(
            endpoint=endpoint,
            kex_algo=kex_algo,
            signature_algorithm=signature_algorithm,
        )
        props.relationships = relationships

        if assert_pcap_safety:
            props.validate_pcap_invariants()

        return props

    def _build_first_class_relationships(
        self,
        endpoint: str,
        kex_algo: Optional[Dict[str, Any]],
        signature_algorithm: Optional[str],
    ) -> List[HybridRelationship]:
        """
        Creates first-class domain relationships for hybrid mechanisms:
        - endpoint -> kex mechanism (NEGOTIATED_KEY_EXCHANGE)
        - kex mechanism -> classical component (HAS_CLASSICAL_COMPONENT)
        - kex mechanism -> PQC component (HAS_POST_QUANTUM_COMPONENT)
        - kex mechanism -> combiner (USES_HYBRID_COMBINER)
        """
        relationships: List[HybridRelationship] = []

        if not kex_algo:
            return relationships

        kex_id = kex_algo["id"]

        # Link endpoint to negotiated KEX
        relationships.append(
            HybridRelationship(
                source_id=f"endpoint:{endpoint}",
                target_id=f"algo:{kex_id}",
                relationship_type=HybridRelationshipType.NEGOTIATED_KEY_EXCHANGE,
                properties={
                    "standard_name": kex_algo["standard_name"],
                    "category": kex_algo["category"],
                },
            )
        )

        # If hybrid, decompose into first-class components
        if kex_algo.get("category") == "hybrid" and "hybrid_components" in kex_algo:
            components = kex_algo["hybrid_components"]

            classical = components.get("classical_component")
            if classical:
                classical_meta = self.catalog.lookup(classical) or {}
                relationships.append(
                    HybridRelationship(
                        source_id=f"algo:{kex_id}",
                        target_id=f"algo:{classical}",
                        relationship_type=HybridRelationshipType.HAS_CLASSICAL_COMPONENT,
                        properties={
                            "role": "classical_pre_master_secret",
                            "standard_name": classical_meta.get("standard_name", classical),
                            "quantum_resilient": False,
                        },
                    )
                )

            pqc = components.get("post_quantum_component")
            if pqc:
                pqc_meta = self.catalog.lookup(pqc) or {}
                relationships.append(
                    HybridRelationship(
                        source_id=f"algo:{kex_id}",
                        target_id=f"algo:{pqc}",
                        relationship_type=HybridRelationshipType.HAS_POST_QUANTUM_COMPONENT,
                        properties={
                            "role": "post_quantum_pre_master_secret",
                            "standard_name": pqc_meta.get("standard_name", pqc),
                            "nist_level": pqc_meta.get("nist_quantum_security_level", 3),
                            "quantum_resilient": True,
                        },
                    )
                )

            combiner = components.get("combiner_function")
            if combiner:
                relationships.append(
                    HybridRelationship(
                        source_id=f"algo:{kex_id}",
                        target_id=f"kdf:{combiner}",
                        relationship_type=HybridRelationshipType.USES_HYBRID_COMBINER,
                        properties={
                            "function": combiner,
                            "combining_strategy": "concatenation_kdf_extract_and_expand",
                        },
                    )
                )

        # Link signature algorithm if present
        if signature_algorithm:
            sig_meta = self.catalog.lookup(signature_algorithm) or {}
            relationships.append(
                HybridRelationship(
                    source_id=f"endpoint:{endpoint}",
                    target_id=f"sig:{signature_algorithm}",
                    relationship_type=HybridRelationshipType.AUTHENTICATED_BY_SIGNATURE,
                    properties={
                        "standard_name": sig_meta.get("standard_name", signature_algorithm),
                        "category": sig_meta.get("category", "classical"),
                    },
                )
            )

        return relationships


def assert_no_pcap_plaintext_claim(finding: Dict[str, Any]) -> None:
    """
    Security check for scan findings / outputs:
    Rejects any report or finding claiming that network packet capture yields plaintext.
    """
    finding_str = json.dumps(finding).lower()
    forbidden_claims = [
        "packet capture reveals plaintext",
        "pcap reveals plaintext",
        "pcap decrypts traffic",
        "plaintext exposed in packet capture",
        "packet capture can reveal plaintext",
    ]
    for claim in forbidden_claims:
        if claim in finding_str:
            raise PlaintextExposureError(
                f"Cryptographic error in scan finding: Illegal claim '{claim}'. "
                "Packet capture alone cannot reveal plaintext."
            )
    if finding.get("packet_capture_can_reveal_plaintext") is True:
        raise PlaintextExposureError("Cryptographic error: packet_capture_can_reveal_plaintext flag is set to True.")
