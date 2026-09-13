"""
ECDAT Secure Filesystem Analyzer Engine (Phase 4.4)
Coordinates safe directory traversal, security guards, asset detectors, and CBOM generation.
"""

import os
import json
import time
from pathlib import Path
from typing import Optional, List, Dict, Any

from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property

from scanners.filesystem.containment import FilesystemSecurityGuard, ContainmentViolationError
from scanners.filesystem.models import FilesystemCryptoAsset, FilesystemAssetType, FilesystemScanReport
from scanners.filesystem.detectors import FilesystemAssetDetector


class FilesystemScanner:
    """
    Secure filesystem scanner enforcing scan-root containment, symlink escape protection,
    device abuse prevention, giant file skipping, and graceful permission handling.
    """

    def __init__(
        self,
        scan_root: str,
        follow_symlinks: bool = False,
        max_file_size_bytes: int = 10 * 1024 * 1024,  # 10 MB
        max_total_bytes: int = 2 * 1024 * 1024 * 1024,  # 2 GB
        max_files_count: int = 50_000,
        content_sample_size: int = 1024 * 1024,  # 1 MB sample for signature matching
    ):
        self.root_path = Path(scan_root).resolve()
        self.guard = FilesystemSecurityGuard(
            scan_root=self.root_path,
            follow_symlinks=follow_symlinks,
            max_file_size_bytes=max_file_size_bytes,
            max_total_bytes=max_total_bytes,
            max_files_count=max_files_count,
        )
        self.detector = FilesystemAssetDetector()
        self.content_sample_size = content_sample_size

    def scan(self) -> FilesystemScanReport:
        """
        Executes the secure filesystem discovery walk.
        """
        start_time = time.time()
        report = FilesystemScanReport(scan_root=str(self.root_path))

        directories_to_visit: List[Path] = [self.root_path]

        while directories_to_visit:
            current_dir = directories_to_visit.pop(0)

            # Check directory safety & containment
            can_enter, skip_reason = self.guard.should_traverse_directory(current_dir)
            if not can_enter:
                if "CONTAINMENT_VIOLATION" in (skip_reason or ""):
                    report.skipped_containment_violations += 1
                    report.security_warnings.append(f"Containment violation blocked on directory: {current_dir}")
                elif "SYMLINK_ESCAPE" in (skip_reason or ""):
                    report.skipped_symlinks += 1
                    report.security_warnings.append(f"Symlink escape blocked on directory: {current_dir}")
                elif "PERMISSION_ERROR" in (skip_reason or ""):
                    report.permission_denied_paths.append(str(current_dir))
                continue

            report.directories_scanned += 1

            # Traverse directory entries safely
            try:
                with os.scandir(current_dir) as it:
                    for entry in it:
                        entry_path = Path(entry.path)

                        try:
                            is_symlink = entry.is_symlink()
                        except (PermissionError, OSError):
                            is_symlink = False

                        # Symlink escape protection
                        if is_symlink:
                            if not self.guard.follow_symlinks:
                                report.skipped_symlinks += 1
                                continue
                            try:
                                target = entry_path.resolve()
                                if not self.guard.is_contained(target):
                                    report.skipped_symlinks += 1
                                    report.security_warnings.append(
                                        f"Symlink escape blocked: {entry_path} -> {target}"
                                    )
                                    continue
                            except (OSError, ValueError):
                                report.skipped_symlinks += 1
                                continue

                        try:
                            # If directory, queue for next traversal
                            if entry.is_dir(follow_symlinks=self.guard.follow_symlinks):
                                directories_to_visit.append(entry_path)
                                continue
                        except (PermissionError, OSError) as e:
                            report.permission_denied_paths.append(str(entry_path))
                            continue

                        # It's a file or link or device node
                        is_safe, file_skip_reason = self.guard.check_file_safety(entry_path)
                        if not is_safe:
                            if "CONTAINMENT_VIOLATION" in (file_skip_reason or ""):
                                report.skipped_containment_violations += 1
                                report.security_warnings.append(f"Containment violation: {entry_path}")
                            elif "SYMLINK" in (file_skip_reason or ""):
                                report.skipped_symlinks += 1
                            elif "BLOCKED_DEVICE" in (file_skip_reason or ""):
                                report.skipped_devices += 1
                            elif "GIANT_FILE" in (file_skip_reason or ""):
                                report.skipped_giant_files += 1
                            elif "PERMISSION_ERROR" in (file_skip_reason or ""):
                                report.permission_denied_paths.append(str(entry_path))
                            continue

                        # Read bounded content sample safely
                        try:
                            file_size = entry_path.stat().st_size
                            with open(entry_path, "rb") as f:
                                sample = f.read(self.content_sample_size)
                            self.guard.record_bytes_read(len(sample))
                            report.files_scanned += 1
                            report.total_bytes_scanned += len(sample)
                        except (PermissionError, OSError) as e:
                            report.permission_denied_paths.append(str(entry_path))
                            continue

                        # Relative path from scan root
                        try:
                            rel_path = str(entry_path.resolve().relative_to(self.root_path)).replace("\\", "/")
                        except ValueError:
                            rel_path = entry_path.name

                        # Inspect file for crypto assets
                        discovered_assets = self.detector.inspect_file(
                            file_path=entry_path,
                            rel_path=rel_path,
                            content_sample=sample,
                            file_size=file_size,
                        )
                        report.assets.extend(discovered_assets)

            except (PermissionError, OSError) as e:
                report.permission_denied_paths.append(str(current_dir))
                continue

        report.duration_ms = round((time.time() - start_time) * 1000, 2)
        return report


