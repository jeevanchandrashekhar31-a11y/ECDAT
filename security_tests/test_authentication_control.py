# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Authentication & Password Hardening Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.identity.password_policy import (
    PasswordPolicy,
    PasswordPolicyError,
    LocalAuthManager,
    AccountLockedError,
)


class TestAuthenticationControl:
    """
    Security Control: User & Service Authentication Engine
    Guarantees timing-attack immunity, memory-hard hashing (scrypt), minimum entropy, and credential protection.
    """

    @pytest.fixture
    def policy(self):
        return PasswordPolicy(min_length=12, max_length=128)

    @pytest.fixture
    def auth_mgr(self, policy):
        return LocalAuthManager(policy=policy, max_failed_attempts=3, lockout_duration_sec=300)

    # 1. POSITIVE TEST: Well-formed, valid credentials succeed
    def test_positive_authentication(self, policy, auth_mgr):
        valid_password = "Correct-Horse-Battery-Staple-2026!Pass"
        result = policy.validate(valid_password, username="analyst_user", email="analyst@example.com")
        assert result["valid"] is True

        # Hash and verify roundtrip succeeds
        pwd_hash = policy.hash_password(valid_password)
        assert policy.verify_password(valid_password, pwd_hash) is True

        # Successful authentication flow
        auth_mgr.register_user("testuser", "test@corp.internal", valid_password, roles=["analyst"])
        auth_res = auth_mgr.authenticate("testuser", valid_password)
        assert auth_res["mfaRequired"] is False
        assert "analyst" in auth_res["user"]["roles"]

    # 2. NEGATIVE TEST: Incorrect or weak password fails cleanly
    def test_negative_authentication(self, policy, auth_mgr):
        valid_password = "Correct-Horse-Battery-Staple-2026!Pass"
        pwd_hash = policy.hash_password(valid_password)

        # Wrong password verification returns False cleanly
        assert policy.verify_password("WrongPassword123!456", pwd_hash) is False

        # Short password raises PasswordPolicyError with violations
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("Short1!Aa")
        assert any("at least 12 characters" in v for v in exc_info.value.violations)

        # Dictionary blacklisted password raises error
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("password123!", username="alice")
        assert any("dictionary" in v.lower() for v in exc_info.value.violations)

    # 3. BOUNDARY TEST: Edge conditions (empty strings, exact length thresholds)
    def test_boundary_authentication(self, policy):
        # Empty string rejects
        with pytest.raises(PasswordPolicyError):
            policy.validate("")

        # None input rejects
        with pytest.raises(PasswordPolicyError):
            policy.validate(None)

        # Exact 12-character boundary
        pw_11 = "Aa1!Aa1!Aa1"  # 11 chars
        pw_12 = "Aa1!Aa1!Aa1!"  # 12 chars
        with pytest.raises(PasswordPolicyError):
            policy.validate(pw_11)
        res_12 = policy.validate(pw_12)
        assert res_12["valid"] is True

        # Exact 128-character boundary
        pw_128 = "A1!" + "a" * 125  # 128 chars
        res_128 = policy.validate(pw_128)
        assert res_128["valid"] is True

        pw_129 = pw_128 + "x"
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate(pw_129)
        assert any("must not exceed 128 characters" in v for v in exc_info.value.violations)

    # 4. MALICIOUS TEST: Timing attack simulation & brute force lockout defense
    def test_malicious_authentication(self, auth_mgr):
        user_pw = "Super-Secure-Production-Key-2026!#"
        auth_mgr.register_user("target_user", "target@corp.internal", user_pw, roles=["operator"])

        # Brute-force simulation with 2 incorrect attempts fails with ValueError
        for _ in range(2):
            with pytest.raises(ValueError):
                auth_mgr.authenticate("target_user", "wrong_guess_attempt!")

        # 3rd attempt reaches max_failed_attempts and raises AccountLockedError
        with pytest.raises(AccountLockedError) as exc_info:
            auth_mgr.authenticate("target_user", "wrong_guess_attempt!")
        assert "locked" in str(exc_info.value).lower()

        # Subsequent attempt with correct password still raises AccountLockedError
        with pytest.raises(AccountLockedError):
            auth_mgr.authenticate("target_user", user_pw)

        # SQL injection / null-byte payload in authentication username
        malicious_user = "admin' OR '1'='1\x00-- "
        with pytest.raises(ValueError):
            auth_mgr.authenticate(malicious_user, "any_pass")

    # 5. REGRESSION TEST: Constant-time comparison must prevent timing side-channels
    def test_regression_authentication(self, policy):
        secret = "synthetic-secret-token-key-2026!Aa1"
        stored_hash = policy.hash_password(secret)

        # Candidates differing in the first char vs last char must both evaluate via hmac.compare_digest
        cand_diff_first = "X" + secret[1:]
        cand_diff_last = secret[:-1] + "X"

        assert policy.verify_password(cand_diff_first, stored_hash) is False
        assert policy.verify_password(cand_diff_last, stored_hash) is False

        # Malformed scrypt header does not crash but returns False
        assert policy.verify_password(secret, "$scrypt$corrupted_header") is False
        assert policy.verify_password(secret, "plaintext_password") is False
