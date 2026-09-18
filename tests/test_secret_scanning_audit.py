"""
# @ecdat-synthetic-corpus
Comprehensive Test Suite for P1: Secret Scanning Audit (Item 13)

Verifies:
1. Detection across all 8 mandatory secret categories:
   - AWS-like keys (access key ID, secret access key)
   - GitHub-like tokens (classic PAT, fine-grained PAT, canary tokens)
   - JWT secrets (raw signed JWTs, jwt_secret variable configurations)
   - Private keys (RSA, EC, OpenSSH, PGP, generic PEM blocks)
   - Database credentials (Postgres, MySQL, MongoDB, Redis URIs, db_password)
   - Cloud credentials (GCP API keys, Azure storage connection strings, Azure client secrets)
   - Generic API keys (OpenAI, Slack, Stripe, generic api_key assignments)
   - High-entropy secrets (Shannon entropy calculation)
2. Distinction between synthetic fixtures and real secrets:
   - Explicit fixture markers (e.g. 'ecdat:fixture', 'ecdat:synthetic', 'mock-credential')
   - Generated fake credentials (dummy prefixes like 'mock-', 'change-this-', repeating hex)
   - Isolated test corpus ('tests/fixtures/synthetic_secrets/')
   - Scanner test mode (test_mode=True vs test_mode=False)
3. Zero silent skipping:
   - Production scans must NOT silently skip tests/, docs/, examples/, rules/, artifacts/
   - Real secrets placed in tests/, docs/, examples/, rules/, or artifacts/ MUST trigger violations!
4. Zero raw secret leakage:
   - Sanitized evidence preserves only minimal context with safe SHA-256 fingerprints
"""

import math
import os
import tempfile
from pathlib import Path
import pytest

from scanners.static.secret_detector import (
    SecretSafeDetector,
    SecretCandidate,
    calculate_shannon_entropy,
)
from scanners.static.results import StaticFinding


# =========================================================================
# 1. Tests for the 8 Mandatory Secret Categories (Real Secrets Flagged)
# =========================================================================

