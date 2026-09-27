"""
ECDAT Archive Safety and Security Engine

Comprehensive archive security defenses against:
- Zip Slip and Tar Slip path traversal (relative ../, absolute paths, Windows drive letters, UNC paths)
- Symlink escapes and directory symlink traversal
- Hardlink escapes to outside or non-existent files
- Decompression bombs (expansion ratio caps, per-entry caps, total extraction budget, streaming byte checks)
- Excessive file count exhaustion
- Nested archives and recursive decompression attacks (extension and magic byte inspection)
- Malformed, corrupt, or truncated archive headers
- Unicode and path normalization bypasses (NFKC normalization, directional overrides, zero-width characters)
- Windows path traversal, reserved device names (CON, NUL, AUX, etc.), Alternate Data Streams (::$DATA)
- Alternate and mixed path separators (/ and \\)

Invariant: Resolved canonical extracted paths MUST strictly remain within the dedicated extraction root.
"""

import argparse
import io
import os
import re
import shutil
import stat
import struct
import sys
import tarfile
import tempfile
import unicodedata
import zipfile
import zlib
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Bounded security defaults
DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024  # 100 MB total extraction limit
DEFAULT_MAX_ENTRY_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB max per entry
DEFAULT_MAX_FILES_COUNT = 10000  # 10,000 max extracted files
DEFAULT_MAX_COMPRESSION_RATIO = 100.0  # 100:1 max ratio

# Archive file extensions considered nested
NESTED_ARCHIVE_EXTS = {
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz",
    ".7z", ".rar", ".iso", ".jar", ".war", ".ear", ".cpio", ".zst"
}

# Archive magic byte signatures for deep content inspection
ARCHIVE_MAGIC_SIGNATURES = [
    (b"PK\x03\x04", "ZIP"),
    (b"PK\x05\x06", "ZIP-EOCD"),
    (b"PK\x07\x08", "ZIP-Span"),
    (b"\x1f\x8b", "GZIP"),
    (b"BZh", "BZIP2"),
    (b"7z\xbc\xaf\x27\x1c", "7-ZIP"),
    (b"\xfd7zXZ\x00", "XZ"),
    (b"Rar!\x1a\x07", "RAR"),
]

# Windows reserved device names: CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9
WINDOWS_RESERVED_BASE = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*|:.*)?$",
    re.IGNORECASE
)

# Forbidden Unicode control / directional override ranges
FORBIDDEN_UNICODE_CHARS = {
    '\x00',  # Null byte
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',  # BiDi embedding/override
    '\u2066', '\u2067', '\u2068', '\u2069',  # BiDi isolates
    '\u200b', '\u200c', '\u200d', '\ufeff',  # Zero-width spaces / BOM
}


class ArchiveSecurityError(Exception):
    """Base exception for all archive security violations."""
    pass


class PathTraversalError(ArchiveSecurityError):
    """Raised when an archive member attempts path traversal (Zip Slip / Tar Slip)."""
    pass


class SymlinkEscapeError(PathTraversalError):
    """Raised when an archive contains a symlink that escapes or traverses outside the extraction root."""
    pass


class HardlinkEscapeError(PathTraversalError):
    """Raised when an archive contains a hardlink that escapes or links outside the extraction root."""
    pass


class DecompressionBombError(ArchiveSecurityError):
    """Raised when an archive exceeds size, count, or compression ratio limits."""
    pass


class NestedArchiveError(ArchiveSecurityError):
    """Raised when an unpermitted nested archive is encountered."""
    pass


class MalformedArchiveError(ArchiveSecurityError):
    """Raised when an archive contains corrupted headers, truncated data, or malformed structures."""
    pass


