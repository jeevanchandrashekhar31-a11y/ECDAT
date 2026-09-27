"""
Container inspection dataclasses and models (Phase 4.3)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from scanners.binary_container.parsers.base import CryptoIndicator


@dataclass
class LayerMetadata:
    index: int
    diff_id: str
    size_bytes: int
    file_count: int
    added_crypto_libs: List[str] = field(default_factory=list)
    added_certificates: List[str] = field(default_factory=list)


@dataclass
class ContainerConfigMetadata:
    architecture: str
    os: str
    created: Optional[str] = None
    entrypoint: List[str] = field(default_factory=list)
    cmd: List[str] = field(default_factory=list)
    working_dir: str = "/"
    user: str = "root"
    labels: Dict[str, str] = field(default_factory=dict)
    sanitized_env: Dict[str, str] = field(default_factory=dict)


@dataclass
class InstalledPackageMetadata:
    name: str
    version: str
    pkg_type: str  # dpkg, apk, rpm, pip, npm
    architecture: Optional[str] = None
    is_crypto_relevant: bool = False
    crypto_capabilities: List[str] = field(default_factory=list)


@dataclass
class SharedLibraryMetadata:
    name: str
    path: str
    is_crypto: bool = False
    crypto_library: Optional[str] = None
    confidence: Optional[str] = None


@dataclass
class CertificateAssetMetadata:
    path: str
    subject: Optional[str] = None
    issuer: Optional[str] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    public_key_algorithm: Optional[str] = None
    key_size_bits: Optional[int] = None
    is_self_signed: bool = False
    sha256_fingerprint: Optional[str] = None


@dataclass
class ContainerScanReport:
    image_reference: str
    registry: str
    repository: str
    tag_or_digest: str
    config: ContainerConfigMetadata
    layers: List[LayerMetadata] = field(default_factory=list)
    packages: List[InstalledPackageMetadata] = field(default_factory=list)
    shared_libraries: List[SharedLibraryMetadata] = field(default_factory=list)
    certificates: List[CertificateAssetMetadata] = field(default_factory=list)
    crypto_libraries: List[CryptoIndicator] = field(default_factory=list)
    total_uncompressed_size_bytes: int = 0
    warnings: List[str] = field(default_factory=list)
    scan_status: str = "success"
