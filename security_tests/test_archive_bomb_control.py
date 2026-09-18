# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Archive Bomb & Resource Decompression Defense Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

from pathlib import Path
import tempfile
import zipfile
import pytest
from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    DecompressionBombError,
    NestedArchiveError,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "malicious_archives"


class TestArchiveBombControl:
    """
    Security Control: Decompression Bomb & Resource Exhaustion Defense
    Guarantees that archive expansion ratios, entry sizes, and total extraction bytes are capped.
    """

    @pytest.fixture
    def guard(self):
        return ArchiveSecurityGuard(
            max_total_bytes=10 * 1024 * 1024,  # 10 MB total
            max_entry_size=5 * 1024 * 1024,   # 5 MB max per entry
            max_compression_ratio=50.0,       # 50:1 max ratio
            allow_nested=False,
        )

    @pytest.fixture
    def sandbox(self):
        with tempfile.TemporaryDirectory() as td:
            yield Path(td).resolve()

    # 1. POSITIVE TEST: Normal archive with standard compression ratio extracts successfully
    def test_positive_archive_bomb(self, guard, sandbox):
        normal_zip = sandbox / "normal.zip"
        with zipfile.ZipFile(normal_zip, "w") as zf:
            zf.writestr("data.txt", "Standard uncompressed text payload\n" * 10)

        out_dir = sandbox / "out_normal"
        extracted = guard.extract(normal_zip, out_dir)
        assert len(extracted) == 1

    # 2. NEGATIVE TEST: Non-archive file or empty archive raises error
    def test_negative_archive_bomb(self, guard, sandbox):
        not_zip = sandbox / "fake.zip"
        not_zip.write_text("not a zip file", encoding="utf-8")

        with pytest.raises(Exception):
            guard.extract(not_zip, sandbox / "out_fake")

    # 3. BOUNDARY TEST: Archive close to safe compression threshold
    def test_boundary_archive_bomb(self, sandbox):
        # Guard with generous limits
        flexible_guard = ArchiveSecurityGuard(max_compression_ratio=150.0)
        border_zip = sandbox / "border.zip"
        # 100 KB text
        with zipfile.ZipFile(border_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("border.txt", "A" * (100 * 1024))

        out_dir = sandbox / "out_border"
        extracted = flexible_guard.extract(border_zip, out_dir)
        assert len(extracted) == 1

    # 4. MALICIOUS TEST: Intentionally malicious archive bomb fixtures blocked
    def test_malicious_archive_bomb(self, guard, sandbox):
        # 1. High expansion ratio bomb (>1000:1)
        ratio_bomb = FIXTURES_DIR / "decompression_bomb_ratio.zip"
        if ratio_bomb.exists():
            with pytest.raises(DecompressionBombError) as exc_info:
                guard.extract(ratio_bomb, sandbox / "out_ratio")
            assert "ratio" in str(exc_info.value).lower() or "exceeded" in str(exc_info.value).lower()

        # 2. Lying headers decompression bomb
        lying_bomb = FIXTURES_DIR / "decompression_bomb_lying_header.zip"
        if lying_bomb.exists():
            # Strict guard with 10KB entry limit
            strict_guard = ArchiveSecurityGuard(max_entry_size=1024)
            with pytest.raises(DecompressionBombError):
                strict_guard.extract(lying_bomb, sandbox / "out_lying")

        # 3. Nested archive (.zip inside .zip)
        nested_zip = FIXTURES_DIR / "nested_archive.zip"
        if nested_zip.exists():
            with pytest.raises(NestedArchiveError) as exc_info:
                guard.extract(nested_zip, sandbox / "out_nested")
            assert "nested" in str(exc_info.value).lower()

    # 5. REGRESSION TEST: Verification of SEC-REG-006 decompression bomb mitigation
    def test_regression_archive_bomb(self, sandbox):
        # Invariant: Exceeding max_total_bytes strictly halts extraction before disk exhaustion
        small_guard = ArchiveSecurityGuard(max_total_bytes=50000)
        large_zip = sandbox / "oversized.zip"
        with zipfile.ZipFile(large_zip, "w") as zf:
            zf.writestr("big1.txt", "X" * 30000)
            zf.writestr("big2.txt", "Y" * 30000)

        with pytest.raises(DecompressionBombError) as exc_info:
            small_guard.extract(large_zip, sandbox / "out_over")
        assert "total" in str(exc_info.value).lower() or "limit" in str(exc_info.value).lower()
