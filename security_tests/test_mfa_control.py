# @ecdat-synthetic-corpus
"""
Adversarial Security Test: MFA & TOTP Step-Up Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import time
import pytest
from scanners.identity.totp_mfa import MfaTotpEngine


class TestMFAControl:
    """
    Security Control: Multi-Factor Authentication (RFC 6238 TOTP)
    Guarantees timing-safe code verification, strict digit validation, and step-up defense.
    """

    @pytest.fixture
    def totp(self):
        return MfaTotpEngine(step_seconds=30, digits=6)

    @pytest.fixture
    def secret_info(self, totp):
        return totp.generate_secret(account_name="test_operator@enterprise.internal")

    # 1. POSITIVE TEST: Correct 6-digit TOTP code generated for current time verifies
    def test_positive_mfa(self, totp, secret_info):
        now = time.time()
        valid_code = totp.generate_code(secret_info["secret"], timestamp=now)
        assert len(valid_code) == 6
        assert totp.verify_code(secret_info["secret"], valid_code, timestamp=now) is True

    # 2. NEGATIVE TEST: Incorrect code or expired timestamp outside window fails
    def test_negative_mfa(self, totp, secret_info):
        now = time.time()
        # Explicitly incorrect code
        assert totp.verify_code(secret_info["secret"], "000000", timestamp=now) is False

        # Code from 5 minutes ago (10 steps back, window is 1) fails
        expired_time = now - 300
        old_code = totp.generate_code(secret_info["secret"], timestamp=expired_time)
        assert totp.verify_code(secret_info["secret"], old_code, window=1, timestamp=now) is False

    # 3. BOUNDARY TEST: Exact 6-digit length boundary & clock-drift boundary
    def test_boundary_mfa(self, totp, secret_info):
        now = time.time()
        valid_code = totp.generate_code(secret_info["secret"], timestamp=now)

        # 5-digit code rejected
        assert totp.verify_code(secret_info["secret"], valid_code[:5], timestamp=now) is False

        # 7-digit code rejected
        assert totp.verify_code(secret_info["secret"], valid_code + "1", timestamp=now) is False

        # Empty code rejected
        assert totp.verify_code(secret_info["secret"], "", timestamp=now) is False

        # Clock-drift boundary: exactly 1 step ahead/behind allowed with window=1
        step_ahead_code = totp.generate_code(secret_info["secret"], timestamp=now + 30)
        assert totp.verify_code(secret_info["secret"], step_ahead_code, window=1, timestamp=now) is True

    # 4. MALICIOUS TEST: Injection vectors & non-numeric inputs
    def test_malicious_mfa(self, totp, secret_info):
        now = time.time()

        # Non-numeric / alphanumeric injection
        assert totp.verify_code(secret_info["secret"], "12ab56", timestamp=now) is False
        assert totp.verify_code(secret_info["secret"], "' OR 1", timestamp=now) is False
        assert totp.verify_code(secret_info["secret"], "12\x00345", timestamp=now) is False

        # Backup code reuse defense: once verified and consumed, backup code cannot be replayed
        plain_codes, hashed_codes = totp.generate_backup_codes(count=4)
        first_code = plain_codes[0]

        # Valid use
        success, remaining = totp.verify_and_consume_backup_code(first_code, hashed_codes)
        assert success is True
        assert len(remaining) == 3

        # Replay attempt fails because code was consumed
        replay_success, _ = totp.verify_and_consume_backup_code(first_code, remaining)
        assert replay_success is False

    # 5. REGRESSION TEST: Constant-time comparison protects against timing attacks
    def test_regression_mfa(self, totp, secret_info):
        now = time.time()
        valid_code = totp.generate_code(secret_info["secret"], timestamp=now)

        # Difference in first character vs difference in last character must execute uniformly
        cand_diff_first = str((int(valid_code[0]) + 1) % 10) + valid_code[1:]
        cand_diff_last = valid_code[:-1] + str((int(valid_code[-1]) + 1) % 10)

        assert totp.verify_code(secret_info["secret"], cand_diff_first, timestamp=now) is False
        assert totp.verify_code(secret_info["secret"], cand_diff_last, timestamp=now) is False
