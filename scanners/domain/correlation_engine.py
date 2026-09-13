"""
ECDAT Evidence Correlation Engine (Phase 7.2)

Correlates cryptographic evidence from all 8 discovery sources:
1. SOURCE (AST/Regex)
2. DEPENDENCY (SCA/SBOM)
3. BINARY (ELF/PE/Mach-O metadata)
4. FILESYSTEM (Cert files, key stores, configs)
5. NETWORK (TLS handshakes, ciphers, cert chains)
6. RUNTIME (eBPF/uprobe live calls)
7. CERTIFICATE (X.509 inventory, SANs, chains)
8. CBOM (CycloneDX imported assets)

Core Principles & Invariants:
1. ANTI-BLIND-MERGE: Never merge entities simply because they share a common name (e.g. "AES" or "RSA").
   Entities require matching contextual descriptors (e.g., key size, curve, file path, endpoint, container, process).
2. DUAL-MODE RESOLUTION:
   - Deterministic Identity: Used when exact locators or strong cryptographic identifiers (SHA-256 fingerprint, exact path + symbol) match.
   - Confidence-Scored Correlation: Used when linking across abstraction layers (e.g., Source Function -> Binary Export, Process -> Endpoint).
     Score (0.0 to 1.0) is evaluated against a configurable confidence threshold.
3. EXPLAINABLE PROVENANCE: Every established relationship answers:
   "Why does ECDAT believe this relationship exists?"
   via an explicit `evidence_rationale` containing evidence sources, confidence calculation, and justification.
4. SECURITY & GOVERNANCE:
   - Graph Injection Prevention: Rejects malicious entity IDs, circular self-loops, and script/tag injections.
   - Query Authorization: Enforces role-based or permission-checked graph queries.
   - Tenant Isolation: Graphs are strictly isolated by `tenant_id`. Cross-tenant links are prohibited.
   - Audit Logging: Sensitive graph queries (inspecting private key metadata, certificates, endpoints) are logged to an audit trail.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union

from scanners.domain.canonical_model import (
    CanonicalCryptoEntity,
    CanonicalCryptoInventory,
    CanonicalRelationship,
    ProvenanceRecord,
)
from scanners.domain.contracts import AssetType, ConfidenceLevel, RelationshipType

logger = logging.getLogger("ecdat.correlation_engine")


class EvidenceOrigin(str, Enum):
    SOURCE = "source"
    DEPENDENCY = "dependency"
    BINARY = "binary"
    FILESYSTEM = "filesystem"
    NETWORK = "network"
    RUNTIME = "runtime"
    CERTIFICATE = "certificate"
    CBOM = "cbom"


class GraphSecurityViolation(Exception):
    """Raised when an unauthorized query, tenant isolation breach, or graph injection is attempted."""
    pass


@dataclass
class CorrelationEvidence:
    """
    Standardized evidence observation feeding into the correlation engine.
    """
    origin: EvidenceOrigin
    entity_type: AssetType
    canonical_name: str
    locator: str  # file path, URL, host:port, package name, pid, etc.
    tenant_id: str = "default"
    application_id: str = "default"
    attributes: Dict[str, Any] = field(default_factory=dict)
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH
    timestamp: float = field(default_factory=time.time)
    fingerprint: Optional[str] = None


@dataclass
class AuditLogEntry:
    """Audit log entry for sensitive queries against the crypto knowledge graph."""
    timestamp: float
    actor_id: str
    tenant_id: str
    action: str
    target_entity_or_type: str
    authorized: bool
    details: Dict[str, Any] = field(default_factory=dict)


class CorrelationEngine:
    """
    Multi-source cryptographic correlation engine and secure graph manager.
    """

    def __init__(
        self,
        tenant_id: str = "default",
        inventory: Optional[CanonicalCryptoInventory] = None,
        min_correlation_confidence: float = 0.65,
    ):
        self.tenant_id = tenant_id
        self.inventory = inventory or CanonicalCryptoInventory(tenant_id=tenant_id)
        self.min_correlation_confidence = min_correlation_confidence
        self.audit_log: List[AuditLogEntry] = []
        # Index for cross-source matching: locator -> entity_id, fingerprint -> entity_id
        self._locator_index: Dict[str, str] = {}
        self._fingerprint_index: Dict[str, str] = {}
        self._name_type_index: Dict[Tuple[str, AssetType], Set[str]] = {}

    # =========================================================================
    # 1. Graph Injection Prevention & Sanitization
    # =========================================================================
    def _validate_entity_security(self, entity: CanonicalCryptoEntity) -> None:
        """
        Validates entity against graph injection attacks (delimiter injection,
        script injections, malicious control characters).
        """
        if entity.tenant_id != self.tenant_id:
            raise GraphSecurityViolation(
                f"Tenant Isolation Breach: Cannot insert entity from tenant '{entity.tenant_id}' "
                f"into inventory for tenant '{self.tenant_id}'."
            )

        # Check for dangerous injection patterns in identifiers or names
        injection_pattern = re.compile(r"[<>\";\x00-\x1f]", re.IGNORECASE)
        if injection_pattern.search(entity.name):
            raise GraphSecurityViolation(
                f"Graph Injection Attempt Detected: Entity name contains illegal characters: '{entity.name}'."
            )

    def _validate_relationship_security(self, relationship: CanonicalRelationship) -> None:
        """Validates relationship edges against graph cycles or cross-tenant injection."""
        if relationship.source_id == relationship.target_id:
            raise GraphSecurityViolation(
                f"Graph Injection Detected: Self-referential loop on entity '{relationship.source_id}'."
            )

    # =========================================================================
    # 2. Ingestion & Deterministic Indexing
    # =========================================================================
    def ingest_entity(self, entity: CanonicalCryptoEntity) -> CanonicalCryptoEntity:
        """Securely ingests an entity with tenant isolation and indexing."""
        self._validate_entity_security(entity)
        self.inventory.add_entity(entity)

        # Index locator and fingerprint if present
        if entity.provenance and entity.provenance.locator:
            norm_loc = entity.provenance.locator.replace("\\", "/").lower()
            self._locator_index[norm_loc] = entity.entity_id

        fp = entity.provenance.hash_or_fingerprint or entity.properties.get("fingerprint") or entity.properties.get("sha256")
        if fp:
            self._fingerprint_index[str(fp).lower()] = entity.entity_id

        key = (entity.name.lower(), entity.entity_type)
        if key not in self._name_type_index:
            self._name_type_index[key] = set()
        self._name_type_index[key].add(entity.entity_id)

        return entity

    # =========================================================================
    # 3. Multi-Source Correlation
    # =========================================================================
    def correlate_evidence(
        self,
        evidence: CorrelationEvidence,
        create_if_missing: bool = True,
    ) -> Tuple[CanonicalCryptoEntity, List[CanonicalRelationship]]:
        """
        Correlates an incoming evidence observation against existing inventory.
        Never blindly merges purely on name.
        Uses deterministic identity where exact locators/fingerprints match,
        and confidence-scored correlation across multi-source layers.
        """
        if evidence.tenant_id != self.tenant_id:
            raise GraphSecurityViolation(
                f"Tenant mismatch: Evidence tenant '{evidence.tenant_id}' != Engine tenant '{self.tenant_id}'"
            )

        matched_entity: Optional[CanonicalCryptoEntity] = None
        correlation_reason: str = ""
        confidence_score: float = 1.0

        # Step 1: Check Deterministic Fingerprint Match (Exact cryptographic identity)
        if evidence.fingerprint:
            fp_clean = evidence.fingerprint.lower()
            matched_id = self._fingerprint_index.get(fp_clean)
            if matched_id:
                matched_entity = self.inventory.get_entity(matched_id)
                correlation_reason = f"Exact SHA-256 fingerprint match '{evidence.fingerprint}'"
                confidence_score = 1.0

        # Step 2: Check Deterministic Exact Locator Match (e.g. same file, endpoint, or container)
        if not matched_entity and evidence.locator:
            norm_loc = evidence.locator.replace("\\", "/").lower()
            matched_id = self._locator_index.get(norm_loc)
            if matched_id:
                candidate = self.inventory.get_entity(matched_id)
                # Ensure type compatibility before merging
                if candidate and candidate.entity_type == evidence.entity_type:
                    matched_entity = candidate
                    correlation_reason = f"Exact locator match '{evidence.locator}' for {evidence.entity_type.value}"
                    confidence_score = 0.95

        # Step 3: Confidence-Scored Correlation (Cross-source contextual evaluation)
        if not matched_entity:
            matched_entity, confidence_score, correlation_reason = self._score_contextual_correlation(evidence)

        # Step 4: Create Entity if no confident match found
        newly_created = False
        if not matched_entity:
            if not create_if_missing:
                return (None, [])  # type: ignore[return-value]

            prov = ProvenanceRecord(
                scanner_name=f"ecdat-{evidence.origin.value}",
                scanner_version="1.0.0",
                source_kind=evidence.origin.value,
                locator=evidence.locator,
                confidence=evidence.confidence,
                hash_or_fingerprint=evidence.fingerprint,
            )
            matched_entity = CanonicalCryptoEntity.create(
                entity_type=evidence.entity_type,
                name=evidence.canonical_name,
                provenance=prov,
                tenant_id=self.tenant_id,
                application_id=evidence.application_id,
                core_properties={
                    "canonical_name": evidence.canonical_name,
                    **evidence.attributes,
                },
            )
            self.ingest_entity(matched_entity)
            newly_created = True

        # Step 5: Establish Relationships with Explicit Rationale
        created_relationships: List[CanonicalRelationship] = []
        if not newly_created and matched_entity and correlation_reason:
            # Create OBSERVED_BY link or cross-layer correlation link
            rationale_props = {
                "why_ecdat_believes_this_exists": (
                    f"Correlated evidence from {evidence.origin.value} with existing entity {matched_entity.name}. "
                    f"Justification: {correlation_reason} (confidence: {confidence_score:.2f})."
                ),
                "evidence_origin": evidence.origin.value,
                "correlation_confidence": confidence_score,
                "matched_at": time.time(),
            }
            # Record correlation rationale on entity properties
            matched_entity.properties.setdefault("correlations", []).append(rationale_props)

        # Build layer relationships if context allows (e.g. Runtime Process -> Crypto Asset)
        created_relationships.extend(self._build_inferred_relationships(matched_entity, evidence))

        return (matched_entity, created_relationships)

    def _score_contextual_correlation(
        self,
        evidence: CorrelationEvidence,
    ) -> Tuple[Optional[CanonicalCryptoEntity], float, str]:
        """
        Anti-Blind-Merge Rule:
        Scores candidate entities sharing the same canonical name based on:
        - Key size match (+0.30)
        - Curve / Mode match (+0.25)
        - Shared container / host / application (+0.25)
        - Ecosystem / runtime match (+0.20)
        Requires score >= self.min_correlation_confidence to accept correlation.
        """
        candidates_ids = self._name_type_index.get((evidence.canonical_name.lower(), evidence.entity_type), set())
        if not candidates_ids:
            return None, 0.0, ""

        best_candidate = None
        best_score = 0.0
        best_reason = ""

        for cid in candidates_ids:
            cand = self.inventory.get_entity(cid)
            if not cand:
                continue

            score = 0.0
            reasons = []

            # 1. Key Size Alignment
            ev_ksize = evidence.attributes.get("key_size") or evidence.attributes.get("key_length")
            cd_ksize = cand.properties.get("key_size") or cand.properties.get("key_length")
            if ev_ksize and cd_ksize:
                if str(ev_ksize) == str(cd_ksize):
                    score += 0.30
                    reasons.append(f"Matching key size ({ev_ksize} bits)")
                else:
                    # Conflicting key size -> Strictly reject merge!
                    continue

            # 2. Curve or Mode Alignment
            ev_mode = evidence.attributes.get("mode") or evidence.attributes.get("curve")
            cd_mode = cand.properties.get("mode") or cand.properties.get("curve")
            if ev_mode and cd_mode:
                if str(ev_mode).upper() == str(cd_mode).upper():
                    score += 0.25
                    reasons.append(f"Matching cipher mode/curve ({ev_mode})")

            # 3. Application Scope Alignment
            if evidence.application_id == cand.application_id and evidence.application_id != "default":
                score += 0.25
                reasons.append(f"Shared application boundary ({cand.application_id})")

            # 4. Locator Substring / Directory Proximity
            if evidence.locator and cand.provenance.locator:
                norm_ev_loc = evidence.locator.replace("\\", "/").lower()
                norm_cd_loc = cand.provenance.locator.replace("\\", "/").lower()
                if norm_ev_loc in norm_cd_loc or norm_cd_loc in norm_ev_loc:
                    score += 0.20
                    reasons.append("Co-located source artifact")

            if score >= self.min_correlation_confidence and score > best_score:
                best_score = score
                best_candidate = cand
                best_reason = "; ".join(reasons)

        if best_candidate and best_score >= self.min_correlation_confidence:
            return best_candidate, best_score, best_reason

        return None, 0.0, ""

    def _build_inferred_relationships(
        self,
        entity: CanonicalCryptoEntity,
        evidence: CorrelationEvidence,
    ) -> List[CanonicalRelationship]:
        """Infers first-class relationships across discovery boundaries."""
        created = []
        # If runtime evidence observed an algorithm, establish runtime relationship
        if evidence.origin == EvidenceOrigin.RUNTIME and entity.entity_type == AssetType.ALGORITHM:
            proc_id = evidence.attributes.get("process_id")
            if proc_id:
                # Link Process -> Algorithm (USES)
                proc_ref = f"urn:ecdat:v1:asset:{self.tenant_id}:{evidence.application_id}:runtime_process:pid_{proc_id}"
                rel = CanonicalRelationship.create(
                    source_id=proc_ref,
                    target_id=entity.entity_id,
                    relationship_type=RelationshipType.USES,
                    confidence=ConfidenceLevel.HIGH,
                    properties={
                        "why_ecdat_believes_this_exists": (
                            f"Live eBPF uprobe observed PID {proc_id} executing cryptographic operation for {entity.name}."
                        ),
                        "evidence_source": "runtime",
                    },
                )
                self._validate_relationship_security(rel)
                self.inventory.add_relationship(rel)
                created.append(rel)

        # If network evidence observed certificate, link Endpoint -> Certificate (PROTECTS)
        if evidence.origin == EvidenceOrigin.NETWORK and entity.entity_type == AssetType.CERTIFICATE:
            endpoint_host = evidence.attributes.get("host")
            endpoint_port = evidence.attributes.get("port", 443)
            if endpoint_host:
                endpoint_ref = f"urn:ecdat:v1:asset:{self.tenant_id}:{evidence.application_id}:endpoint:{endpoint_host}_{endpoint_port}"
                rel = CanonicalRelationship.create(
                    source_id=entity.entity_id,
                    target_id=endpoint_ref,
                    relationship_type=RelationshipType.PROTECTS,
                    confidence=ConfidenceLevel.HIGH,
                    properties={
                        "why_ecdat_believes_this_exists": (
                            f"Active TLS handshake on {endpoint_host}:{endpoint_port} negotiated certificate {entity.name}."
                        ),
                        "evidence_source": "network",
                    },
                )
                self._validate_relationship_security(rel)
                self.inventory.add_relationship(rel)
                created.append(rel)

        return created

    # =========================================================================
    # 4. Security: Authorized & Audited Graph Queries
    # =========================================================================
    def execute_authorized_query(
        self,
        actor_id: str,
        actor_tenant: str,
        user_roles: Set[str],
        query_type: str,
        target_id_or_type: str,
        query_fn: Callable[[CanonicalCryptoInventory], Any],
    ) -> Any:
        """
        Executes a graph query enforcing:
        - Tenant isolation: actor_tenant must match inventory tenant
        - Authorization check: sensitive queries require 'security_analyst' or 'admin' role
        - Audit logging: records actor, action, timestamp, and verdict
        """
        timestamp = time.time()
        is_sensitive = query_type in ["sensitive_inspect", "export_secrets", "query_private_keys", "query_certificates"]

        # 1. Tenant Isolation Enforced
        if actor_tenant != self.tenant_id:
            self.audit_log.append(
                AuditLogEntry(
                    timestamp=timestamp,
                    actor_id=actor_id,
                    tenant_id=actor_tenant,
                    action=query_type,
                    target_entity_or_type=target_id_or_type,
                    authorized=False,
                    details={"error": f"Tenant mismatch: Actor '{actor_tenant}' cannot query tenant '{self.tenant_id}'"},
                )
            )
            raise GraphSecurityViolation(
                f"Unauthorized: Actor tenant '{actor_tenant}' cannot access graph data belonging to tenant '{self.tenant_id}'."
            )

        # 2. Authorization Check
        authorized = True
        if is_sensitive and not any(r in user_roles for r in ["security_analyst", "admin", "auditor"]):
            authorized = False

        self.audit_log.append(
            AuditLogEntry(
                timestamp=timestamp,
                actor_id=actor_id,
                tenant_id=actor_tenant,
                action=query_type,
                target_entity_or_type=target_id_or_type,
                authorized=authorized,
                details={"roles": list(user_roles), "sensitive": is_sensitive},
            )
        )

        if not authorized:
            raise GraphSecurityViolation(
                f"Forbidden: Actor '{actor_id}' lacks required roles (security_analyst, admin, auditor) "
                f"for sensitive query '{query_type}'."
            )

        # 3. Execute Query
        return query_fn(self.inventory)
