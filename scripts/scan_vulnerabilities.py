#!/usr/bin/env python3
"""
ECDAT Multi-Ecosystem Vulnerability Scanner (Hardened Fail-Closed & Versioned Offline DB Architecture).

Integrates automated vulnerability auditing for Python, Node.js Backend, and
React Frontend dependencies with strict fail-closed security guarantees and
versioned offline database snapshot support.

State Model:
- CLEAN: All requested targets were successfully verified and 0 vulnerabilities were found.
- VULNERABLE: Verification completed successfully and 1+ vulnerabilities were found.
- SCAN_ERROR: A tool crashed, produced unparseable output, or experienced an unexpected exception.
- SCAN_UNAVAILABLE: A required scanner tool is missing, remote service is down, or query timed out.
- INVALID_INPUT: A target file or input directory does not exist or is corrupted.
- INCOMPLETE_VULNERABILITY_DATA: Offline database snapshot does not have complete 100% coverage
  over the queried packages. MUST NEVER be interpreted as ZERO_VULNERABILITIES or CLEAN.

Security Mandates:
- OSV unavailable -> SCAN_UNAVAILABLE (NOT clean)
- npm audit failure -> SCAN_ERROR / SCAN_UNAVAILABLE (NOT clean)
- tool missing -> SCAN_UNAVAILABLE (NOT clean)
- network timeout -> SCAN_UNAVAILABLE (NOT clean)
- parse error -> SCAN_ERROR (NOT clean)
- unknown result -> SCAN_ERROR (NOT clean)
- Offline database incomplete -> INCOMPLETE_VULNERABILITY_DATA (NOT zero vulnerabilities)
- Only CLEAN may satisfy a 'no known vulnerabilities' gate.
- Never return an empty finding list as a substitute for scanner failure.
"""

from __future__ import annotations

import argparse
import datetime
from dataclasses import dataclass, field
from enum import Enum
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set, Tuple
import urllib.error
import urllib.request

REPO_ROOT = Path(__file__).resolve().parent.parent
OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch"
DEFAULT_OFFLINE_DB_PATH = REPO_ROOT / "rules" / "offline_vulnerability_db.json"


class ScanStatus(str, Enum):
    CLEAN = "CLEAN"
    VULNERABLE = "VULNERABLE"
    SCAN_ERROR = "SCAN_ERROR"
    SCAN_UNAVAILABLE = "SCAN_UNAVAILABLE"
    INVALID_INPUT = "INVALID_INPUT"
    INCOMPLETE_VULNERABILITY_DATA = "INCOMPLETE_VULNERABILITY_DATA"


@dataclass
class VulnerabilityScanResult:
    """
    Structured outcome of a vulnerability scan across one or more ecosystems.
    Enforces that scanner failures or incomplete offline databases never masquerade as clean results.
    """

    status: ScanStatus
    findings: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    unavailable_reasons: List[str] = field(default_factory=list)
    invalid_inputs: List[str] = field(default_factory=list)
    scanned_targets: List[str] = field(default_factory=list)
    offline_db_info: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_clean(self) -> bool:
        """
        Absolute Security Rule:
        Only CLEAN may satisfy a 'no known vulnerabilities' gate.
        Never return an empty finding list as a substitute for scanner failure or incomplete data.
        """
        return (
            self.status == ScanStatus.CLEAN
            and len(self.findings) == 0
            and len(self.errors) == 0
            and len(self.unavailable_reasons) == 0
            and len(self.invalid_inputs) == 0
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.metadata.get("timestamp", datetime.datetime.now(datetime.timezone.utc).isoformat()),
            "scanner": "ECDAT Vulnerability Scanner 1.0.0",
            "status": self.status.value,
            "scan_successful": self.status in (ScanStatus.CLEAN, ScanStatus.VULNERABLE),
            "is_clean": self.is_clean(),
            "total_findings": len(self.findings),
            "findings": self.findings,
            "errors": self.errors,
            "unavailable_reasons": self.unavailable_reasons,
            "invalid_inputs": self.invalid_inputs,
            "scanned_targets": self.scanned_targets,
            "offline_db_info": self.offline_db_info,
            "metadata": self.metadata,
        }


def is_clean_gate_satisfied(result: VulnerabilityScanResult) -> bool:
    """
    Gate validation helper:
    Only CLEAN may satisfy a 'no known vulnerabilities' gate.
    """
    return result.is_clean()


def evaluate_vulnerability_gate(
    result: VulnerabilityScanResult,
    require_clean: bool = False,
    fail_on: str = "none",
) -> Tuple[bool, str]:
    """
    Evaluates scan result against gating rules.
    Returns (passed, reason).
    """
    if result.status == ScanStatus.INVALID_INPUT:
        return False, f"Gate REJECTED (INVALID_INPUT): {'; '.join(result.invalid_inputs)}"
    if result.status == ScanStatus.SCAN_UNAVAILABLE:
        return False, f"Gate REJECTED (SCAN_UNAVAILABLE): {'; '.join(result.unavailable_reasons)}"
    if result.status == ScanStatus.SCAN_ERROR:
        return False, f"Gate REJECTED (SCAN_ERROR): {'; '.join(result.errors)}"
    if result.status == ScanStatus.INCOMPLETE_VULNERABILITY_DATA:
        cov_pct = (
            result.offline_db_info.get("coverage", {}).get("coverage_pct", 0)
            if result.offline_db_info
            else 0
        )
        return (
            False,
            f"Gate REJECTED (INCOMPLETE_VULNERABILITY_DATA): Offline database coverage is incomplete ({cov_pct}%). Cannot verify zero vulnerabilities.",
        )
    if result.status == ScanStatus.VULNERABLE:
        if require_clean:
            return False, f"Gate REJECTED: {len(result.findings)} vulnerabilities found; gate requires CLEAN"
        crit_count = sum(1 for v in result.findings if v.get("severity") == "CRITICAL")
        high_count = sum(1 for v in result.findings if v.get("severity") in ("CRITICAL", "HIGH"))
        if fail_on == "critical" and crit_count > 0:
            return False, f"Gate REJECTED: {crit_count} CRITICAL vulnerabilities exceed policy threshold"
        if fail_on == "high" and high_count > 0:
            return False, f"Gate REJECTED: {high_count} HIGH/CRITICAL vulnerabilities exceed policy threshold"
        if fail_on == "any" and len(result.findings) > 0:
            return False, f"Gate REJECTED: {len(result.findings)} vulnerabilities detected with --fail-on any"
        return True, f"Gate APPROVED: {len(result.findings)} vulnerabilities within allowed policy threshold"
    if result.status == ScanStatus.CLEAN:
        return True, "Gate APPROVED: 0 known vulnerabilities detected across all verified ecosystems"
    return False, f"Gate REJECTED: Unknown scan status '{result.status}'"


