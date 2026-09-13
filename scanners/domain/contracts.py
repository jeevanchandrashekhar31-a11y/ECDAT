"""
ECDAT Domain Contracts (Python)
Formal domain models and interfaces establishing explicit domain boundaries
between discovery, normalization, risk assessment, policy evaluation, and reporting.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set
from pydantic import BaseModel, Field


class ScanType(str, Enum):
    STATIC = "static"
    NETWORK = "network"
    BINARY_CONTAINER = "binary_container"
    CBOM_IMPORT = "cbom_import"
    HYBRID = "hybrid"
    RUNTIME = "runtime"


class ScanStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SeverityLevel(str, Enum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"
    INFORMATIONAL = "Informational"
    UNCLASSIFIED = "Unclassified"


class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AssetType(str, Enum):
    # Core cryptographic primitives & material
    ALGORITHM = "algorithm"
    CERTIFICATE = "certificate"
    KEY_METADATA = "key_metadata"
    HARDCODED_PRIVATE_KEY = "hardcoded_private_key"
    SIGNING_KEY = "signing_key"
    STORED_ENCRYPTED_DATA = "stored_encrypted_data"
    DATA_ASSET = "data_asset"
    
    # Software & system layers
    APPLICATION = "application"
    SERVICE = "service"
    REPOSITORY = "repository"
    FILE = "file"
    FUNCTION = "function"
    DEPENDENCY = "dependency"
    CRYPTO_LIBRARY = "crypto_library"
    
    # Network, host, & runtime boundaries
    PROTOCOL = "protocol"
    PROTOCOL_SESSION = "protocol_session"
    NETWORK_ENDPOINT = "network_endpoint"
    ENDPOINT = "endpoint"
    CONTAINER = "container"
    HOST = "host"
    RUNTIME_PROCESS = "runtime_process"
    
    # Governance, operations, & risk
    OWNER = "owner"
    ENVIRONMENT = "environment"
    POLICY = "policy"
    FINDING = "finding"
    RISK = "risk"
    REMEDIATION = "remediation"


class RelationshipType(str, Enum):
    CONTAINS = "contains"
    DEPENDS_ON = "depends_on"
    SECURES = "secures"
    USES = "uses"
    SIGNS = "signs"
    IMPLEMENTS = "implements"
    # Phase 7.1 Canonical Graph Relationships
    PROTECTS = "protects"
    PRESENT_IN = "present_in"
    OBSERVED_BY = "observed_by"
    TERMINATES_AT = "terminates_at"
    OWNED_BY = "owned_by"
    VIOLATES = "violates"
    REMEDIATED_BY = "remediated_by"
    HOSTS_PROCESS = "hosts_process"
    # First-class hybrid & PQC relationship types (Phase 5.3)
    HAS_CLASSICAL_COMPONENT = "has_classical_component"
    HAS_POST_QUANTUM_COMPONENT = "has_post_quantum_component"
    USES_HYBRID_COMBINER = "uses_hybrid_combiner"
    NEGOTIATED_KEY_EXCHANGE = "negotiated_key_exchange"
    AUTHENTICATED_BY_SIGNATURE = "authenticated_by_signature"


class EvidenceSource(str, Enum):
    """Source of cryptographic observation or finding (Phase 5.3)."""
    STATIC_CONFIGURATION = "static_configuration"
    NETWORK_HANDSHAKE = "network_handshake"
    RUNTIME = "runtime"


class QuantumRelevance(str, Enum):
    SHOR_VULNERABLE = "shor_vulnerable"
    GROVER_SENSITIVE = "grover_sensitive"
    QUANTUM_SAFE = "quantum_safe"
    NOT_APPLICABLE = "not_applicable"


class MoscaStatus(str, Enum):
    SAFE = "SAFE"
    WATCH = "WATCH"
    AT_RISK = "AT_RISK"
    CRITICAL_URGENT = "CRITICAL_URGENT"


# =====================================================================
# 1. Evidence
# =====================================================================
class Evidence(BaseModel):
    """
    Empirical proof backing an observation or cryptographic finding.
    Guaranteed free of unredacted private keys and sensitive credentials.
    """

    location: str = Field(description="File path, URI, or network address")
    line_number: Optional[int] = Field(default=None, description="Source line number if applicable")
    column_number: Optional[int] = Field(default=None, description="Source column number if applicable")
    snippet: Optional[str] = Field(default=None, description="Sanitized, redacted evidence excerpt")
    proof_type: str = Field(default="source_code", description="source_code, cert_der, tls_handshake, etc.")
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH)
    raw_attributes: Dict[str, Any] = Field(default_factory=dict, description="Tool-specific non-sensitive metadata")


# =====================================================================
# 2. Observation
# =====================================================================
class Observation(BaseModel):
    """
    Raw, unclassified empirical observation produced by a discovery engine
    prior to canonical normalization or risk assessment.
    """

    observation_id: str = Field(description="Unique observation identifier")
    discovery_engine: str = Field(description="Name/version of the producing engine")
    target: str = Field(description="Scanned target entity")
    raw_algorithm: Optional[str] = Field(default=None)
    raw_key_size: Optional[str] = Field(default=None)
    raw_protocol: Optional[str] = Field(default=None)
    evidence: Evidence = Field(description="Backing evidence")
    observed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC timestamp",
    )


# =====================================================================
# 3. Finding
# =====================================================================
class Finding(BaseModel):
    """
    Normalized cryptographic finding representing a specific cryptographic usage site.
    """

    finding_id: str = Field(description="Unique finding identifier (e.g. fnd_xxx)")
    asset_id: str = Field(description="Parent asset reference")
    algorithm_standard: str = Field(description="Canonical algorithm name (e.g. 'RSA', 'AES-256', 'TLS 1.2')")
    primitive_type: str = Field(default="unknown", description="asymmetric_cipher, symmetric_cipher, hash, kex, etc.")
    key_size_bits: Optional[int] = Field(default=None, description="Key size in bits if resolvable")
    curve_name: Optional[str] = Field(default=None, description="Elliptic curve name (e.g. secp256r1)")
    mode: Optional[str] = Field(default=None, description="Block cipher mode (e.g. GCM, CBC)")
    severity: SeverityLevel = Field(default=SeverityLevel.INFORMATIONAL)
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH)
    evidence: Evidence = Field(description="Primary provenance evidence")
    analysis_source: str = Field(default="ast", description="ast, regex, llm_verified, ssl_handshake, package_manifest")
    needs_human_review: bool = Field(default=False)
    review_reason: Optional[str] = Field(default=None)


# =====================================================================
# 4. CryptoAsset
# =====================================================================
class CryptoAsset(BaseModel):
    """
    First-class cryptographic asset entity tracked within ECDAT inventory.
    """

    asset_id: str = Field(description="Unique asset identifier / primary identifier")
    primary_identifier: str = Field(description="Canonical URI/ARN/path of the asset")
    asset_type: AssetType = Field(description="Classification of the cryptographic asset")
    data_sensitivity: str = Field(default="internal", description="public, internal, confidential, restricted")
    business_criticality: str = Field(default="medium", description="low, medium, high, critical")
    highest_severity: SeverityLevel = Field(default=SeverityLevel.INFORMATIONAL)
    at_quantum_risk: bool = Field(default=False)
    findings_count: int = Field(default=0)
    components: List[str] = Field(default_factory=list, description="Associated component references")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Asset properties")


# =====================================================================
# 5. AssetRelationship
# =====================================================================
class AssetRelationship(BaseModel):
    """
    Directed relationship between cryptographic assets or components.
    """

    source_id: str = Field(description="Originating asset or component ID")
    target_id: str = Field(description="Destination asset or component ID")
    relationship_type: RelationshipType = Field(description="Nature of the relationship")
    metadata: Dict[str, Any] = Field(default_factory=dict)


# =====================================================================
# 6. RiskAssessment
# =====================================================================
class RiskAssessment(BaseModel):
    """
    Multi-dimensional risk evaluation for an asset or finding.
    """

    classical_severity: SeverityLevel = Field(default=SeverityLevel.INFORMATIONAL)
    classical_score: float = Field(default=0.0, ge=0.0, le=10.0)
    quantum_relevance: QuantumRelevance = Field(default=QuantumRelevance.NOT_APPLICABLE)
    grover_security_margin: Optional[int] = Field(default=None, description="Effective symmetric security under Grover")
    shor_vulnerable: bool = Field(default=False)
    mosca_status: MoscaStatus = Field(default=MoscaStatus.SAFE)
    mosca_collapse_year: Optional[int] = Field(default=None)
    explainability: List[str] = Field(default_factory=list, description="Deterministic risk rationale sentences")


# =====================================================================
# 7. PolicyEvaluation
# =====================================================================
class PolicyEvaluation(BaseModel):
    """
    Evaluation verdict against an organizational or regulatory policy profile.
    """

    policy_profile: str = Field(default="standard", description="standard, regulated_bfsi, nist_csf_strict, etc.")
    fail_on_threshold: str = Field(default="none", description="none, critical, high, medium")
    passed: bool = Field(default=True)
    blocking_reasons: List[str] = Field(default_factory=list)
    violated_rules: List[Dict[str, Any]] = Field(default_factory=list)


# =====================================================================
# 8. RemediationAction & 9. RemediationPlan
# =====================================================================
class RemediationAction(BaseModel):
    """
    Discrete, prioritized remediation action for an identified cryptographic risk.
    """

    action_id: str = Field(description="Unique action ID")
    asset_id: str = Field(description="Affected asset")
    priority: int = Field(default=1, description="1 (urgent) to 5 (low)")
    title: str = Field(description="Summary title")
    description: str = Field(description="Actionable guidance")
    target_standard: str = Field(description="Target cryptographic standard (e.g. ML-KEM-768, AES-256-GCM)")
    recommended_year: int = Field(description="Target completion year")
    effort_estimate: str = Field(default="medium", description="low, medium, high")


class RemediationPlan(BaseModel):
    """
    Structured remediation roadmap covering all identified risks in a scan.
    """

    plan_id: str = Field(description="Unique remediation plan identifier")
    scan_id: str = Field(description="Associated scan ID")
    total_actions: int = Field(default=0)
    actions: List[RemediationAction] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# =====================================================================
# 10. ScanRequest & 11. ScanContext
# =====================================================================
class ScanRequest(BaseModel):
    """
    Value object initiating a discovery engine scan.
    """

    scan_type: ScanType = Field(description="Type of scan requested")
    target: str = Field(description="Target path, hostname, IP, or container reference")
    policy_profile: str = Field(default="standard")
    fail_on: str = Field(default="none")
    include_extensions: Set[str] = Field(default_factory=set)
    exclude_directories: Set[str] = Field(default_factory=set)
    max_file_size_bytes: int = Field(default=5 * 1024 * 1024)
    max_files: int = Field(default=10000)
    timeout_seconds: int = Field(default=300)
    options: Dict[str, Any] = Field(default_factory=dict)


class ScanContext(BaseModel):
    """
    Contextual execution boundaries and metadata during discovery execution.
    """

    scan_id: str = Field(description="Unique scan run identifier")
    request: ScanRequest = Field(description="Original scan request")
    started_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    temp_dir: Optional[str] = Field(default=None)
    is_cancelled: bool = Field(default=False)
    progress_percent: int = Field(default=0, ge=0, le=100)


# =====================================================================
# 12. ScanResult
# =====================================================================
class ScanResult(BaseModel):
    """
    Immutable domain result returned by a discovery engine.
    Completely decoupled from persistence and presentation concerns.
    """

    scan_id: str = Field(description="Scan identifier")
    scan_type: ScanType = Field(description="Type of discovery executed")
    target: str = Field(description="Scanned target")
    status: ScanStatus = Field(default=ScanStatus.SUCCESS)
    engine_name: str = Field(description="Producing engine identifier")
    engine_version: str = Field(description="Version of the discovery engine")
    duration_seconds: float = Field(default=0.0)
    assets: List[CryptoAsset] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    relationships: List[AssetRelationship] = Field(default_factory=list)
    observations: List[Observation] = Field(default_factory=list)
    policy_evaluation: Optional[PolicyEvaluation] = Field(default=None)
    remediation_plan: Optional[RemediationPlan] = Field(default=None)
    summary_metrics: Dict[str, Any] = Field(default_factory=dict)
    errors: List[str] = Field(default_factory=list)


# =====================================================================
# 13. DiscoveryEngine Interface
# =====================================================================
class DiscoveryEngine(ABC):
    """
    Abstract contract for all ECDAT discovery engines.
    Discovery engines must strictly return domain objects (ScanResult)
    without modifying database tables or UI presentation state.
    """

    @abstractmethod
    def scan(self, request: ScanRequest, context: ScanContext) -> ScanResult:
        """
        Executes discovery against the requested target within the provided context.
        Must be deterministic, respect context timeouts, and return a domain ScanResult.
        """
        pass
