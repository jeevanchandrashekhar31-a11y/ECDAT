import os
import pytest
from unittest.mock import patch, MagicMock
from scanners.binary_container.parsers.container_parser import ContainerScanner
from scanners.common.archive_guard import PathTraversalError, SymlinkEscapeError, HardlinkEscapeError, DecompressionBombError

@pytest.fixture
def scanner():
    return ContainerScanner()

def test_scan_image_tarball_path_traversal(scanner):
    with patch('scanners.binary_container.parsers.container_parser.ArchiveSecurityGuard') as mock_guard_cls:
        mock_guard = mock_guard_cls.return_value
        mock_guard.extract.side_effect = PathTraversalError("Zip Slip attempt detected")
        
        results = scanner.scan_image_tarball("fake_malicious.tar")
        # Should cleanly return empty results, logging the warning without crashing
        assert results["image"] == "fake_malicious.tar"
        assert len(results["layers"]) == 0

def test_scan_image_tarball_symlink_escape(scanner):
    with patch('scanners.binary_container.parsers.container_parser.ArchiveSecurityGuard') as mock_guard_cls:
        mock_guard = mock_guard_cls.return_value
        mock_guard.extract.side_effect = SymlinkEscapeError("Symlink escape detected")
        
        results = scanner.scan_image_tarball("fake_malicious_sym.tar")
        assert len(results["layers"]) == 0

def test_scan_image_tarball_hardlink_escape(scanner):
    with patch('scanners.binary_container.parsers.container_parser.ArchiveSecurityGuard') as mock_guard_cls:
        mock_guard = mock_guard_cls.return_value
        mock_guard.extract.side_effect = HardlinkEscapeError("Hardlink escape detected")
        
        results = scanner.scan_image_tarball("fake_malicious_hard.tar")
        assert len(results["layers"]) == 0

def test_scan_image_tarball_decompression_bomb(scanner):
    with patch('scanners.binary_container.parsers.container_parser.ArchiveSecurityGuard') as mock_guard_cls:
        mock_guard = mock_guard_cls.return_value
        mock_guard.extract.side_effect = DecompressionBombError("Max uncompressed size exceeded")
        
        results = scanner.scan_image_tarball("fake_bomb.tar")
        assert len(results["layers"]) == 0
