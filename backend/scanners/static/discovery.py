import os
import re
import logging
from pathlib import Path
from typing import List, Set, Dict

logger = logging.getLogger(__name__)

WINDOWS_RESERVED_NAMES = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$", re.IGNORECASE)


class FileDiscovery:
    def __init__(
        self,
        root_dir: str,
        include_exts: Set[str],
        exclude_dirs: Set[str],
        max_file_size_bytes: int,
        max_files: int = 10000,
        max_depth: int = 25,
    ):
        self.root_dir = Path(root_dir).resolve()
        self.include_exts = {ext.lower() for ext in include_exts}
        self.exclude_dirs = exclude_dirs
        self.max_file_size_bytes = max_file_size_bytes
        self.max_files = max_files
        self.max_depth = max_depth
        self.skipped_stats: Dict[str, int] = {
            "symlinks": 0,
            "outside_root": 0,
            "oversized": 0,
            "unreadable": 0,
            "binary_or_generated": 0,
            "excluded_dir": 0,
            "unsupported_ext": 0,
            "file_limit": 0,
            "max_depth_exceeded": 0,
            "reserved_name": 0,
        }

    def _is_safe_path(self, path: Path) -> bool:
        """Ensure path resolves to within the root directory (prevents path traversal)."""
        try:
            resolved = path.resolve(strict=False)
            return self.root_dir in resolved.parents or resolved == self.root_dir
        except Exception:
            return False

    def discover_files(self) -> List[Path]:
        if not self.root_dir.is_dir():
            raise ValueError(f"Root path {self.root_dir} is not a directory.")

        valid_files = []
        visited_dirs: Set[str] = set()

        for dirpath, dirnames, filenames in os.walk(self.root_dir, followlinks=False):
            current_dir = Path(dirpath)

            # Cycle / loop detection via resolved realpath
            try:
                resolved_dir = str(current_dir.resolve())
                if resolved_dir in visited_dirs:
                    dirnames[:] = []
                    continue
                visited_dirs.add(resolved_dir)
            except Exception:
                dirnames[:] = []
                continue

            # Check maximum traversal depth
            try:
                rel_parts = current_dir.relative_to(self.root_dir).parts
                depth = len(rel_parts)
                if depth > self.max_depth:
                    self.skipped_stats["max_depth_exceeded"] += 1
                    dirnames[:] = []  # Do not descend further into deeply nested directory bomb
                    continue
            except Exception:
                dirnames[:] = []
                continue

            # Remove excluded dirs and symlinks in-place to prevent os.walk from entering them
            dirnames[:] = [d for d in dirnames if d not in self.exclude_dirs and not (current_dir / d).is_symlink()]

            for d in list(dirnames):
                if d in self.exclude_dirs:
                    self.skipped_stats["excluded_dir"] += 1

            for filename in filenames:
                # Reject null bytes in filename
                if "\x00" in filename:
                    self.skipped_stats["unreadable"] += 1
                    continue

                # Filter Windows reserved device names (CON, PRN, AUX, NUL, etc.)
                if WINDOWS_RESERVED_NAMES.match(filename):
                    self.skipped_stats["reserved_name"] += 1
                    continue

                file_path = current_dir / filename

                # Reject symlinks to prevent loops and root escape
                if file_path.is_symlink():
                    self.skipped_stats["symlinks"] += 1
                    continue

                if not self._is_safe_path(file_path):
                    self.skipped_stats["outside_root"] += 1
                    continue

                if file_path.suffix.lower() not in self.include_exts:
                    self.skipped_stats["unsupported_ext"] += 1
                    continue

                try:
                    if len(valid_files) >= self.max_files:
                        self.skipped_stats["file_limit"] += 1
                        continue
                    stat = file_path.stat()
                    if stat.st_size > self.max_file_size_bytes:
                        self.skipped_stats["oversized"] += 1
                        continue

                    if not os.access(file_path, os.R_OK):
                        self.skipped_stats["unreadable"] += 1
                        continue

                    valid_files.append(file_path)
                except Exception:
                    self.skipped_stats["unreadable"] += 1

        return valid_files
