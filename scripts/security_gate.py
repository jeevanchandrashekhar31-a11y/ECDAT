#!/usr/bin/env python3
"""
ECDAT Security Release Gate Engine — Phase 33.

The security release gate strictly enforces zero-trust release criteria.
Every control executes its verification command as a real subprocess in that run.
A control has exactly three possible states: PASS, FAIL, NOT_RUN.
  - PASS requires exit code 0 from a command executed in this run.
  - Non-zero exit code -> FAIL.
  - Command missing, timed out, or skipped -> NOT_RUN.
  - NOT_RUN must never be rendered as PASS.

The gate prints REJECTED and exits with code 1 if ANY control is FAIL or NOT_RUN.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@dataclass
class GateControlResult:
    control_id: int
    name: str
    status: str  # "PASS", "FAIL", "NOT_RUN"
    exit_code: Optional[int]
    fail_reason: str
    verified_evidence: Dict[str, Any]
    duration_sec: float
    output_summary: str = ""

    @property
    def passed(self) -> bool:
        return self.status == "PASS"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["passed"] = self.passed
        return d


class SecurityReleaseGate:
    """Orchestrates the 14 mandatory security gate evaluations."""

    DEFAULT_COMMANDS: Dict[int, Any] = {
        1: [sys.executable, "-m", "pytest", "tests/test_vulnerability_release_gate.py", "-k", "critical", "-q", "--disable-warnings"],
        2: [sys.executable, "-m", "pytest", "tests/test_vulnerability_release_gate.py", "-k", "high", "-q", "--disable-warnings"],
        3: {
            "pytest": [sys.executable, "-m", "pytest", "-q", "--disable-warnings"],
            "node": ["node", "--test"],
        },
        4: [sys.executable, "-m", "pytest", "tests/test_security_regressions.py", "-q", "--disable-warnings"],
        5: [sys.executable, "-m", "pytest", "tests/test_rbac_authorization.py", "tests/test_object_authorization.py", "security_tests/test_authorization_control.py", "-q", "--disable-warnings"],
        6: [sys.executable, "-m", "pytest", "tests/test_multi_tenancy_isolation.py", "security_tests/test_tenant_isolation_control.py", "-q", "--disable-warnings"],
        7: {
            "crash_check": [sys.executable, "-m", "scanners.ci_scanner", "--invalid-test-flag-for-crash-interception"],
            "tests": [sys.executable, "-m", "pytest", "security_tests/test_scanner_fail_closed_control.py", "-q", "--disable-warnings"],
        },
        8: [sys.executable, "-m", "pytest", "tests/test_vulnerability_scanner_fail_closed.py", "-q", "--disable-warnings"],
        9: [sys.executable, "-m", "pytest", "tests/test_secret_scanning_audit.py", "-q", "--disable-warnings"],
        10: [sys.executable, "-m", "pytest", "tests/test_cbom_17_compliance.py", "tests/test_cbom_correctness.py", "-q", "--disable-warnings"],
        11: [sys.executable, "-m", "pytest", "tests/test_container_hardening.py", "-q", "--disable-warnings"],
        12: [sys.executable, "-m", "pytest", "tests/test_k8s_hardening.py", "-q", "--disable-warnings"],
        13: [sys.executable, "-c", "import sys, pathlib; artifacts = ['artifacts/sbom/ecdat_sbom_cyclonedx.json', 'artifacts/sbom/ecdat_sbom_spdx.json', 'artifacts/security/DEPENDENCY_INVENTORY.json', 'artifacts/security/VULNERABILITY_REPORT.md', 'artifacts/security/DOCUMENTATION_TRUTH_AUDIT.md', 'artifacts/provenance/ecdat_provenance.slsa.json', 'artifacts/SHA256SUMS', 'artifacts/SHA256SUMS.sig', 'docs/competitive_capability_matrix.md']; missing = [a for a in artifacts if not (pathlib.Path(a).exists() and pathlib.Path(a).stat().st_size > 0)]; sys.exit(1 if missing else 0)"],
        14: [sys.executable, "scripts/sign_artifacts.py", "--verify"],
    }

    def __init__(
        self,
        repo_root: Optional[Path] = None,
        verbose: bool = False,
        control_commands: Optional[Dict[int, Any]] = None,
    ):
        self.repo_root = (repo_root or REPO_ROOT).resolve()
        self.verbose = verbose
        self.results: List[GateControlResult] = []
        self.control_commands: Dict[int, Any] = dict(self.DEFAULT_COMMANDS)
        if control_commands:
            self.control_commands.update(control_commands)

    def set_control_command(self, control_id: int, command: Any) -> None:
        """Allows injecting a custom or failing command into any control."""
        self.control_commands[control_id] = command

    def _log(self, msg: str) -> None:
        print(msg)

    def _run_subprocess(
        self, cmd: List[str], cwd: Optional[Path] = None, timeout: int = 120
    ) -> Tuple[str, Optional[int], str, str]:
        """
        Runs a command as a subprocess in this run.
        Returns (status, exit_code, stdout, stderr).
        status is one of: "PASS", "FAIL", "NOT_RUN".
        """
        if not cmd:
            return "NOT_RUN", None, "", "No command specified"
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(cwd or self.repo_root),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            status = "PASS" if proc.returncode == 0 else "FAIL"
            return status, proc.returncode, proc.stdout, proc.stderr
        except FileNotFoundError as fnf:
            return "NOT_RUN", None, "", f"Command executable not found: {fnf}"
        except subprocess.TimeoutExpired as te:
            return "NOT_RUN", None, "", f"Command timed out after {timeout}s: {te}"
        except Exception as ex:
            return "NOT_RUN", None, "", f"Command execution exception: {ex}"

    def _execute_standard_control(
        self, control_id: int, name: str, timeout: int = 60
    ) -> GateControlResult:
        t0 = time.perf_counter()
        cmd = self.control_commands.get(control_id)
        if not cmd:
            return GateControlResult(
                control_id=control_id,
                name=name,
                status="NOT_RUN",
                exit_code=None,
                fail_reason="No verification command configured",
                verified_evidence={},
                duration_sec=round(time.perf_counter() - t0, 3),
                output_summary="command missing",
            )

        status, exit_code, stdout, stderr = self._run_subprocess(cmd, timeout=timeout)
        duration = round(time.perf_counter() - t0, 3)

        if status == "NOT_RUN":
            return GateControlResult(
                control_id=control_id,
                name=name,
                status="NOT_RUN",
                exit_code=None,
                fail_reason=stderr or "Command skipped or timed out",
                verified_evidence={},
                duration_sec=duration,
                output_summary="NOT_RUN",
            )
        elif status == "FAIL":
            fail_msg = (stderr.strip()[-200:] or stdout.strip()[-200:] or f"Exit code {exit_code}")
            return GateControlResult(
                control_id=control_id,
                name=name,
                status="FAIL",
                exit_code=exit_code,
                fail_reason=f"Verification command failed (exit={exit_code}): {fail_msg}",
                verified_evidence={"stdout": stdout[-300:], "stderr": stderr[-300:]},
                duration_sec=duration,
                output_summary=f"exit={exit_code}",
            )
        else:
            return GateControlResult(
                control_id=control_id,
                name=name,
                status="PASS",
                exit_code=0,
                fail_reason="",
                verified_evidence={"exit_code": 0, "stdout_summary": stdout.strip().splitlines()[-1] if stdout.strip() else ""},
                duration_sec=duration,
                output_summary="exit=0",
            )

    # ------------------------------------------------------------------------
    # CONTROL 1: Critical Vulnerability Exists
    # ------------------------------------------------------------------------
    def check_01_critical_vulnerability(self) -> GateControlResult:
        return self._execute_standard_control(1, "critical vulnerability exists")

    # ------------------------------------------------------------------------
    # CONTROL 2: High Vulnerability Exists
    # ------------------------------------------------------------------------
    def check_02_high_vulnerability(self) -> GateControlResult:
        return self._execute_standard_control(2, "high vulnerability exists")

    # ------------------------------------------------------------------------
    # CONTROL 3: Test Suite Fails
    # ------------------------------------------------------------------------
    def check_03_test_suite(self, quick: bool = False) -> GateControlResult:
        t0 = time.perf_counter()
        name = "test suite"
        override = self.control_commands.get(3)

        if override and isinstance(override, list):
            status, exit_code, stdout, stderr = self._run_subprocess(override, timeout=180)
            combined = stdout + " " + stderr
            p_match = re.search(r"(\d+)\s+failed", combined)
            n_match = re.search(r"(?:#|ℹ)\s*fail\s+(\d+)", combined)
            x_count = combined.count("✖")
            failed_count = 0
            if p_match:
                failed_count += int(p_match.group(1))
            if n_match:
                failed_count += int(n_match.group(1))
            failed_count += x_count

            if status == "NOT_RUN":
                summary = "NOT_RUN"
                fail_reason = stderr or "Command not found or timed out"
            elif exit_code != 0 or failed_count > 0:
                status = "FAIL"
                summary = f"exit={exit_code}" + (f", {failed_count} failed" if failed_count > 0 else "")
                fail_reason = f"Test runner reported failures or exited non-zero ({summary})"
            else:
                status = "PASS"
                summary = f"exit={exit_code}"
                fail_reason = ""

            return GateControlResult(
                control_id=3,
                name=name,
                status=status,
                exit_code=exit_code,
                fail_reason=fail_reason,
                verified_evidence={"stdout": stdout[-500:], "stderr": stderr[-500:]},
                duration_sec=round(time.perf_counter() - t0, 3),
                output_summary=summary,
            )

        # Default Control 03: run pytest and node --test
        if quick:
            pytest_cmd = [sys.executable, "-m", "pytest", "security_tests/", "-q", "--disable-warnings"]
            node_cmd = ["node", "--test", "tests/api/approval_api.test.js"]
        else:
            pytest_cmd = [sys.executable, "-m", "pytest", "-q", "--disable-warnings"]
            node_cmd = ["node", "--test"]

        # Only apply override if caller explicitly set a custom command (not just the default)
        if override and override != self.DEFAULT_COMMANDS.get(3):
            if isinstance(override, dict):
                pytest_cmd = override.get("pytest", pytest_cmd)
                node_cmd = override.get("node", node_cmd)

        p_status, p_exit, p_out, p_err = self._run_subprocess(pytest_cmd, timeout=180)

        # Parse pytest output for failures
        pytest_output = p_out + " " + p_err
        p_match = re.search(r"(\d+)\s+failed", pytest_output)
        p_failed_count = int(p_match.group(1)) if p_match else (1 if p_exit != 0 else 0)

        # Run node --test in backend/
        n_status, n_exit, n_out, n_err = self._run_subprocess(
            node_cmd, cwd=self.repo_root / "backend", timeout=180
        )
        node_output = n_out + " " + n_err
        n_match = re.search(r"(?:#|ℹ)\s*fail\s+(\d+)", node_output)
        n_failed_count = int(n_match.group(1)) if n_match else (1 if n_exit != 0 else 0)
        x_count = node_output.count("✖")
        total_node_fails = max(n_failed_count, x_count)

        is_not_run = p_status == "NOT_RUN" or n_status == "NOT_RUN"
        has_failed = (
            p_exit != 0
            or p_failed_count > 0
            or n_exit != 0
            or total_node_fails > 0
            or p_status == "FAIL"
            or n_status == "FAIL"
        )

        if is_not_run:
            status = "NOT_RUN"
            exit_code = p_exit if p_exit is not None else n_exit
            summary = f"pytest={p_status}, node={n_status}"
            fail_reason = "Test runner could not be executed or timed out"
        elif has_failed:
            status = "FAIL"
            exit_code = p_exit if p_exit != 0 else (n_exit if n_exit is not None else 1)
            parts = []
            if p_exit != 0 or p_failed_count > 0:
                parts.append(f"pytest exit={p_exit}, {p_failed_count} failed")
            if n_exit != 0 or total_node_fails > 0:
                parts.append(f"node exit={n_exit}, {total_node_fails} failed")
            summary = "; ".join(parts) if parts else f"pytest exit={p_exit}, node exit={n_exit}"
            fail_reason = summary
        else:
            status = "PASS"
            exit_code = 0
            summary = "pytest exit=0, node exit=0"
            fail_reason = ""

        return GateControlResult(
            control_id=3,
            name=name,
            status=status,
            exit_code=exit_code,
            fail_reason=fail_reason,
            verified_evidence={
                "pytest_exit": p_exit,
                "pytest_failed": p_failed_count,
                "node_exit": n_exit,
                "node_failed": total_node_fails,
            },
            duration_sec=round(time.perf_counter() - t0, 3),
            output_summary=summary,
        )

    # ------------------------------------------------------------------------
    # CONTROL 4: Security Regression Fails
    # ------------------------------------------------------------------------
    def check_04_security_regression(self) -> GateControlResult:
        return self._execute_standard_control(4, "security regression fails")

    # ------------------------------------------------------------------------
    # CONTROL 5: Authorization Regression Fails
    # ------------------------------------------------------------------------
    def check_05_authorization_regression(self) -> GateControlResult:
        return self._execute_standard_control(5, "authorization regression fails")

    # ------------------------------------------------------------------------
    # CONTROL 6: Tenant Isolation Fails
    # ------------------------------------------------------------------------
    def check_06_tenant_isolation(self) -> GateControlResult:
        return self._execute_standard_control(6, "tenant isolation fails")

    # ------------------------------------------------------------------------
    # CONTROL 7: Scanner Fails Unexpectedly
    # ------------------------------------------------------------------------
    def check_07_scanner_crash_interception(self) -> GateControlResult:
        t0 = time.perf_counter()
        name = "scanner fails unexpectedly"
        cmd_cfg = self.control_commands.get(7)
        if isinstance(cmd_cfg, list):
            status, exit_code, stdout, stderr = self._run_subprocess(cmd_cfg, timeout=60)
            duration = round(time.perf_counter() - t0, 3)
            return GateControlResult(
                control_id=7,
                name=name,
                status=status,
                exit_code=exit_code,
                fail_reason="" if status == "PASS" else f"Exit code {exit_code}: {stderr[:200] or stdout[:200]}",
                verified_evidence={"stdout": stdout[-300:], "stderr": stderr[-300:]},
                duration_sec=duration,
                output_summary=f"exit={exit_code}" if exit_code is not None else "NOT_RUN",
            )

        # 1. Deterministic exit code check: invalid invocation must exit with code 2
        crash_cmd = [sys.executable, "-m", "scanners.ci_scanner", "--invalid-test-flag-for-crash-interception"]
        c_status, c_exit, c_out, c_err = self._run_subprocess(crash_cmd, timeout=30)
        if c_status == "NOT_RUN":
            return GateControlResult(
                control_id=7,
                name=name,
                status="NOT_RUN",
                exit_code=None,
                fail_reason=c_err or "Crash check command timed out or not found",
                verified_evidence={},
                duration_sec=round(time.perf_counter() - t0, 3),
                output_summary="NOT_RUN",
            )
        if c_exit != 2:
            return GateControlResult(
                control_id=7,
                name=name,
                status="FAIL",
                exit_code=c_exit,
                fail_reason=f"Scanner did not intercept invalid invocation with exit code 2 (got {c_exit})",
                verified_evidence={"stdout": c_out[:200], "stderr": c_err[:200]},
                duration_sec=round(time.perf_counter() - t0, 3),
                output_summary=f"exit={c_exit}",
            )

        # 2. Scanner fail-closed regression tests
        test_cmd = [sys.executable, "-m", "pytest", "security_tests/test_scanner_fail_closed_control.py", "-q", "--disable-warnings"]
        t_status, t_exit, t_out, t_err = self._run_subprocess(test_cmd, timeout=30)
        duration = round(time.perf_counter() - t0, 3)
        if t_status == "NOT_RUN":
            return GateControlResult(
                control_id=7,
                name=name,
                status="NOT_RUN",
                exit_code=None,
                fail_reason=t_err or "Scanner fail-closed tests timed out or not found",
                verified_evidence={},
                duration_sec=duration,
                output_summary="NOT_RUN",
            )
        if t_exit != 0:
            return GateControlResult(
                control_id=7,
                name=name,
                status="FAIL",
                exit_code=t_exit,
                fail_reason=f"Scanner fail-closed tests failed: {t_err[:200] or t_out[:200]}",
                verified_evidence={"stdout": t_out[-300:], "stderr": t_err[-300:]},
                duration_sec=duration,
                output_summary=f"exit={t_exit}",
            )

        return GateControlResult(
            control_id=7,
            name=name,
            status="PASS",
            exit_code=0,
            fail_reason="",
            verified_evidence={"crash_check_exit": 2, "fail_closed_tests_exit": 0},
            duration_sec=duration,
            output_summary="exit=0",
        )

    # ------------------------------------------------------------------------
    # CONTROL 8: Dependency Scan is Incomplete
    # ------------------------------------------------------------------------
    def check_08_dependency_scan_completeness(self) -> GateControlResult:
        return self._execute_standard_control(8, "dependency scan is incomplete")

    # ------------------------------------------------------------------------
    # CONTROL 9: Secret Scan Fails
    # ------------------------------------------------------------------------
    def check_09_secret_scan(self) -> GateControlResult:
        return self._execute_standard_control(9, "secret scan fails")

    # ------------------------------------------------------------------------
    # CONTROL 10: CBOM Validation Fails
    # ------------------------------------------------------------------------
    def check_10_cbom_validation(self) -> GateControlResult:
        return self._execute_standard_control(10, "CBOM validation fails")

    # ------------------------------------------------------------------------
    # CONTROL 11: Container Scan Fails
    # ------------------------------------------------------------------------
    def check_11_container_scan(self) -> GateControlResult:
        return self._execute_standard_control(11, "container scan fails")

    # ------------------------------------------------------------------------
    # CONTROL 12: Kubernetes Policy Fails
    # ------------------------------------------------------------------------
    def check_12_kubernetes_policy(self) -> GateControlResult:
        return self._execute_standard_control(12, "Kubernetes policy fails")

    # ------------------------------------------------------------------------
    # CONTROL 13: Required Artifact Missing
    # ------------------------------------------------------------------------
    def check_13_required_artifacts(self) -> GateControlResult:
        return self._execute_standard_control(13, "required artifact missing")

    # ------------------------------------------------------------------------
    # CONTROL 14: Required Security Evidence Missing
    # ------------------------------------------------------------------------
    def check_14_security_evidence(self) -> GateControlResult:
        return self._execute_standard_control(14, "required security evidence missing")

    # ------------------------------------------------------------------------
    # Execution Runner
    # ------------------------------------------------------------------------
    def execute(self, quick: bool = False) -> Tuple[bool, List[GateControlResult]]:
        """Runs all 14 mandatory controls in sequence."""
        self._log("=" * 80)
        self._log("ECDAT SECURITY RELEASE GATE — 14 MANDATORY CONTROLS EVALUATION")
        self._log("=" * 80)

        checks = [
            ("C01", lambda: self.check_01_critical_vulnerability()),
            ("C02", lambda: self.check_02_high_vulnerability()),
            ("C03", lambda: self.check_03_test_suite(quick=quick)),
            ("C04", lambda: self.check_04_security_regression()),
            ("C05", lambda: self.check_05_authorization_regression()),
            ("C06", lambda: self.check_06_tenant_isolation()),
            ("C07", lambda: self.check_07_scanner_crash_interception()),
            ("C08", lambda: self.check_08_dependency_scan_completeness()),
            ("C09", lambda: self.check_09_secret_scan()),
            ("C10", lambda: self.check_10_cbom_validation()),
            ("C11", lambda: self.check_11_container_scan()),
            ("C12", lambda: self.check_12_kubernetes_policy()),
            ("C13", lambda: self.check_13_required_artifacts()),
            ("C14", lambda: self.check_14_security_evidence()),
        ]

        self.results = []
        all_passed = True

        for code, check_fn in checks:
            res = check_fn()
            self.results.append(res)
            icon = f"[{res.status}]"
            if res.status == "PASS":
                details = f"PASS ({res.output_summary or 'exit=0'})"
            elif res.status == "FAIL":
                details = f"FAIL ({res.output_summary or f'exit={res.exit_code}'})"
                all_passed = False
            else:
                details = f"NOT_RUN ({res.fail_reason or 'command missing, timed out, or skipped'})"
                all_passed = False

            self._log(f"  {icon} Control {res.control_id:02d}: {res.name.upper():<35} -> {details}")

        self._log("=" * 80)
        if all_passed and len(self.results) == 14:
            self._log(">> [SECURITY GATE APPROVED] ALL 14 MANDATORY CONTROLS VERIFIED WITH EVIDENCE")
        else:
            self._log(">> [SECURITY GATE REJECTED] ONE OR MORE MANDATORY CONTROLS FAILED")
        self._log("=" * 80)

        return (all_passed and len(self.results) == 14), self.results

    def generate_json_report(self, output_path: Path) -> None:
        """Saves machine-readable JSON evaluation report."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        all_passed = all(r.status == "PASS" for r in self.results) and len(self.results) == 14
        report = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "overall_status": "RELEASE_APPROVED" if all_passed else "RELEASE_REJECTED",
            "controls_evaluated": len(self.results),
            "passed_count": sum(1 for r in self.results if r.status == "PASS"),
            "failed_count": sum(1 for r in self.results if r.status == "FAIL"),
            "not_run_count": sum(1 for r in self.results if r.status == "NOT_RUN"),
            "controls": [r.to_dict() for r in self.results],
        }
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        self._log(f">> Security Gate JSON report written to: {output_path}")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="ECDAT Security Release Gate Engine (Phase 33)")
    parser.add_argument("--quick", action="store_true", help="Run optimized check targets")
    parser.add_argument("--json", action="store_true", help="Print JSON report to stdout")
    parser.add_argument("--report-dir", type=Path, default=REPO_ROOT / "artifacts" / "security", help="Output directory")
    args = parser.parse_args(argv)

    gate = SecurityReleaseGate(verbose=True)
    passed, results = gate.execute(quick=args.quick)

    # Note: Do not write any .md file per security instructions
    json_report = args.report_dir / "security_gate_report.json"
    gate.generate_json_report(json_report)

    if args.json:
        print(json_report.read_text(encoding="utf-8"))

    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