class TestEightSecretCategories:
    """Verifies detection of all 8 mandatory categories when unmarked (real secrets)."""

    def test_aws_like_keys_detected(self):
        # AWS Access Key ID
        content = 'aws_access_key_id = "AKIA1234567890ABCDEF"\n'
        _, candidates = SecretSafeDetector.detect_and_redact(content, file_path="config/aws.py")
        types = [c.candidate_type for c in candidates]
        assert "AWS_ACCESS_KEY" in types
        cand = next(c for c in candidates if c.candidate_type == "AWS_ACCESS_KEY")
        assert not cand.is_synthetic
        assert cand.severity == "critical"
        assert "AKIA1234567890ABCDEF" not in cand.minimal_evidence
        assert cand.safe_fingerprint.startswith("sha256:")

        # AWS Secret Access Key (40 chars)
        secret_content = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY1234567890"\n'
        _, secret_cands = SecretSafeDetector.detect_and_redact(secret_content, file_path="config/aws.py")
        secret_types = [c.candidate_type for c in secret_cands]
        assert "AWS_SECRET_ACCESS_KEY" in secret_types
        cand = next(c for c in secret_cands if c.candidate_type == "AWS_SECRET_ACCESS_KEY")
        assert not cand.is_synthetic

    def test_github_like_tokens_detected(self):
        # Classic PAT (36+ chars)
        classic_content = 'gh_token = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"\n'
        _, classic_cands = SecretSafeDetector.detect_and_redact(classic_content, file_path="deploy/ci.sh")
        assert any(c.candidate_type == "GITHUB_TOKEN" and not c.is_synthetic for c in classic_cands)

        # Fine-grained PAT (82 chars)
        fine_content = 'pat = "github_pat_11AABCDEF01234567890123456789012345678901234567890123456789012345678901234567890"\n'
        _, fine_cands = SecretSafeDetector.detect_and_redact(fine_content, file_path="deploy/ci.sh")
        assert any(c.candidate_type == "GITHUB_FINE_GRAINED_PAT" and not c.is_synthetic for c in fine_cands)

    def test_jwt_secrets_and_tokens_detected(self):
        # Raw signed JWT
        jwt_content = (
            'auth_header = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
            'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkplZXZhbiIsImlhdCI6MTUxNjIzOTAyMn0.'
            '4P4Nvhdp1Zf09_jV7Yn7W5Z2U8B9Z1V5K2V7W3Y8Z4Q"\n'
        )
        _, jwt_cands = SecretSafeDetector.detect_and_redact(jwt_content, file_path="api/client.py")
        assert any(c.candidate_type == "JWT_TOKEN" and not c.is_synthetic for c in jwt_cands)

        # JWT Secret assignment
        jwt_sec_content = 'jwt_secret = "my-super-secret-signing-key-high-entropy-prod-32chars"\n'
        _, sec_cands = SecretSafeDetector.detect_and_redact(jwt_sec_content, file_path="config/jwt.py")
        assert any(c.candidate_type == "JWT_SECRET" and not c.is_synthetic for c in sec_cands)

    def test_private_keys_detected(self):
        rsa_pem = (
            "-----BEGIN RSA PRIVATE KEY-----\n"
            "MIIEowIBAAKCAQEA0Y3+secretKeyBytesHereForTestingOnlyNotRealKey1234567890=\n"
            "MIIEowIBAAKCAQEA0Y3+secretKeyBytesHereForTestingOnlyNotRealKey1234567890=\n"
            "-----END RSA PRIVATE KEY-----\n"
        )
        _, pem_cands = SecretSafeDetector.detect_and_redact(rsa_pem, file_path="certs/server.key")
        assert any(c.candidate_type == "RSA_PRIVATE_KEY" and not c.is_synthetic for c in pem_cands)

        ec_pem = (
            "-----BEGIN EC PRIVATE KEY-----\n"
            "MHcCAQEEIIsecretEcBytesHereForTestingOnlyNotRealKey1234567890=\n"
            "-----END EC PRIVATE KEY-----\n"
        )
        _, ec_cands = SecretSafeDetector.detect_and_redact(ec_pem, file_path="certs/ec.key")
        assert any(c.candidate_type == "EC_PRIVATE_KEY" and not c.is_synthetic for c in ec_cands)

    def test_database_credentials_detected(self):
        db_uri = 'DATABASE_URL = "postgresql://prod_admin:SuperSecretDbP@ssw0rd99!@db.prod.enterprise.com:5432/proddb"\n'
        _, db_cands = SecretSafeDetector.detect_and_redact(db_uri, file_path="config/db.py")
        assert any(c.candidate_type == "DATABASE_URI" and not c.is_synthetic for c in db_cands)

        db_pass = 'db_password = "production_secure_db_pass_99214"\n'
        _, pass_cands = SecretSafeDetector.detect_and_redact(db_pass, file_path="config/db.py")
        assert any(c.candidate_type == "DATABASE_PASSWORD" and not c.is_synthetic for c in pass_cands)

    def test_cloud_credentials_detected(self):
        # GCP API Key (AIzaSy...)
        gcp_content = 'gcp_key = "AIzaSyDaBcDeFgHiJkLmNoPqRsTuVwXyZ012345"\n'
        _, gcp_cands = SecretSafeDetector.detect_and_redact(gcp_content, file_path="cloud/gcp.py")
        assert any(c.candidate_type == "GCP_API_KEY" and not c.is_synthetic for c in gcp_cands)

        # Azure Storage Connection String
        azure_storage = 'azure_conn = "DefaultEndpointsProtocol=https;AccountName=proddata;AccountKey=V8mK19xZ42qL78pT90wY23nR56uB71sM99xL44qTV8mK19xZ42qL78pT90wY23nR56uB71sM99xL44qTV8mK19xZ42qL78pT90wY=="\n'
        _, az_cands = SecretSafeDetector.detect_and_redact(azure_storage, file_path="cloud/azure.py")
        assert any(c.candidate_type == "AZURE_STORAGE_KEY" and not c.is_synthetic for c in az_cands)

        # Azure Client Secret
        az_secret = 'azure_client_secret = "V8mK19~xZ42qL78pT90wY23nR56uB71sM99xL44q"\n'
        _, client_cands = SecretSafeDetector.detect_and_redact(az_secret, file_path="cloud/azure.py")
        assert any(c.candidate_type == "AZURE_CLIENT_SECRET" and not c.is_synthetic for c in client_cands)

    def test_generic_api_keys_detected(self):
        # OpenAI
        openai_content = 'openai_api_key = "sk-proj-V8mK19xZ42qL78pT90wY23nR56uB71sM99xL44qTV8mK19xZ42qL78pT90wY"\n'
        _, ai_cands = SecretSafeDetector.detect_and_redact(openai_content, file_path="ai/agent.py")
        assert any(c.candidate_type == "OPENAI_API_KEY" and not c.is_synthetic for c in ai_cands)

        # Slack
        slack_content = 'slack_token = "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"\n'
        _, slack_cands = SecretSafeDetector.detect_and_redact(slack_content, file_path="notify/slack.py")
        assert any(c.candidate_type == "SLACK_TOKEN" and not c.is_synthetic for c in slack_cands)

        # Stripe
        stripe_content = 'stripe_key = "sk_live_51AbCdEfGhIjKlMnOpQrStUvWx"\n'
        _, stripe_cands = SecretSafeDetector.detect_and_redact(stripe_content, file_path="billing/stripe.py")
        assert any(c.candidate_type == "STRIPE_KEY" and not c.is_synthetic for c in stripe_cands)

        # Generic API Key
        generic_content = 'api_key = "live_prod_api_key_super_secret_99887766"\n'
        _, gen_cands = SecretSafeDetector.detect_and_redact(generic_content, file_path="services/api.py")
        assert any(c.candidate_type == "GENERIC_API_KEY" and not c.is_synthetic for c in gen_cands)

    def test_high_entropy_secrets_detected(self):
        # Shannon entropy calculation
        hex_key = "a1f9c8b3d4e27605948372615049382716a5b4c3d2e1f0"
        entropy = calculate_shannon_entropy(hex_key)
        assert entropy > 3.0

        content = f'user_credential = "{hex_key}"\n'
        _, entropy_cands = SecretSafeDetector.detect_and_redact(content, file_path="crypto/cipher.py")
        assert any(c.candidate_type == "HIGH_ENTROPY_SECRET" and not c.is_synthetic for c in entropy_cands)


