"""
Deterministic generator for malicious archive test fixtures.
Constructs test fixtures covering all required attack vectors:
- Zip Slip relative traversal (../../evil.txt)
- Windows backslash traversal (..\\..\\windows\\system32\\calc.exe)
- Absolute Unix paths (/etc/shadow)
- Absolute Windows paths (C:\\Windows\\win.ini)
- Decompression bomb ratio (>100:1 ratio, 5MB zeros deflated to ~5KB)
- Excessive file count (55 files > 50 maxFilesCount)
- Excessive total uncompressed size (12MB > 10MB limit, deflated to ~15KB)
- Nested archive (zip containing a zip containing a zip)
- Unicode NFKC normalization bypass (\uff0e\uff0e\uff0fmalicious.txt)
- Windows reserved device names (CON.txt, dir/NUL)
- Windows NTFS Alternate Data Streams (payload.txt::$DATA)
- Malformed / corrupted archive (truncated ZIP)
- Additional fixtures for full test suite coverage (tar escapes, lying headers, disguised zips)

All generated files are strictly under 1 MB on disk.
"""

import io
import os
import struct
import tarfile
import zipfile
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "malicious_archives"


def generate_all_fixtures():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Zip Slip relative traversal (../../evil.txt)
    p1 = FIXTURES_DIR / "zip_slip_relative.zip"
    with zipfile.ZipFile(p1, "w") as zf:
        zf.writestr("../../evil.txt", "MALICIOUS_RELATIVE_TRAVERSAL\n")

    # 2. Zip Slip Windows backslash (..\\..\\windows\\system32\\calc.exe)
    p2 = FIXTURES_DIR / "zip_slip_windows_backslash.zip"
    with zipfile.ZipFile(p2, "w") as zf:
        zf.writestr("..\\..\\windows\\system32\\calc.exe", "MALICIOUS_BACKSLASH_TRAVERSAL\n")

    # 3. Absolute Unix path (/etc/shadow)
    p3 = FIXTURES_DIR / "absolute_unix_path.zip"
    with zipfile.ZipFile(p3, "w") as zf:
        zf.writestr("/etc/shadow", "MALICIOUS_ABSOLUTE_UNIX\n")

    # 4. Absolute Windows path (C:\\Windows\\win.ini)
    p4 = FIXTURES_DIR / "absolute_windows_path.zip"
    with zipfile.ZipFile(p4, "w") as zf:
        zf.writestr("C:\\Windows\\win.ini", "MALICIOUS_ABSOLUTE_WINDOWS\n")

    # 5. Decompression bomb ratio (5MB zeros compressed with DEFLATE to <10KB; ratio > 500:1)
    p5 = FIXTURES_DIR / "decompression_bomb_ratio.zip"
    zeros = b"\x00" * (5 * 1024 * 1024)
    with zipfile.ZipFile(p5, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("huge_zeroes.dat", zeros)

    # 6. Excessive file count archive (55 files > 50 limit)
    p6 = FIXTURES_DIR / "excessive_file_count.zip"
    with zipfile.ZipFile(p6, "w") as zf:
        for i in range(55):
            zf.writestr(f"file_{i:03d}.txt", f"data {i}\n")

    # 7. Excessive total uncompressed size (8 entries of 1.5MB = 12MB > 10MB limit; DEFLATED to <20KB)
    p7 = FIXTURES_DIR / "excessive_total_size.zip"
    with zipfile.ZipFile(p7, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        payload = b"\x00" * int(1.5 * 1024 * 1024)
        for i in range(8):
            zf.writestr(f"part_{i}.bin", payload)

    # 8. Nested archive: a zip containing a zip containing a zip
    p8 = FIXTURES_DIR / "nested_archive.zip"
    innermost_buf = io.BytesIO()
    with zipfile.ZipFile(innermost_buf, "w") as innermost_zf:
        innermost_zf.writestr("innermost.txt", "innermost content\n")

    middle_buf = io.BytesIO()
    with zipfile.ZipFile(middle_buf, "w") as middle_zf:
        middle_zf.writestr("innermost.zip", innermost_buf.getvalue())

    with zipfile.ZipFile(p8, "w") as outer_zf:
        outer_zf.writestr("inner.zip", middle_buf.getvalue())

    # 9. Unicode normalization bypass (\uff0e\uff0e\uff0fmalicious.txt)
    p9 = FIXTURES_DIR / "unicode_normalization_bypass.zip"
    with zipfile.ZipFile(p9, "w") as zf:
        zf.writestr("\uff0e\uff0e\uff0fmalicious.txt", "UNICODE_NORMALIZATION_BYPASS\n")

    # 10. Windows reserved device names (CON.txt and dir/NUL)
    p10 = FIXTURES_DIR / "windows_device_names.zip"
    with zipfile.ZipFile(p10, "w") as zf:
        zf.writestr("CON.txt", "DEVICE_NAME_CON\n")
        zf.writestr("dir/NUL", "DEVICE_NAME_NUL\n")

    # 11. Windows NTFS Alternate Data Streams (payload.txt::$DATA)
    p11 = FIXTURES_DIR / "windows_alternate_data_stream.zip"
    with zipfile.ZipFile(p11, "w") as zf:
        zf.writestr("payload.txt::$DATA", "NTFS_ADS_CONTENT\n")

    # 12. Malformed / corrupted archive (truncated ZIP)
    p12 = FIXTURES_DIR / "malformed_corrupt.zip"
    p12.write_bytes(b"PK\x03\x04\x14\x00\x00\x00truncated_corrupted_garbage")

    # 13. Symlink escape (tar with symlink pointing to /etc/passwd)
    p13 = FIXTURES_DIR / "symlink_escape.tar"
    with tarfile.open(p13, "w") as tar:
        ti = tarfile.TarInfo(name="sym_escape.txt")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "/etc/passwd"
        tar.addfile(ti)

    # 14. Symlink directory escape (tar with symlink pointing to ../../)
    p14 = FIXTURES_DIR / "symlink_directory_escape.tar"
    with tarfile.open(p14, "w") as tar:
        ti = tarfile.TarInfo(name="sym_dir")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "../../"
        tar.addfile(ti)

    # 15. Hardlink escape (tar with hardlink pointing to /etc/shadow)
    p15 = FIXTURES_DIR / "hardlink_escape.tar"
    with tarfile.open(p15, "w") as tar:
        ti = tarfile.TarInfo(name="hardlink_escape.txt")
        ti.type = tarfile.LNKTYPE
        ti.linkname = "/etc/shadow"
        tar.addfile(ti)

    # 16. Lying header decompression bomb
    p16 = FIXTURES_DIR / "decompression_bomb_lying_header.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lying.dat", b"\x00" * (3 * 1024 * 1024))
    raw_zip = bytearray(buf.getvalue())
    cd_sig = b"PK\x01\x02"
    cd_idx = raw_zip.find(cd_sig)
    if cd_idx != -1:
        struct.pack_into("<I", raw_zip, cd_idx + 24, 64)
    p16.write_bytes(bytes(raw_zip))

    # 17. Disguised nested archive (file named README.txt containing ZIP magic bytes)
    p17 = FIXTURES_DIR / "nested_archive_disguised.zip"
    with zipfile.ZipFile(p17, "w") as zf:
        zf.writestr("README.txt", b"PK\x03\x04\x14\x00\x00\x00disguised_archive_payload")

    # Verify all generated files are under 1 MB on disk
    for f in FIXTURES_DIR.iterdir():
        if f.is_file():
            size = f.stat().st_size
            assert size < 1024 * 1024, f"Fixture {f.name} is {size} bytes, exceeds 1MB limit"

import contextlib
import shutil
import tempfile


@contextlib.contextmanager
def deeply_nested_fixture(levels: int = 30, base_dir: Path | None = None):
    """
    Context manager that creates a deeply nested directory tree in a temporary directory
    during the test run and safely tears it down afterward.
    Protects against Windows PATH_MAX issues while ensuring depth-nesting tests pass.
    """
    if base_dir is None:
        temp_dir = Path(tempfile.mkdtemp(prefix="ecdat_nested_"))
        cleanup_temp = True
    else:
        temp_dir = base_dir
        cleanup_temp = False

    target_dir = temp_dir / "02_deeply_nested"
    try:
        curr = target_dir
        curr.mkdir(parents=True, exist_ok=True)
        for i in range(levels):
            curr = curr / f"depth_level_{i:02d}"
            try:
                curr.mkdir(exist_ok=True)
            except OSError:
                break
        target_file = curr / "deep_crypto.c"
        try:
            target_file.write_text("void deep_func() { SHA1_Init(NULL); }\n", encoding="utf-8")
        except OSError:
            pass

        yield target_dir
    finally:
        if cleanup_temp:
            path_str = str(temp_dir.resolve())
            if os.name == "nt" and not path_str.startswith("\\\\?\\"):
                path_str = "\\\\?\\" + path_str
            shutil.rmtree(path_str, ignore_errors=True)


if __name__ == "__main__":
    generate_all_fixtures()