def filesystem_report_to_cbom(report: FilesystemScanReport) -> Bom:
    """
    Transforms a FilesystemScanReport into a CycloneDX 1.6 CBOM document.
    """
    bom = Bom()
    root_ref = f"fs:root/{report.scan_root.replace(':', '').replace('\\', '/').strip('/')}"

    root_comp = Component(
        type=ComponentType.APPLICATION,
        name=f"Filesystem: {report.scan_root}",
        bom_ref=root_ref,
    )
    root_comp.properties.add(Property(name="ecdat:scan_root", value=report.scan_root))
    root_comp.properties.add(Property(name="ecdat:files_scanned", value=str(report.files_scanned)))
    root_comp.properties.add(Property(name="ecdat:directories_scanned", value=str(report.directories_scanned)))
    root_comp.properties.add(Property(name="ecdat:assets_count", value=str(len(report.assets))))
    root_comp.properties.add(Property(name="ecdat:analysis_mode", value="SECURE_FILESYSTEM_CONTAINED"))

    bom.components.add(root_comp)
    dep_comps = []

    for asset in report.assets:
        asset_ref = f"fs:asset/{asset.asset_type.value}/{asset.asset_id}@{root_ref}"

        comp_type = ComponentType.CRYPTOGRAPHIC_ASSET
        comp_name = f"{asset.asset_type.value.upper()}: {asset.file_path}"
        if asset.asset_type == FilesystemAssetType.LIBRARY_INSTALLATION:
            comp_type = ComponentType.LIBRARY
            comp_name = asset.metadata.get("library_name") or comp_name
        elif asset.asset_type in (FilesystemAssetType.CRYPTO_CONFIG, FilesystemAssetType.TLS_CONFIG):
            comp_type = ComponentType.FILE

        comp = Component(
            type=comp_type,
            name=comp_name,
            bom_ref=asset_ref,
        )
        comp.properties.add(Property(name="ecdat:asset_type", value=asset.asset_type.value))
        comp.properties.add(Property(name="ecdat:file_path", value=asset.file_path))
        comp.properties.add(Property(name="ecdat:file_size", value=str(asset.file_size_bytes)))
        comp.properties.add(Property(name="ecdat:sha256", value=asset.sha256_hash))
        comp.properties.add(Property(name="ecdat:confidence", value=asset.confidence))
        comp.properties.add(Property(name="ecdat:description", value=asset.description))

        for k, v in asset.metadata.items():
            if isinstance(v, (str, int, float, bool)):
                comp.properties.add(Property(name=f"ecdat:meta:{k}", value=str(v)))
            elif isinstance(v, dict):
                comp.properties.add(Property(name=f"ecdat:meta:{k}", value=json.dumps(v)))

        bom.components.add(comp)
        dep_comps.append(comp)

    if dep_comps:
        bom.register_dependency(root_comp, dep_comps)

    return bom
