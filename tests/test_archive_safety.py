"""
Tests for Phase 10: P0 — Archive / Zip Security.
Validates that ECDAT's ArchiveSecurityGuard enforces:
- Strict canonical path containment invariant
- Zip Slip & Tar Slip protection across Unix and Windows separators
- Absolute paths (Unix root & Windows drives) rejection
- Symlink & hardlink escape defenses
- Decompression bomb defenses (ratio, lying headers, streaming limits)
- Excessive file count and uncompressed size caps
- Nested archive & recursive extraction defenses
- Unicode NFKC normalization bypass rejection
- Windows reserved device names and NTFS Alternate Data Streams rejection
- Malformed archive handling
- Pre-built malicious fixture testing
"""

import io
import os
import tarfile
import zipfile
from pathlib import Path
import pytest

from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    ArchiveSecurityError,
    DecompressionBombError,
    PathTraversalError,
    SymlinkEscapeError,
    HardlinkEscapeError,
    NestedArchiveError,
    MalformedArchiveError,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "malicious_archives"


@pytest.fixture
def guard():
    """Archive security guard with lowered limits for fast, isolated testing."""
    return ArchiveSecurityGuard(
        max_total_bytes=10 * 1024 * 1024,  # 10 MB total
        max_entry_size=2 * 1024 * 1024,  # 2 MB max entry
        max_files_count=50,
        max_compression_ratio=20.0,  # 20:1 max ratio for testing
        allow_nested=False,
        allow_symlinks=False,
    )


# ============================================================================
# SUITE 1: CANONICAL EXTRACTION & CLEAN ARCHIVE TESTS
# ============================================================================

def test_clean_zip_extraction(guard, tmp_path):
    """Verifies that legitimate zip archives extract cleanly within canonical root."""
    zip_path = tmp_path / "clean.zip"
    extract_to = tmp_path / "extracted_clean"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("src/main.c", "int main() { return 0; }\n")
        zf.writestr("include/main.h", "#define VAL 1\n")

    extracted = guard.extract_zip(zip_path, extract_to)
    assert len(extracted) == 2
    assert (extract_to / "src" / "main.c").exists()
    assert (extract_to / "include" / "main.h").exists()

    # Invariant: Every extracted file must canonically reside within extract_to
    for p in extracted:
        assert os.path.commonpath([str(extract_to.resolve()), str(p.resolve())]) == str(extract_to.resolve())


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


# ============================================================================
# SUITE 2: ZIP SLIP & PATH TRAVERSAL DEFENSES
# ============================================================================

def test_zipslip_path_traversal_blocked(guard, tmp_path):
    """ZipSlip attempt using relative traversal (../../) must be rejected."""
    fixture = FIXTURES_DIR / "zip_slip_relative.zip"
    extract_to = tmp_path / "extracted_slip"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Path traversal attempt blocked" in str(exc_info.value)
    assert not (tmp_path / "evil_relative.txt").exists()


def test_zipslip_windows_backslash_blocked(guard, tmp_path):
    """ZipSlip attempt using Windows backslashes (..\\..\\) must be rejected."""
    fixture = FIXTURES_DIR / "zip_slip_windows_backslash.zip"
    extract_to = tmp_path / "extracted_backslash"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Path traversal attempt blocked" in str(exc_info.value)


def test_zipslip_absolute_path_blocked(guard, tmp_path):
    """ZipSlip attempt using absolute Unix path must be rejected."""
    fixture = FIXTURES_DIR / "absolute_unix_path.zip"
    extract_to = tmp_path / "extracted_abs"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Absolute path" in str(exc_info.value) or "Path traversal attempt blocked" in str(exc_info.value)


def test_zipslip_windows_drive_letter_blocked(guard, tmp_path):
    """ZipSlip attempt using Windows drive letters (C:\\) must be rejected."""
    fixture = FIXTURES_DIR / "absolute_windows_path.zip"
    extract_to = tmp_path / "extracted_drive"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Windows drive letter" in str(exc_info.value) or "Path traversal attempt blocked" in str(exc_info.value)


# ============================================================================
# SUITE 3: SYMLINK & HARDLINK ESCAPE DEFENSES
# ============================================================================

def test_symlink_escape_blocked(guard, tmp_path):
    """Tar archive containing symlink escaping extraction root must be blocked."""
    fixture = FIXTURES_DIR / "symlink_escape.tar"
    extract_to = tmp_path / "extracted_sym"

    with pytest.raises(SymlinkEscapeError) as exc_info:
        guard.extract_tar(fixture, extract_to)
    assert "Symlink rejected" in str(exc_info.value) or "escapes extraction root" in str(exc_info.value)


def test_symlink_directory_escape_blocked(guard, tmp_path):
    """Tar archive containing symlink directory escaping root must be blocked."""
    fixture = FIXTURES_DIR / "symlink_directory_escape.tar"
    extract_to = tmp_path / "extracted_sym_dir"

    with pytest.raises(SymlinkEscapeError):
        guard.extract_tar(fixture, extract_to)


