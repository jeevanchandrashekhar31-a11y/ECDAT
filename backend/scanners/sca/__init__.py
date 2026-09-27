"""
ECDAT Software Composition Analysis (SCA) & SBOM Ingestion Package
"""

from .sbom_ingestion import (
    ingest_sbom,
    validate_sbom_structure,
    NormalizedComponent,
    NormalizedSbom,
    DependencyRelationship,
)
from .crypto_dependency_mapping import (
    ReachabilityLevel,
    CryptoDependencyKnowledgeBase,
    CryptoReachabilityClassifier,
    ReachabilityClassification,
    PackageCryptoMapping,
)
from .vulnerability_correlator import (
    CryptoImpactType,
    ExploitabilityStatus,
    DependencyVulnerabilityCorrelation,
    DependencyVulnerabilityCorrelator,
    VulnerabilityRecord,
)

__all__ = [
    "ingest_sbom",
    "validate_sbom_structure",
    "NormalizedComponent",
    "NormalizedSbom",
    "DependencyRelationship",
    "ReachabilityLevel",
    "CryptoDependencyKnowledgeBase",
    "CryptoReachabilityClassifier",
    "ReachabilityClassification",
    "PackageCryptoMapping",
    "CryptoImpactType",
    "ExploitabilityStatus",
    "DependencyVulnerabilityCorrelation",
    "DependencyVulnerabilityCorrelator",
    "VulnerabilityRecord",
]
