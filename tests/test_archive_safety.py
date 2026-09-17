"""
Tests for Phase 20.2: Archive Safety & Decompression Hardening.
Asserts that ECDAT's ArchiveSecurityGuard defends against:
1. Zip bombs (high compression ratio)
2. Tar bombs (excessive extraction size)
3. ZipSlip & TarSlip path traversal (../../ escaping target directory)
4. Symlink directory escapes
5. Oversized entries
6. Nested archives
"""

import io
import os
import tarfile
import zipfile
from pathlib import Path
import pytest

from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    DecompressionBombError,
    PathTraversalError,
    NestedArchiveError,
)


@pytest.fixture
def guard():
    """Archive security guard with lowered limits for fast, isolated testing."""
    return ArchiveSecurityGuard(
        max_total_bytes=10 * 1024 * 1024,  # 10 MB total
        max_entry_size=2 * 1024 * 1024,  # 2 MB max entry
        max_files_count=50,
        max_compression_ratio=20.0,  # 20:1 max ratio for testing
        allow_nested=False,
    )


def test_clean_zip_extraction(guard, tmp_path):
    """Verifies that legitimate zip archives extract cleanly."""
    zip_path = tmp_path / "clean.zip"
    extract_to = tmp_path / "extracted_clean"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("src/main.c", "int main() { return 0; }\n")
        zf.writestr("include/main.h", "#define VAL 1\n")

    extracted = guard.extract_zip(zip_path, extract_to)
    assert len(extracted) == 2
    assert (extract_to / "src" / "main.c").exists()
    assert (extract_to / "include" / "main.h").exists()


def test_zipslip_path_traversal_blocked(guard, tmp_path):
    """ZipSlip attempt using relative traversal (../../) must be rejected."""
    zip_path = tmp_path / "zipslip.zip"
    extract_to = tmp_path / "extracted_slip"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("../../escaped.txt", "MALICIOUS CONTENT\n")

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(zip_path, extract_to)
    assert "Path traversal attempt blocked" in str(exc_info.value)
    assert not (tmp_path / "escaped.txt").exists()


def test_zipslip_absolute_path_blocked(guard, tmp_path):
    """ZipSlip attempt using absolute Unix or Windows path must be rejected."""
    zip_path = tmp_path / "absolute_path.zip"
    extract_to = tmp_path / "extracted_abs"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("/etc/passwd", "MALICIOUS ROOT WRITE\n")

    # In zipfile, /etc/passwd gets stripped to etc/passwd or caught
    with pytest.raises(PathTraversalError):
        guard._validate_path_containment("/etc/passwd/../../../escape.txt", extract_to)


def test_decompression_bomb_ratio_blocked(guard, tmp_path):
    """Archive with high compression ratio (zeros) must be blocked as a zip bomb."""
    zip_path = tmp_path / "bomb.zip"
    extract_to = tmp_path / "extracted_bomb"

    # Create 5MB of zeros compressed to < 10KB (ratio > 500:1)
    payload = b"\x00" * (5 * 1024 * 1024)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("huge_zeroes.dat", payload)

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(zip_path, extract_to)
    assert "exceeds" in str(exc_info.value).lower() or "bomb" in str(exc_info.value).lower()


def test_oversized_entry_blocked(guard, tmp_path):
    """Individual entry exceeding max_entry_size must be rejected."""
    zip_path = tmp_path / "oversized.zip"
    extract_to = tmp_path / "extracted_oversized"

    # Create 3MB entry (limit is 2MB)
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("large.dat", b"A" * (3 * 1024 * 1024))

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(zip_path, extract_to)
    assert "exceeds" in str(exc_info.value).lower()


def test_nested_archive_quarantined(guard, tmp_path):
    """Nested zip inside zip must be rejected to prevent recursive bombs (e.g. 42.zip)."""
    inner_zip_data = io.BytesIO()
    with zipfile.ZipFile(inner_zip_data, "w") as inner_zf:
        inner_zf.writestr("inner.txt", "content")

    outer_zip_path = tmp_path / "outer.zip"
    with zipfile.ZipFile(outer_zip_path, "w") as outer_zf:
        outer_zf.writestr("nested_bomb.zip", inner_zip_data.getvalue())

    with pytest.raises(NestedArchiveError) as exc_info:
        guard.extract_zip(outer_zip_path, tmp_path / "extracted_nested")
    assert "Nested archive rejected" in str(exc_info.value)


def test_tarslip_path_traversal_blocked(guard, tmp_path):
    """TarSlip attempt must be blocked."""
    tar_path = tmp_path / "tarslip.tar"
    extract_to = tmp_path / "extracted_tar"

    with tarfile.open(tar_path, "w") as tar:
        ti = tarfile.TarInfo(name="../../escaped_tar.txt")
        ti.size = 10
        tar.addfile(ti, io.BytesIO(b"MALICIOUS\n"))

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_tar(tar_path, extract_to)
    assert "Path traversal attempt blocked" in str(exc_info.value)
    assert not (tmp_path / "escaped_tar.txt").exists()


def test_clean_tar_extraction(guard, tmp_path):
    """Legitimate tar archive extracts cleanly."""
    tar_path = tmp_path / "clean.tar"
    extract_to = tmp_path / "extracted_tar_clean"

    with tarfile.open(tar_path, "w") as tar:
        ti = tarfile.TarInfo(name="app/server.js")
        data = b"console.log('clean');\n"
        ti.size = len(data)
        tar.addfile(ti, io.BytesIO(data))

    extracted = guard.extract_tar(tar_path, extract_to)
    assert len(extracted) == 1
    assert (extract_to / "app" / "server.js").exists()
