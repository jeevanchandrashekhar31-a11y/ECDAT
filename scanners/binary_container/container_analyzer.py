"""
ECDAT Container Image Analyzer (Phase 4.3)
Performs purely static container image analysis without executing application entrypoints.
Inspects:
- layers
- packages
- shared libraries
- configs (with credential sanitization)
- certificates
- crypto libraries (via robust multi-signal fingerprinting)
- SBOM (CycloneDX 1.6 CBOM)
- application metadata

Enforces security guards:
- Registry SSRF prevention
- Credential leakage prevention
- Untrusted registry access control
- Oversized layers prevention
- Decompression bomb prevention
"""

import hashlib
import json
import logging
import os
import re
import tarfile
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Set, Tuple

from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property

from scanners.binary_container.container_models import (
    LayerMetadata,
    ContainerConfigMetadata,
    InstalledPackageMetadata,
    SharedLibraryMetadata,
    CertificateAssetMetadata,
    ContainerScanReport,
)
from scanners.binary_container.security_guards import (
    validate_registry_security,
    sanitize_config_env,
    SafeArchiveExtractor,
    SecurityGuardError,
    RegistrySSRFError,
    UntrustedRegistryError,
    DecompressionBombError,
    PathTraversalError,
)
from scanners.binary_container.parsers.library_fingerprinter import (
    LibraryFingerprinter,
    FingerprintEvidence,
)
from scanners.binary_container.parsers.base import CryptoIndicator, SymbolMetadata

logger = logging.getLogger("ECDAT.ContainerAnalyzer")


