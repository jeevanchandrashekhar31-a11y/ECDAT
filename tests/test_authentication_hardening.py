"""
Tests for Phase 15.2 Secure Authentication Hardening (Python)

Covers:
- NIST SP 800-63B password policy enforcement
- Dictionary blacklist rejection & username/email substring defense
- scrypt key derivation and constant-time verification
- Brute-force lockout and account locking
- RFC 6238 TOTP generation, validation, and Base32 encoding/decoding
- Single-use recovery backup codes
- Secure cookie validation and CSRF token protection
"""

import time
import pytest
from scanners.identity.password_policy import (
    PasswordPolicy,
    PasswordPolicyError,
    AccountLockedError,
    LocalAuthManager,
    COMMON_PASSWORDS_BLACKLIST,
)
from scanners.identity.totp_mfa import (
    MfaTotpEngine,
    base32_encode,
    base32_decode,
)
from scanners.identity.cookie_session import (
    CookieSecurityValidator,
)


class TestPasswordPolicy:
    def test_strong_password_passes(self):
        policy = PasswordPolicy(min_length=12)
        res = policy.validate("Correct-Horse-Battery-Staple-2026!")
        assert res["valid"] is True

    def test_too_short_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("Short1!Aa")
        assert any("at least 12 characters" in v for v in exc_info.value.violations)

    def test_missing_uppercase_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("alllowercaseletters123!@#")
        assert any("uppercase letter" in v for v in exc_info.value.violations)

    def test_missing_special_character_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("NoSpecialCharacters123456")
        assert any("special character" in v for v in exc_info.value.violations)

    def test_dictionary_blacklist_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("password123!")
        assert any("vulnerable or common dictionary" in v for v in exc_info.value.violations)

    def test_username_substring_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("SecurityAdmin_2026!#", username="admin")
        assert any("username" in v for v in exc_info.value.violations)

    def test_email_localpart_substring_rejected(self):
        policy = PasswordPolicy(min_length=12)
        with pytest.raises(PasswordPolicyError) as exc_info:
            policy.validate("AliceSecurePass_2026!", email="alice@enterprise.com")
        assert any("email address local part" in v for v in exc_info.value.violations)

    def test_scrypt_hashing_and_verification(self):
        policy = PasswordPolicy(min_length=12)
        raw_pw = "Enterprise-Grade-Quantum-Agile-2026!"
        stored_hash = policy.hash_password(raw_pw)

        assert stored_hash.startswith("$scrypt$N=16384,r=8,p=1$")
        assert policy.verify_password(raw_pw, stored_hash) is True
        assert policy.verify_password("Wrong-Password-12345!", stored_hash) is False
        assert policy.verify_password("", stored_hash) is False
        assert policy.verify_password(raw_pw, "invalid_format") is False


class TestLocalAuthManagerAndBruteForce:
    def test_user_registration_and_authentication(self):
        mgr = LocalAuthManager(max_failed_attempts=3, lockout_duration_sec=60)
        reg = mgr.register_user(
            username="analyst_bob",
            email="bob@internal.corp",
            password="StrongPassword#2026!",
            roles=["analyst"],
        )
        assert reg["username"] == "analyst_bob"
        assert reg["roles"] == ["analyst"]

        auth_res = mgr.authenticate("analyst_bob", "StrongPassword#2026!")
        assert auth_res["mfaRequired"] is False
        assert auth_res["user"]["username"] == "analyst_bob"

    def test_duplicate_username_fails(self):
        mgr = LocalAuthManager()
        mgr.register_user("charlie", "c@corp.com", "StrongPassword#2026!")
        with pytest.raises(ValueError) as exc:
            mgr.register_user("charlie", "c2@corp.com", "StrongPassword#2026!")
        assert "already exists" in str(exc.value)

    def test_brute_force_lockout_after_max_attempts(self):
        mgr = LocalAuthManager(max_failed_attempts=3, lockout_duration_sec=300)
        mgr.register_user("target_user", "target@corp.com", "SuperSecure_2026!#")

        # 1st fail
        with pytest.raises(ValueError):
            mgr.authenticate("target_user", "BadPassword1!")
        # 2nd fail
        with pytest.raises(ValueError):
            mgr.authenticate("target_user", "BadPassword2!")
        # 3rd fail -> triggers lockout
        with pytest.raises(AccountLockedError) as exc_lock:
            mgr.authenticate("target_user", "BadPassword3!")
        assert "Account locked after 3 failed attempts" in str(exc_lock.value)

        # Subsequent attempt is rejected with lockout even with correct password
        with pytest.raises(AccountLockedError):
            mgr.authenticate("target_user", "SuperSecure_2026!#")

    def test_unknown_user_fails_gracefully(self):
        mgr = LocalAuthManager()
        with pytest.raises(ValueError) as exc:
            mgr.authenticate("nonexistent_user", "AnyPassword1234!")
        assert "Invalid username or password" in str(exc.value)


