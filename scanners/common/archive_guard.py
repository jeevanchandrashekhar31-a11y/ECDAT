"""
ECDAT Archive Safety and Security Engine (Phase 20.2)

Hardens archive processing against:
- Zip bombs / Tar bombs (decompression ratio and size explosion)
- Path traversal (ZipSlip / TarSlip: ../, absolute paths, Windows drive letters)
- Symlink extraction / directory escapes
- Excessive compression ratio (> 100:1)
- Oversized individual entries (> 25MB)
- Nested archives (quarantined to prevent recursive decompression attacks)
- Special device nodes, FIFOs, and sockets

Extracts strictly into isolated target directories, validating every extracted path.
"""

import argparse
import os
import re
import shutil
import stat
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Security limits
DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024  # 100 MB total extraction limit
DEFAULT_MAX_ENTRY_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB max per entry
DEFAULT_MAX_FILES_COUNT = 1000  # 1,000 max extracted files
DEFAULT_MAX_COMPRESSION_RATIO = 100.0  # 100:1 max ratio

NESTED_ARCHIVE_EXTS = {".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz", ".7z", ".rar", ".iso"}

WINDOWS_DEVICE_NAMES = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", re.IGNORECASE)


class ArchiveSecurityError(Exception):
    """Base exception for archive security violations."""

    pass


class DecompressionBombError(ArchiveSecurityError):
    """Raised when an archive exceeds size, count, or compression ratio limits."""

    pass


class PathTraversalError(ArchiveSecurityError):
    """Raised when an archive entry attempts path traversal (ZipSlip/TarSlip)."""

    pass


class NestedArchiveError(ArchiveSecurityError):
    """Raised when an unpermitted nested archive is encountered."""

    pass


