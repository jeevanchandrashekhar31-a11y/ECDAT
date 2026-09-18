"""
ECDAT Malicious Archive Fixture Generator (Phase 10)

Generates test archive fixtures covering all required attack vectors:
- Zip Slip (relative traversal ../)
- Windows path traversal with backslashes (..\\)
- Absolute Unix paths (/etc/shadow)
- Windows drive letter paths (C:\\Windows\\win.ini)
- Symlink escapes and directory symlink traversals
- Hardlink escapes to outside targets
- Decompression bombs (high ratio > 100:1)
- Lying headers in decompression bombs
- Excessive file count archives
- Excessive total uncompressed size archives
- Nested archives (.zip inside .zip)
- Disguised nested archives (magic bytes in .txt)
- Unicode NFKC normalization bypasses (\uff0e\uff0e\uff0f)
- Windows reserved device names (CON, NUL, AUX)
- Windows NTFS Alternate Data Streams (payload.txt::$DATA)
- Malformed, corrupt, or truncated zip archives
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
        zf.writestr("../../evil_relative.txt", "MALICIOUS_RELATIVE_TRAVERSAL\n")

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

    # 5. Symlink escape (tar with symlink pointing to /etc/passwd)
    p5 = FIXTURES_DIR / "symlink_escape.tar"
    with tarfile.open(p5, "w") as tar:
        ti = tarfile.TarInfo(name="sym_escape.txt")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "/etc/passwd"
        tar.addfile(ti)

    # 6. Symlink directory escape (tar with symlink pointing to ../../)
    p6 = FIXTURES_DIR / "symlink_directory_escape.tar"
    with tarfile.open(p6, "w") as tar:
        ti = tarfile.TarInfo(name="sym_dir")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "../../"
        tar.addfile(ti)

    # 7. Hardlink escape (tar with hardlink pointing to /etc/shadow)
    p7 = FIXTURES_DIR / "hardlink_escape.tar"
    with tarfile.open(p7, "w") as tar:
        ti = tarfile.TarInfo(name="hardlink_escape.txt")
        ti.type = tarfile.LNKTYPE
        ti.linkname = "/etc/shadow"
        tar.addfile(ti)

    # 8. Decompression bomb ratio (5MB of zeros compressed to <10KB, ratio > 500:1)
    p8 = FIXTURES_DIR / "decompression_bomb_ratio.zip"
    zeros = b"\x00" * (5 * 1024 * 1024)
    with zipfile.ZipFile(p8, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("huge_zeroes.dat", zeros)

    # 9. Lying header decompression bomb (zip entry declaring size 100 bytes but expands to 5MB)
    p9 = FIXTURES_DIR / "decompression_bomb_lying_header.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lying.dat", b"\x00" * (3 * 1024 * 1024))
    raw_zip = bytearray(buf.getvalue())
    # Tamper with declared uncompressed size in Central Directory if found
    cd_sig = b"PK\x01\x02"
    cd_idx = raw_zip.find(cd_sig)
    if cd_idx != -1:
        # uncompressed size is at offset 24 from cd_idx
        struct.pack_into("<I", raw_zip, cd_idx + 24, 64)  # claims only 64 bytes uncompressed
    p9.write_bytes(bytes(raw_zip))

    # 10. Excessive file count archive (55 files)
    p10 = FIXTURES_DIR / "excessive_file_count.zip"
    with zipfile.ZipFile(p10, "w") as zf:
        for i in range(55):
            zf.writestr(f"file_{i:03d}.txt", f"data {i}\n")

    # 11. Excessive total uncompressed size (8 files of 1.5MB each = 12MB > 10MB limit)
    p11 = FIXTURES_DIR / "excessive_total_size.zip"
    with zipfile.ZipFile(p11, "w", compression=zipfile.ZIP_STORED) as zf:
        payload = b"X" * int(1.5 * 1024 * 1024)
        for i in range(8):
            zf.writestr(f"part_{i}.bin", payload)

    # 12. Nested archive (.zip containing inner.zip)
    p12 = FIXTURES_DIR / "nested_archive.zip"
    inner_buf = io.BytesIO()
    with zipfile.ZipFile(inner_buf, "w") as inner_zf:
        inner_zf.writestr("inner_payload.txt", "hello from nested archive\n")
    with zipfile.ZipFile(p12, "w") as outer_zf:
        outer_zf.writestr("inner_archive.zip", inner_buf.getvalue())

    # 13. Disguised nested archive (file named README.txt containing ZIP magic bytes)
    p13 = FIXTURES_DIR / "nested_archive_disguised.zip"
    with zipfile.ZipFile(p13, "w") as zf:
        zf.writestr("README.txt", b"PK\x03\x04\x14\x00\x00\x00disguised_archive_payload")

    # 14. Unicode normalization bypass (\uff0e\uff0e\uff0fmalicious.txt)
    p14 = FIXTURES_DIR / "unicode_normalization_bypass.zip"
    with zipfile.ZipFile(p14, "w") as zf:
        zf.writestr("\uff0e\uff0e\uff0fmalicious.txt", "UNICODE_NORMALIZATION_BYPASS\n")

    # 15. Windows reserved device names (CON.txt and dir/NUL)
    p15 = FIXTURES_DIR / "windows_device_names.zip"
    with zipfile.ZipFile(p15, "w") as zf:
        zf.writestr("CON.txt", "DEVICE_NAME_CON\n")
        zf.writestr("dir/NUL", "DEVICE_NAME_NUL\n")

    # 16. Windows NTFS Alternate Data Streams (payload.txt::$DATA)
    p16 = FIXTURES_DIR / "windows_alternate_data_stream.zip"
    with zipfile.ZipFile(p16, "w") as zf:
        zf.writestr("payload.txt::$DATA", "NTFS_ADS_CONTENT\n")

    # 17. Malformed / corrupted archive (truncated ZIP)
    p17 = FIXTURES_DIR / "malformed_corrupt.zip"
    p17.write_bytes(b"PK\x03\x04\x14\x00\x00\x00truncated_corrupted_garbage")

    print(f">> Generated 17 malicious archive fixtures in {FIXTURES_DIR}")


if __name__ == "__main__":
    generate_all_fixtures()