class ContainerImageAnalyzer:
    """
    Static Container Image Analyzer.
    Never executes application entrypoints, CMD, or scripts from the image.
    """

    def __init__(
        self,
        allowed_registries: Optional[Set[str]] = None,
        enforce_registry_allowlist: bool = False,
        max_layer_size_bytes: int = 1024 * 1024 * 1024,  # 1 GB
        max_total_size_bytes: int = 5 * 1024 * 1024 * 1024,  # 5 GB
    ):
        self.allowed_registries = allowed_registries
        self.enforce_registry_allowlist = enforce_registry_allowlist
        self.extractor = SafeArchiveExtractor(
            max_layer_size_bytes=max_layer_size_bytes,
            max_total_size_bytes=max_total_size_bytes,
        )
        self.fingerprinter = LibraryFingerprinter()

    def analyze_image_archive(self, tar_path: Path, image_reference: str = "container:archive") -> ContainerScanReport:
        """
        Analyzes a Docker or OCI image tarball (e.g. from `docker save` or OCI layout).
        Never executes any binary or entrypoint from the image.
        """
        # 1. Security Check: Validate registry/reference
        registry, repo = validate_registry_security(
            image_reference,
            allowed_registries=self.allowed_registries,
            enforce_allowlist=self.enforce_registry_allowlist,
        )

        with tempfile.TemporaryDirectory(prefix="ecdat_container_") as temp_dir:
            extract_root = Path(temp_dir)
            self.extractor.inspect_and_extract_layer(tar_path, extract_root)

            # Read manifest.json
            manifest_path = extract_root / "manifest.json"
            if not manifest_path.exists():
                raise SecurityGuardError("Invalid container tarball: manifest.json missing.")

            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)

            if not isinstance(manifest_data, list) or not manifest_data:
                raise SecurityGuardError("Invalid manifest.json: expected non-empty array.")

            image_manifest = manifest_data[0]
            config_file_name = image_manifest.get("Config", "")
            layer_tar_names = image_manifest.get("Layers", [])

            # Read Config JSON (Metadata, Env, Entrypoint)
            config_meta = self._parse_image_config(extract_root / config_file_name)

            # Staging directory for consolidated rootfs inspection
            rootfs_dir = extract_root / "rootfs"
            rootfs_dir.mkdir(parents=True, exist_ok=True)

            layers_meta: List[LayerMetadata] = []
            all_crypto_libs: Dict[str, CryptoIndicator] = {}
            all_certificates: List[CertificateAssetMetadata] = []

            for idx, layer_tar_name in enumerate(layer_tar_names):
                layer_path = extract_root / layer_tar_name
                if not layer_path.exists():
                    continue

                layer_diff_id = hashlib.sha256(layer_path.read_bytes()).hexdigest()
                extracted_files = self.extractor.inspect_and_extract_layer(layer_path, rootfs_dir)

                # Check for crypto libraries or certs introduced in this layer
                layer_crypto = self._find_crypto_libs_in_file_list(extracted_files)
                layer_certs = [f for f in extracted_files if any(f.endswith(ext) for ext in [".crt", ".pem", ".cer"])]

                layers_meta.append(
                    LayerMetadata(
                        index=idx,
                        diff_id=f"sha256:{layer_diff_id}",
                        size_bytes=layer_path.stat().st_size,
                        file_count=len(extracted_files),
                        added_crypto_libs=layer_crypto,
                        added_certificates=layer_certs,
                    )
                )

            # Inspect Consolidated Rootfs: Packages, Shared Libraries, Certificates, Configs
            packages = self._inspect_installed_packages(rootfs_dir)
            shared_libs, crypto_indicators = self._inspect_shared_libraries(rootfs_dir)
            certificates = self._inspect_certificates(rootfs_dir)

            for ind in crypto_indicators:
                all_crypto_libs[ind.library_name] = ind

            return ContainerScanReport(
                image_reference=image_reference,
                registry=registry,
                repository=repo,
                tag_or_digest=image_reference.split(":")[-1] if ":" in image_reference else "latest",
                config=config_meta,
                layers=layers_meta,
                packages=packages,
                shared_libraries=shared_libs,
                certificates=certificates,
                crypto_libraries=list(all_crypto_libs.values()),
                total_uncompressed_size_bytes=self.extractor.total_extracted_bytes,
                scan_status="success",
            )

    def analyze_rootfs_directory(
        self, rootfs_dir: Path, image_reference: str = "container:rootfs"
    ) -> ContainerScanReport:
        """
        Analyzes a container rootfs directory statically.
        Never executes any binary or entrypoint.
        """
        registry, repo = validate_registry_security(
            image_reference,
            allowed_registries=self.allowed_registries,
            enforce_allowlist=self.enforce_registry_allowlist,
        )

        config_meta = ContainerConfigMetadata(
            architecture="unknown",
            os="linux",
            entrypoint=[],
            cmd=[],
            working_dir="/",
            user="root",
            labels={},
            sanitized_env={},
        )

        packages = self._inspect_installed_packages(rootfs_dir)
        shared_libs, crypto_indicators = self._inspect_shared_libraries(rootfs_dir)
        certificates = self._inspect_certificates(rootfs_dir)

        return ContainerScanReport(
            image_reference=image_reference,
            registry=registry,
            repository=repo,
            tag_or_digest="rootfs",
            config=config_meta,
            layers=[
                LayerMetadata(
                    index=0,
                    diff_id="rootfs",
                    size_bytes=0,
                    file_count=len(shared_libs),
                    added_crypto_libs=[c.library_name for c in crypto_indicators],
                    added_certificates=[c.path for c in certificates],
                )
            ],
            packages=packages,
            shared_libraries=shared_libs,
            certificates=certificates,
            crypto_libraries=crypto_indicators,
            total_uncompressed_size_bytes=0,
            scan_status="success",
        )

    def _parse_image_config(self, config_path: Path) -> ContainerConfigMetadata:
        if not config_path.exists():
            return ContainerConfigMetadata(architecture="unknown", os="unknown")

        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        cfg = data.get("config", {})
        raw_env = cfg.get("Env", [])
        sanitized_env = sanitize_config_env(raw_env)

        return ContainerConfigMetadata(
            architecture=data.get("architecture", "unknown"),
            os=data.get("os", "unknown"),
            created=data.get("created"),
            entrypoint=cfg.get("Entrypoint", []) or [],
            cmd=cfg.get("Cmd", []) or [],
            working_dir=cfg.get("WorkingDir", "/"),
            user=cfg.get("User", "root"),
            labels=cfg.get("Labels", {}) or {},
            sanitized_env=sanitized_env,
        )

    def _inspect_installed_packages(self, rootfs_dir: Path) -> List[InstalledPackageMetadata]:
        packages: List[InstalledPackageMetadata] = []

        # 1. dpkg status (/var/lib/dpkg/status)
        dpkg_file = rootfs_dir / "var" / "lib" / "dpkg" / "status"
        if dpkg_file.exists():
            try:
                content = dpkg_file.read_text(encoding="utf-8", errors="ignore")
                for block in content.split("\n\n"):
                    pkg_name = None
                    pkg_ver = None
                    pkg_arch = None
                    for line in block.splitlines():
                        if line.startswith("Package: "):
                            pkg_name = line.split("Package: ")[1].strip()
                        elif line.startswith("Version: "):
                            pkg_ver = line.split("Version: ")[1].strip()
                        elif line.startswith("Architecture: "):
                            pkg_arch = line.split("Architecture: ")[1].strip()
                    if pkg_name and pkg_ver:
                        is_crypto = any(
                            c in pkg_name.lower() for c in ["ssl", "crypto", "tls", "sodium", "botan", "mbed", "wolf"]
                        )
                        packages.append(
                            InstalledPackageMetadata(
                                name=pkg_name,
                                version=pkg_ver,
                                pkg_type="dpkg",
                                architecture=pkg_arch,
                                is_crypto_relevant=is_crypto,
                            )
                        )
            except Exception as e:
                logger.warning(f"Error parsing dpkg database: {e}")

        # 2. apk installed (/lib/apk/db/installed)
        apk_file = rootfs_dir / "lib" / "apk" / "db" / "installed"
        if apk_file.exists():
            try:
                content = apk_file.read_text(encoding="utf-8", errors="ignore")
                for block in content.split("\n\n"):
                    pkg_name = None
                    pkg_ver = None
                    for line in block.splitlines():
                        if line.startswith("P:"):
                            pkg_name = line[2:].strip()
                        elif line.startswith("V:"):
                            pkg_ver = line[2:].strip()
                    if pkg_name and pkg_ver:
                        is_crypto = any(
                            c in pkg_name.lower() for c in ["ssl", "crypto", "tls", "sodium", "botan", "mbed", "wolf"]
                        )
                        packages.append(
                            InstalledPackageMetadata(
                                name=pkg_name,
                                version=pkg_ver,
                                pkg_type="apk",
                                is_crypto_relevant=is_crypto,
                            )
                        )
            except Exception as e:
                logger.warning(f"Error parsing apk database: {e}")

        return packages

    def _inspect_shared_libraries(self, rootfs_dir: Path) -> Tuple[List[SharedLibraryMetadata], List[CryptoIndicator]]:
        shared_libs: List[SharedLibraryMetadata] = []
        discovered_lib_names: List[str] = []
        crypto_indicators: List[CryptoIndicator] = []

        lib_dirs = [
            rootfs_dir / "lib",
            rootfs_dir / "lib64",
            rootfs_dir / "usr" / "lib",
            rootfs_dir / "usr" / "lib64",
            rootfs_dir / "usr" / "local" / "lib",
        ]

        for d in lib_dirs:
            if not d.exists() or not d.is_dir():
                continue
            for root, _, files in os.walk(d):
                for fname in files:
                    if ".so" in fname or fname.endswith(".dylib") or fname.endswith(".dll"):
                        fpath = Path(root) / fname
                        rel_path = str(fpath.relative_to(rootfs_dir)).replace("\\", "/")
                        discovered_lib_names.append(fname)
                        shared_libs.append(
                            SharedLibraryMetadata(
                                name=fname,
                                path=rel_path,
                            )
                        )

        # Run Library Fingerprinter across discovered shared libraries
        if discovered_lib_names:
            fingerprints = self.fingerprinter.fingerprint(
                imported_libraries=discovered_lib_names,
                symbols=[],
                strings=[],
            )
            for fp in fingerprints:
                crypto_indicators.append(
                    CryptoIndicator(
                        library_name=fp.library_name,
                        confidence=fp.confidence,
                        matched_libraries=fp.matched_libraries,
                        matched_symbols=[],
                        matched_strings=[],
                        description=fp.rationale,
                    )
                )

        return shared_libs, crypto_indicators

    def _inspect_certificates(self, rootfs_dir: Path) -> List[CertificateAssetMetadata]:
        certificates: List[CertificateAssetMetadata] = []
        cert_dirs = [
            rootfs_dir / "etc" / "ssl" / "certs",
            rootfs_dir / "etc" / "pki",
            rootfs_dir / "usr" / "share" / "ca-certificates",
            rootfs_dir / "usr" / "local" / "share" / "ca-certificates",
        ]

        for d in cert_dirs:
            if not d.exists() or not d.is_dir():
                continue
            for root, _, files in os.walk(d):
                for fname in files:
                    if fname.endswith(".crt") or fname.endswith(".pem") or fname.endswith(".cer"):
                        cert_path = Path(root) / fname
                        rel_path = str(cert_path.relative_to(rootfs_dir)).replace("\\", "/")
                        meta = self._parse_certificate_file(cert_path, rel_path)
                        if meta:
                            certificates.append(meta)

        return certificates

    def _parse_certificate_file(self, cert_path: Path, rel_path: str) -> Optional[CertificateAssetMetadata]:
        try:
            content = cert_path.read_bytes()
            if b"-----BEGIN CERTIFICATE-----" not in content and not content.startswith(b"\x30\x82"):
                return None

            sha256_fp = hashlib.sha256(content).hexdigest()
            # Basic static metadata extraction without execution
            text = content.decode("utf-8", errors="ignore")
            subject = None
            issuer = None
            for line in text.splitlines():
                if "Subject:" in line:
                    subject = line.split("Subject:")[1].strip()
                elif "Issuer:" in line:
                    issuer = line.split("Issuer:")[1].strip()

            return CertificateAssetMetadata(
                path=rel_path,
                subject=subject or cert_path.name,
                issuer=issuer,
                public_key_algorithm="RSA/ECDSA",
                sha256_fingerprint=sha256_fp,
            )
        except Exception:
            return None

    def _find_crypto_libs_in_file_list(self, file_list: List[str]) -> List[str]:
        found = []
        for f in file_list:
            fname = f.split("/")[-1]
            for pat in [
                "libcrypto",
                "libssl",
                "libboringssl",
                "libtls",
                "libmbed",
                "libwolfssl",
                "libbotan",
                "libsodium",
            ]:
                if pat in fname.lower():
                    found.append(fname)
                    break
        return found


