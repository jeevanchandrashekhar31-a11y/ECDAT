from typing import List, Dict, Optional
from pydantic import BaseModel, Field


class NetworkCryptoFinding(BaseModel):
    """
    Represents a cryptographic finding from a network scan (e.g. TLS handshakes).

    Fields:
    - bom_ref: A unique identifier for this asset in the CBOM (e.g. 'net:host:port').
    - host: The scanned host/IP.
    - port: The scanned port.
    - tls_versions: A list of negotiated TLS versions (e.g. ['TLSv1.2', 'TLSv1.3']).
    - cipher_suites: A list of negotiated cipher suites (e.g. ['TLS_AES_128_GCM_SHA256']).
    - cert_chain: A list of certificates in the chain, each represented as a dict of properties.
    - key_sizes: A dictionary mapping algorithm families to key sizes (e.g. {'RSA': 2048, 'ECDH': 256}).
    - data_sensitivity: Classification of the data being transmitted (default 'internal').
    - business_criticality: The business importance of the asset (default 'medium').
    - timestamp: ISO 8601 timestamp of when the scan occurred.
    - tool_version: Version of the scanning tool used.
    - target_supplied: The exact target string supplied by the user.
    - resolved_endpoint: The resolved IP and port, if applicable.
    - scan_status: Status of the scan ('success', 'partial', 'failed').
    - error_reason: Non-sensitive reason for failure, if applicable.
    """

    bom_ref: str
    host: str
    port: int
    tls_versions: List[str] = Field(default_factory=list)
    cipher_suites: List[str] = Field(default_factory=list)
    cert_chain: List[Dict] = Field(default_factory=list)
    key_sizes: Dict[str, int] = Field(default_factory=dict)
    data_sensitivity: str = "internal"
    business_criticality: str = "medium"

    timestamp: str = ""
    tool_version: str = "ECDAT Network Scanner v3.0"
    target_supplied: str = ""
    resolved_endpoint: Optional[str] = None
    scan_status: str = "success"
    error_reason: Optional[str] = None
    protocol: str = "TLS"

    signature_algorithms: List[str] = Field(default_factory=list)
    key_exchanges: List[str] = Field(default_factory=list)
    alpn_protocols: List[str] = Field(default_factory=list)
    weak_algorithms: List[str] = Field(default_factory=list)
    trust_problems: List[str] = Field(default_factory=list)
    quantum_vulnerabilities: List[str] = Field(default_factory=list)
    authorization_id: Optional[str] = None
    audit_id: Optional[str] = None


class CodeCryptoFinding(BaseModel):
    """
    Represents a cryptographic finding from a static code scan.

    Fields:
    - bom_ref: A unique identifier for this asset in the CBOM (e.g. 'code:path/to/file.c').
    - file_path: The path to the source file where the asset was found.
    - language: The programming language of the file (e.g. 'C', 'Python').
    - line: The line number where the asset was found, if applicable.
    - algorithm: The detected cryptographic algorithm (e.g. 'MD5', 'RSA').
    - library: The cryptographic library being used, if known (e.g. 'OpenSSL').
    - key_size: The key size in bits, if statically resolvable.
    - finding_type: The type of finding (e.g. 'algorithm', 'hardcoded_key').
    - confidence: The confidence level of the detection ('high', 'medium', 'low').
    - data_sensitivity: Classification of the data processed (default 'internal').
    - business_criticality: The business importance of the application (default 'medium').
    """

    bom_ref: str
    file_path: str
    language: str
    line: Optional[int] = None
    algorithm: str
    library: Optional[str] = None
    key_size: Optional[int] = None
    finding_type: str
    confidence: str = "high"
    data_sensitivity: str = "internal"
    business_criticality: str = "medium"
    detection_method: str = "deterministic"
    needs_human_review: bool = False
    reason: Optional[str] = None
    fingerprint: Optional[str] = None
    secret_type: Optional[str] = None


class BinaryContainerFinding(BaseModel):
    """
    Represents a cryptographic finding from a compiled binary or container image scan.

    Fields:
    - bom_ref: A unique identifier for this asset (e.g. 'binary:path').
    - target: The binary or container being scanned.
    - component_name: The name of the vulnerable/detected component.
    - component_version: The version of the component, if known.
    - crypto_library: The cryptographic library providing the implementation.
    - data_sensitivity: Classification of the data processed.
    - business_criticality: The business importance of the application.
    """

    bom_ref: str
    target: str
    component_name: str
    component_version: Optional[str] = None
    crypto_library: str
    evidence_type: str = "package_inventory"
    confidence: str = "medium"
    purl: Optional[str] = None
    cpe: Optional[str] = None
    artifact_path: Optional[str] = None
    data_sensitivity: str = "internal"
    business_criticality: str = "medium"


# Re-export domain contracts for unified access across scanners
from scanners.domain.contracts import (  # noqa: E402
    DiscoveryEngine,
    ScanRequest,
    ScanContext,
    Finding,
    Evidence,
    CryptoAsset,
    AssetRelationship,
    Observation,
    RiskAssessment,
    PolicyEvaluation,
    RemediationPlan,
    RemediationAction,
    ScanResult,
    ScanType,
    ScanStatus,
    SeverityLevel,
    ConfidenceLevel,
    AssetType,
    RelationshipType,
    QuantumRelevance,
    MoscaStatus,
    EvidenceSource,
)
from scanners.domain.canonical_model import (  # noqa: E402
    ProvenanceRecord,
    CanonicalCryptoEntity,
    CanonicalRelationship,
    CanonicalCryptoInventory,
)
from scanners.domain.correlation_engine import (  # noqa: E402
    CorrelationEngine,
    CorrelationEvidence,
    EvidenceOrigin,
    GraphSecurityViolation,
    AuditLogEntry,
)