class ArchiveSecurityGuard:
    """
    Validates and extracts ZIP and TAR archives within strict security bounds.
    """

    def __init__(
        self,
        max_total_bytes: int = DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES,
        max_entry_size: int = DEFAULT_MAX_ENTRY_SIZE_BYTES,
        max_files_count: int = DEFAULT_MAX_FILES_COUNT,
        max_compression_ratio: float = DEFAULT_MAX_COMPRESSION_RATIO,
        allow_nested: bool = False,
    ):
        self.max_total_bytes = max_total_bytes
        self.max_entry_size = max_entry_size
        self.max_files_count = max_files_count
        self.max_compression_ratio = max_compression_ratio
        self.allow_nested = allow_nested

    def _validate_path_containment(self, member_name: str, extract_to: Path) -> Path:
        """
        Validates that member_name resolves strictly within extract_to.
        Blocks ZipSlip, TarSlip, absolute paths, and Windows drive letters.
        """
        # Reject null bytes in member names
        if "\x00" in member_name:
            raise PathTraversalError(f"Null byte detected in archive member name: {repr(member_name)}")

        # Normalize slashes and reject leading slashes / drive letters
        clean_name = member_name.replace("\\", "/").lstrip("/")
        if re.match(r"^[a-zA-Z]:", clean_name):
            raise PathTraversalError(f"Windows drive letter path rejected: {member_name}")

        target_path = (extract_to / clean_name).resolve()

        # Strict containment verification
        try:
            target_path.relative_to(extract_to)
        except ValueError:
            raise PathTraversalError(
                f"Path traversal attempt blocked: member '{member_name}' resolves to '{target_path}' outside '{extract_to}'"
            )

        # Check filename against Windows reserved names
        if WINDOWS_DEVICE_NAMES.match(target_path.name):
            raise PathTraversalError(f"Forbidden Windows reserved device name in archive: {target_path.name}")

        return target_path

    def extract_zip(self, zip_path: Path, extract_to: Path) -> List[Path]:
        """Safely extract a ZIP archive."""
        if not zip_path.exists():
            raise FileNotFoundError(f"Archive not found: {zip_path}")

        compressed_size = zip_path.stat().st_size
        if compressed_size == 0:
            raise ArchiveSecurityError("Empty archive file (0 bytes).")

        extract_to = extract_to.resolve()
        extract_to.mkdir(parents=True, exist_ok=True)

        extracted_files: List[Path] = []
        total_uncompressed = 0
        file_count = 0

        with zipfile.ZipFile(zip_path, "r") as zf:
            infolist = zf.infolist()

            # Pre-flight check: total declared size and file count
            for info in infolist:
                file_count += 1
                if file_count > self.max_files_count:
                    raise DecompressionBombError(
                        f"Archive exceeds maximum file count limit ({self.max_files_count} files)."
                    )

                if info.file_size > self.max_entry_size:
                    raise DecompressionBombError(
                        f"Archive entry '{info.filename}' ({info.file_size} bytes) exceeds entry limit ({self.max_entry_size} bytes)."
                    )

                total_uncompressed += info.file_size
                if total_uncompressed > self.max_total_bytes:
                    raise DecompressionBombError(
                        f"Total uncompressed size ({total_uncompressed} bytes) exceeds limit ({self.max_total_bytes} bytes)."
                    )

            # Global compression ratio check
            overall_ratio = total_uncompressed / max(compressed_size, 1)
            if overall_ratio > self.max_compression_ratio and total_uncompressed > (1024 * 1024):
                raise DecompressionBombError(
                    f"Excessive compression ratio ({overall_ratio:.1f}:1) exceeds limit ({self.max_compression_ratio}:1). Possible zip bomb."
                )

            # Extraction loop
            running_bytes = 0
            for info in infolist:
                # Directory entry
                if info.is_dir():
                    dir_target = self._validate_path_containment(info.filename, extract_to)
                    dir_target.mkdir(parents=True, exist_ok=True)
                    continue

                # Path containment check
                target_path = self._validate_path_containment(info.filename, extract_to)

                # Nested archive check
                ext = target_path.suffix.lower()
                if not self.allow_nested and ext in NESTED_ARCHIVE_EXTS:
                    raise NestedArchiveError(
                        f"Nested archive rejected: '{info.filename}'. Nested archives are disabled to prevent recursive bombs."
                    )

                # Ensure parent directory exists and is contained
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # Extract safely with bounded streaming
                with zf.open(info, "r") as source, open(target_path, "wb") as target:
                    bytes_written = 0
                    while chunk := source.read(65536):
                        bytes_written += len(chunk)
                        running_bytes += len(chunk)

                        if bytes_written > self.max_entry_size:
                            target_path.unlink(missing_ok=True)
                            raise DecompressionBombError(
                                f"Decompressed size of entry '{info.filename}' exceeded limit during extraction."
                            )

                        if running_bytes > self.max_total_bytes:
                            target_path.unlink(missing_ok=True)
                            raise DecompressionBombError("Global uncompressed byte budget exceeded during extraction.")

                        target.write(chunk)

                extracted_files.append(target_path)

        return extracted_files

    def extract_tar(self, tar_path: Path, extract_to: Path) -> List[Path]:
        """Safely extract a TAR/TAR.GZ/TGZ archive."""
        if not tar_path.exists():
            raise FileNotFoundError(f"Archive not found: {tar_path}")

        compressed_size = tar_path.stat().st_size
        if compressed_size == 0:
            raise ArchiveSecurityError("Empty archive file (0 bytes).")

        extract_to = extract_to.resolve()
        extract_to.mkdir(parents=True, exist_ok=True)

        extracted_files: List[Path] = []
        total_uncompressed = 0
        file_count = 0

        with tarfile.open(tar_path, mode="r:*") as tar:
            for member in tar:
                file_count += 1
                if file_count > self.max_files_count:
                    raise DecompressionBombError(
                        f"Archive exceeds maximum file count limit ({self.max_files_count} files)."
                    )

                # Block special device nodes, FIFOs, and character devices
                if member.isdev() or member.ischr() or member.isblk() or member.isfifo():
                    continue

                # Path traversal / TarSlip protection
                target_path = self._validate_path_containment(member.name, extract_to)

                # Directory
                if member.isdir():
                    target_path.mkdir(parents=True, exist_ok=True)
                    continue

                # Symlink / Hardlink target validation
                if member.issym() or member.islnk():
                    link_target = (target_path.parent / member.linkname).resolve()
                    try:
                        link_target.relative_to(extract_to)
                    except ValueError:
                        # Symlink points outside extraction root; block for safety
                        continue

                    # On platforms/users lacking symlink privileges, skip creation gracefully
                    try:
                        if member.issym():
                            target_path.unlink(missing_ok=True)
                            os.symlink(member.linkname, target_path)
                        elif member.islnk():
                            target_path.unlink(missing_ok=True)
                            os.link(link_target, target_path)
                        extracted_files.append(target_path)
                    except (OSError, NotImplementedError):
                        continue
                    continue

                # Nested archive check
                ext = target_path.suffix.lower()
                if not self.allow_nested and ext in NESTED_ARCHIVE_EXTS:
                    raise NestedArchiveError(
                        f"Nested archive rejected: '{member.name}'. Nested archives are disabled to prevent recursive bombs."
                    )

                # Individual entry size check
                if member.size > self.max_entry_size:
                    raise DecompressionBombError(
                        f"Archive entry '{member.name}' ({member.size} bytes) exceeds limit ({self.max_entry_size} bytes)."
                    )

                total_uncompressed += member.size
                if total_uncompressed > self.max_total_bytes:
                    raise DecompressionBombError(
                        f"Total uncompressed size ({total_uncompressed} bytes) exceeds limit ({self.max_total_bytes} bytes)."
                    )

                # Ratio check
                overall_ratio = total_uncompressed / max(compressed_size, 1)
                if overall_ratio > self.max_compression_ratio and total_uncompressed > (1024 * 1024):
                    raise DecompressionBombError(
                        f"Excessive compression ratio ({overall_ratio:.1f}:1). Possible tar bomb."
                    )

                target_path.parent.mkdir(parents=True, exist_ok=True)

                fileobj = tar.extractfile(member)
                if fileobj is None:
                    continue

                bytes_written = 0
                with open(target_path, "wb") as out_f:
                    while chunk := fileobj.read(65536):
                        bytes_written += len(chunk)
                        if bytes_written > self.max_entry_size:
                            target_path.unlink(missing_ok=True)
                            raise DecompressionBombError(
                                f"Entry '{member.name}' exceeded size limit during extraction."
                            )
                        out_f.write(chunk)

                extracted_files.append(target_path)

        return extracted_files

    def extract(self, archive_path: Path, extract_to: Path) -> List[Path]:
        """Automatically detect archive format and safely extract."""
        p = Path(archive_path)
        name_lower = p.name.lower()

        if name_lower.endswith(".zip"):
            return self.extract_zip(p, extract_to)
        elif any(name_lower.endswith(ext) for ext in [".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz"]):
            return self.extract_tar(p, extract_to)
        else:
            # Attempt zip first, then tar
            try:
                if zipfile.is_zipfile(p):
                    return self.extract_zip(p, extract_to)
            except Exception:
                pass
            return self.extract_tar(p, extract_to)


