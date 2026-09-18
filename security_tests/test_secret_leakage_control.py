# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Secret Leakage & Safe Redaction Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.static.secret_detector import SecretSafeDetector


class TestSecretLeakageControl:
    """
    Security Control: Secret-Safe Scanning, Fingerprinting, and Zero Raw Secret Leakage
    Guarantees that credentials in scanned code are never leaked in logs, CBOM, or finding objects.
    """

    # 1. POSITIVE TEST: Clean source code returns zero secret findings
    def test_positive_secret_leakage(self):
        clean_code = """
def calculate_area(width: float, height: float) -> float:
    \"\"\"Calculates rectangle area.\"\"\"
    return width * height
"""
        redacted, candidates = SecretSafeDetector.detect_and_redact(clean_code, file_path="math_utils.py")
        assert len(candidates) == 0
        assert redacted == clean_code

    # 2. NEGATIVE TEST: Empty code or whitespace returns zero findings cleanly
    def test_negative_secret_leakage(self):
        redacted, candidates = SecretSafeDetector.detect_and_redact("", file_path="empty.py")
        assert len(candidates) == 0
        assert redacted == ""

    # 3. BOUNDARY TEST: Repetitive or structured low-entropy strings below threshold
    def test_boundary_secret_leakage(self):
        low_entropy = "const dummy_pattern = '0123456789012345678901234567890123456789';"
        redacted, candidates = SecretSafeDetector.detect_and_redact(low_entropy, file_path="config.js")
        # Repetitive pattern does not produce uncertified high-entropy false positives
        real_findings = [c for c in candidates if not c.is_synthetic]
        assert len(real_findings) == 0

    # 4. MALICIOUS TEST: Active secret exposure is detected, fingerprinted, and fully redacted
    def test_malicious_secret_leakage(self):
        # Synthetic test credential fixture
        malicious_source = """
# ecdat:fixture
AWS_SECRET = "AKIAIOSFODNN7EXAMPLE"
PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0synthetic...\\n-----END RSA PRIVATE KEY-----"
"""
        redacted_text, candidates = SecretSafeDetector.detect_and_redact(
            malicious_source,
            file_path="tests/fixtures/synthetic_secrets/leaked_creds.py",
        )
        assert len(candidates) >= 1
        # Invariant: Secret bytes are completely redacted
        assert "AKIAIOSFODNN7EXAMPLE" not in redacted_text
        assert "[SYNTHETIC_SECRET" in redacted_text or "[REDACTED" in redacted_text

        for cand in candidates:
            # Safe non-reversible fingerprint is generated
            assert cand.safe_fingerprint.startswith("sha256:")
            # Minimal evidence preserves syntax context without leaking raw secret
            assert "AKIAIOSFODNN7EXAMPLE" not in cand.minimal_evidence

    # 5. REGRESSION TEST: Secret detector guarantees zero raw secret retention in finding objects
    def test_regression_secret_leakage(self):
        code_with_token = 'api_token = "mock-secret-token-abcdef1234567890"  # ecdat:fixture\n'
        redacted_text, candidates = SecretSafeDetector.detect_and_redact(code_with_token, file_path="app.py")

        for cand in candidates:
            # Finding object must never hold raw secret value
            assert not hasattr(cand, "raw_secret")
            assert not hasattr(cand, "secret_value")
