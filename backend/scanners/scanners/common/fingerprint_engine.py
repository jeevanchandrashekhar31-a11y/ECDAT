"""
ECDAT Multi-Dimensional Fingerprinting Engine (Phase 21.2)

Computes composite fingerprints across:
1. File Content Hashes (SHA-256 per source file)
2. Dependency Manifests & Lockfiles (composite SHA-256)
3. Scanner Configuration Parameters (canonical JSON SHA-256)
4. Scan Engine Version & Rule Logic (version + rule definitions SHA-256)
5. Policy Version & Compliance Rules (policy-as-code SHA-256)

Combines into an immutable Environment Digest that guarantees zero stale results:
If engine rules, scanner configuration, or policies change, stale cached results
are automatically invalidated.
"""

from dataclasses import asdict, dataclass, field
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Known dependency manifests and lockfiles across ecosystems
DEPENDENCY_MANIFEST_NAMES = {
    "package.json",
    "package-lock.json",
    "requirements.txt",
    "requirements.lock",
    "requirements-lock.txt",
    "Pipfile.lock",
    "pyproject.toml",
    "go.mod",
    "go.sum",
    "pom.xml",
    "build.gradle",
    "Cargo.toml",
    "Cargo.lock",
    "Gemfile.lock",
    "composer.lock",
}

# Default engine version identifier
SCAN_ENGINE_VERSION = "2.1.0-perf"


def compute_file_sha256(file_path: Path) -> str:
    """Computes streaming SHA-256 hash of a file."""
    sha = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                sha.update(chunk)
        return sha.hexdigest()
    except OSError:
        return ""


def compute_bytes_sha256(data: bytes) -> str:
    """Computes SHA-256 hash of in-memory byte buffer."""
    return hashlib.sha256(data).hexdigest()


