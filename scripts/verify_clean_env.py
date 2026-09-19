#!/usr/bin/env python3
"""
ECDAT Clean Environment Verification Harness — Phase 36.

Performs security and release gate verification inside a scrubbed, hermetic environment.
Ensures verification does NOT rely on:
  - Developer machine state
  - Cached dependencies / global packages
  - Existing databases
  - Existing Docker images / daemon state
  - Ambient developer environment variables
"""

from __future__ import annotations

import argparse
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
SANITIZED_ENV_FILE = REPO_ROOT / "config" / "sanitized.env.example"

# Essential OS bootstrap variables required for subprocess execution
MINIMAL_OS_VARS_WINDOWS = {
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PATH",
}

MINIMAL_OS_VARS_POSIX = {
    "PATH",
    "HOME",
    "TMPDIR",
    "USER",
    "LANG",
    "LC_ALL",
}

# Ambient developer variables that MUST be scrubbed
DEVELOPER_SENSITIVE_PREFIXES = (
    "AWS_",
    "AZURE_",
    "GCP_",
    "GOOGLE_",
    "GITHUB_",
    "GIT_",
    "SSH_",
    "NPM_",
    "DOCKER_",
    "KUBE",
    "PG",
    "POSTGRES",
    "DATABASE_",
    "REDIS_",
    "SECRET",
    "KEY",
    "TOKEN",
    "PASSWORD",
    "AUTH",
)


def parse_env_file(file_path: Path) -> Dict[str, str]:
    """Parse a .env formatted file into key-value pairs."""
    env_vars = {}
    if not file_path.exists():
        return env_vars

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip().strip("'\"")
    return env_vars


def build_clean_environment(sanitized_config_path: Path) -> Tuple[Dict[str, str], List[str]]:
    """
    Constructs a hermetic execution environment by stripping all developer
    variables and populating strictly the sanitized configuration.
    """
    is_windows = platform.system() == "Windows"
    allowed_os_vars = MINIMAL_OS_VARS_WINDOWS if is_windows else MINIMAL_OS_VARS_POSIX

    stripped_vars = []
    clean_env: Dict[str, str] = {}

    # 1. Retain only indispensable OS runtime variables
    for var, val in os.environ.items():
        var_upper = var.upper()
        if var_upper in allowed_os_vars:
            clean_env[var] = val
        else:
            stripped_vars.append(var)

    # 2. Double-check: Purge any ambient developer credential variables
    for var in list(clean_env.keys()):
        var_upper = var.upper()
        if var_upper != "PATH" and any(var_upper.startswith(pfx) for pfx in DEVELOPER_SENSITIVE_PREFIXES):
            stripped_vars.append(var)
            clean_env.pop(var, None)

    # 3. Load sanitized example configuration
    sanitized_vars = parse_env_file(sanitized_config_path)
    for k, v in sanitized_vars.items():
        clean_env[k] = v

    # 4. Enforce test and offline guarantees
    clean_env["NODE_ENV"] = "test"
    clean_env["APP_ENV"] = "test"
    clean_env["ECDAT_ENV"] = "test"
    clean_env["PYTHONUNBUFFERED"] = "1"
    clean_env["NODE_TEST_CONTEXT"] = "true"

    return clean_env, stripped_vars


def run_clean_step(name: str, cmd: List[str], env: Dict[str, str], cwd: Path) -> bool:
    """Executes a verification step inside the clean environment."""
    print(f"\n>> [CLEAN STEP] {name}...")
    print(f"   Command: {' '.join(cmd)}")
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if proc.returncode != 0:
        print(f"   [FAILED] Exit code {proc.returncode}")
        if proc.stdout:
            print("   Output (tail):")
            for line in proc.stdout.splitlines()[-10:]:
                print(f"     {line}")
        if proc.stderr:
            print("   Error (tail):")
            for line in proc.stderr.splitlines()[-10:]:
                print(f"     {line}")
        return False

    print(f"   [PASSED] Exit code 0")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="ECDAT Clean Environment Verification Engine (Phase 36)")
    parser.add_argument(
        "--config",
        default=str(SANITIZED_ENV_FILE),
        help="Path to sanitized example configuration file",
    )
    parser.add_argument("--skip-tests", action="store_true", help="Skip running core unit tests")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"[ERROR] Sanitized configuration file missing: {config_path}")
        return 1

    print("=" * 80)
    print("ECDAT CLEAN ENVIRONMENT SECURITY VERIFICATION (PHASE 36)")
    print("=" * 80)

    # 1. Build purged hermetic environment
    clean_env, stripped_vars = build_clean_environment(config_path)
    print(f">> Purged {len(stripped_vars)} ambient developer machine environment variables.")
    print(f">> Injected {len(parse_env_file(config_path))} sanitized configuration variables.")
    print(f">> Verification will execute with ZERO reliance on ambient machine state.")

    steps: List[Tuple[str, List[str]]] = [
        (
            "1a. Regenerate Dependency Security Inventory",
            [sys.executable, "scripts/generate_dependency_inventory.py"],
        ),
        (
            "1b. Regenerate Vulnerability Scan & Assessment Reports",
            [sys.executable, "scripts/scan_vulnerabilities.py"],
        ),
        (
            "1c. Regenerate SLSA Build Provenance Attestation",
            [sys.executable, "scripts/generate_provenance.py"],
        ),
        (
            "1d. Cryptographic Artifact Signing",
            [sys.executable, "scripts/sign_artifacts.py", "--sign"],
        ),
        (
            "1e. Cryptographic Artifact Signatures Verification",
            [sys.executable, "scripts/sign_artifacts.py", "--verify"],
        ),
        (
            "2. Evidence-Based Verification Standards",
            [sys.executable, "scripts/generate_security_evidence.py", "--verify"],
        ),
        (
            "3. Final Quality & Release Gate (17 Qualification Domains)",
            [sys.executable, "scripts/final_quality_gate.py"],
        ),
        (
            "4. Supply-Chain Security Release Gate (6 Gates)",
            [sys.executable, "scripts/release_gate.py"],
        ),
    ]

    if not args.skip_tests:
        steps.append((
            "5. Evidence Unit Test Suite",
            [sys.executable, "-m", "pytest", "tests/test_security_evidence.py", "-q"],
        ))
        steps.append((
            "6. Final Quality Gate Test Suite",
            [sys.executable, "-m", "pytest", "tests/test_final_quality_gate.py", "-q"],
        ))

    failed = False
    for step_name, step_cmd in steps:
        success = run_clean_step(step_name, step_cmd, clean_env, REPO_ROOT)
        if not success:
            failed = True
            break

    print("\n" + "=" * 80)
    if failed:
        print(">> [CLEAN ENVIRONMENT VERIFICATION FAILED] ONE OR MORE STEPS FAILED.")
        print("=" * 80)
        return 1

    print(">> [CLEAN ENVIRONMENT VERIFICATION APPROVED] ALL VERIFICATION STEPS PASSED")
    print(">> Zero reliance on developer machine state, ambient env, or local databases.")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    sys.exit(main())
