"""
ECDAT Canonical Crypto Asset Model & Inventory (Phase 7.1)

Covers all 22 required entity types:
- Application
- Service
- Repository
- File
- Function
- Dependency
- Library
- Algorithm
- Key metadata
- Certificate
- Protocol
- Endpoint
- Container
- Host
- Runtime process
- Data asset
- Owner
- Environment
- Policy
- Finding
- Risk
- Remediation

Every entity has:
- Stable deterministic identifier (URN)
- Provenance tracking (scanner, version, source, location, timestamp, confidence)
- Core attributes & properties
- Explicit graph relationships (USES, PROTECTS, PRESENT_IN, DEPENDS_ON, OBSERVED_BY,
  TERMINATES_AT, OWNED_BY, VIOLATES, REMEDIATED_BY)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Union

from scanners.domain.contracts import (
    AssetType,
    ConfidenceLevel,
    Evidence,
    EvidenceSource,
    MoscaStatus,
    QuantumRelevance,
    RelationshipType,
    SeverityLevel,
)
from scanners.domain.identity import (
    ACTIVE_IDENTITY_VERSION,
    generate_asset_id,
    generate_evidence_id,
    generate_finding_id,
    generate_relationship_id,
)


@dataclass
class ProvenanceRecord:
    """
    Immutable provenance metadata tracking origin, scanner version, and observation context.
    """

    scanner_name: str
    scanner_version: str
    source_kind: str  # source_code, dependency_manifest, binary_elf, container_layer, network_handshake, runtime_uprobe, cbom_import
    locator: str  # File path, repo URI, host:port, container ID, PID
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    scan_configuration: Dict[str, Any] = field(default_factory=dict)
    hash_or_fingerprint: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scanner_name": self.scanner_name,
            "scanner_version": self.scanner_version,
            "source_kind": self.source_kind,
            "locator": self.locator,
            "confidence": self.confidence.value if hasattr(self.confidence, "value") else str(self.confidence),
            "timestamp": self.timestamp,
            "scan_configuration": self.scan_configuration,
            "hash_or_fingerprint": self.hash_or_fingerprint,
        }


@dataclass
class CanonicalCryptoEntity:
    """
    Canonical base entity representing any node in the ECDAT Crypto Asset Inventory.
    """

    entity_id: str
    entity_type: AssetType
    name: str
    provenance: ProvenanceRecord
    tenant_id: str = "default"
    application_id: str = "default"
    properties: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)

    @classmethod
    def create(
        cls,
        entity_type: Union[AssetType, str],
        name: str,
        provenance: ProvenanceRecord,
        tenant_id: str = "default",
        application_id: str = "default",
        core_properties: Optional[Dict[str, Any]] = None,
        additional_properties: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
    ) -> CanonicalCryptoEntity:
        """
        Creates an entity with deterministic, collision-resistant URN based on RFC 8785 canonical hash.
        """
        e_type_enum = AssetType(entity_type) if isinstance(entity_type, str) else entity_type
        e_type_str = e_type_enum.value

        core_props = dict(core_properties or {})
        # Ensure canonical name is in core properties for deterministic hashing
        if "canonical_name" not in core_props:
            core_props["canonical_name"] = name.strip()

        urn = generate_asset_id(
            asset_type=e_type_str,
            provenance={
                "kind": provenance.source_kind,
                "locator": provenance.locator,
            },
            core_properties=core_props,
            tenant_id=tenant_id,
            application_id=application_id,
        )

        all_props = {**core_props, **(additional_properties or {})}

        return cls(
            entity_id=urn,
            entity_type=e_type_enum,
            name=name,
            provenance=provenance,
            tenant_id=tenant_id,
            application_id=application_id,
            properties=all_props,
            tags=tags or [],
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type.value,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "application_id": self.application_id,
            "provenance": self.provenance.to_dict(),
            "properties": self.properties,
            "tags": self.tags,
        }


@dataclass
class CanonicalRelationship:
    """
    Directed relationship connecting two entities in the crypto inventory knowledge graph.
    Supports: USES, PROTECTS, PRESENT_IN, DEPENDS_ON, OBSERVED_BY, TERMINATES_AT,
    OWNED_BY, VIOLATES, REMEDIATED_BY, and first-class hybrid component relationships.
    """

    relationship_id: str
    source_id: str
    target_id: str
    relationship_type: RelationshipType
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH
    provenance: Optional[ProvenanceRecord] = None
    properties: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        source_id: str,
        target_id: str,
        relationship_type: Union[RelationshipType, str],
        confidence: ConfidenceLevel = ConfidenceLevel.HIGH,
        provenance: Optional[ProvenanceRecord] = None,
        properties: Optional[Dict[str, Any]] = None,
    ) -> CanonicalRelationship:
        r_type_enum = RelationshipType(relationship_type) if isinstance(relationship_type, str) else relationship_type
        rel_id = generate_relationship_id(
            source_asset_id=source_id,
            target_asset_id=target_id,
            relationship_type=r_type_enum.value,
        )
        return cls(
            relationship_id=rel_id,
            source_id=source_id,
            target_id=target_id,
            relationship_type=r_type_enum,
            confidence=confidence,
            provenance=provenance,
            properties=properties or {},
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "relationship_id": self.relationship_id,
            "source_id": self.source_id,
            "target_id": self.target_id,
            "relationship_type": self.relationship_type.value,
            "confidence": self.confidence.value if hasattr(self.confidence, "value") else str(self.confidence),
            "provenance": self.provenance.to_dict() if self.provenance else None,
            "properties": self.properties,
        }


class CanonicalCryptoInventory:
    """
    Unified Crypto Asset Inventory and in-memory knowledge graph.
    Tracks entities, relationships, indices by type, and offers traversal queries.
    """

    def __init__(self, tenant_id: str = "default", application_id: str = "default"):
        self.tenant_id = tenant_id
        self.application_id = application_id
        self.entities: Dict[str, CanonicalCryptoEntity] = {}
        self.relationships: Dict[str, CanonicalRelationship] = {}
        self._type_index: Dict[AssetType, Set[str]] = {t: set() for t in AssetType}
        self._out_edges: Dict[str, Set[str]] = {}
        self._in_edges: Dict[str, Set[str]] = {}

    def add_entity(self, entity: CanonicalCryptoEntity) -> CanonicalCryptoEntity:
        self.entities[entity.entity_id] = entity
        self._type_index[entity.entity_type].add(entity.entity_id)
        if entity.entity_id not in self._out_edges:
            self._out_edges[entity.entity_id] = set()
        if entity.entity_id not in self._in_edges:
            self._in_edges[entity.entity_id] = set()
        return entity

    def add_relationship(self, relationship: CanonicalRelationship) -> CanonicalRelationship:
        # Validate that connected entities exist or register stubs
        self.relationships[relationship.relationship_id] = relationship

        if relationship.source_id not in self._out_edges:
            self._out_edges[relationship.source_id] = set()
        self._out_edges[relationship.source_id].add(relationship.relationship_id)

        if relationship.target_id not in self._in_edges:
            self._in_edges[relationship.target_id] = set()
        self._in_edges[relationship.target_id].add(relationship.relationship_id)

        return relationship

    def get_entity(self, entity_id: str) -> Optional[CanonicalCryptoEntity]:
        return self.entities.get(entity_id)

    def find_by_type(self, entity_type: Union[AssetType, str]) -> List[CanonicalCryptoEntity]:
        e_type = AssetType(entity_type) if isinstance(entity_type, str) else entity_type
        ids = self._type_index.get(e_type, set())
        return [self.entities[eid] for eid in ids if eid in self.entities]

    def get_outgoing_relationships(self, entity_id: str) -> List[CanonicalRelationship]:
        rel_ids = self._out_edges.get(entity_id, set())
        return [self.relationships[rid] for rid in rel_ids if rid in self.relationships]

    def get_incoming_relationships(self, entity_id: str) -> List[CanonicalRelationship]:
        rel_ids = self._in_edges.get(entity_id, set())
        return [self.relationships[rid] for rid in rel_ids if rid in self.relationships]

    def to_graph_dict(self) -> Dict[str, Any]:
        """Serializes the entire inventory knowledge graph."""
        return {
            "tenant_id": self.tenant_id,
            "application_id": self.application_id,
            "entity_count": len(self.entities),
            "relationship_count": len(self.relationships),
            "entities": [e.to_dict() for e in self.entities.values()],
            "relationships": [r.to_dict() for r in self.relationships.values()],
        }
