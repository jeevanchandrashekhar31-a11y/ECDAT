"""
Filesystem Crypto Asset Data Models (Phase 4.4)
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional


class FilesystemAssetType(str, Enum):
    CERTIFICATE = "certificate"
    PUBLIC_KEY = "public_key"
    CRYPTO_CONFIG = "crypto_config"
    TLS_CONFIG = "tls_config"
    LIBRARY_INSTALLATION = "library_installation"
    KEY_STORE_REFERENCE = "key_store_reference"


@dataclass
class FilesystemCryptoAsset:
    asset_id: str
    asset_type: FilesystemAssetType
    file_path: str  # Relative to scan root
    absolute_path: str
    file_size_bytes: int
    sha256_hash: str
    confidence: str  # high, medium, low
    description: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    containment_verified: bool = True


@dataclass
class FilesystemScanReport:
    scan_root: str
    assets: List[FilesystemCryptoAsset] = field(default_factory=list)
    files_scanned: int = 0
    directories_scanned: int = 0
    total_bytes_scanned: int = 0
    skipped_symlinks: int = 0
    skipped_devices: int = 0
    skipped_giant_files: int = 0
    skipped_containment_violations: int = 0
    permission_denied_paths: List[str] = field(default_factory=list)
    security_warnings: List[str] = field(default_factory=list)
    duration_ms: float = 0.0
    scan_status: str = "success"