class ArchiveSecurityGuard:
    """
    Validates and extracts ZIP and TAR archives within strict canonical security bounds.
    """

    def __init__(
        self,
        max_total_bytes: int = DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES,
        max_entry_size: int = DEFAULT_MAX_ENTRY_SIZE_BYTES,
        max_files_count: int = DEFAULT_MAX_FILES_COUNT,
        max_compression_ratio: float = DEFAULT_MAX_COMPRESSION_RATIO,
        allow_nested: bool = False,
        allow_symlinks: bool = False,
    ):
        self.max_total_bytes = max_total_bytes
        self.max_entry_size = max_entry_size
        self.max_files_count = max_files_count
        self.max_compression_ratio = max_compression_ratio
        self.allow_nested = allow_nested
        self.allow_symlinks = allow_symlinks

    def _validate_path_containment(
        self,
        member_name: str,
        extract_to: Path,
        is_dir: bool = False
    ) -> Path:
        """
        Validates that member_name resolves strictly within extract_to using canonical path validation.
        Protects against Zip Slip, absolute paths, Windows drive letters, UNC shares, ADS,
        Unicode normalization bypasses, Windows device names, and alternate separators.
        """
        if not member_name or not isinstance(member_name, str):
            raise PathTraversalError("Empty or invalid member name.")

        # 1. Reject control characters and forbidden Unicode sequences
        for char in member_name:
            if char in FORBIDDEN_UNICODE_CHARS or (ord(char) < 32 and char not in ('\t', '\n', '\r')):
                raise PathTraversalError(f"Prohibited control or Unicode character in member name: {repr(char)}")

        # 2. Unicode NFKC Normalization (defeats fullwidth character bypasses like \uff0e\uff0e\uff0f)
        normalized_name = unicodedata.normalize("NFKC", member_name)

        # 2.5 URL-decode check for encoded traversal sequences like %2e%2e%2f
        if "%" in normalized_name:
            import urllib.parse
            unquoted = urllib.parse.unquote(normalized_name)
            if ".." in unquoted or unquoted.startswith(("/", "\\")):
                raise PathTraversalError(f"URL-encoded path traversal sequence rejected: '{member_name}'")

        # 3. Reject Absolute Paths and Windows Drives / UNC Shares before any stripping
        raw_check = normalized_name.strip()
        if raw_check.startswith(("/", "\\")):
            raise PathTraversalError(f"Absolute path in archive member rejected: '{member_name}'")
        if re.match(r"^[a-zA-Z]:", raw_check):
            raise PathTraversalError(f"Windows drive letter path rejected: '{member_name}'")
        if raw_check.startswith(("\\\\", "//")):
            raise PathTraversalError(f"Windows UNC share path rejected: '{member_name}'")
        if re.match(r"^[\\/]{2,}\.?[\\/]", raw_check):
            raise PathTraversalError(f"Windows device path rejected: '{member_name}'")

        # 4. Normalize path separators: Convert all backslashes to forward slashes
        clean_name = normalized_name.replace("\\", "/").strip("/")

        # Check again for drive letters or traversal after initial slash stripping
        if re.match(r"^[a-zA-Z]:", clean_name):
            raise PathTraversalError(f"Windows drive letter path rejected: '{member_name}'")

        # 5. Segment-level inspection
        segments = clean_name.split("/")
        for seg in segments:
            # Check for Windows NTFS Alternate Data Streams (colons in filename)
            if ":" in seg:
                raise PathTraversalError(
                    f"Forbidden Windows Alternate Data Stream (ADS) in member: '{member_name}'"
                )

            # Check for Windows reserved device names at ANY directory level
            if WINDOWS_RESERVED_BASE.match(seg):
                raise PathTraversalError(
                    f"Forbidden Windows reserved device name in archive member: '{seg}' in '{member_name}'"
                )

            # Check for trailing dots or spaces which Windows silently strips
            if seg not in (".", "..") and seg.endswith((".", " ")):
                raise PathTraversalError(
                    f"Prohibited trailing dot or space in path segment: '{seg}' in '{member_name}'"
                )

        # 6. Canonical Path Invariant Resolution
        canonical_root = extract_to.resolve()
        target_path = (canonical_root / clean_name).resolve()

        # Invariant Verification 1: commonpath containment
        try:
            common = os.path.commonpath([str(canonical_root), str(target_path)])
            if common != str(canonical_root):
                raise PathTraversalError(
                    f"Path traversal attempt blocked: member '{member_name}' resolves to '{target_path}' outside root '{canonical_root}'"
                )
        except ValueError:
            # On Windows, different drive letters will raise ValueError in commonpath
            raise PathTraversalError(
                f"Path traversal attempt blocked: cross-drive escape in member '{member_name}'"
            )

        # Invariant Verification 2: relative_to containment
        try:
            rel = target_path.relative_to(canonical_root)
            if rel == Path(".") and not is_dir:
                raise PathTraversalError(f"Archive entry cannot target extraction root directly: '{member_name}'")
        except ValueError:
            raise PathTraversalError(
                f"Path traversal attempt blocked: member '{member_name}' escapes '{canonical_root}'"
            )

        # Invariant Verification 3: Parent Directory Symlink Traversal Verification
        # Ensure no ancestor directory already present on disk is a symlink
        curr = canonical_root
        for part in rel.parts[:-1]:
            curr = curr / part
            if curr.is_symlink():
                raise SymlinkEscapeError(
                    f"Symlink directory traversal detected in parent path '{curr}' for member '{member_name}'"
                )

        return target_path

    def _check_nested_extension(self, path: Path, member_name: str) -> None:
        """Reject unpermitted nested archives by extension."""
        if self.allow_nested:
            return
        name_lower = path.name.lower()
        for ext in NESTED_ARCHIVE_EXTS:
            if name_lower.endswith(ext):
                raise NestedArchiveError(
                    f"Nested archive rejected: '{member_name}'. Nested archives are disabled to prevent recursive bombs."
                )

    def _check_magic_bytes_for_nested(self, chunk: bytes, member_name: str) -> None:
        """Inspect initial payload bytes to detect disguised nested archives."""
        if self.allow_nested or not chunk:
            return
        for magic, name in ARCHIVE_MAGIC_SIGNATURES:
            if chunk.startswith(magic):
                raise NestedArchiveError(
                    f"Disguised nested {name} archive detected via magic bytes in member '{member_name}'."
                )

    def extract_zip(self, zip_path: Path, extract_to: Path) -> List[Path]:
        """
        Safely extract a ZIP archive under strict canonical security bounds.
        """
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

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                infolist = zf.infolist()

                # Phase 1: Pre-flight Header Validation
                for info in infolist:
                    if not info.is_dir():
                        file_count += 1
                        if file_count > self.max_files_count:
                            raise DecompressionBombError(
                                f"Archive exceeds maximum file count limit ({self.max_files_count} files)."
                            )

                    # Negative or corrupted size check
                    if info.file_size < 0 or info.compress_size < 0:
                        raise MalformedArchiveError(f"Negative or corrupted file size in entry '{info.filename}'.")

                    if info.file_size > self.max_entry_size:
                        raise DecompressionBombError(
                            f"Archive entry '{info.filename}' ({info.file_size} bytes) exceeds entry limit ({self.max_entry_size} bytes)."
                        )

                    total_uncompressed += info.file_size
                    if total_uncompressed > self.max_total_bytes:
                        raise DecompressionBombError(
                            f"Total uncompressed size ({total_uncompressed} bytes) exceeds limit ({self.max_total_bytes} bytes)."
                        )

                    # Symlink detection in ZIP format (Unix mode in external_attr)
                    mode = info.external_attr >> 16
                    if stat.S_ISLNK(mode) and not self.allow_symlinks:
                        raise SymlinkEscapeError(
                            f"Symlink entry in ZIP archive rejected: '{info.filename}'"
                        )

                # Compression ratio check across archive
                overall_ratio = total_uncompressed / max(compressed_size, 1)
                if overall_ratio > self.max_compression_ratio and total_uncompressed >= (1024 * 1024):
                    raise DecompressionBombError(
                        f"Excessive compression ratio ({overall_ratio:.1f}:1) exceeds limit ({self.max_compression_ratio}:1). Possible zip bomb."
                    )

                # Phase 2: Extraction Loop with Streaming Verification
                running_bytes = 0
                for info in infolist:
                    if info.is_dir():
                        dir_target = self._validate_path_containment(info.filename, extract_to, is_dir=True)
                        dir_target.mkdir(parents=True, exist_ok=True)
                        continue

                    target_path = self._validate_path_containment(info.filename, extract_to, is_dir=False)
                    self._check_nested_extension(target_path, info.filename)

                    target_path.parent.mkdir(parents=True, exist_ok=True)

                    # Stream extraction while enforcing dynamic byte caps
                    with zf.open(info, "r") as source:
                        bytes_written = 0
                        first_chunk = True
                        with open(target_path, "wb") as target:
                            while chunk := source.read(65536):
                                if first_chunk:
                                    self._check_magic_bytes_for_nested(chunk, info.filename)
                                    first_chunk = False

                                bytes_written += len(chunk)
                                running_bytes += len(chunk)

                                if bytes_written > self.max_entry_size:
                                    target_path.unlink(missing_ok=True)
                                    raise DecompressionBombError(
                                        f"Decompressed size of entry '{info.filename}' exceeded entry limit during extraction."
                                    )

                                if running_bytes > self.max_total_bytes:
                                    target_path.unlink(missing_ok=True)
                                    raise DecompressionBombError(
                                        "Global uncompressed byte budget exceeded during extraction."
                                    )

                                target.write(chunk)

                    extracted_files.append(target_path)

        except (zipfile.BadZipFile, zlib.error, struct.error, EOFError) as e:
            raise MalformedArchiveError(f"Corrupt or malformed ZIP archive: {e}")

        return extracted_files

    def extract_tar(self, tar_path: Path, extract_to: Path) -> List[Path]:
        """
        Safely extract a TAR / TAR.GZ / TGZ / TAR.BZ2 / TAR.XZ archive under strict canonical security bounds.
        """
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

        try:
            with tarfile.open(tar_path, mode="r:*") as tar:
                for member in tar:
                    file_count += 1
                    if file_count > self.max_files_count:
                        raise DecompressionBombError(
                            f"Archive exceeds maximum file count limit ({self.max_files_count} files)."
                        )

                    # Block device nodes, FIFOs, and character devices
                    if member.isdev() or member.ischr() or member.isblk() or member.isfifo():
                        continue

                    # Directory handling
                    if member.isdir():
                        dir_target = self._validate_path_containment(member.name, extract_to, is_dir=True)
                        dir_target.mkdir(parents=True, exist_ok=True)
                        continue

                    # Validate target path containment
                    target_path = self._validate_path_containment(member.name, extract_to, is_dir=False)

                    # Symlink Handling
                    if member.issym():
                        if not self.allow_symlinks:
                            raise SymlinkEscapeError(
                                f"Symlink rejected by archive security policy: '{member.name}' -> '{member.linkname}'"
                            )

                        # Symlink target resolution and boundary containment
                        norm_linkname = unicodedata.normalize("NFKC", member.linkname).replace("\\", "/")
                        if norm_linkname.startswith(("/", "\\")) or re.match(r"^[a-zA-Z]:", norm_linkname):
                            raise SymlinkEscapeError(
                                f"Absolute symlink target rejected: '{member.name}' -> '{member.linkname}'"
                            )

                        link_target = (target_path.parent / norm_linkname).resolve()
                        try:
                            common = os.path.commonpath([str(extract_to), str(link_target)])
                            if common != str(extract_to):
                                raise SymlinkEscapeError(
                                    f"Symlink target escapes extraction root: '{member.name}' -> '{member.linkname}'"
                                )
                        except ValueError:
                            raise SymlinkEscapeError(
                                f"Symlink target cross-drive escape: '{member.name}' -> '{member.linkname}'"
                            )

                        try:
                            target_path.unlink(missing_ok=True)
                            os.symlink(member.linkname, target_path)
                            extracted_files.append(target_path)
                        except (OSError, NotImplementedError):
                            continue
                        continue

                    # Hardlink Handling
                    if member.islnk():
                        norm_linkname = unicodedata.normalize("NFKC", member.linkname).replace("\\", "/")
                        if norm_linkname.startswith(("/", "\\")) or re.match(r"^[a-zA-Z]:", norm_linkname):
                            raise HardlinkEscapeError(
                                f"Absolute hardlink target rejected: '{member.name}' -> '{member.linkname}'"
                            )

                        link_target = (target_path.parent / norm_linkname).resolve()
                        try:
                            common = os.path.commonpath([str(extract_to), str(link_target)])
                            if common != str(extract_to):
                                raise HardlinkEscapeError(
                                    f"Hardlink target escapes extraction root: '{member.name}' -> '{member.linkname}'"
                                )
                        except ValueError:
                            raise HardlinkEscapeError(
                                f"Hardlink cross-drive escape: '{member.name}' -> '{member.linkname}'"
                            )

                        # Target file must already exist inside extract_to and cannot be a symlink
                        if not link_target.exists():
                            raise HardlinkEscapeError(
                                f"Hardlink target does not exist inside extraction root: '{member.linkname}'"
                            )
                        if link_target.is_symlink():
                            raise HardlinkEscapeError(
                                f"Hardlink to symlink forbidden: '{member.linkname}'"
                            )

                        try:
                            target_path.unlink(missing_ok=True)
                            os.link(link_target, target_path)
                            extracted_files.append(target_path)
                        except (OSError, NotImplementedError):
                            continue
                        continue

                    # Nested archive extension check
                    self._check_nested_extension(target_path, member.name)

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

                    # Overall compression ratio check
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
                    first_chunk = True
                    with open(target_path, "wb") as out_f:
                        while chunk := fileobj.read(65536):
                            if first_chunk:
                                self._check_magic_bytes_for_nested(chunk, member.name)
                                first_chunk = False

                            bytes_written += len(chunk)
                            if bytes_written > self.max_entry_size:
                                target_path.unlink(missing_ok=True)
                                raise DecompressionBombError(
                                    f"Entry '{member.name}' exceeded size limit during extraction."
                                )
                            out_f.write(chunk)

                    extracted_files.append(target_path)

        except (tarfile.TarError, zlib.error, struct.error, EOFError) as e:
            raise MalformedArchiveError(f"Corrupt or malformed TAR archive: {e}")

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
    parser.add_argument("--max-files", type=int, default=10000, help="Max file count")
    parser.add_argument("--allow-nested", action="store_true", help="Allow nested archives")
    parser.add_argument("--allow-symlinks", action="store_true", help="Allow symlinks")
    args = parser.parse_args()

    guard = ArchiveSecurityGuard(
        max_total_bytes=args.max_size_mb * 1024 * 1024,
        max_entry_size=args.max_entry_mb * 1024 * 1024,
        max_files_count=args.max_files,
        allow_nested=args.allow_nested,
        allow_symlinks=args.allow_symlinks,
    )

    archive_path = Path(args.archive)
    dest_path = Path(args.destination)

    try:
        if args.action == "extract":
            extracted = guard.extract(archive_path, dest_path)
            print(f">> [SUCCESS] Extracted {len(extracted)} files safely into {dest_path}")
            return 0
        elif args.action == "validate":
            with tempfile.TemporaryDirectory(prefix="ecdat_val_") as tmp_dir:
                guard.extract(archive_path, Path(tmp_dir))
            print(f">> [PASS] Archive {archive_path} validated cleanly without security violations.")
            return 0
    except (ArchiveSecurityError, FileNotFoundError, OSError) as e:
        print(f"::error::Archive Security Rejection: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