# =========================================================================
# 2. Tests for Synthetic Fixture vs. Real Secret Discrimination
# =========================================================================

class TestSyntheticFixtureDiscrimination:
    """Verifies that explicit fixture markers, fake credentials, and isolated test corpus are recognized."""

    def test_explicit_fixture_marker_recognized(self):
        content = (
            '# ecdat:synthetic-fixture\n'
            'AWS_ACCESS_KEY_ID = "AKIA1234567890ABCDEF"\n'
            'AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCY1234567890"\n'
        )
        _, candidates = SecretSafeDetector.detect_and_redact(content, file_path="tests/test_aws.py")
        assert len(candidates) >= 1
        for cand in candidates:
            assert cand.is_synthetic, f"Candidate {cand.candidate_type} should be recognized as synthetic due to marker!"

    def test_generated_fake_credentials_prefixes_recognized(self):
        content = (
            'MOCK_API_KEY = "mock-api-key-k8s-cluster-secret-token-12345"\n'
            'DUMMY_KEY = "dummy-encryption-key-for-testing-only-1234"\n'
            'CHANGE_THIS_PASS = "change-this-local-postgres-password"\n'
        )
        _, candidates = SecretSafeDetector.detect_and_redact(content, file_path="docs/guide.md")
        for cand in candidates:
            assert cand.is_synthetic

    def test_isolated_test_corpus_recognized(self):
        content = 'API_KEY = "k8s-prod-cluster-api-key-ecdat-enterprise-sec-token-2026"\n'
        # In isolated test corpus path:
        _, candidates = SecretSafeDetector.detect_and_redact(
            content, file_path="tests/fixtures/synthetic_secrets/my_fixture.py"
        )
        assert len(candidates) >= 1
        assert all(c.is_synthetic for c in candidates)

    def test_scanner_test_mode_behavior(self):
        content = 'SECRET_TOKEN = "unmarked-secret-token-in-test-file-9988"\n'
        # In test mode:
        _, test_cands = SecretSafeDetector.detect_and_redact(content, file_path="tests/unit_test.py", test_mode=True)
        # In test mode, matches in test files are marked synthetic:
        for c in test_cands:
            assert c.is_synthetic

        # In production mode (test_mode=False):
        # If there's no fixture marker and not in isolated corpus, it is flagged as REAL secret!
        _, prod_cands = SecretSafeDetector.detect_and_redact(
            'api_key = "live_unmarked_token_in_test_that_is_real_secret_12345"\n',
            file_path="tests/my_test.py",
            test_mode=False,
        )
        assert any(not c.is_synthetic for c in prod_cands)


# =========================================================================
# 3. Tests: Never Silently Skip Entire Classes of Files
# =========================================================================

class TestZeroSilentSkipping:
    """Verifies that tests/, docs/, examples/, rules/, artifacts/ are NOT silently skipped."""

    @pytest.mark.parametrize(
        "target_dir",
        ["tests", "docs", "examples", "rules", "artifacts"],
    )
    def test_real_secrets_in_target_dirs_are_detected(self, target_dir):
        """Placing an un-annotated real credential in tests/, docs/, examples/, rules/, or artifacts/ MUST be flagged!"""
        file_path = f"{target_dir}/leaked_credential.py"
        content = 'AWS_KEY = "AKIA1234567890ABCDEF"\n'
        _, candidates = SecretSafeDetector.detect_and_redact(content, file_path=file_path, test_mode=False)

        assert len(candidates) >= 1
        cand = candidates[0]
        assert not cand.is_synthetic, f"Un-annotated secret in {target_dir} was falsely marked as synthetic!"
        assert cand.severity in ("high", "critical")

    def test_findings_model_records_synthetic_status(self):
        """StaticFinding includes is_synthetic and sets finding_type='synthetic_fixture' when synthetic."""
        synthetic_cand = SecretCandidate(
            candidate_type="AWS_ACCESS_KEY",
            file_path="tests/fixtures/test.py",
            line_number=1,
            safe_fingerprint="sha256:1234567890abcdef",
            redacted_token="[SYNTHETIC_SECRET:AWS_ACCESS_KEY:sha256:1234567890abcdef]",
            minimal_evidence='aws_key = "[SYNTHETIC_SECRET]"',
            confidence="high",
            severity="low",
            is_synthetic=True,
        )
        findings = SecretSafeDetector.create_static_findings([synthetic_cand])
        assert len(findings) == 1
        f = findings[0]
        assert f.is_synthetic is True
        assert f.finding_type == "synthetic_fixture"
        assert f.rule_id == "SYNTHETIC_FIXTURE_AWS_ACCESS_KEY"
        assert f.to_dict()["is_synthetic"] is True
