"""
Pytest Test Suite for Clean Environment Verification (Phase 36).

Verifies:
1. Ambient developer environment variables are strictly purged.
2. Sanitized configuration contains all required keys.
3. High-entropy synthetic secrets satisfy security guardrails.
4. Clean environment verification harness executes and passes with exit code 0.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.verify_clean_env import (
    REPO_ROOT,
    SANITIZED_ENV_FILE,
    build_clean_environment,
    parse_env_file,
)


def test_sanitized_config_file_exists_and_contains_required_keys():
    """Asserts that the sanitized configuration file exists and contains all required variables."""
    assert SANITIZED_ENV_FILE.exists(), f"Missing {SANITIZED_ENV_FILE}"
    parsed = parse_env_file(SANITIZED_ENV_FILE)

    required_keys = [
        "NODE_ENV",
        "PORT",
        "CORS_ORIGIN",
        "ECDAT_API_KEY",
        "DATA_ENCRYPTION_KEY",
        "JWT_SECRET",
        "REQUIRE_AUTH_FOR_READS",
        "DATABASE_URL",
        "DATABASE_SSL",
        "AUDIT_HMAC_SECRET",
        "SIEM_HMAC_SECRET",
        "SIEM_WEBHOOK_SECRET",
        "ECDAT_POLICY_SIGNING_KEY",
        "MAX_JSON_SIZE",
        "MAX_UPLOAD_BYTES",
        "UPLOAD_RATE_LIMIT",
        "RETENTION_SCANS_DAYS",
    ]

    for key in required_keys:
        assert key in parsed, f"Required configuration key '{key}' missing from sanitized.env.example"
        assert len(parsed[key]) > 0, f"Key '{key}' is empty"


def test_sanitized_secrets_satisfy_entropy_and_length_guards():
    """Verifies that all synthetic secrets in sanitized config satisfy length >= 32 characters."""
    parsed = parse_env_file(SANITIZED_ENV_FILE)

    secret_keys = [
        "ECDAT_API_KEY",
        "DATA_ENCRYPTION_KEY",
        "JWT_SECRET",
        "AUDIT_HMAC_SECRET",
        "SIEM_HMAC_SECRET",
        "SIEM_WEBHOOK_SECRET",
        "ECDAT_POLICY_SIGNING_KEY",
    ]

    for key in secret_keys:
        val = parsed[key]
        assert len(val) >= 32, f"Key '{key}' is shorter than 32 characters: length {len(val)}"
        assert not val.startswith("change-this"), f"Key '{key}' uses prohibited prefix"
        assert not val.startswith("test-"), f"Key '{key}' uses prohibited prefix"


def test_build_clean_environment_purges_developer_vars(monkeypatch):
    """Verifies that build_clean_environment purges sensitive developer variables."""
    # Inject simulated ambient developer variables
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "simulated_aws_secret_key_12345")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_simulatedgithubtoken1234567890")
    monkeypatch.setenv("DATABASE_URL", "postgresql://ambient_dev:pass@localhost:5432/ambient_db")
    monkeypatch.setenv("DOCKER_HOST", "tcp://localhost:2375")

    clean_env, stripped = build_clean_environment(SANITIZED_ENV_FILE)

    # Ambient vars must be in stripped list
    assert "AWS_SECRET_ACCESS_KEY" in stripped
    assert "GITHUB_TOKEN" in stripped
    assert "DOCKER_HOST" in stripped

    # Clean env must NOT have the ambient values
    assert "AWS_SECRET_ACCESS_KEY" not in clean_env
    assert "GITHUB_TOKEN" not in clean_env
    assert "DOCKER_HOST" not in clean_env
    assert clean_env["DATABASE_URL"] != "postgresql://ambient_dev:pass@localhost:5432/ambient_db"


def test_verify_clean_env_cli_execution():
    """Verifies that running scripts/verify_clean_env.py succeeds with exit code 0."""
    cmd = [sys.executable, "scripts/verify_clean_env.py", "--skip-tests"]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, f"Clean verification failed: {proc.stderr}"
    assert "[CLEAN ENVIRONMENT VERIFICATION APPROVED]" in proc.stdout
