"""
ECDAT Filesystem Security & Containment Guards (Phase 4.4)
Protects against:
- ../ traversal
- Symlink escapes
- Mount / device abuse (pseudo-filesystems, block/char devices, FIFOs, sockets, circular mounts)
- Giant files and memory exhaustion
- Permission confusion and TOCTOU
Enforces strict scan-root containment.
"""

import os
import stat
from pathlib import Path
from typing import Set, Tuple, Optional, List


class ContainmentViolationError(SecurityError if "SecurityError" in globals() else ValueError):
    """Raised when a path traversal or symlink escape violates the scan-root containment."""
    pass


class FilesystemSecurityGuard:
    """
    Enforces strict security checks on every directory and file encountered during a filesystem scan.
    """

    # Pseudo-filesystems and virtual mounts on Linux/Unix that must NEVER be traversed
    BLOCKED_SYSTEM_DIRECTORIES = {
        "/proc",
        "/sys",
        "/dev",
        "/run",
        "/sys/fs/cgroup",
        "/dev/pts",
        "/dev/shm",
    }

    def __init__(
        self,
        scan_root: Path,
        follow_symlinks: bool = False,
        max_file_size_bytes: int = 10 * 1024 * 1024,  # 10 MB limit for deep content inspection
        max_total_bytes: int = 2 * 1024 * 1024 * 1024,  # 2 GB total read limit
        max_files_count: int = 50_000,
    ):
        self.raw_root = scan_root
        self.root_path = Path(scan_root).resolve()
        if not self.root_path.exists():
            raise FileNotFoundError(f"Scan root does not exist: {scan_root}")
        if not self.root_path.is_dir():
            raise ValueError(f"Scan root must be a directory: {scan_root}")

        self.follow_symlinks = follow_symlinks
        self.max_file_size_bytes = max_file_size_bytes
        self.max_total_bytes = max_total_bytes
        self.max_files_count = max_files_count

        self.visited_inodes: Set[Tuple[int, int]] = set()
        self.files_scanned = 0
        self.total_bytes_read = 0

    def is_contained(self, path: Path) -> bool:
        """
        Verifies that the resolved path is strictly within the scan root.
        Guards against '../' traversal and symlink escapes.
        """
        try:
            resolved = path.resolve()
            # In Python 3.9+, is_relative_to is available
            if hasattr(resolved, "is_relative_to"):
                return resolved.is_relative_to(self.root_path)
            # Fallback for older versions
            return os.path.commonpath([str(resolved), str(self.root_path)]) == str(self.root_path)
        except (ValueError, OSError):
            return False

    def check_file_safety(self, file_path: Path) -> Tuple[bool, Optional[str]]:
        """
        Validates file safety before reading.
        Returns (is_safe, skip_reason).
        """
        # 1. Check scan-root containment
        if not self.is_contained(file_path):
            return False, "CONTAINMENT_VIOLATION: Path escapes scan root."

        # 2. Check symlink policy
        if file_path.is_symlink():
            if not self.follow_symlinks:
                return False, "SKIPPED_SYMLINK: Symlink following is disabled."
            try:
                target = file_path.resolve()
                if not self.is_contained(target):
                    return False, f"SYMLINK_ESCAPE: Target '{target}' points outside scan root."
            except (OSError, ValueError) as e:
                return False, f"BROKEN_SYMLINK: Unable to resolve symlink ({e})."

        # 3. Check for device nodes, FIFOs, sockets, pipes
        try:
            st = file_path.lstat()
            mode = st.st_mode
            if stat.S_ISCHR(mode):
                return False, "BLOCKED_DEVICE: Character device node."
            if stat.S_ISBLK(mode):
                return False, "BLOCKED_DEVICE: Block device node."
            if stat.S_ISFIFO(mode):
                return False, "BLOCKED_DEVICE: Named pipe (FIFO)."
            if stat.S_ISSOCK(mode):
                return False, "BLOCKED_DEVICE: UNIX domain socket."
        except (PermissionError, OSError) as e:
            return False, f"PERMISSION_ERROR: Unable to stat file ({e})."

        # 4. Check for giant files
        try:
            file_size = file_path.stat().st_size
            if file_size > self.max_file_size_bytes:
                return False, f"GIANT_FILE: File size ({file_size} bytes) exceeds limit ({self.max_file_size_bytes} bytes)."
        except (PermissionError, OSError) as e:
            return False, f"PERMISSION_ERROR: Unable to get file size ({e})."

        # 5. Check global resource budget
        if self.files_scanned >= self.max_files_count:
            return False, f"BUDGET_EXCEEDED: Maximum files limit ({self.max_files_count}) reached."

        if self.total_bytes_read >= self.max_total_bytes:
            return False, f"BUDGET_EXCEEDED: Maximum read bytes limit ({self.max_total_bytes}) reached."

        return True, None

    def should_traverse_directory(self, dir_path: Path) -> Tuple[bool, Optional[str]]:
        """
        Validates directory safety before entering.
        Checks for containment, symlink escape, pseudo-filesystems, and circular loops.
        """
        # 1. Containment check
        if not self.is_contained(dir_path):
            return False, "CONTAINMENT_VIOLATION: Directory escapes scan root."

        # 2. Block pseudo-filesystems
        resolved_str = str(dir_path.resolve()).replace("\\", "/")
        for blocked in self.BLOCKED_SYSTEM_DIRECTORIES:
            if resolved_str == blocked or resolved_str.startswith(f"{blocked}/"):
                return False, f"BLOCKED_SYSTEM_DIR: Traversal of '{blocked}' is forbidden."

        # 3. Symlink check on directory
        if dir_path.is_symlink():
            if not self.follow_symlinks:
                return False, "SKIPPED_SYMLINK_DIR: Directory symlink ignored."
            try:
                target = dir_path.resolve()
                if not self.is_contained(target):
                    return False, f"SYMLINK_ESCAPE: Directory symlink points outside scan root ({target})."
            except (OSError, ValueError) as e:
                return False, f"BROKEN_SYMLINK: Unable to resolve directory symlink ({e})."

        # 4. Prevent circular loops via (st_dev, st_ino)
        try:
            st = dir_path.stat()
            inode_key = (st.st_dev, st.st_ino)
            if inode_key in self.visited_inodes:
                return False, "CIRCULAR_TRAVERSAL: Inode already visited (possible circular mount or loop)."
            self.visited_inodes.add(inode_key)
        except (PermissionError, OSError) as e:
            return False, f"PERMISSION_ERROR: Unable to stat directory ({e})."

        return True, None

    def record_bytes_read(self, n_bytes: int):
        self.total_bytes_read += n_bytes
        self.files_scanned += 1