class TestTotpMfaEngine:
    def test_base32_roundtrip(self):
        raw_bytes = b"ECDAT-CRYPTO-AGILITY-2026"
        encoded = base32_encode(raw_bytes)
        decoded = base32_decode(encoded)
        assert decoded == raw_bytes

    def test_totp_generation_and_verification(self):
        engine = MfaTotpEngine(step_seconds=30, digits=6, algorithm="sha1")
        setup = engine.generate_secret("alice@ecdat.io")
        secret = setup["secret"]

        assert len(secret) > 16
        assert "otpauth://totp/ECDAT:alice%40ecdat.io" in setup["otpAuthUri"]

        # Generate code for current time
        now = time.time()
        code = engine.generate_code(secret, now)
        assert len(code) == 6
        assert code.isdigit()

        # Verify within window
        assert engine.verify_code(secret, code, window=1, timestamp=now) is True
        assert engine.verify_code(secret, "000000", window=1, timestamp=now) is False

        # Verify time drift within 1 step (30s)
        assert engine.verify_code(secret, code, window=1, timestamp=now + 25) is True

    def test_single_use_backup_codes(self):
        engine = MfaTotpEngine()
        plain_codes, hashed_codes = engine.generate_backup_codes(count=4)

        assert len(plain_codes) == 4
        assert len(hashed_codes) == 4

        test_code = plain_codes[0]
        # First use succeeds
        valid, remaining = engine.verify_and_consume_backup_code(test_code, hashed_codes)
        assert valid is True
        assert len(remaining) == 3

        # Re-using the same backup code fails (single-use invariant)
        valid2, remaining2 = engine.verify_and_consume_backup_code(test_code, remaining)
        assert valid2 is False
        assert len(remaining2) == 3


class TestCookieAndCsrfSecurity:
    def test_cookie_attribute_validation_production(self):
        valid_cookie = "ecdat_access_token=xyz; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900"
        result = CookieSecurityValidator.validate_cookie_attributes(valid_cookie, is_production=True)
        assert result["compliant"] is True
        assert result["hasHttpOnly"] is True
        assert result["hasSecure"] is True
        assert result["hasSameSiteStrict"] is True

    def test_cookie_missing_httponly_and_secure(self):
        insecure_cookie = "session_token=xyz; Path=/; SameSite=Lax"
        result = CookieSecurityValidator.validate_cookie_attributes(insecure_cookie, is_production=True)
        assert result["compliant"] is False
        assert any("HttpOnly" in issue for issue in result["issues"])
        assert any("Secure" in issue for issue in result["issues"])

    def test_csrf_double_submit_verification(self):
        token = CookieSecurityValidator.generate_csrf_token()
        assert len(token) == 64

        # Matching tokens pass
        res = CookieSecurityValidator.verify_csrf(
            header_token=token,
            cookie_token=token,
            origin="http://localhost:3000",
            allowed_origins=["http://localhost:3000"],
        )
        assert res["valid"] is True

        # Mismatched tokens fail
        res_mismatch = CookieSecurityValidator.verify_csrf(
            header_token=token,
            cookie_token="different_token_123456",
        )
        assert res_mismatch["valid"] is False
        assert "mismatch" in res_mismatch["reason"]

        # Missing token fails
        res_missing = CookieSecurityValidator.verify_csrf(
            header_token=None,
            cookie_token=token,
        )
        assert res_missing["valid"] is False

        # Untrusted origin fails
        res_bad_origin = CookieSecurityValidator.verify_csrf(
            header_token=token,
            cookie_token=token,
            origin="https://evil-attacker.com",
            allowed_origins=["http://localhost:3000"],
        )
        assert res_bad_origin["valid"] is False
        assert "Untrusted request origin" in res_bad_origin["reason"]
