#!/usr/bin/env python3
"""
ECDAT Automated Supply-Chain Release Gate Engine.
Enforces zero-trust release criteria aligned with SLSA Level 3 & OpenSSF.

A release MUST fail if:
1. Critical known exploitable dependency exists without documented exception
2. Secrets are detected
3. Critical security tests fail
4. Artifact integrity verification fails
5. Security scanner crashes silently (deterministic failure handling)
6. Required SBOM is missing or invalid

Exit Codes:
  0 = ALL GATES PASSED (Release Approved)
  1 = RELEASE GATE VIOLATION (Release Blocked)
  2 = INTERNAL RUNNER ERROR
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scanners.vulnerability_release_gate import VulnerabilityReleaseGateEngine
from scanners.static.secret_detector import SecretSafeDetector

# Exclude strictly build caches, virtualenvs, local signing key files, and adversarial DoS/benchmark bomb fixtures.
# NEVER broadly whitelist tests/, docs/, examples/, rules/, artifacts/!
EXCLUDED_BUILD_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    ".keys",
    "coverage",
    "hostile_repo",
    "large_repos",
    "malicious_archives",
}
NON_SECRET_LOCKFILES = {
    "package-lock.json",
    "backend/package-lock.json",
    "frontend/package-lock.json",
    "requirements.lock",
    "requirements-lock.txt",
    "REPO_INVENTORY.json",
    "artifacts/SHA256SUMS.sig",
}


class ReleaseGateEvaluator:
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.results: List[Dict[str, Any]] = []
        self.overall_status = "PASS"

    def record_check(self, name: str, passed: bool, message: str, details: Optional[Dict[str, Any]] = None):
        status_str = "PASS" if passed else "FAIL"
        if not passed:
            self.overall_status = "FAIL"
        self.results.append({
            "gate_name": name,
            "status": status_str,
            "message": message,
            "details": details or {}
        })
        icon = "[PASS]" if passed else "[FAIL]"
        print(f"   {icon} {name}: {message}")

    # ------------------------------------------------------------------------
    # GATE 1: Vulnerability Release Gate
    # ------------------------------------------------------------------------
    def check_vulnerability_gate(self) -> bool:
        print("\n>> [GATE 1/6] Evaluating Vulnerability Release Gate (CRITICAL/HIGH/MEDIUM/LOW)...")
        gate_engine = VulnerabilityReleaseGateEngine(repo_root=REPO_ROOT)
        
        # Load active findings from vulnerability report if present, or synthetic check
        vuln_report = REPO_ROOT / "artifacts" / "security" / "ecdat_vulnerability_report.json"
        findings = []
        if vuln_report.exists():
            try:
                with open(vuln_report, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    findings = data.get("findings", [])
            except Exception as e:
                self.record_check("Vulnerability Release Gate", False, f"Could not read vulnerability report: {e}")
                return False

        verdict = gate_engine.evaluate(findings)
        details = {
            "critical_blockers": len(verdict.critical_blockers),
            "unaccepted_highs": len(verdict.unaccepted_highs),
            "accepted_highs": len(verdict.accepted_highs),
            "tracked_remediations": len(verdict.tracked_remediations),
            "tracked_improvements": len(verdict.tracked_improvements),
            "tampering_violations": len(verdict.tampering_violations),
        }

        if not verdict.passed:
            msg = (f"Gate REJECTED: {len(verdict.critical_blockers)} critical blockers, "
                   f"{len(verdict.unaccepted_highs)} unaccepted high vulnerabilities, "
                   f"{len(verdict.tampering_violations)} tampering violations.")
            self.record_check("Vulnerability Release Gate", False, msg, details)
            return False

        msg = (f"Gate PASSED: 0 critical blockers, 0 unaccepted highs "
               f"({len(verdict.accepted_highs)} accepted highs, "
               f"{len(verdict.tracked_remediations)} tracked remediations, "
               f"{len(verdict.tracked_improvements)} tracked improvements, "
               f"{len(verdict.tampering_violations)} tampering violations).")
        self.record_check("Vulnerability Release Gate", True, msg, details)
        return True

    # ------------------------------------------------------------------------
    # GATE 2: Secret Detection
    # ------------------------------------------------------------------------
    def check_secrets_gate(self) -> bool:
        print("\n>> [GATE 2/6] Scanning Codebase and Artifacts for Leaked Secrets...")
        detected_secrets = []
        synthetic_fixtures_count = 0

        scan_extensions = {".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yml", ".yaml", ".env", ".sh", ".toml", ".md"}

        for root, dirs, files in os.walk(REPO_ROOT):
            # Prune excluded directories (caches and build artifacts only)
            dirs[:] = [d for d in dirs if d not in EXCLUDED_BUILD_DIRS]

            for file in files:
                file_path = Path(root) / file
                rel_path = file_path.relative_to(REPO_ROOT).as_posix()

                # Skip non-secret lockfiles and signatures
                if rel_path in NON_SECRET_LOCKFILES or any(rel_path.endswith("/" + f) for f in NON_SECRET_LOCKFILES):
                    continue

                if file_path.suffix.lower() not in scan_extensions and file != "Dockerfile":
                    continue

                try:
                    if file_path.stat().st_size > 5 * 1024 * 1024:
                        continue

                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()

                    _, candidates = SecretSafeDetector.detect_and_redact(
                        content, file_path=rel_path, test_mode=False
                    )

                    for cand in candidates:
                        if cand.is_synthetic:
                            synthetic_fixtures_count += 1
                        else:
                            detected_secrets.append({
                                "file": rel_path,
                                "line": cand.line_number,
                                "rule": cand.candidate_type,
                                "fingerprint": cand.safe_fingerprint,
                                "evidence": cand.minimal_evidence,
                            })
                except Exception as ex:
                    detected_secrets.append({
                        "file": rel_path,
                        "line": 1,
                        "rule": "FILE_READ_ERROR",
                        "fingerprint": "error",
                        "evidence": f"Could not scan file: {str(ex)}",
                    })

        if detected_secrets:
            msg = f"{len(detected_secrets)} hardcoded secrets detected across repository!"
            self.record_check("Secret Detection", False, msg, {
                "secrets": detected_secrets[:10],
                "synthetic_fixtures_permitted": synthetic_fixtures_count,
            })
            return False

        self.record_check(
            "Secret Detection",
            True,
            f"Zero leaked secrets or credentials detected across tracked files ({synthetic_fixtures_count} certified synthetic fixtures verified)."
        )
        return True

    # ------------------------------------------------------------------------
    # GATE 3: Critical Security Tests
    # ------------------------------------------------------------------------
    def check_security_tests_gate(self) -> bool:
        print("\n>> [GATE 3/6] Running Critical Security & Cryptographic Regression Tests...")
        # 1. Enforce Regression Policy (Phase 22.4 Mandate)
        try:
            from scanners.regression_policy import SecurityRegressionPolicyEngine
            engine = SecurityRegressionPolicyEngine()
            verdict = engine.enforce_policy()
            if not verdict.passed:
                self.record_check("Regression Policy Mandate", False, f"Regression policy check failed: {verdict.summary}")
                return False
            self.record_check("Regression Policy Mandate", True, f"All {verdict.verified_regressions} registered security bugs satisfy 5-point closure standard.")
        except Exception as e:
            self.record_check("Regression Policy Mandate", False, f"Regression policy engine failed: {e}")
            return False

        # 2. Run targeted security test files and adversarial test suite
        security_test_targets = [
            "tests/test_parity_audit.py",
            "tests/test_evidence_integrity.py",
            "tests/test_technical_reporting.py",
            "tests/test_executive_reporting.py",
            "tests/test_production_configuration.py",
            "tests/test_k8s_hardening.py",
            "tests/test_container_hardening.py",
            "tests/test_vulnerability_release_gate.py",
            "tests/test_security_regressions.py",
            "tests/test_security_regression_architecture.py",
            "tests/redteam/test_appsec_assessment.py",
            "tests/redteam/test_adversarial_scanner_assessment.py",
            "tests/test_golden_corpus.py",
            "tests/test_fuzz_parsers.py",
            "tests/test_adversarial_scanner.py",
            "tests/test_final_quality_gate.py",
            "security_tests",
        ]

        existing_targets = [t for t in security_test_targets if (REPO_ROOT / t).exists()]
        if not existing_targets:
            existing_targets = ["tests/", "security_tests/"]

        cmd = [sys.executable, "-m", "pytest"] + existing_targets + ["-q", "--disable-warnings"]
        try:
            proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=90)
            if proc.returncode != 0:
                msg = f"Security test suite failed (exit code {proc.returncode})."
                self.record_check("Critical Security Tests", False, msg, {"stderr": proc.stderr[:300], "stdout": proc.stdout[:300]})
                return False

            # Run Node.js adversarial security test suite if present
            node_test_path = REPO_ROOT / "backend" / "tests" / "security" / "adversarial_controls.test.js"
            if node_test_path.exists():
                node_proc = subprocess.run(
                    ["node", "--test", str(node_test_path)],
                    cwd=str(REPO_ROOT),
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if node_proc.returncode != 0:
                    msg = f"Node.js adversarial security tests failed (exit code {node_proc.returncode})."
                    self.record_check("Critical Security Tests", False, msg, {"stderr": node_proc.stderr[:300], "stdout": node_proc.stdout[:300]})
                    return False

            self.record_check("Critical Security Tests", True, "All critical security and cryptographic test suites (Python & Node.js adversarial) PASSED successfully.")
            return True
        except Exception as e:
            self.record_check("Critical Security Tests", False, f"Failed to execute security tests: {e}")
            return False

    # ------------------------------------------------------------------------
    # GATE 4: Artifact Integrity Verification
    # ------------------------------------------------------------------------
    def check_artifact_integrity_gate(self) -> bool:
        print("\n>> [GATE 4/6] Verifying Artifact Checksums and Digital Signatures...")
        sign_script = REPO_ROOT / "scripts" / "sign_artifacts.py"
        if not sign_script.exists():
            self.record_check("Artifact Integrity Verification", False, "Signing utility script missing.")
            return False

        cmd = [sys.executable, str(sign_script), "--verify"]
        try:
            proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=30)
            if proc.returncode != 0:
                self.record_check("Artifact Integrity Verification", False, f"Signature/Checksum verification failed: {proc.stdout[:200]}")
                return False

            self.record_check("Artifact Integrity Verification", True, "Ed25519 digital signature and SHA-256/SHA-512 artifact checksums are VALID.")
            return True
        except Exception as e:
            self.record_check("Artifact Integrity Verification", False, f"Verification error: {e}")
            return False

    # ------------------------------------------------------------------------
    # GATE 5: Silent Scanner Crash Detection
    # ------------------------------------------------------------------------
    def check_silent_scanner_crash_gate(self) -> bool:
        print("\n>> [GATE 5/6] Verifying Scanner Exit Code Integrity & Crash Interception...")
        # 1. Verify that scanner error codes (exit code 2) are NEVER conflated with 0 (clean).
        ci_scanner_file = REPO_ROOT / "scanners" / "ci_scanner.py"
        if not ci_scanner_file.exists():
            self.record_check("Silent Scanner Crash Detection", False, "scanners/ci_scanner.py missing.")
            return False

        # Execute CI scanner with an intentionally invalid argument to verify deterministic exit code 2 or 3
        test_cmd = [sys.executable, "-m", "scanners.ci_scanner", "--non-existent-flag-test-crash"]
        proc = subprocess.run(test_cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)

        if proc.returncode == 0:
            self.record_check("Silent Scanner Crash Detection", False, "Scanner silently exited with 0 on invalid command line arguments!")
            return False

        # 2. Verify no subprocess invocations in scripts or scanners use POSIX-broken shell=True with list args
        import ast
        dangerous_calls = []
        for search_dir in ["scripts", "scanners"]:
            for py_file in (REPO_ROOT / search_dir).rglob("*.py"):
                try:
                    tree = ast.parse(py_file.read_text(encoding="utf-8"))
                    for node in ast.walk(tree):
                        if isinstance(node, ast.Call):
                            is_shell_true = any(k.arg == "shell" and isinstance(k.value, ast.Constant) and k.value.value is True for k in node.keywords)
                            has_list_arg = node.args and isinstance(node.args[0], (ast.List, ast.Tuple))
                            if is_shell_true and has_list_arg:
                                dangerous_calls.append(f"{py_file.relative_to(REPO_ROOT)}:{node.lineno}")
                except Exception:
                    pass

        if dangerous_calls:
            self.record_check(
                "Silent Scanner Crash Detection",
                False,
                f"POSIX-broken subprocess.run(list, shell=True) detected in: {', '.join(dangerous_calls)}"
            )
            return False

        # Verify exit code is strictly non-zero and subprocess calls are clean
        self.record_check(
            "Silent Scanner Crash Detection",
            True,
            f"Scanner deterministically caught error with non-zero exit code ({proc.returncode}); zero shell=True list invocations detected."
        )
        return True

    # ------------------------------------------------------------------------
    # GATE 6: Required SBOM Presence & Validation
    # ------------------------------------------------------------------------
    def check_required_sbom_gate(self) -> bool:
        print("\n>> [GATE 6/6] Verifying Required SBOM Presence and Schema Compliance...")
        cdx_file = REPO_ROOT / "artifacts" / "sbom" / "ecdat_sbom_cyclonedx.json"
        spdx_file = REPO_ROOT / "artifacts" / "sbom" / "ecdat_sbom_spdx.json"

        if not cdx_file.exists():
            self.record_check("Required SBOM Verification", False, f"Missing required CycloneDX SBOM: {cdx_file.name}")
            return False

        if not spdx_file.exists():
            self.record_check("Required SBOM Verification", False, f"Missing required SPDX SBOM: {spdx_file.name}")
            return False

        # Validate CycloneDX structure
        try:
            with open(cdx_file, "r", encoding="utf-8") as f:
                cdx = json.load(f)

            if cdx.get("bomFormat") != "CycloneDX" or cdx.get("specVersion") != "1.6":
                self.record_check("Required SBOM Verification", False, "CycloneDX SBOM missing valid bomFormat or specVersion 1.6.")
                return False

            components = cdx.get("components", [])
            if len(components) < 10:
                self.record_check("Required SBOM Verification", False, f"CycloneDX SBOM contains suspiciously few components ({len(components)}).")
                return False
        except Exception as e:
            self.record_check("Required SBOM Verification", False, f"Malformed CycloneDX SBOM JSON: {e}")
            return False

        # Validate SPDX structure
        try:
            with open(spdx_file, "r", encoding="utf-8") as f:
                spdx = json.load(f)

            if spdx.get("spdxVersion") != "SPDX-2.3" or not spdx.get("packages"):
                self.record_check("Required SBOM Verification", False, "SPDX SBOM missing valid spdxVersion SPDX-2.3 or packages array.")
                return False
        except Exception as e:
            self.record_check("Required SBOM Verification", False, f"Malformed SPDX SBOM JSON: {e}")
            return False

        self.record_check(
            "Required SBOM Verification",
            True,
            f"Required CycloneDX 1.6 ({len(components)} components) and SPDX 2.3 SBOMs are present, non-empty, and schema-valid."
        )
        return True

    def generate_report(self, out_dir: Path) -> Path:
        """Write JSON and Markdown Release Gate reports."""
        out_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        report_data = {
            "timestamp": timestamp,
            "overall_status": self.overall_status,
            "total_gates": len(self.results),
            "passed_gates": sum(1 for r in self.results if r["status"] == "PASS"),
            "failed_gates": sum(1 for r in self.results if r["status"] == "FAIL"),
            "gates": self.results
        }

        json_path = out_dir / "release_gate_report.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(report_data, f, indent=2)

        md_path = out_dir / "RELEASE_GATE_REPORT.md"
        lines = [
            "# ECDAT Supply-Chain Release Gate Audit Report",
            "",
            f"**Execution Timestamp**: `{timestamp}`  ",
            f"**Verdict**: **`{self.overall_status}`** ({report_data['passed_gates']}/{report_data['total_gates']} gates passed)  ",
            "",
            "---",
            "",
            "## Gate Evaluation Summary",
            "",
            "| Gate # | Gate Name | Verdict | Audit Finding / Assertion |",
            "|---|---|---|---|"
        ]

        for idx, g in enumerate(self.results, 1):
            verdict_badge = "**PASS**" if g["status"] == "PASS" else "<span style='color:red'>**FAIL**</span>"
            lines.append(f"| Gate {idx} | `{g['gate_name']}` | {verdict_badge} | {g['message']} |")

        lines.extend([
            "",
            "---",
            "",
            "## Policy Compliance Rules Enforced",
            "- **Rule 1**: 4-Tier Release Gate: CRITICAL is an unconditional release blocker; HIGH is a blocker unless formally risk accepted; MEDIUM is tracked remediation; LOW is tracked improvement. Lowering severity without documented evidence is strictly prohibited.",
            "- **Rule 2**: Secrets, tokens, and private keys are strictly prohibited in code and release bundles.",
            "- **Rule 3**: Cryptographic and security test suites must pass 100%.",
            "- **Rule 4**: Ed25519 cryptographic signature and SHA-256 checksums must verify.",
            "- **Rule 5**: Security scanner crashes and runtime errors must never be conflated with clean pass.",
            "- **Rule 6**: CycloneDX 1.6 and SPDX 2.3 SBOMs are mandatory release assets."
        ])

        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        return md_path


def main():
    parser = argparse.ArgumentParser(description="ECDAT Supply-Chain Release Gate Engine")
    parser.add_argument("--output-dir", default="artifacts/security", help="Directory for release gate reports")
    args = parser.parse_args()

    evaluator = ReleaseGateEvaluator()

    # Execute all 6 gates sequentially
    evaluator.check_vulnerability_gate()
    evaluator.check_secrets_gate()
    evaluator.check_security_tests_gate()
    evaluator.check_artifact_integrity_gate()
    evaluator.check_silent_scanner_crash_gate()
    evaluator.check_required_sbom_gate()

    out_dir = REPO_ROOT / args.output_dir
    report_file = evaluator.generate_report(out_dir)

    print(f"\n>> Release Gate Report generated at: {report_file}")
    if evaluator.overall_status == "PASS":
        print(">> ========================================================")
        print(">> [RELEASE APPROVED] ALL SUPPLY-CHAIN SECURITY GATES PASSED")
        print(">> ========================================================\n")
        return 0
    else:
        print(">> ========================================================")
        print(">> [RELEASE REJECTED] ONE OR MORE SECURITY GATES FAILED")
        print(">> ========================================================\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
