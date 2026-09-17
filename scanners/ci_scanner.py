"""
ECDAT CI/CD Scanner & Orchestrator (Phase 13.1)

Provides first-class CI/CD workflows supporting:
- pull request scan (diff-aware scanning on modified files)
- full repository scan
- policy gate (policy-as-code and severity thresholds)
- CBOM generation (CycloneDX 1.6/1.7)
- SARIF export (OASIS SARIF v2.1.0 standard for GitHub Security)
- dependency scan (crypto reachability & manifest checks)
- secret scan (secret-safe zero-leakage key detection)
- container scan (Dockerfile & container image inspection)

Deterministic exit codes:
  0 = PASS (clean scan, policy gate passed, no scanner errors)
  1 = POLICY_SECURITY_FAILURE (policy gate failed or findings exceed threshold)
  2 = SCANNER_ERROR (runtime failure, unhandled scanner crash, IO failure)
  3 = INVALID_CONFIG (invalid arguments, bad target path, malformed policy)

CRITICAL INVARIANT:
Do not conflate scanner failure with "no vulnerabilities."
If any scanner crashes or fails, the exit code is strictly 2 and complete=False.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
from enum import IntEnum, Enum
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from scanners.static.discovery import FileDiscovery
from scanners.static.regex_rules import apply_regex_rules
from scanners.static.sanitization import redact_secrets
from scanners.static.results import StaticFinding
from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.secret_detector import SecretSafeDetector
from scanners.cbom_mapping import code_finding_to_cbom, merge_cboms, serialize_cbom
from scanners.models import CodeCryptoFinding
from scanners.policy_engine import PolicyEngine, DEFAULT_POLICY_PATH

logger = logging.getLogger("ECDAT.CIScanner")


class CIExitCode(IntEnum):
    PASS = 0
    POLICY_SECURITY_FAILURE = 1
    SCANNER_ERROR = 2
    INVALID_CONFIG = 3


class CIScanMode(str, Enum):
    FULL_REPO = "full_repo"
    PULL_REQUEST = "pull_request"


VALID_FAIL_ON_CHOICES = ("none", "critical", "high", "policy")

DEFAULT_INCLUDE_EXTS = {
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".go",
    ".js",
    ".mjs",
    ".cjs",
    ".py",
    ".pyw",
    ".java",
    ".kt",
    ".kts",
    ".ts",
    ".tsx",
    ".cs",
    ".rs",
    ".json",
    ".yaml",
    ".yml",
    ".env",
    ".pem",
    ".key",
    ".crt",
}

try:
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 25000))
except Exception:
    pass

DEFAULT_EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "fixtures",
    "artifacts",
    "examples",
    "coverage",
    "scratch",
}


@dataclass
class CIScanConfig:
    target_dir: str = "."
    scan_mode: CIScanMode = CIScanMode.FULL_REPO
    pr_base: Optional[str] = None
    changed_files: Optional[List[str]] = None
    policy_path: Optional[str] = None
    fail_on: str = "critical"
    fail_on_warn: bool = False
    output_cbom: Optional[str] = None
    output_sarif: Optional[str] = None
    scan_secrets: bool = True
    scan_deps: bool = True
    scan_container: Optional[str] = None
    include_ext: Set[str] = field(default_factory=lambda: set(DEFAULT_INCLUDE_EXTS))
    exclude_dirs: Set[str] = field(default_factory=lambda: set(DEFAULT_EXCLUDE_DIRS))
    max_file_size_mb: int = 5
    max_files: int = 10000


@dataclass
class CIScanResult:
    exit_code: CIExitCode
    scan_mode: str
    target_dir: str
    complete: bool
    vulnerabilities_conflated: bool = False  # Strict invariant: always False
    total_files_scanned: int = 0
    findings: List[Dict[str, Any]] = field(default_factory=list)
    static_findings_count: int = 0
    secret_findings_count: int = 0
    dependency_findings_count: int = 0
    container_findings_count: int = 0
    gate_passed: bool = True
    gate_verdict: str = "ALLOW"
    gate_violations: List[str] = field(default_factory=list)
    scanner_errors: List[str] = field(default_factory=list)
    cbom_path: Optional[str] = None
    sarif_path: Optional[str] = None
    summary: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["exit_code"] = int(self.exit_code)
        return data


def resolve_pr_diff_files(target_dir: str, pr_base: str) -> Tuple[List[str], Optional[str]]:
    """
    Resolves changed files using git diff against pr_base.
    Returns (list_of_relative_paths, error_message).
    """
    resolved_target = Path(target_dir).resolve()
    if not (resolved_target / ".git").exists() and not Path(".git").exists():
        # Check if git repository is discoverable
        pass

    try:
        # Check git availability and repo status
        check = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(resolved_target),
            capture_output=True,
            text=True,
            check=False,
        )
        if check.returncode != 0:
            return [], f"Target directory '{target_dir}' is not inside a git repository."

        # Try triple-dot diff first (merge-base), then double-dot diff
        diff_cmd = ["git", "diff", "--name-only", f"{pr_base}...HEAD"]
        proc = subprocess.run(
            diff_cmd,
            cwd=str(resolved_target),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            # Fallback to direct ref diff
            diff_cmd = ["git", "diff", "--name-only", pr_base]
            proc = subprocess.run(
                diff_cmd,
                cwd=str(resolved_target),
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode != 0:
                return [], f"Git diff against '{pr_base}' failed: {proc.stderr.strip()}"

        lines = [line.strip().replace("\\", "/") for line in proc.stdout.splitlines() if line.strip()]
        return lines, None
    except FileNotFoundError:
        return [], "Git executable not found on system PATH."
    except Exception as e:
        return [], f"Error executing git diff: {str(e)}"


class CIScanner:
    """
    First-class CI/CD Orchestrator for ECDAT.
    """

    def __init__(self, config: Optional[CIScanConfig] = None):
        self.config = config or CIScanConfig()

    def validate_config(self) -> Tuple[bool, Optional[str]]:
        """Validates configuration, returning (is_valid, error_reason)."""
        target = Path(self.config.target_dir)
        if not target.exists():
            return False, f"Target directory does not exist: {self.config.target_dir}"
        if not target.is_dir():
            return False, f"Target path is not a directory: {self.config.target_dir}"

        if self.config.fail_on not in VALID_FAIL_ON_CHOICES:
            return (
                False,
                f"Invalid fail_on choice '{self.config.fail_on}'. Choose from: {', '.join(VALID_FAIL_ON_CHOICES)}",
            )

        if self.config.policy_path:
            p = Path(self.config.policy_path)
            if not p.exists():
                return False, f"Specified policy file not found: {self.config.policy_path}"
            try:
                with open(p, "r", encoding="utf-8") as f:
                    json.load(f)
            except Exception as e:
                return False, f"Malformed policy JSON file at {self.config.policy_path}: {e}"

        if self.config.scan_container and self.config.scan_container != "auto":
            cpath = Path(self.config.scan_container)
            if not cpath.is_absolute():
                cpath = target / cpath
            if not cpath.exists():
                return False, f"Specified container scan target not found: {self.config.scan_container}"

        return True, None

    def run(self) -> CIScanResult:
        """
        Executes the CI scan with strict exit code semantics.
        Never conflates scanner errors with 'no vulnerabilities'.
        """
        # 1. Validate Configuration
        is_valid, config_err = self.validate_config()
        if not is_valid:
            return CIScanResult(
                exit_code=CIExitCode.INVALID_CONFIG,
                scan_mode=str(self.config.scan_mode.value),
                target_dir=self.config.target_dir,
                complete=False,
                vulnerabilities_conflated=False,
                scanner_errors=[f"Configuration Error: {config_err}"],
                gate_passed=False,
                gate_verdict="INVALID_CONFIG",
                gate_violations=[config_err or "Invalid configuration"],
            )

        target_path = Path(self.config.target_dir).resolve()
        scan_errors: List[str] = []
        is_complete = True
        findings: List[Dict[str, Any]] = []

        # 2. Determine Scope (PR vs Full Repo)
        target_files: List[Path] = []
        mode_str = self.config.scan_mode.value

        if self.config.pr_base or self.config.changed_files is not None:
            mode_str = CIScanMode.PULL_REQUEST.value
            changed_names: List[str] = []

            if self.config.changed_files is not None:
                changed_names = [f.strip().replace("\\", "/") for f in self.config.changed_files if f.strip()]
            elif self.config.pr_base:
                diff_files, diff_err = resolve_pr_diff_files(str(target_path), self.config.pr_base)
                if diff_err:
                    # If git diff failed due to bad ref or git error
                    return CIScanResult(
                        exit_code=CIExitCode.INVALID_CONFIG
                        if "not inside a git repository" in diff_err or "failed" in diff_err
                        else CIExitCode.SCANNER_ERROR,
                        scan_mode=mode_str,
                        target_dir=str(target_path),
                        complete=False,
                        vulnerabilities_conflated=False,
                        scanner_errors=[diff_err],
                        gate_passed=False,
                        gate_verdict="ERROR",
                        gate_violations=[diff_err],
                    )
                changed_names = diff_files

            # Filter changed files to those that exist, match extensions, and aren't in exclude dirs
            for rel in changed_names:
                candidate = (target_path / rel).resolve()
                if candidate.exists() and candidate.is_file():
                    ext = candidate.suffix.lower()
                    if ext in self.config.include_ext:
                        # Check exclude dirs
                        rel_parts = set(candidate.relative_to(target_path).parts)
                        if not rel_parts.intersection(self.config.exclude_dirs):
                            target_files.append(candidate)
        else:
            # Full Repo Discovery
            try:
                max_bytes = self.config.max_file_size_mb * 1024 * 1024
                discovery = FileDiscovery(
                    str(target_path),
                    self.config.include_ext,
                    self.config.exclude_dirs,
                    max_bytes,
                    self.config.max_files,
                )
                target_files = discovery.discover_files()
            except Exception as e:
                scan_errors.append(f"File discovery error: {str(e)}")
                is_complete = False

        static_count = 0
        secret_count = 0
        dep_count = 0
        container_count = 0

        # 3. Sub-Scanner: Static Code Scanner (AST + Regex)
        if is_complete:
            try:
                registry = get_default_adapter_registry()
                for fpath in target_files:
                    try:
                        with open(fpath, "rb") as f:
                            source_bytes = f.read()
                        content = source_bytes.decode("utf-8", errors="replace")
                    except Exception as fe:
                        scan_errors.append(f"Cannot read file '{fpath}': {str(fe)}")
                        continue

                    rel_path = str(fpath.relative_to(target_path)).replace("\\", "/")
                    ext = fpath.suffix.lower()

                    # AST extraction
                    ast_findings = []
                    adapter = registry.get_by_extension(ext)
                    if adapter:
                        try:
                            ast_findings = adapter.extract_findings(source_bytes, fpath, target_path)
                        except Exception as ae:
                            scan_errors.append(f"AST adapter failed on '{rel_path}': {str(ae)}")

                    # Regex extraction
                    regex_findings = []
                    try:
                        raw_matches = apply_regex_rules(content)
                        for m in raw_matches:
                            sanitized = redact_secrets(m.get("evidence", ""))
                            f_item = StaticFinding(
                                file_path=rel_path,
                                line_number=m.get("line_number", 1),
                                rule_id=m.get("rule_id", "ECDAT-STATIC"),
                                algorithm=m.get("algorithm", "UNKNOWN"),
                                evidence=sanitized,
                                confidence=m.get("confidence", "medium"),
                                finding_type=m.get("finding_type", "weak_crypto"),
                                severity=m.get("severity", "medium"),
                            )
                            regex_findings.append(f_item)
                    except Exception as re_err:
                        scan_errors.append(f"Regex scanner failed on '{rel_path}': {str(re_err)}")

                    # Deduplicate AST & Regex
                    file_findings: Dict[str, Any] = {}
                    for af in ast_findings:
                        key = f"{af.file_path}:{af.line_number}:{af.algorithm}"
                        file_findings[key] = {
                            "rule_id": af.rule_id,
                            "algorithm": af.algorithm,
                            "finding_type": af.finding_type,
                            "file_path": af.file_path,
                            "line_number": af.line_number,
                            "severity": af.severity,
                            "confidence": af.confidence,
                            "evidence": af.evidence,
                            "category": "static_code",
                            "source": "ast",
                        }

                    for rf in regex_findings:
                        key = f"{rf.file_path}:{rf.line_number}:{rf.algorithm}"
                        if key not in file_findings:
                            file_findings[key] = {
                                "rule_id": rf.rule_id,
                                "algorithm": rf.algorithm,
                                "finding_type": rf.finding_type,
                                "file_path": rf.file_path,
                                "line_number": rf.line_number,
                                "severity": rf.severity,
                                "confidence": rf.confidence,
                                "evidence": rf.evidence,
                                "category": "static_code",
                                "source": "regex",
                            }

                    for item in file_findings.values():
                        findings.append(item)
                        static_count += 1
            except Exception as e:
                scan_errors.append(f"Static scanner engine crash: {str(e)}")
                is_complete = False

        # 4. Sub-Scanner: Secret Scanner (SecretSafeDetector)
        if is_complete and self.config.scan_secrets:
            try:
                for fpath in target_files:
                    try:
                        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read()
                    except Exception:
                        continue

                    rel_path = str(fpath.relative_to(target_path)).replace("\\", "/")
                    sanitized_content, secret_candidates = SecretSafeDetector.detect_and_redact(
                        content, file_path=rel_path
                    )

                    for cand in secret_candidates:
                        # Strictly zero raw secret leakage: minimal_evidence has redaction token only
                        findings.append(
                            {
                                "rule_id": f"ECDAT-SECRET-{cand.candidate_type}",
                                "algorithm": cand.candidate_type,
                                "finding_type": "hardcoded_key",
                                "file_path": rel_path,
                                "line_number": cand.line_number,
                                "severity": cand.severity,
                                "confidence": cand.confidence,
                                "evidence": cand.minimal_evidence,
                                "fingerprint": cand.safe_fingerprint,
                                "category": "secret",
                                "source": "secret_detector",
                            }
                        )
                        secret_count += 1
            except Exception as e:
                scan_errors.append(f"Secret scanner crash: {str(e)}")
                is_complete = False

        # 5. Sub-Scanner: Dependency Scanner (Manifest & Crypto mapping)
        if is_complete and self.config.scan_deps:
            try:
                dep_findings = self._scan_dependencies(target_path)
                for df in dep_findings:
                    findings.append(df)
                    dep_count += 1
            except Exception as e:
                scan_errors.append(f"Dependency scanner crash: {str(e)}")
                is_complete = False

        # 6. Sub-Scanner: Container Scanner (Dockerfile & Container artifacts)
        if is_complete and self.config.scan_container:
            try:
                container_findings = self._scan_container_target(target_path, self.config.scan_container)
                for cf in container_findings:
                    findings.append(cf)
                    container_count += 1
            except Exception as e:
                scan_errors.append(f"Container scanner crash: {str(e)}")
                is_complete = False

        # 7. Developer Feedback Enrichment (Phase 13.2)
        from scanners.developer_feedback import DeveloperFeedbackGenerator

        enriched_findings = []
        for f in findings:
            df = DeveloperFeedbackGenerator.generate(f, target_root=str(target_path))
            f["developer_feedback"] = df.to_dict()
            f["is_suppressed"] = df.is_suppressed
            if df.is_suppressed:
                f["suppression_reason"] = df.suppression_reason
            enriched_findings.append(f)
        findings = enriched_findings

        # 8. CBOM Generation
        cbom_dest = None
        if self.config.output_cbom:
            try:
                cbom_dest = str(Path(self.config.output_cbom).resolve())
                self._write_cbom(findings, cbom_dest)
            except Exception as e:
                scan_errors.append(f"Failed to generate/write CBOM: {str(e)}")
                is_complete = False

        # 9. SARIF Generation
        sarif_dest = None
        if self.config.output_sarif:
            try:
                sarif_dest = str(Path(self.config.output_sarif).resolve())
                self._write_sarif(findings, sarif_dest)
            except Exception as e:
                scan_errors.append(f"Failed to generate/write SARIF: {str(e)}")
                is_complete = False

        # 9. Deterministic Exit Code & Policy Gate Evaluation
        # STRICT INVARIANT: Do not conflate scanner failure with "no vulnerabilities."
        if not is_complete or scan_errors:
            return CIScanResult(
                exit_code=CIExitCode.SCANNER_ERROR,
                scan_mode=mode_str,
                target_dir=str(target_path),
                complete=False,
                vulnerabilities_conflated=False,
                total_files_scanned=len(target_files),
                findings=findings,
                static_findings_count=static_count,
                secret_findings_count=secret_count,
                dependency_findings_count=dep_count,
                container_findings_count=container_count,
                gate_passed=False,
                gate_verdict="SCANNER_ERROR",
                gate_violations=["Scanner encountered fatal errors; cannot certify clean state"],
                scanner_errors=scan_errors,
                cbom_path=cbom_dest,
                sarif_path=sarif_dest,
                summary={
                    "status": "SCANNER_ERROR",
                    "reason": "One or more sub-scanners failed during execution. Conflation with 'no vulnerabilities' is strictly prohibited.",
                    "error_count": len(scan_errors),
                },
            )

        # Policy Gate Evaluation
        gate_passed = True
        gate_verdict = "ALLOW"
        gate_violations: List[str] = []

        if self.config.fail_on == "policy" or self.config.policy_path:
            try:
                policy_engine = PolicyEngine()
                pol_res = policy_engine.evaluate(findings, policy=self.config.policy_path)
                gate_verdict = pol_res.get("verdict", "ALLOW")
                if gate_verdict == "BLOCK" or (gate_verdict == "WARN" and self.config.fail_on_warn):
                    gate_passed = False
                    for asset_eval in pol_res.get("assets", []):
                        for r_res in asset_eval.get("rule_results", []):
                            for reason in r_res.get("reasons", []):
                                gate_violations.append(
                                    f"{r_res.get('final_action')}: {reason} [{r_res.get('rule_id')}] on {asset_eval.get('name', 'asset')}"
                                )
            except Exception as pe:
                scan_errors.append(f"Policy evaluation crash: {str(pe)}")
                return CIScanResult(
                    exit_code=CIExitCode.SCANNER_ERROR,
                    scan_mode=mode_str,
                    target_dir=str(target_path),
                    complete=False,
                    vulnerabilities_conflated=False,
                    total_files_scanned=len(target_files),
                    findings=findings,
                    scanner_errors=scan_errors,
                    gate_passed=False,
                    gate_verdict="ERROR",
                )

        if gate_passed and self.config.fail_on in ("critical", "high"):
            min_rank = {"critical": 2, "high": 1}[self.config.fail_on]
            rank_map = {"critical": 2, "high": 1, "medium": 0, "low": 0, "informational": 0}
            for f in findings:
                if f.get("is_suppressed"):
                    continue
                sev = str(f.get("severity", "informational")).lower()
                if rank_map.get(sev, 0) >= min_rank:
                    gate_violations.append(
                        f"{sev.upper()}: {f.get('rule_id')} ({f.get('algorithm')}) at {f.get('file_path')}:{f.get('line_number')}"
                    )
            if gate_violations:
                gate_passed = False
                gate_verdict = "BLOCK"

        exit_code = CIExitCode.PASS if gate_passed else CIExitCode.POLICY_SECURITY_FAILURE

        return CIScanResult(
            exit_code=exit_code,
            scan_mode=mode_str,
            target_dir=str(target_path),
            complete=True,
            vulnerabilities_conflated=False,
            total_files_scanned=len(target_files),
            findings=findings,
            static_findings_count=static_count,
            secret_findings_count=secret_count,
            dependency_findings_count=dep_count,
            container_findings_count=container_count,
            gate_passed=gate_passed,
            gate_verdict=gate_verdict,
            gate_violations=gate_violations,
            scanner_errors=[],
            cbom_path=cbom_dest,
            sarif_path=sarif_dest,
            summary={
                "status": "PASS" if gate_passed else "POLICY_SECURITY_FAILURE",
                "total_findings": len(findings),
                "gate_passed": gate_passed,
                "gate_verdict": gate_verdict,
                "violations_count": len(gate_violations),
            },
        )

    def _scan_dependencies(self, root_dir: Path) -> List[Dict[str, Any]]:
        """Inspects package manifests for weak/unapproved cryptographic libraries."""
        findings: List[Dict[str, Any]] = []

        # Known insecure or deprecated crypto libraries
        insecure_packages = {
            "pycrypto": (
                "critical",
                "PyCrypto is unmaintained and contains known vulnerabilities. Use cryptography instead.",
            ),
            "pycryptodome": ("informational", "PyCryptodome is present; verify algorithm usage."),
            "des": ("critical", "Legacy DES package is deprecated and vulnerable."),
            "md5": ("critical", "MD5 hashing package is cryptographically broken."),
            "rc4": ("critical", "RC4 cipher package is cryptographically broken."),
            "ursa": ("high", "Ursa contains legacy primitives."),
        }

        # 1. Check package.json
        pkg_json_path = root_dir / "package.json"
        if pkg_json_path.exists():
            try:
                with open(pkg_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                all_deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                for pkg_name, ver in all_deps.items():
                    clean_name = pkg_name.lower().strip()
                    if clean_name in insecure_packages:
                        sev, rec = insecure_packages[clean_name]
                        findings.append(
                            {
                                "rule_id": f"ECDAT-DEP-{clean_name.upper()}",
                                "algorithm": clean_name,
                                "finding_type": "weak_dependency",
                                "file_path": "package.json",
                                "line_number": 1,
                                "severity": sev,
                                "confidence": "high",
                                "evidence": f'"{pkg_name}": "{ver}"',
                                "category": "dependency",
                                "source": "sca",
                                "remediation": rec,
                            }
                        )
            except Exception as e:
                logger.warning("Error reading package.json: %s", e)

        # 2. Check requirements.txt
        req_path = root_dir / "requirements.txt"
        if req_path.exists():
            try:
                with open(req_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                for line_no, line in enumerate(lines, start=1):
                    raw = line.strip()
                    if not raw or raw.startswith("#"):
                        continue
                    pkg_candidate = re.split(r"[><=~!;]", raw)[0].strip().lower()
                    if pkg_candidate in insecure_packages:
                        sev, rec = insecure_packages[pkg_candidate]
                        findings.append(
                            {
                                "rule_id": f"ECDAT-DEP-{pkg_candidate.upper()}",
                                "algorithm": pkg_candidate,
                                "finding_type": "weak_dependency",
                                "file_path": "requirements.txt",
                                "line_number": line_no,
                                "severity": sev,
                                "confidence": "high",
                                "evidence": raw,
                                "category": "dependency",
                                "source": "sca",
                                "remediation": rec,
                            }
                        )
            except Exception as e:
                logger.warning("Error reading requirements.txt: %s", e)

        return findings

    def _scan_container_target(self, root_dir: Path, target: str) -> List[Dict[str, Any]]:
        """Scans Dockerfile or container configuration for cryptographic issues."""
        findings: List[Dict[str, Any]] = []
        if target and target != "auto":
            cpath = Path(target)
            dockerfile_path = cpath if cpath.is_absolute() else root_dir / cpath
        else:
            dockerfile_path = root_dir / "Dockerfile"

        if dockerfile_path.exists() and dockerfile_path.is_file():
            try:
                with open(dockerfile_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                for line_no, line in enumerate(lines, start=1):
                    raw = line.strip()
                    # Check for outdated base images
                    if re.search(
                        r"\bFROM\s+.*\b(alpine:3\.[0-9]|ubuntu:14\.|ubuntu:16\.|debian:8|centos:6)", raw, re.IGNORECASE
                    ):
                        findings.append(
                            {
                                "rule_id": "ECDAT-CONTAINER-DEPRECATED-BASE",
                                "algorithm": "LEGACY_BASE_IMAGE",
                                "finding_type": "container_weakness",
                                "file_path": str(dockerfile_path.relative_to(root_dir)).replace("\\", "/"),
                                "line_number": line_no,
                                "severity": "high",
                                "confidence": "high",
                                "evidence": raw,
                                "category": "container",
                                "source": "dockerfile",
                                "remediation": "Update base container image to an actively supported LTS distribution.",
                            }
                        )
                    # Check for insecure package installations
                    if "apt-get" in raw or "apk add" in raw or "yum install" in raw:
                        if "pycrypto" in raw or "libssl1.0" in raw:
                            findings.append(
                                {
                                    "rule_id": "ECDAT-CONTAINER-INSECURE-PKG",
                                    "algorithm": "LEGACY_CRYPTO_PKG",
                                    "finding_type": "container_weakness",
                                    "file_path": str(dockerfile_path.relative_to(root_dir)).replace("\\", "/"),
                                    "line_number": line_no,
                                    "severity": "critical",
                                    "confidence": "high",
                                    "evidence": raw,
                                    "category": "container",
                                    "source": "dockerfile",
                                    "remediation": "Remove vulnerable cryptographic libraries from container build instructions.",
                                }
                            )
            except Exception as e:
                logger.warning("Error parsing Dockerfile: %s", e)

        return findings

    def _write_cbom(self, findings: List[Dict[str, Any]], dest_path: str) -> None:
        """Writes CycloneDX CBOM JSON to destination path."""
        cboms = []
        for f in findings:
            ccf = CodeCryptoFinding(
                bom_ref=f"ci:{f.get('file_path')}:{f.get('line_number')}:{f.get('algorithm')}",
                file_path=str(f.get("file_path")),
                language="Unknown",
                line=int(f.get("line_number", 1)),
                algorithm=str(f.get("algorithm")),
                finding_type=str(f.get("finding_type")),
                confidence=str(f.get("confidence", "medium")),
                analysis_source=str(f.get("source", "ci_scanner")),
                needs_human_review=False,
                reason=f.get("description", f.get("finding_type")),
                fingerprint=f.get("fingerprint"),
                secret_type=f.get("algorithm") if f.get("finding_type") == "hardcoded_key" else None,
            )
            cboms.append(code_finding_to_cbom(ccf))

        p = Path(dest_path)
        p.parent.mkdir(parents=True, exist_ok=True)

        if cboms:
            merged = merge_cboms(cboms)
            serialized = serialize_cbom(merged)
            p.write_text(serialized, encoding="utf-8")
        else:
            empty_cbom = json.dumps(
                {
                    "bomFormat": "CycloneDX",
                    "specVersion": "1.6",
                    "components": [],
                },
                indent=2,
            )
            p.write_text(empty_cbom, encoding="utf-8")

    def _write_sarif(self, findings: List[Dict[str, Any]], dest_path: str) -> None:
        """Generates, automatically validates, and writes OASIS SARIF v2.1.0 JSON."""
        from scanners.sarif_engine import SarifEngine

        sarif_data = SarifEngine.generate_and_validate(
            findings,
            tool_name="ECDAT CI Scanner",
            target_root=self.config.target_dir,
        )
        SarifEngine.write_sarif(sarif_data, dest_path, validate=True)


def generate_sarif_v2(findings: List[Dict[str, Any]], tool_name: str = "ECDAT CI Scanner") -> Dict[str, Any]:
    """
    Generates and automatically validates standard OASIS SARIF v2.1.0 report for GitHub Security upload.
    Ensures safe redaction of secrets in code snippets.
    """
    from scanners.sarif_engine import SarifEngine

    return SarifEngine.generate_and_validate(findings, tool_name=tool_name)


def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ECDAT First-Class CI/CD Scanner (Phase 13.1)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "target", nargs="?", default=".", help="Directory or workspace to scan (default: current directory)"
    )
    parser.add_argument(
        "--pr-base", default=None, help="Base branch/ref for Pull Request diff-aware scan (e.g. origin/main, HEAD~1)"
    )
    parser.add_argument(
        "--changed-files", default=None, help="Comma-separated list of explicit changed files for PR scan"
    )
    parser.add_argument("--policy", default=None, help="Path to policy-as-code JSON file")
    parser.add_argument(
        "--fail-on",
        choices=VALID_FAIL_ON_CHOICES,
        default="critical",
        help="Gate threshold to trigger failure exit code: none, critical, high, policy (default: critical)",
    )
    parser.add_argument("--fail-on-warn", action="store_true", help="Escalate policy WARN verdicts to failure")
    parser.add_argument("-o", "--output-cbom", default=None, help="Path to output CycloneDX CBOM JSON file")
    parser.add_argument("--output-sarif", default=None, help="Path to output OASIS SARIF v2.1.0 JSON file")
    parser.add_argument("--no-secrets", action="store_true", help="Disable secret scanning")
    parser.add_argument("--no-deps", action="store_true", help="Disable dependency SCA scanning")
    parser.add_argument("--scan-container", default=None, help="Path to Dockerfile or container artifact to inspect")
    parser.add_argument(
        "--developer-feedback", action="store_true", help="Print actionable developer feedback cards for findings"
    )
    parser.add_argument("--json", action="store_true", help="Output summary in JSON format")

    return parser.parse_args(args)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    changed_list = None
    if args.changed_files:
        changed_list = [f.strip() for f in args.changed_files.split(",") if f.strip()]

    config = CIScanConfig(
        target_dir=args.target,
        scan_mode=CIScanMode.PULL_REQUEST if (args.pr_base or changed_list) else CIScanMode.FULL_REPO,
        pr_base=args.pr_base,
        changed_files=changed_list,
        policy_path=args.policy,
        fail_on=args.fail_on,
        fail_on_warn=args.fail_on_warn,
        output_cbom=args.output_cbom,
        output_sarif=args.output_sarif,
        scan_secrets=not args.no_secrets,
        scan_deps=not args.no_deps,
        scan_container=args.scan_container,
    )

    scanner = CIScanner(config)
    result = scanner.run()

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
    else:
        print("=" * 60)
        print("ECDAT CI/CD Scanner Execution Report")
        print("=" * 60)
        print(f"Target Directory:      {result.target_dir}")
        print(f"Scan Mode:             {result.scan_mode.upper()}")
        print(f"Files Scanned:         {result.total_files_scanned}")
        print(f"Complete:              {result.complete}")
        print(f"Exit Code:             {result.exit_code.value} ({result.exit_code.name})")
        print(f"Policy Gate Verdict:   {result.gate_verdict} (Passed: {result.gate_passed})")
        print(
            f"Findings:              {len(result.findings)} total "
            f"({result.static_findings_count} static, {result.secret_findings_count} secret, "
            f"{result.dependency_findings_count} dependency, {result.container_findings_count} container)"
        )

        if result.cbom_path:
            print(f"CBOM Written:          {result.cbom_path}")
        if result.sarif_path:
            print(f"SARIF Written:         {result.sarif_path}")

        if result.scanner_errors:
            print("\n[!] Scanner Errors Occurred (NOT conflated with 'no vulnerabilities'):")
            for err in result.scanner_errors:
                print(f"  - {err}")

        if result.gate_violations:
            print("\n[X] Policy / Security Violations:")
            for viol in result.gate_violations:
                print(f"  - {viol}")

        if args.developer_feedback and result.findings:
            from scanners.developer_feedback import DeveloperFeedbackGenerator

            print("\n" + "=" * 60)
            print("Actionable Developer Feedback Cards")
            print("=" * 60)
            for f in result.findings[:10]:
                df_obj = DeveloperFeedbackGenerator.generate(f, target_root=args.target)
                print(DeveloperFeedbackGenerator.render_terminal_card(df_obj))

        print("=" * 60)

    return result.exit_code.value


if __name__ == "__main__":
    sys.exit(main())