def compute_canonical_dict_hash(data: Dict[str, Any]) -> str:
    """Computes deterministic SHA-256 hash of a dictionary."""
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass
class ScanFingerprints:
    engine_version: str = SCAN_ENGINE_VERSION
    engine_fingerprint: str = ""
    policy_fingerprint: str = ""
    config_fingerprint: str = ""
    dependency_fingerprint: str = ""
    environment_digest: str = ""
    dependency_files_tracked: List[str] = field(default_factory=list)
    policy_files_tracked: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FingerprintEngine:
    """
    Coordinates multi-dimensional fingerprint generation and stale-result invalidation.
    """

    def __init__(self, root_dir: Path, rules_dir: Optional[Path] = None):
        self.root_dir = Path(root_dir).resolve()
        self.rules_dir = Path(rules_dir).resolve() if rules_dir else REPO_ROOT / "rules"

    def compute_engine_fingerprint(self, extra_components: Optional[List[str]] = None) -> str:
        """
        Computes SHA-256 digest of scanner engine logic, rule definitions, and adapters.
        Ensures any code change to regexes, AST rules, or scanner logic invalidates cache.
        """
        sha = hashlib.sha256()
        sha.update(SCAN_ENGINE_VERSION.encode("utf-8"))

        # Include core scanner source hashes
        static_dir = REPO_ROOT / "scanners" / "static"
        if static_dir.exists():
            for root, _, files in sorted(os.walk(static_dir)):
                for f in sorted(files):
                    if f.endswith(".py"):
                        fp = Path(root) / f
                        sha.update(f.encode("utf-8"))
                        sha.update(compute_file_sha256(fp).encode("utf-8"))

        if extra_components:
            for item in sorted(extra_components):
                sha.update(item.encode("utf-8"))

        return sha.hexdigest()

    def compute_policy_fingerprint(
        self, policy_files: Optional[List[Path]] = None, policy_profile: Optional[str] = None
    ) -> Tuple[str, List[str]]:
        """
        Computes SHA-256 digest of active policy-as-code files and compliance catalogs.
        """
        sha = hashlib.sha256()
        tracked_files: List[str] = []

        if policy_files is None:
            # Discover standard policy files
            candidate_files = [
                self.rules_dir / "policy_as_code.json",
                self.rules_dir / "compliance_catalog.json",
                self.rules_dir / "security_exceptions.json",
                self.rules_dir / "policy_profiles.json",
                self.rules_dir / "static_rules.json",
            ]
            policy_files = [p for p in candidate_files if p.exists()]

        for pf in sorted(policy_files):
            rel = str(pf.relative_to(REPO_ROOT)).replace("\\", "/") if pf.is_relative_to(REPO_ROOT) else pf.name
            tracked_files.append(rel)
            sha.update(rel.encode("utf-8"))
            sha.update(compute_file_sha256(pf).encode("utf-8"))

        if policy_profile:
            sha.update(f"profile:{policy_profile}".encode("utf-8"))

        return sha.hexdigest(), tracked_files

    def compute_config_fingerprint(self, config_dict: Dict[str, Any]) -> str:
        """
        Computes canonical SHA-256 digest of effective scanner runtime configuration.
        """
        # Strip transient runtime paths or output artifact paths that don't affect scan logic
        cleaned = {}
        excluded_keys = {"output", "output_sarif", "temp_dir", "cache_dir", "concurrency"}
        for k, v in config_dict.items():
            if k in excluded_keys:
                continue
            if isinstance(v, set):
                cleaned[k] = sorted(list(v))
            else:
                cleaned[k] = v
        return compute_canonical_dict_hash(cleaned)

    def compute_dependency_fingerprint(self) -> Tuple[str, List[str]]:
        """
        Scans target root for lockfiles and manifests, computing a composite digest.
        """
        sha = hashlib.sha256()
        tracked_manifests: List[str] = []

        for root, _, files in sorted(os.walk(self.root_dir)):
            # Skip VCS / node_modules when locating dependencies
            if ".git" in root or "node_modules" in root or ".venv" in root:
                continue
            for f in sorted(files):
                if f in DEPENDENCY_MANIFEST_NAMES:
                    fpath = Path(root) / f
                    try:
                        rel = str(fpath.relative_to(self.root_dir)).replace("\\", "/")
                        tracked_manifests.append(rel)
                        sha.update(rel.encode("utf-8"))
                        sha.update(compute_file_sha256(fpath).encode("utf-8"))
                    except OSError:
                        pass

        if not tracked_manifests:
            sha.update(b"NO_DEPENDENCY_MANIFESTS_PRESENT")

        return sha.hexdigest(), tracked_manifests

    def generate_composite_fingerprints(
        self,
        config_dict: Dict[str, Any],
        policy_files: Optional[List[Path]] = None,
        policy_profile: Optional[str] = None,
    ) -> ScanFingerprints:
        """
        Generates full multi-dimensional fingerprint vector and global Environment Digest.
        """
        eng_fp = self.compute_engine_fingerprint()
        pol_fp, pol_tracked = self.compute_policy_fingerprint(policy_files, policy_profile)
        cfg_fp = self.compute_config_fingerprint(config_dict)
        dep_fp, dep_tracked = self.compute_dependency_fingerprint()

        # Environment Digest combines all 4 macro vectors
        env_sha = hashlib.sha256()
        env_sha.update(eng_fp.encode("utf-8"))
        env_sha.update(pol_fp.encode("utf-8"))
        env_sha.update(cfg_fp.encode("utf-8"))
        env_sha.update(dep_fp.encode("utf-8"))
        env_digest = env_sha.hexdigest()

        return ScanFingerprints(
            engine_version=SCAN_ENGINE_VERSION,
            engine_fingerprint=eng_fp,
            policy_fingerprint=pol_fp,
            config_fingerprint=cfg_fp,
            dependency_fingerprint=dep_fp,
            environment_digest=env_digest,
            dependency_files_tracked=dep_tracked,
            policy_files_tracked=pol_tracked,
        )

    @staticmethod
    def is_environment_stale(
        cached_fingerprints: Dict[str, Any], current_fingerprints: ScanFingerprints
    ) -> Tuple[bool, List[str]]:
        """
        Validates whether cached state has become stale due to any fingerprint drift.
        Returns (is_stale, list_of_drift_reasons).
        """
        reasons = []
        if cached_fingerprints.get("engine_fingerprint") != current_fingerprints.engine_fingerprint:
            reasons.append("Scan engine version or scanner rule logic changed")
        if cached_fingerprints.get("policy_fingerprint") != current_fingerprints.policy_fingerprint:
            reasons.append("Security policy rules, compliance catalog, or exceptions changed")
        if cached_fingerprints.get("config_fingerprint") != current_fingerprints.config_fingerprint:
            reasons.append("Scanner configuration parameters changed")
        if cached_fingerprints.get("dependency_fingerprint") != current_fingerprints.dependency_fingerprint:
            reasons.append("Dependency manifests or lockfiles changed")
        if cached_fingerprints.get("environment_digest") != current_fingerprints.environment_digest:
            if not reasons:
                reasons.append("Composite environment digest mismatch")

        return len(reasons) > 0, reasons
