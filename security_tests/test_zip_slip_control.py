# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Zip Slip & Malicious Archive Extraction Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

from pathlib import Path
import tempfile
import zipfile
import pytest
from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    PathTraversalError,
    MalformedArchiveError,
    ArchiveSecurityError,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "malicious_archives"


class TestZipSlipControl:
    """
    Security Control: Zip Slip & Tar Slip Traversal Defense
    Guarantees that archive extraction can never write files outside the designated extraction directory.
    """

    @pytest.fixture
    def guard(self):
        return ArchiveSecurityGuard(allow_nested=False, allow_symlinks=False)

    @pytest.fixture
    def sandbox(self):
        with tempfile.TemporaryDirectory() as td:
            yield Path(td).resolve()

    # 1. POSITIVE TEST: Benign zip archive extracts cleanly
    def test_positive_zip_slip(self, guard, sandbox):
        safe_zip = sandbox / "safe.zip"
        with zipfile.ZipFile(safe_zip, "w") as zf:
            zf.writestr("safe_dir/file.txt", "Clean content\n")

        extract_dir = sandbox / "extracted"
        extracted_files = guard.extract(safe_zip, extract_dir)
        assert len(extracted_files) == 1
        assert (extract_dir / "safe_dir" / "file.txt").exists()

    # 2. NEGATIVE TEST: Corrupted / truncated archive fails cleanly
    def test_negative_zip_slip(self, guard, sandbox):
        corrupt_zip = FIXTURES_DIR / "malformed_corrupt.zip"
        if corrupt_zip.exists():
            with pytest.raises(MalformedArchiveError):
                guard.extract(corrupt_zip, sandbox)

    # 3. BOUNDARY TEST: Archive with empty subdirectories and 0-byte file
    def test_boundary_zip_slip(self, guard, sandbox):
        boundary_zip = sandbox / "boundary.zip"
        with zipfile.ZipFile(boundary_zip, "w") as zf:
            zf.writestr("empty_dir/", "")
            zf.writestr("empty_dir/zero_byte.txt", "")

        extract_dir = sandbox / "boundary_out"
        extracted_files = guard.extract(boundary_zip, extract_dir)
        assert (extract_dir / "empty_dir" / "zero_byte.txt").exists()

    # 4. MALICIOUS TEST: Intentionally malicious Zip Slip fixtures intercepted and blocked
    def test_malicious_zip_slip(self, guard, sandbox):
        malicious_fixtures = [
            "zip_slip_relative.zip",
            "zip_slip_windows.zip",
            "absolute_unix_path.zip",
            "absolute_windows_path.zip",
        ]
        for fix_name in malicious_fixtures:
            fix_path = FIXTURES_DIR / fix_name
            if fix_path.exists():
                with pytest.raises(PathTraversalError) as exc_info:
                    guard.extract(fix_path, sandbox / "out")
                assert "rejected" in str(exc_info.value).lower() or "traversal" in str(exc_info.value).lower()

        # Symlink and hardlink escapes
        for tar_fix in ["symlink_escape.tar", "hardlink_escape.tar"]:
            tar_path = FIXTURES_DIR / tar_fix
            if tar_path.exists():
                with pytest.raises(ArchiveSecurityError):
                    guard.extract(tar_path, sandbox / "out")

    # 5. REGRESSION TEST: Verification of SEC-REG-007 traversal immunity (zero leakage outside root)
    def test_regression_zip_slip(self, guard, sandbox):
        slip_fixture = FIXTURES_DIR / "zip_slip_relative.zip"
        if slip_fixture.exists():
            extract_target = sandbox / "safe_zone"
            with pytest.raises(PathTraversalError):
                guard.extract(slip_fixture, extract_target)

            # Assert no malicious file escaped to parent sandbox
            assert not (sandbox / "evil_relative.txt").exists()
            assert not (Path(tempfile.gettempdir()) / "evil_relative.txt").exists()