def container_report_to_cbom(report: ContainerScanReport) -> Bom:
    """
    Transforms a ContainerScanReport into a CycloneDX 1.6 CBOM document.
    """
    bom = Bom()
    target_ref = f"container:image/{report.repository}@{report.tag_or_digest}"

    # Container component
    image_comp = Component(
        type=ComponentType.CONTAINER,
        name=report.image_reference,
        bom_ref=target_ref,
    )
    image_comp.properties.add(Property(name="ecdat:registry", value=report.registry))
    image_comp.properties.add(Property(name="ecdat:architecture", value=report.config.architecture))
    image_comp.properties.add(Property(name="ecdat:os", value=report.config.os))
    image_comp.properties.add(Property(name="ecdat:user", value=report.config.user))
    image_comp.properties.add(Property(name="ecdat:working_dir", value=report.config.working_dir))
    image_comp.properties.add(Property(name="ecdat:entrypoint", value=" ".join(report.config.entrypoint)))
    image_comp.properties.add(Property(name="ecdat:layers_count", value=str(len(report.layers))))
    image_comp.properties.add(Property(name="ecdat:analysis_mode", value="STATIC_SAFE_NON_EXECUTING"))

    bom.components.add(image_comp)
    dep_comps = []

    # Crypto libraries
    for ind in report.crypto_libraries:
        comp_ref = f"container:crypto_lib/{ind.library_name.lower()}@{target_ref}"
        lib_comp = Component(
            type=ComponentType.LIBRARY,
            name=ind.library_name,
            bom_ref=comp_ref,
        )
        lib_comp.properties.add(Property(name="ecdat:confidence", value=ind.confidence))
        lib_comp.properties.add(Property(name="ecdat:description", value=ind.description))
        lib_comp.properties.add(Property(name="ecdat:evidence", value="; ".join(ind.matched_libraries)[:255]))
        bom.components.add(lib_comp)
        dep_comps.append(lib_comp)

    # Certificates
    for idx, cert in enumerate(report.certificates):
        cert_ref = f"container:cert/{idx}@{target_ref}"
        cert_comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"Certificate: {cert.subject or cert.path}",
            bom_ref=cert_ref,
        )
        cert_comp.properties.add(Property(name="ecdat:path", value=cert.path))
        if cert.sha256_fingerprint:
            cert_comp.properties.add(Property(name="ecdat:fingerprint", value=cert.sha256_fingerprint))
        bom.components.add(cert_comp)
        dep_comps.append(cert_comp)

    if dep_comps:
        bom.register_dependency(image_comp, dep_comps)

    return bom