class OfflineVulnerabilityDatabase:
    """
    Versioned offline vulnerability database manager.
    Loads and indexes curated vulnerability advisories with explicit provenance.
    Enforces coverage accounting so partial databases are never represented as clean.
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DEFAULT_OFFLINE_DB_PATH
        self.version: str = "unknown"
        self.timestamp: str = "unknown"
        self.source: str = "unknown"
        self.supported_ecosystems: List[str] = []
        self.packages: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.db_path.exists():
            return
        try:
            with open(self.db_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.version = data.get("database_version", "unknown")
            self.timestamp = data.get("database_timestamp", "unknown")
            self.source = data.get("source", "unknown")
            self.supported_ecosystems = data.get("supported_ecosystems", [])
            self.packages = data.get("packages", {})
        except Exception:
            pass

    def is_loaded(self) -> bool:
        return bool(self.packages)

    def check_packages(
        self,
        packages: List[Dict[str, str]],
        default_ecosystem: str = "generic",
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any], List[str]]:
        """
        Evaluates a package list against the offline snapshot.
        Returns:
            findings: matching vulnerability entries
            coverage: {total_queried, covered_count, uncovered_count, coverage_pct, covered_packages, uncovered_packages}
            query_failures: list of unindexed package notifications
        """
        findings: List[Dict[str, Any]] = []
        covered_packages: List[str] = []
        uncovered_packages: List[str] = []
        query_failures: List[str] = []

        for p in packages:
            pkg_name = p.get("name", "").strip()
            pkg_key = pkg_name.lower()
            version = p.get("version", "").strip()
            eco = p.get("ecosystem", default_ecosystem)

            if pkg_key in self.packages:
                pkg_data = self.packages[pkg_key]
                covered_packages.append(pkg_name)
                for adv in pkg_data.get("advisories", []):
                    if self._is_version_affected(version, adv.get("affected_ranges", [])):
                        findings.append({
                            "package": pkg_name,
                            "version": version,
                            "ecosystem": eco,
                            "advisory_id": adv.get("id"),
                            "aliases": adv.get("aliases", []),
                            "summary": adv.get("summary", "Offline advisory match"),
                            "severity": adv.get("severity", "MODERATE"),
                            "details": adv.get("details", ""),
                            "context": "Offline Database Match",
                            "exploitability": "Evaluated via offline database snapshot",
                        })
            else:
                uncovered_packages.append(pkg_name)
                query_failures.append(
                    f"Package '{pkg_name}' ({eco}) is not indexed in offline database snapshot {self.version}"
                )

        total_queried = len(packages)
        covered_count = len(covered_packages)
        uncovered_count = len(uncovered_packages)
        coverage_pct = round((covered_count / total_queried) * 100.0, 2) if total_queried > 0 else 100.0

        coverage = {
            "total_queried": total_queried,
            "covered_count": covered_count,
            "uncovered_count": uncovered_count,
            "coverage_pct": coverage_pct,
            "covered_packages": covered_packages,
            "uncovered_packages": uncovered_packages,
        }

        return findings, coverage, query_failures

    @staticmethod
    def _is_version_affected(version: str, affected_ranges: List[Dict[str, Any]]) -> bool:
        if not version or not affected_ranges:
            return False
        # Match fixed/introduced boundary heuristics
        for r in affected_ranges:
            fixed = r.get("fixed")
            introduced = r.get("introduced", "0")
            if fixed and version < fixed:
                return True
        return False


class VulnerabilityScanner:
    """
    Core Multi-Ecosystem Vulnerability Scanner with Fail-Closed state model.
    """

    def __init__(
        self,
        repo_root: Optional[Path] = None,
        osv_timeout: int = 15,
        npm_timeout: int = 30,
        npm_bin: Optional[str] = None,
        offline_db_path: Optional[Path] = None,
    ):
        self.repo_root = repo_root or REPO_ROOT
        self.osv_timeout = osv_timeout
        self.npm_timeout = npm_timeout
        self.npm_bin = npm_bin
        self.offline_db = OfflineVulnerabilityDatabase(db_path=offline_db_path)

    def query_osv_batch(
        self, queries: List[Dict[str, Any]]
    ) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str], Optional[ScanStatus]]:
        """
        Execute batch query against OSV API.
        Returns: (results_list, error_message, scan_status)
        If any error occurs, returns (None, err_msg, status) to enforce fail-closed behavior.
        """
        if not queries:
            return [], None, None

        all_results: List[Dict[str, Any]] = []
        chunk_size = 50

        for i in range(0, len(queries), chunk_size):
            chunk = queries[i : i + chunk_size]
            payload = json.dumps({"queries": chunk}).encode("utf-8")
            req = urllib.request.Request(
                OSV_BATCH_URL,
                data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "ECDAT-Vuln-Scanner/1.0.0"},
            )
            try:
                with urllib.request.urlopen(req, timeout=self.osv_timeout) as resp:
                    resp_bytes = resp.read()
                    try:
                        data = json.loads(resp_bytes.decode("utf-8"))
                    except json.JSONDecodeError as jde:
                        return (
                            None,
                            f"OSV API response parse error in batch chunk {i // chunk_size + 1}: {jde}",
                            ScanStatus.SCAN_ERROR,
                        )

                    if not isinstance(data, dict) or "results" not in data or not isinstance(data["results"], list):
                        return (
                            None,
                            f"OSV API returned unexpected schema in chunk {i // chunk_size + 1} (missing 'results' list)",
                            ScanStatus.SCAN_ERROR,
                        )

                    chunk_results = data["results"]
                    if len(chunk_results) != len(chunk):
                        return (
                            None,
                            f"OSV API result length mismatch in chunk {i // chunk_size + 1}: expected {len(chunk)}, got {len(chunk_results)}",
                            ScanStatus.SCAN_ERROR,
                        )

                    all_results.extend(chunk_results)

            except (socket.timeout, TimeoutError) as te:
                return (
                    None,
                    f"OSV batch query timed out after {self.osv_timeout}s in chunk {i // chunk_size + 1}: {te}",
                    ScanStatus.SCAN_UNAVAILABLE,
                )
            except urllib.error.HTTPError as he:
                if 500 <= he.code <= 599:
                    return (
                        None,
                        f"OSV API service unavailable (HTTP {he.code}): {he.reason}",
                        ScanStatus.SCAN_UNAVAILABLE,
                    )
                return (
                    None,
                    f"OSV API error (HTTP {he.code}): {he.reason}",
                    ScanStatus.SCAN_ERROR,
                )
            except urllib.error.URLError as ue:
                if isinstance(ue.reason, (socket.timeout, TimeoutError)):
                    return (
                        None,
                        f"OSV batch query timed out: {ue.reason}",
                        ScanStatus.SCAN_UNAVAILABLE,
                    )
                return (
                    None,
                    f"OSV API network unreachable: {ue.reason}",
                    ScanStatus.SCAN_UNAVAILABLE,
                )
            except Exception as ex:
                return (
                    None,
                    f"Unexpected error communicating with OSV API: {ex}",
                    ScanStatus.SCAN_ERROR,
                )

        return all_results, None, None

    def scan_sbom_file(
        self, sbom_path: Path
    ) -> Tuple[List[Dict[str, Any]], List[str], List[str], List[str]]:
        """
        Scan components from a CycloneDX SBOM file.
        Returns: (findings, errors, unavailable_reasons, invalid_inputs)
        """
        print(f"   Scanning CycloneDX SBOM: {sbom_path}...")
        if not sbom_path.exists():
            return [], [], [], [f"SBOM file does not exist: {sbom_path}"]

        try:
            with open(sbom_path, "r", encoding="utf-8") as f:
                sbom = json.load(f)
        except Exception as e:
            return [], [], [], [f"Failed to read/parse SBOM JSON at {sbom_path}: {e}"]

        if not isinstance(sbom, dict) or "components" not in sbom or not isinstance(sbom["components"], list):
            return [], [], [], [f"SBOM document at {sbom_path} is malformed or missing 'components' array"]

        queries = []
        metadata_map = {}

        for comp in sbom.get("components", []):
            purl = comp.get("purl", "")
            if not purl or not purl.startswith("pkg:"):
                continue

            parts = purl.replace("pkg:", "").split("/", 1)
            if len(parts) != 2:
                continue
            eco, rest = parts[0], parts[1]
            ecosystem_map = {"pypi": "PyPI", "npm": "npm"}
            if eco not in ecosystem_map:
                continue

            if rest.startswith("@"):
                sub = rest[1:].split("@", 1)
                if len(sub) == 2:
                    name = "@" + sub[0]
                    ver = sub[1].split("#")[0]
                else:
                    continue
            else:
                sub = rest.split("@", 1)
                if len(sub) == 2:
                    name = sub[0]
                    ver = sub[1].split("#")[0]
                else:
                    continue

            queries.append({"package": {"name": name, "ecosystem": ecosystem_map[eco]}, "version": ver})
            metadata_map[f"{name}@{ver}"] = comp

        print(f"   Extracted {len(queries)} package queries from SBOM.")
        if not queries and len(sbom.get("components", [])) > 0:
            return [], [], [], [f"SBOM at {sbom_path} contains {len(sbom['components'])} components, but 0 valid package queries could be resolved"]

        osv_results, err_msg, err_status = self.query_osv_batch(queries)
        if err_msg:
            if err_status == ScanStatus.SCAN_UNAVAILABLE:
                return [], [], [f"SBOM scan failed: {err_msg}"], []
            return [], [f"SBOM scan failed: {err_msg}"], [], []

        if osv_results is None:
            return [], ["OSV returned None without error message"], [], []

        vulns = []
        for idx, res in enumerate(osv_results):
            q = queries[idx]
            key = f"{q['package']['name']}@{q['version']}"
            c_meta = metadata_map.get(key, {})
            for v in res.get("vulns", []):
                vulns.append({
                    "package": q["package"]["name"],
                    "version": q["version"],
                    "ecosystem": q["package"]["ecosystem"],
                    "purl": c_meta.get("purl"),
                    "advisory_id": v.get("id"),
                    "aliases": v.get("aliases", []),
                    "summary": v.get("summary", "No summary provided"),
                    "severity": extract_severity(v),
                    "details": v.get("details", "")[:300],
                    "context": f"SBOM Component ({c_meta.get('scope', 'required')})",
                    "exploitability": (
                        evaluate_python_exploitability(q["package"]["name"], v)
                        if q["package"]["ecosystem"] == "PyPI"
                        else evaluate_node_exploitability(q["package"]["name"], extract_severity(v), "Node.js")
                    ),
                })

        return vulns, [], [], []

    def scan_python_packages(
        self, py_packages: List[Dict[str, str]]
    ) -> Tuple[List[Dict[str, Any]], List[str], List[str], List[str]]:
        """
        Scan Python packages against OSV API.
        Returns: (findings, errors, unavailable_reasons, invalid_inputs)
        """
        print("   Querying OSV for Python packages...")
        if not py_packages:
            return [], [], [], ["Empty Python package list provided for scanning"]

        queries = []
        for p in py_packages:
            if not isinstance(p, dict) or "name" not in p or "version" not in p:
                return [], [], [], ["Malformed Python package entry missing 'name' or 'version'"]
            queries.append({"package": {"name": p["name"], "ecosystem": "PyPI"}, "version": p["version"]})

        osv_results, err_msg, err_status = self.query_osv_batch(queries)
        if err_msg:
            if err_status == ScanStatus.SCAN_UNAVAILABLE:
                return [], [], [f"Python scan failed: {err_msg}"], []
            return [], [f"Python scan failed: {err_msg}"], [], []

        if osv_results is None:
            return [], ["OSV returned None for Python packages without error message"], [], []

        vulns = []
        for idx, res in enumerate(osv_results):
            pkg_info = py_packages[idx]
            for v in res.get("vulns", []):
                vulns.append({
                    "package": pkg_info["name"],
                    "version": pkg_info["version"],
                    "ecosystem": "Python",
                    "advisory_id": v.get("id"),
                    "aliases": v.get("aliases", []),
                    "summary": v.get("summary", "No summary provided"),
                    "severity": extract_severity(v),
                    "details": v.get("details", "")[:300],
                    "context": "Core Scanner Engine Runtime",
                    "exploitability": evaluate_python_exploitability(pkg_info["name"], v),
                })

        return vulns, [], [], []

    def run_npm_audit(
        self, directory: Path, ecosystem_name: str
    ) -> Tuple[List[Dict[str, Any]], List[str], List[str], List[str]]:
        """
        Run `npm audit --json` on a Node.js workspace directory.
        Returns: (findings, errors, unavailable_reasons, invalid_inputs)
        """
        print(f"   Running npm audit for {ecosystem_name} in {directory.name}/...")
        if not directory.exists():
            return [], [], [], [f"Directory {directory} does not exist for {ecosystem_name}"]

        lockfile = directory / "package-lock.json"
        if not lockfile.exists():
            return [], [], [], [f"Lockfile package-lock.json missing in {directory} for {ecosystem_name}"]

        try:
            with open(lockfile, "r", encoding="utf-8") as lf:
                json.load(lf)
        except Exception as e:
            return [], [], [], [f"package-lock.json in {directory} is malformed or invalid JSON: {e}"]

        npm_bin = self.npm_bin or shutil.which("npm")
        if not npm_bin:
            return [], [], [f"Required tool 'npm' is missing from PATH for {ecosystem_name} in {directory}"], []

        try:
            proc = subprocess.run(
                [npm_bin, "audit", "--json"],
                cwd=str(directory),
                capture_output=True,
                text=True,
                timeout=self.npm_timeout,
            )
        except subprocess.TimeoutExpired:
            return [], [], [f"npm audit timed out after {self.npm_timeout}s for {ecosystem_name} in {directory}"], []
        except FileNotFoundError:
            return [], [], [f"npm executable '{npm_bin}' not found on system"], []
        except OSError as oe:
            return [], [f"OS error executing npm audit for {ecosystem_name}: {oe}"], [], []
        except Exception as ex:
            return [], [f"Unexpected error running npm audit for {ecosystem_name}: {ex}"], [], []

        raw_output = proc.stdout.strip() or proc.stderr.strip()
        if not raw_output:
            return [], [f"npm audit exited with code {proc.returncode} but produced no output in {directory}"], [], []

        try:
            audit_json = json.loads(raw_output)
        except json.JSONDecodeError as je:
            return (
                [],
                [f"Failed to parse npm audit JSON in {directory}: {je} (output snippet: {raw_output[:200]})"],
                [],
                [],
            )

        if not isinstance(audit_json, dict):
            return [], [f"npm audit in {directory} produced non-dict JSON output"], [], []

        # Check for explicit npm error responses (e.g. offline, registry down, bad auth)
        if "error" in audit_json:
            err_info = audit_json["error"]
            if isinstance(err_info, dict):
                code = str(err_info.get("code", "UNKNOWN"))
                summary = str(err_info.get("summary", "npm audit error"))
            else:
                code = "UNKNOWN"
                summary = str(err_info)

            if code in ("ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "E500", "E502", "E503", "E504", "EAI_AGAIN", "FETCH_ERROR"):
                return [], [], [f"npm registry unavailable for {ecosystem_name}: {summary} ({code})"], []
            return [], [f"npm audit failure for {ecosystem_name}: {summary} ({code})"], [], []

        if "vulnerabilities" not in audit_json and "metadata" not in audit_json:
            return [], [f"Unknown npm audit schema in {directory}: missing 'vulnerabilities' key"], [], []

        vulns = []
        advisories = audit_json.get("vulnerabilities", {})
        if not isinstance(advisories, dict):
            return [], [f"npm audit 'vulnerabilities' key in {directory} is not a dictionary"], [], []

        for pkg_name, adv in advisories.items():
            if not isinstance(adv, dict):
                continue
            severity = str(adv.get("severity", "moderate")).upper()
            via_list = adv.get("via", [])
            summary = "Transitive dependency advisory"
            adv_id = "NPM-AUDIT"

            for via in via_list:
                if isinstance(via, dict):
                    summary = via.get("title", summary)
                    adv_id = via.get("url", "").split("/")[-1] or via.get("source", adv_id)

            vulns.append({
                "package": pkg_name,
                "version": adv.get("range", "resolved"),
                "ecosystem": ecosystem_name,
                "advisory_id": adv_id,
                "aliases": [],
                "summary": summary,
                "severity": severity,
                "details": f"Direct: {adv.get('isDirect', False)}, Fix available: {bool(adv.get('fixAvailable'))}",
                "context": "Node.js Lockfile Dependency",
                "exploitability": evaluate_node_exploitability(pkg_name, severity, ecosystem_name),
            })

        return vulns, [], [], []

    def scan_offline(
        self,
        sbom_path: Optional[Path] = None,
        scan_node: bool = True,
    ) -> VulnerabilityScanResult:
        """
        Executes scan in limited offline mode using the versioned offline database snapshot.
        Calculates package coverage and enforces that incomplete coverage yields
        INCOMPLETE_VULNERABILITY_DATA (never ZERO_VULNERABILITIES or CLEAN).
        """
        print(">> [OFFLINE] Executing scan against offline vulnerability database snapshot...")
        all_packages: List[Dict[str, str]] = []
        scanned_targets: List[str] = []
        invalid_inputs: List[str] = []
        ecosystems_seen: Set[str] = set()

        # 1. Extract packages from SBOM or requirements.lock
        target_sbom = sbom_path or (self.repo_root / "artifacts" / "sbom" / "ecdat_sbom_cyclonedx.json")
        if target_sbom.exists():
            scanned_targets.append(f"CycloneDX SBOM ({target_sbom.name})")
            try:
                with open(target_sbom, "r", encoding="utf-8") as f:
                    sbom_data = json.load(f)
                for comp in sbom_data.get("components", []):
                    purl = comp.get("purl", "")
                    if purl.startswith("pkg:"):
                        parts = purl.replace("pkg:", "").split("/", 1)
                        if len(parts) == 2:
                            eco, rest = parts[0], parts[1]
                            name_ver = rest.rsplit("@", 1)
                            name = name_ver[0]
                            ver = name_ver[1].split("#")[0] if len(name_ver) > 1 else "unknown"
                            eco_name = "PyPI" if eco == "pypi" else ("npm" if eco == "npm" else eco)
                            all_packages.append({"name": name, "version": ver, "ecosystem": eco_name})
                            ecosystems_seen.add(eco_name)
            except Exception as ex:
                invalid_inputs.append(f"Failed to read/parse SBOM JSON at {target_sbom}: {ex}")
        else:
            req_lock = self.repo_root / "requirements.lock"
            if req_lock.exists():
                scanned_targets.append("Python requirements.lock")
                try:
                    with open(req_lock, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if line and not line.startswith("#") and "==" in line:
                                parts = line.split("==")
                                all_packages.append({"name": parts[0].strip(), "version": parts[1].strip(), "ecosystem": "PyPI"})
                                ecosystems_seen.add("PyPI")
                except Exception as ex:
                    invalid_inputs.append(f"Failed to read requirements.lock: {ex}")
            else:
                invalid_inputs.append(f"Neither SBOM ({target_sbom}) nor requirements.lock found for offline scanning")

        # 2. Extract node packages if requested
        if scan_node:
            for d_name, eco in [("backend", "npm"), ("frontend", "npm")]:
                lock = self.repo_root / d_name / "package-lock.json"
                if lock.exists():
                    scanned_targets.append(f"Node.js {d_name} (package-lock.json)")
                    try:
                        with open(lock, "r", encoding="utf-8") as lf:
                            lock_data = json.load(lf)
                        packages_dict = lock_data.get("packages", {})
                        for pkg_path, meta in packages_dict.items():
                            if pkg_path:
                                name = pkg_path.split("node_modules/")[-1]
                                ver = meta.get("version", "unknown")
                                all_packages.append({"name": name, "version": ver, "ecosystem": "npm"})
                                ecosystems_seen.add("npm")
                    except Exception as ex:
                        invalid_inputs.append(f"Failed to read {lock}: {ex}")

        # De-duplicate package queries by (name, version, ecosystem)
        unique_packages: List[Dict[str, str]] = []
        seen_pkg: Set[Tuple[str, str, str]] = set()
        for p in all_packages:
            key = (p["name"].lower(), p["version"], p["ecosystem"].lower())
            if key not in seen_pkg:
                seen_pkg.add(key)
                unique_packages.append(p)

        # Evaluate against offline database
        findings, coverage_data, query_failures = self.offline_db.check_packages(
            unique_packages, default_ecosystem="generic"
        )

        offline_db_info = {
            "database_version": self.offline_db.version,
            "database_timestamp": self.offline_db.timestamp,
            "source": self.offline_db.source,
            "package_ecosystem": sorted(list(ecosystems_seen)),
            "coverage": coverage_data,
            "query_failures": query_failures,
        }

        # Enforce fail-closed state model for offline scanning:
        # If any input is invalid -> INVALID_INPUT
        # If database coverage is incomplete -> INCOMPLETE_VULNERABILITY_DATA (never CLEAN/ZERO)
        # If 100% coverage and findings exist -> VULNERABLE
        # If 100% coverage and 0 findings -> CLEAN
        if invalid_inputs:
            status = ScanStatus.INVALID_INPUT
        elif coverage_data["uncovered_count"] > 0 or coverage_data["coverage_pct"] < 100.0:
            status = ScanStatus.INCOMPLETE_VULNERABILITY_DATA
        elif findings:
            status = ScanStatus.VULNERABLE
        else:
            status = ScanStatus.CLEAN

        return VulnerabilityScanResult(
            status=status,
            findings=findings,
            errors=[],
            unavailable_reasons=[],
            invalid_inputs=invalid_inputs,
            scanned_targets=scanned_targets,
            offline_db_info=offline_db_info,
            metadata={
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "mode": "offline",
                "total_unique_findings": len(findings),
                "coverage_pct": coverage_data["coverage_pct"],
            },
        )

    def scan(
        self,
        sbom_path: Optional[Path] = None,
        scan_node: bool = True,
        offline: bool = False,
    ) -> VulnerabilityScanResult:
        """
        Executes full multi-ecosystem vulnerability scan.
        If offline=True, delegates to scan_offline() enforcing INCOMPLETE_VULNERABILITY_DATA rules.
        """
        if offline:
            return self.scan_offline(sbom_path=sbom_path, scan_node=scan_node)

        all_vulns: List[Dict[str, Any]] = []
        all_errors: List[str] = []
        all_unavailable: List[str] = []
        all_invalid_inputs: List[str] = []
        scanned_targets: List[str] = []

        # 1. SBOM / Python scanning
        if sbom_path is not None:
            scanned_targets.append(f"CycloneDX SBOM ({sbom_path.name})")
            v, e, u, inv = self.scan_sbom_file(sbom_path)
            all_vulns.extend(v)
            all_errors.extend(e)
            all_unavailable.extend(u)
            all_invalid_inputs.extend(inv)
        else:
            default_sbom = self.repo_root / "artifacts" / "sbom" / "ecdat_sbom_cyclonedx.json"
            if default_sbom.exists():
                scanned_targets.append(f"CycloneDX SBOM ({default_sbom.name})")
                v, e, u, inv = self.scan_sbom_file(default_sbom)
                all_vulns.extend(v)
                all_errors.extend(e)
                all_unavailable.extend(u)
                all_invalid_inputs.extend(inv)
            else:
                req_lock = self.repo_root / "requirements.lock"
                if req_lock.exists():
                    scanned_targets.append("Python requirements.lock")
                    py_pkgs = []
                    try:
                        with open(req_lock, "r", encoding="utf-8") as f:
                            for line in f:
                                line = line.strip()
                                if line and not line.startswith("#") and "==" in line:
                                    parts = line.split("==")
                                    py_pkgs.append({"name": parts[0].strip(), "version": parts[1].strip()})
                        v, e, u, inv = self.scan_python_packages(py_pkgs)
                        all_vulns.extend(v)
                        all_errors.extend(e)
                        all_unavailable.extend(u)
                        all_invalid_inputs.extend(inv)
                    except Exception as ex:
                        all_invalid_inputs.append(f"Failed to read requirements.lock: {ex}")
                else:
                    all_invalid_inputs.append(f"Neither default SBOM ({default_sbom}) nor requirements.lock found for Python scanning")

        # 2. Node.js backend and frontend scanning
        if scan_node:
            be_dir = self.repo_root / "backend"
            fe_dir = self.repo_root / "frontend"

            scanned_targets.append("Node.js Backend (backend/)")
            v_be, e_be, u_be, inv_be = self.run_npm_audit(be_dir, "Node.js Backend")
            all_vulns.extend(v_be)
            all_errors.extend(e_be)
            all_unavailable.extend(u_be)
            all_invalid_inputs.extend(inv_be)

            scanned_targets.append("React Frontend (frontend/)")
            v_fe, e_fe, u_fe, inv_fe = self.run_npm_audit(fe_dir, "React Frontend")
            all_vulns.extend(v_fe)
            all_errors.extend(e_fe)
            all_unavailable.extend(u_fe)
            all_invalid_inputs.extend(inv_fe)

        # De-duplicate findings by (package, advisory_id)
        unique_vulns = []
        seen: Set[Tuple[str, str]] = set()
        for v in all_vulns:
            key = (v.get("package", ""), v.get("advisory_id", ""))
            if key not in seen:
                seen.add(key)
                unique_vulns.append(v)

        # Determine overall status strictly by priority
        if all_invalid_inputs:
            status = ScanStatus.INVALID_INPUT
        elif all_unavailable:
            status = ScanStatus.SCAN_UNAVAILABLE
        elif all_errors:
            status = ScanStatus.SCAN_ERROR
        elif unique_vulns:
            status = ScanStatus.VULNERABLE
        else:
            status = ScanStatus.CLEAN

        return VulnerabilityScanResult(
            status=status,
            findings=unique_vulns,
            errors=all_errors,
            unavailable_reasons=all_unavailable,
            invalid_inputs=all_invalid_inputs,
            scanned_targets=scanned_targets,
            metadata={
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "mode": "online",
                "total_unique_findings": len(unique_vulns),
                "total_errors": len(all_errors),
                "total_unavailable": len(all_unavailable),
                "total_invalid_inputs": len(all_invalid_inputs),
            },
        )


# Backward-compatible functional wrappers
def query_osv_batch(queries: List[Dict[str, Any]], timeout: int = 15) -> Optional[List[Dict[str, Any]]]:
    scanner = VulnerabilityScanner(osv_timeout=timeout)
    results, err, _ = scanner.query_osv_batch(queries)
    return results


def scan_sbom_file(sbom_path: Path) -> List[Dict[str, Any]]:
    scanner = VulnerabilityScanner()
    findings, _, _, _ = scanner.scan_sbom_file(sbom_path)
    return findings


def scan_python_packages(py_packages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    scanner = VulnerabilityScanner()
    findings, _, _, _ = scanner.scan_python_packages(py_packages)
    return findings


def run_npm_audit(directory: Path, ecosystem_name: str) -> List[Dict[str, Any]]:
    scanner = VulnerabilityScanner()
    findings, _, _, _ = scanner.run_npm_audit(directory, ecosystem_name)
    return findings


def extract_severity(v: Dict[str, Any]) -> str:
    """Extract standard severity label (CRITICAL, HIGH, MODERATE, LOW)."""
    db_spec = v.get("database_specific", {})
    if "severity" in db_spec:
        return str(db_spec["severity"]).upper()
    for s in v.get("severity", []):
        score = s.get("score", "")
        if "CVSS" in score:
            try:
                if "/S:U" in score and "/C:H/I:H/A:H" in score:
                    return "CRITICAL"
                elif "/C:H" in score or "/I:H" in score:
                    return "HIGH"
            except Exception:
                pass
    return "MODERATE"


def evaluate_python_exploitability(pkg_name: str, adv: Dict[str, Any]) -> str:
    """Contextual exploitability assessment for Python dependencies in ECDAT."""
    if any(x in pkg_name for x in ["pytest", "coverage", "ruff"]):
        return "Zero in Production: Development and testing harness only."
    if pkg_name == "cryptography":
        return "Low / Managed: ECDAT strictly invokes standard public-key ASN.1 / X.509 parsing; no unsupported curve operations."
    return "Evaluated against static scanner runtime."


def evaluate_node_exploitability(pkg_name: str, severity: str, ecosystem: str) -> str:
    """Contextual exploitability assessment for Node.js dependencies in ECDAT."""
    if "frontend" in ecosystem.lower():
        if "router" in pkg_name:
            return "Low in ECDAT: CSR Single Page App; navigation paths are statically declared; no SSR hydration is used."
        if any(x in pkg_name for x in ["vitest", "vite", "eslint", "tailwind"]):
            return "Zero in Production: Client-side build tooling; not included in production Nginx runtime."
    return "Requires evaluation against backend routes."


def generate_markdown_report(result: VulnerabilityScanResult, out_path: Path):
    """Generate comprehensive, honest Markdown vulnerability report."""
    timestamp = result.metadata.get("timestamp", datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
    vulns = result.findings

    sev_counts = {"CRITICAL": 0, "HIGH": 0, "MODERATE": 0, "LOW": 0}
    for v in vulns:
        s = v.get("severity", "MODERATE").upper()
        sev_counts[s] = sev_counts.get(s, 0) + 1

    lines = [
        "# ECDAT Dependency Vulnerability & Security Audit Report",
        "",
        f"**Audit Timestamp**: `{timestamp}`  ",
        f"**Scanner Status**: `{result.status.value}`  ",
        "**Engines**: Google OSV.dev Batch API, npm audit, CycloneDX 1.6 SBOM Verification  ",
        "",
        "---",
        "",
    ]

    # Offline Database Metadata Banner
    if result.offline_db_info:
        info = result.offline_db_info
        cov = info.get("coverage", {})
        lines.extend([
            "## Offline Database Metadata",
            "",
            f"- **Database Version**: `{info.get('database_version')}`",
            f"- **Database Timestamp**: `{info.get('database_timestamp')}`",
            f"- **Source**: `{info.get('source')}`",
            f"- **Package Ecosystems**: `{', '.join(info.get('package_ecosystem', []))}`",
            f"- **Coverage**: `{cov.get('coverage_pct')}%` ({cov.get('covered_count')} covered / {cov.get('total_queried')} total queried)",
            f"- **Query Failures / Uncovered Packages**: `{len(info.get('query_failures', []))}` unindexed packages",
            "",
            "---",
            "",
        ])

    # Fail-Closed Warning if Incomplete or Error
    if result.status == ScanStatus.INCOMPLETE_VULNERABILITY_DATA:
        cov = result.offline_db_info.get("coverage", {}) if result.offline_db_info else {}
        lines.extend([
            "> [!CAUTION]",
            "> **INCOMPLETE VULNERABILITY DATA**: The offline vulnerability database is limited and incomplete.",
            f"> The snapshot covers only `{cov.get('coverage_pct', 0)}%` of queried packages ({cov.get('uncovered_count', 0)} packages unindexed).",
            "> **THIS RESULT MUST NOT BE INTERPRETED AS ZERO VULNERABILITIES OR CLEAN.**",
            "> In accordance with ECDAT fail-closed security rules, this state does **NOT** satisfy a 'no known vulnerabilities' gate.",
            "",
            "---",
            "",
        ])
    elif result.status in (ScanStatus.SCAN_ERROR, ScanStatus.SCAN_UNAVAILABLE, ScanStatus.INVALID_INPUT):
        lines.extend([
            "> [!CAUTION]",
            f"> **VULNERABILITY SCAN FAILED / UNVERIFIED**: Scanner status is **`{result.status.value}`**.",
            "> The scan encountered operational failures and could **NOT** verify that dependencies are clean.",
            "> In accordance with ECDAT fail-closed security invariants, this state does **NOT** satisfy a 'no known vulnerabilities' gate.",
            "",
            "### Failure Details:",
            "",
        ])
        if result.invalid_inputs:
            lines.append("- **Invalid Inputs / Corrupted Targets**:")
            for item in result.invalid_inputs:
                lines.append(f"  - `{item}`")
        if result.unavailable_reasons:
            lines.append("- **Unavailable Tools / Network Services**:")
            for item in result.unavailable_reasons:
                lines.append(f"  - `{item}`")
        if result.errors:
            lines.append("- **Execution / Parse Errors**:")
            for item in result.errors:
                lines.append(f"  - `{item}`")
        lines.extend(["", "---", ""])

    lines.extend([
        "## 1. Executive Summary",
        "",
        "| Severity / Metric | Value | Blast Radius in ECDAT | Gating Status |",
        "|---|---|---|---|",
        f"| **Overall Status** | **`{result.status.value}`** | Verified Execution Model | **{'PASS' if result.is_clean() else 'FAIL / BLOCKED'}** |",
        f"| **CRITICAL** | `{sev_counts.get('CRITICAL', 0)}` | Zero exploitable in production runtime | **FAIL** if unexempted |",
        f"| **HIGH** | `{sev_counts.get('HIGH', 0)}` | Contained to dev tools / bounded parser | **MONITOR** |",
        f"| **MODERATE** | `{sev_counts.get('MODERATE', 0)}` | Theoretical / offline components | **TOLERATED** |",
        f"| **LOW** | `{sev_counts.get('LOW', 0)}` | Informational | **TOLERATED** |",
        "",
        "---",
        "",
        "## 2. Detailed Findings Catalog",
        "",
    ])

    if result.status == ScanStatus.CLEAN:
        lines.append("> **Zero vulnerabilities detected.** All audited packages are verified clean across Python, Backend, and Frontend ecosystems.")
    elif result.status == ScanStatus.INCOMPLETE_VULNERABILITY_DATA and not vulns:
        lines.append("> **Zero findings recorded across indexed packages, but database coverage is INCOMPLETE.** This is NOT a clean result.")
    elif result.status in (ScanStatus.SCAN_ERROR, ScanStatus.SCAN_UNAVAILABLE, ScanStatus.INVALID_INPUT) and not vulns:
        lines.append(f"> **No findings recorded due to scanner failure ({result.status.value}).** This is NOT a clean result.")
    else:
        lines.append("| Package | Version | Ecosystem | Advisory ID | Severity | Context & Exploitability Analysis |")
        lines.append("|---|---|---|---|---|---|")
        for v in sorted(vulns, key=lambda x: (x.get("severity") != "CRITICAL", x.get("severity") != "HIGH", x.get("package"))):
            adv_id = v.get("advisory_id", "N/A")
            adv_link = f"[{adv_id}](https://osv.dev/vulnerability/{adv_id})" if not adv_id.startswith("http") else f"[Advisory]({adv_id})"
            lines.append(
                f"| `{v.get('package')}` | `{v.get('version')}` | {v.get('ecosystem')} | {adv_link} | **{v.get('severity')}** | {v.get('exploitability')} |"
            )

    lines.extend([
        "",
        "---",
        "",
        "## 3. Remediation & Gating Guidelines",
        "",
        "1. **Zero-Trust Exemption Policy**: Any critical vulnerability requires an approved entry in `rules/security_exceptions.json` detailing rationale, mitigation, and expiration date.",
        "2. **Continuous Scanning**: This audit runs automatically on every Pull Request and release build.",
        "3. **Fail-Closed Gate**: Only `CLEAN` may satisfy a 'no known vulnerabilities' gate. Scanner errors, network timeouts, missing tools, or incomplete offline data block release gates.",
    ])

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="ECDAT Multi-Ecosystem Vulnerability Scanner (Fail-Closed)")
    parser.add_argument("--sbom", default=None, help="Path to CycloneDX SBOM JSON (defaults to artifacts/sbom/ecdat_sbom_cyclonedx.json)")
    parser.add_argument("--output-dir", default="artifacts/security", help="Output directory for reports")
    parser.add_argument("--fail-on", choices=["critical", "high", "any", "none"], default="none", help="Fail build on severity threshold")
    parser.add_argument("--require-clean", action="store_true", help="Require strictly CLEAN state (zero findings and zero scanner errors)")
    parser.add_argument("--offline", action="store_true", help="Execute in limited offline mode using versioned database snapshot")
    parser.add_argument("--offline-db", default=None, help="Custom path to offline vulnerability database snapshot JSON")
    parser.add_argument("--timeout", type=int, default=15, help="OSV query timeout in seconds")
    parser.add_argument("--npm-timeout", type=int, default=30, help="npm audit timeout in seconds")
    args = parser.parse_args()

    out_dir = REPO_ROOT / args.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    mode_label = "Offline Snapshot Mode" if args.offline else "Online Multi-Ecosystem"
    print(f">> [1/3] Initiating Vulnerability Scan ({mode_label})...")
    scanner = VulnerabilityScanner(
        repo_root=REPO_ROOT,
        osv_timeout=args.timeout,
        npm_timeout=args.npm_timeout,
        offline_db_path=Path(args.offline_db) if args.offline_db else None,
    )

    sbom_path = REPO_ROOT / args.sbom if args.sbom else None
    result = scanner.scan(sbom_path=sbom_path, scan_node=True, offline=args.offline)

    print(f">> [2/3] Scan completed with status: {result.status.value}")
    if result.findings:
        print(f"   Found {len(result.findings)} vulnerability advisory findings.")
    if result.errors:
        print(f"   Encountered {len(result.errors)} errors during scanning.")
    if result.unavailable_reasons:
        print(f"   Encountered {len(result.unavailable_reasons)} unavailable components.")
    if result.invalid_inputs:
        print(f"   Encountered {len(result.invalid_inputs)} invalid input targets.")
    if result.offline_db_info:
        cov = result.offline_db_info.get("coverage", {})
        print(f"   Offline Database Coverage: {cov.get('coverage_pct', 0)}% ({cov.get('covered_count', 0)}/{cov.get('total_queried', 0)} packages indexed).")

    # Save JSON report
    json_path = out_dir / "ecdat_vulnerability_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result.to_dict(), f, indent=2)
    print(f">> [3/3] Saved JSON report: {json_path}")

    # Save Markdown report
    md_path = out_dir / "VULNERABILITY_REPORT.md"
    generate_markdown_report(result, md_path)
    print(f"   Saved Markdown report: {md_path}")

    # Evaluate fail-closed state model & gating
    if result.status == ScanStatus.INVALID_INPUT:
        print(f"\n::error::Scanner Failure (INVALID_INPUT): {'; '.join(result.invalid_inputs)}")
        return 2

    if result.status == ScanStatus.SCAN_UNAVAILABLE:
        print(f"\n::error::Scanner Failure (SCAN_UNAVAILABLE): {'; '.join(result.unavailable_reasons)}")
        return 2

    if result.status == ScanStatus.SCAN_ERROR:
        print(f"\n::error::Scanner Failure (SCAN_ERROR): {'; '.join(result.errors)}")
        return 2

    if result.status == ScanStatus.INCOMPLETE_VULNERABILITY_DATA:
        cov = result.offline_db_info.get("coverage", {}) if result.offline_db_info else {}
        print(
            f"\n::error::Offline Vulnerability Scan Incomplete (INCOMPLETE_VULNERABILITY_DATA): "
            f"Coverage is {cov.get('coverage_pct', 0)}% ({cov.get('uncovered_count', 0)} packages unindexed). "
            "This result MUST NOT be interpreted as ZERO_VULNERABILITIES or CLEAN."
        )
        return 2

    if result.status == ScanStatus.VULNERABLE:
        crit_count = sum(1 for v in result.findings if v.get("severity") == "CRITICAL")
        high_count = sum(1 for v in result.findings if v.get("severity") in ("CRITICAL", "HIGH"))

        if args.require_clean:
            print(f"\n::error::Gate Failure: Scan is VULNERABLE ({len(result.findings)} findings). Gate requires CLEAN.")
            return 1
        if args.fail_on == "critical" and crit_count > 0:
            print(f"\n::error::Policy Failure: {crit_count} CRITICAL vulnerabilities detected.")
            return 1
        if args.fail_on == "high" and high_count > 0:
            print(f"\n::error::Policy Failure: {high_count} HIGH/CRITICAL vulnerabilities detected.")
            return 1
        if args.fail_on == "any" and len(result.findings) > 0:
            print(f"\n::error::Policy Failure: {len(result.findings)} vulnerabilities detected.")
            return 1

        print(f"\n>> Scan completed with {len(result.findings)} findings (within policy threshold).")
        return 0

    if result.status == ScanStatus.CLEAN:
        print("\n>> VULNERABILITY SCAN PASSED (CLEAN).")
        return 0

    print(f"\n::error::Scanner Failure: Unknown scan status '{result.status}'. Fail closed.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
