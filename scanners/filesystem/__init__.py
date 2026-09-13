"""
ECDAT Secure Filesystem Discovery Package (Phase 4.4)
"""

from .containment import FilesystemSecurityGuard, ContainmentViolationError
from .models import FilesystemCryptoAsset, FilesystemAssetType, FilesystemScanReport
from .detectors import FilesystemAssetDetector
from .filesystem_scanner import FilesystemScanner, filesystem_report_to_cbom

__all__ = [
    "FilesystemSecurityGuard",
    "ContainmentViolationError",
    "FilesystemCryptoAsset",
    "FilesystemAssetType",
    "FilesystemScanReport",
    "FilesystemAssetDetector",
    "FilesystemScanner",
    "filesystem_report_to_cbom",
]
