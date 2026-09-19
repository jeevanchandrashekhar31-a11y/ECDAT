#!/usr/bin/env python3
"""
ECDAT Clean Archive Utility
Creates a clean, production-ready ZIP archive of ECDAT.

Everything tracked by git is included except:
- .git/
- node_modules/
- __pycache__/
- .venv/
- dist/
- .keys/
- .env (and .env.* except .example)
- artifacts/uploads/
- artifacts/security/
- security_evidence/

CRITICAL INVARIANT:
Nothing under tests/ or rules/ may ever be excluded.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import List, Set

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "ecdat_clean_package.zip"

EXCLUDED_DIR_PATTERNS = (
    ".git/",
    "node_modules/",
    "__pycache__/",
    ".venv/",
    "venv/",
    "dist/",
    ".keys/",
    "artifacts/uploads/",
    "artifacts/security/",
    "security_evidence/",
)

# Explicit denylist for defense-in-depth against credential and secret leaks
# Enforced on every path before it is written to the zip, regardless of git tracking
EXPLICIT_DENYLIST_PATHS = (
    ".keys",
    ".keys/",
)

EXPLICIT_DENYLIST_EXTENSIONS = (
    ".pem",
    ".key",
    ".p12",
    ".pfx",
)


def is_excluded(rel_path_str: str) -> bool:
    """
    Evaluates whether a relative file path should be excluded from the clean package.
    Enforces defense-in-depth exclusions for keys, credentials, and env files regardless
    of git tracking status.
    """
    posix_path = rel_path_str.replace("\\", "/").strip("/")
    parts = posix_path.split("/")
    filename = parts[-1]

    # Defense-in-depth denylist: enforced regardless of git tracking
    # 1. .keys/ directory and paths
    if ".keys" in parts or posix_path.startswith(".keys/") or "/.keys/" in posix_path:
        return True

    # 2. .env and .env.* files (except *.example)
    if filename == ".env" or (filename.startswith(".env.") and not filename.endswith(".example")):
        return True

    # 3. Private key and certificate extensions (*.pem, *.key, *.p12, *.pfx)
    if any(filename.endswith(ext) for ext in EXPLICIT_DENYLIST_EXTENSIONS):
        return True

    # CRITICAL INVARIANT: Nothing under tests/ or rules/ may ever be excluded.
    if posix_path.startswith(("tests/", "rules/")):
        return False

    # Check directory exclusion patterns
    for pfx in EXCLUDED_DIR_PATTERNS:
        if posix_path.startswith(pfx) or f"/{pfx}" in f"/{posix_path}":
            return True

    # Python bytecode
    if filename.endswith((".pyc", ".pyo", ".pyd")):
        return True

    return False


def get_files_to_package(repo_root: Path) -> List[str]:
    """
    Determines all files to include in the archive based on git tracked files
    plus any untracked source files not matching the exclusion rules.
    """
    files_to_pack: List[str] = []
    try:
        git_out = subprocess.check_output(
            ["git", "ls-files"], cwd=str(repo_root), text=True, encoding="utf-8"
        )
        tracked = [line.strip() for line in git_out.splitlines() if line.strip()]
        for f in tracked:
            if not is_excluded(f):
                full_p = repo_root / f
                if full_p.is_symlink() or (full_p.exists() and full_p.is_file()):
                    files_to_pack.append(f)
    except Exception as err:
        print(f"[WARN] git ls-files failed ({err}); falling back to directory traversal", file=sys.stderr)
        for root, dirs, files in os.walk(repo_root):
            rel_root = Path(root).relative_to(repo_root).as_posix()
            if rel_root != "." and is_excluded(rel_root + "/"):
                dirs.clear()
                continue
            for fname in files:
                rel_f = (Path(rel_root) / fname).as_posix() if rel_root != "." else fname
                if not is_excluded(rel_f):
                    files_to_pack.append(rel_f)

    return sorted(set(files_to_pack))


def create_clean_zip(output_path: Path = DEFAULT_OUT) -> Path:
    start_time = time.time()
    output_path = output_path.resolve()
    prefix = output_path.stem if output_path.stem else "ecdat_clean_package"

    print(f">> Packaging ECDAT repository cleanly into: {output_path.name} (prefix: {prefix}/)...")

    files_to_pack = get_files_to_package(REPO_ROOT)
    file_count = 0
    total_uncompressed_bytes = 0

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=4) as zf:
        for rel_str in files_to_pack:
            # Explicit denylist checked on every path before it's written to the zip
            if is_excluded(rel_str):
                continue

            full_path = REPO_ROOT / rel_str
            if full_path == output_path:
                continue

            arcname = f"{prefix}/{rel_str}"
            try:
                if full_path.is_symlink():
                    link_target = os.readlink(full_path)
                    zi = zipfile.ZipInfo(arcname)
                    zi.create_system = 3  # Unix
                    zi.external_attr = 0o120777 << 16  # S_IFLNK | 0777
                    zf.writestr(zi, str(link_target).replace("\\", "/"))
                    file_count += 1
                elif full_path.is_file():
                    zf.write(full_path, arcname)
                    file_count += 1
                    total_uncompressed_bytes += full_path.stat().st_size
            except Exception as err:
                print(f"   [WARN] Skipping {rel_str}: {err}", file=sys.stderr)

    duration = time.time() - start_time
    zip_size_mb = output_path.stat().st_size / (1024 * 1024)
    uncompressed_mb = total_uncompressed_bytes / (1024 * 1024)

    print(f">> [SUCCESS] Archive created in {duration:.2f} seconds!")
    print(f">> Files Included: {file_count}")
    print(f">> Uncompressed Size: {uncompressed_mb:.2f} MB")
    print(f">> Clean ZIP Size:    {zip_size_mb:.2f} MB")
    print(f">> Location: {output_path}")

    # Verify against git ls-files
    if not verify_zip_against_git(output_path, REPO_ROOT, prefix=prefix):
        sys.exit(1)

    return output_path


def verify_zip_against_git(zip_path: Path, repo_root: Path, prefix: str = "ecdat_clean_package") -> bool:
    """
    Compares git ls-files against the zip manifest and prints any tracked file that was omitted.
    If any file under tests/ or rules/ is omitted, returns False (causing exit 1).
    """
    print("\n>> Verifying ZIP archive against git ls-files...")
    try:
        git_output = subprocess.check_output(
            ["git", "ls-files"], cwd=str(repo_root), text=True, encoding="utf-8"
        )
        tracked_files = set(git_output.split())
    except Exception as e:
        print(f"[ERROR] Failed to query git ls-files: {e}", file=sys.stderr)
        return False

    with zipfile.ZipFile(zip_path, "r") as zf:
        zip_names = set(zf.namelist())

    # Map zip entries to repo-relative paths by stripping prefix
    zip_manifest: Set[str] = set()
    for name in zip_names:
        if prefix and name.startswith(f"{prefix}/"):
            zip_manifest.add(name[len(prefix) + 1:])
        else:
            zip_manifest.add(name.split("/", 1)[-1])
            zip_manifest.add(name)

    # Expected in zip: all tracked files except those that match is_excluded()
    expected_tracked = {f for f in tracked_files if not is_excluded(f)}
    omitted_expected = sorted(expected_tracked - zip_manifest)
    omitted_core = [
        f for f in omitted_expected if f.startswith(("tests/", "rules/", "backend/", "frontend/", "scanners/"))
    ]

    print(f">> Tracked files in git: {len(tracked_files)}")
    print(f">> Tracked files expected in zip: {len(expected_tracked)}")
    print(f">> Tracked files omitted from zip: {len(omitted_expected)}")
    if omitted_expected:
        print("   Sample omitted tracked files:")
        for f in omitted_expected[:20]:
            print(f"     - {f}")

    if omitted_core:
        print(
            f"\n[ERROR] {len(omitted_core)} core tracked files under tests/, rules/, backend/, frontend/, scanners/ were omitted from the ZIP!",
            file=sys.stderr,
        )
        for f in omitted_core[:40]:
            print(f"   [FAIL] Missing: {f}", file=sys.stderr)
        return False

    print(">> [VERIFICATION PASSED] Zero tracked files under tests/, rules/, backend/, frontend/, scanners/ are omitted.")
    return True


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    create_clean_zip(out)