def main():
    parser = argparse.ArgumentParser(description="ECDAT Safe Archive Extraction Utility")
    parser.add_argument("action", choices=["extract", "validate"], help="Action to perform")
    parser.add_argument("archive", help="Path to archive file (.zip, .tar, .tar.gz)")
    parser.add_argument("destination", nargs="?", default=".", help="Target extraction directory")
    parser.add_argument("--max-size-mb", type=int, default=100, help="Max total uncompressed size (MB)")
    parser.add_argument("--max-entry-mb", type=int, default=25, help="Max single entry size (MB)")
    parser.add_argument("--max-files", type=int, default=1000, help="Max file count")
    parser.add_argument("--allow-nested", action="store_true", help="Allow nested archives")
    args = parser.parse_args()

    guard = ArchiveSecurityGuard(
        max_total_bytes=args.max_size_mb * 1024 * 1024,
        max_entry_size=args.max_entry_mb * 1024 * 1024,
        max_files_count=args.max_files,
        allow_nested=args.allow_nested,
    )

    archive_path = Path(args.archive)
    dest_path = Path(args.destination)

    try:
        if args.action == "extract":
            extracted = guard.extract(archive_path, dest_path)
            print(f">> [SUCCESS] Extracted {len(extracted)} files safely into {dest_path}")
            return 0
        elif args.action == "validate":
            # Extract to temporary isolated dir to validate
            with tempfile.TemporaryDirectory(prefix="ecdat_val_") as tmp_dir:
                guard.extract(archive_path, Path(tmp_dir))
            print(f">> [PASS] Archive {archive_path} validated cleanly without security violations.")
            return 0
    except (ArchiveSecurityError, FileNotFoundError, OSError) as e:
        print(f"::error::Archive Security Rejection: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
