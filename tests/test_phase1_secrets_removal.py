"""
Regression Test Suite for Phase 1: Secrets + Credential Removal.
Validates:
- P0-01: No private signing keys are packaged in release distributions.
- P0-02: Hardcoded default API keys are eliminated from production code.
- P0-03: Frontend browser client does NOT automatically inherit or store privileged admin API keys.
"""
import os
import re
from pathlib import Path
import pytest
from cryptography.hazmat.primitives import serialization

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_p0_01_private_signing_key_not_in_packaging_list():
    """Validates that .keys and private key files are strictly excluded from clean archive builds."""
    clean_zip_script = REPO_ROOT / "scripts" / "create_clean_zip.py"
    assert clean_zip_script.exists()

    content = clean_zip_script.read_text(encoding="utf-8")
    assert '".keys"' in content
    assert '".pem"' in content
    assert '".key"' in content


def test_p0_01_public_key_verification_without_private_key():
    """Validates that artifact verification succeeds using only the public key."""
    from scripts.sign_artifacts import verify_manifest

    pub_key_path = REPO_ROOT / "config" / "ed25519_release_public.pem"
    manifest_path = REPO_ROOT / "artifacts" / "SHA256SUMS"
    sig_path = REPO_ROOT / "artifacts" / "SHA256SUMS.sig"

    assert pub_key_path.exists(), "Public key must exist in config/"
    assert manifest_path.exists()
    assert sig_path.exists()

    verified = verify_manifest(manifest_path, pub_key_path, sig_path)
    assert verified is True, "Artifact verification must pass using standalone public key"


def test_p0_02_demo_import_no_default_api_key():
    """Validates that demo_import.py does not contain hardcoded default API key string."""
    demo_import = REPO_ROOT / "docker" / "demo_import.py"
    content = demo_import.read_text(encoding="utf-8")

    assert "change-this-local-api-key" not in content
    assert "raise SystemExit" in content or "sys.exit" in content


def test_p0_03_frontend_client_no_default_admin_key():
    """Validates that client.ts does not fall back to ecdat-demo-admin-key-2026."""
    client_ts = REPO_ROOT / "frontend" / "src" / "api" / "client.ts"
    content = client_ts.read_text(encoding="utf-8")

    # Invariant: Must not auto-populate session with hardcoded demo key
    assert "ecdat-demo-admin-key-2026" not in content
    # Invariant: Must return null when no key configured
    assert "return null;" in content