def test_hardlink_escape_blocked(guard, tmp_path):
    """Tar archive containing hardlink pointing to outside file must be blocked."""
    fixture = FIXTURES_DIR / "hardlink_escape.tar"
    extract_to = tmp_path / "extracted_hardlink"

    with pytest.raises(HardlinkEscapeError) as exc_info:
        guard.extract_tar(fixture, extract_to)
    assert "hardlink" in str(exc_info.value).lower()


# ============================================================================
# SUITE 4: DECOMPRESSION BOMBS & RESOURCE LIMITS
# ============================================================================

def test_decompression_bomb_ratio_blocked(guard, tmp_path):
    """Archive with excessive compression ratio (>100:1) must be blocked."""
    fixture = FIXTURES_DIR / "decompression_bomb_ratio.zip"
    extract_to = tmp_path / "extracted_bomb"

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "exceeds" in str(exc_info.value).lower() or "bomb" in str(exc_info.value).lower()


def test_decompression_bomb_lying_header_blocked(guard, tmp_path):
    """Archive whose header lies about uncompressed size must be caught during streaming."""
    fixture = FIXTURES_DIR / "decompression_bomb_lying_header.zip"
    extract_to = tmp_path / "extracted_lying"

    with pytest.raises((DecompressionBombError, MalformedArchiveError)) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert any(w in str(exc_info.value).lower() for w in ["exceeded", "bomb", "corrupt", "malformed", "crc"])


def test_oversized_entry_blocked(guard, tmp_path):
    """Individual entry exceeding max_entry_size must be rejected."""
    zip_path = tmp_path / "oversized.zip"
    extract_to = tmp_path / "extracted_oversized"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("large.dat", b"A" * (3 * 1024 * 1024))  # 3MB > 2MB limit

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(zip_path, extract_to)
    assert "exceeds" in str(exc_info.value).lower()


def test_excessive_file_count_blocked(guard, tmp_path):
    """Archive containing excessive number of files must be rejected."""
    fixture = FIXTURES_DIR / "excessive_file_count.zip"
    extract_to = tmp_path / "extracted_file_count"

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "file count limit" in str(exc_info.value).lower()


def test_excessive_total_size_blocked(guard, tmp_path):
    """Archive whose total size exceeds global extraction budget must be rejected."""
    fixture = FIXTURES_DIR / "excessive_total_size.zip"
    extract_to = tmp_path / "extracted_total_size"

    with pytest.raises(DecompressionBombError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "total uncompressed size" in str(exc_info.value).lower()


# ============================================================================
# SUITE 5: NESTED ARCHIVE & RECURSIVE DECOMPRESSION DEFENSES
# ============================================================================

def test_nested_archive_quarantined(guard, tmp_path):
    """Nested zip inside zip must be rejected to prevent recursive bombs (e.g. 42.zip)."""
    fixture = FIXTURES_DIR / "nested_archive.zip"
    extract_to = tmp_path / "extracted_nested"

    with pytest.raises(NestedArchiveError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Nested archive rejected" in str(exc_info.value)


def test_nested_archive_disguised_by_magic_bytes_blocked(guard, tmp_path):
    """File disguised with .txt extension but containing ZIP magic bytes must be caught."""
    fixture = FIXTURES_DIR / "nested_archive_disguised.zip"
    extract_to = tmp_path / "extracted_disguised"

    with pytest.raises(NestedArchiveError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Disguised nested" in str(exc_info.value)


# ============================================================================
# SUITE 6: UNICODE NORMALIZATION & WINDOWS PATH DEFENSES
# ============================================================================

def test_unicode_normalization_bypass_blocked(guard, tmp_path):
    """Fullwidth unicode characters (\uff0e\uff0e\uff0f) must be normalized and rejected."""
    fixture = FIXTURES_DIR / "unicode_normalization_bypass.zip"
    extract_to = tmp_path / "extracted_unicode"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Path traversal attempt blocked" in str(exc_info.value)


def test_windows_reserved_device_names_blocked(guard, tmp_path):
    """Archives with CON.txt, NUL, AUX must be rejected."""
    fixture = FIXTURES_DIR / "windows_device_names.zip"
    extract_to = tmp_path / "extracted_devices"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "reserved device name" in str(exc_info.value).lower()


def test_windows_alternate_data_stream_blocked(guard, tmp_path):
    """Archives with NTFS Alternate Data Streams (::$DATA) must be rejected."""
    fixture = FIXTURES_DIR / "windows_alternate_data_stream.zip"
    extract_to = tmp_path / "extracted_ads"

    with pytest.raises(PathTraversalError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Alternate Data Stream" in str(exc_info.value)


# ============================================================================
# SUITE 7: MALFORMED & CORRUPTED ARCHIVE HANDLING
# ============================================================================

def test_malformed_corrupt_archive_rejected(guard, tmp_path):
    """Truncated or corrupted archive headers must raise MalformedArchiveError."""
    fixture = FIXTURES_DIR / "malformed_corrupt.zip"
    extract_to = tmp_path / "extracted_corrupt"

    with pytest.raises(MalformedArchiveError) as exc_info:
        guard.extract_zip(fixture, extract_to)
    assert "Corrupt or malformed" in str(exc_info.value)
