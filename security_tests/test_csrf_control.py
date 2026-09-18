# @ecdat-synthetic-corpus
"""
Adversarial Security Test: CSRF Protection & Cookie Security Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.identity.cookie_session import CookieSecurityValidator


class TestCSRFControl:
    """
    Security Control: Anti-CSRF Double Submit Cookie & Origin Verification
    Guarantees that state-changing requests cannot be forged from cross-origin contexts.
    """

    @pytest.fixture
    def validator(self):
        return CookieSecurityValidator()

    # 1. POSITIVE TEST: Matching CSRF cookie and header from allowed origin succeeds
    def test_positive_csrf(self, validator):
        token = validator.generate_csrf_token()
        assert len(token) == 64  # 32 random bytes in hex

        res = validator.verify_csrf(
            header_token=token,
            cookie_token=token,
            origin="http://localhost:3000",
            allowed_origins=["http://localhost:3000"],
        )
        assert res["valid"] is True
        assert "succeeded" in res["reason"]

    # 2. NEGATIVE TEST: Missing token in header or cookie fails cleanly
    def test_negative_csrf(self, validator):
        token = validator.generate_csrf_token()

        # Missing header token
        res_no_header = validator.verify_csrf(header_token=None, cookie_token=token)
        assert res_no_header["valid"] is False
        assert "Missing CSRF token" in res_no_header["reason"]

        # Missing cookie token
        res_no_cookie = validator.verify_csrf(header_token=token, cookie_token="")
        assert res_no_cookie["valid"] is False
        assert "Missing CSRF token" in res_no_cookie["reason"]

    # 3. BOUNDARY TEST: Cookie security flags & attributes compliance
    def test_boundary_csrf(self, validator):
        # Fully compliant production cookie
        good_cookie = "ecdat_session=xyz123; Path=/; HttpOnly; Secure; SameSite=Strict"
        res_good = validator.validate_cookie_attributes(good_cookie, is_production=True)
        assert res_good["compliant"] is True
        assert len(res_good["issues"]) == 0

        # Boundary: Missing SameSite=Strict or missing HttpOnly
        bad_cookie = "ecdat_session=xyz123; Path=/; Secure"
        res_bad = validator.validate_cookie_attributes(bad_cookie, is_production=True)
        assert res_bad["compliant"] is False
        assert any("HttpOnly" in issue for issue in res_bad["issues"])
        assert any("SameSite" in issue for issue in res_bad["issues"])

    # 4. MALICIOUS TEST: Cross-origin attack & mismatched token forgery
    def test_malicious_csrf(self, validator):
        legit_token = validator.generate_csrf_token()
        attacker_token = validator.generate_csrf_token()

        # Attacker submits arbitrary token in header matching victim's session
        res_mismatch = validator.verify_csrf(
            header_token=attacker_token,
            cookie_token=legit_token,
        )
        assert res_mismatch["valid"] is False
        assert "mismatch" in res_mismatch["reason"]

        # Malicious cross-origin header from attacker site
        res_evil_origin = validator.verify_csrf(
            header_token=legit_token,
            cookie_token=legit_token,
            origin="http://evil-phishing-site.com",
            allowed_origins=["https://ecdat.corp.internal"],
        )
        assert res_evil_origin["valid"] is False
        assert "Untrusted request origin" in res_evil_origin["reason"]

    # 5. REGRESSION TEST: Constant-time comparison prevents timing attacks on token
    def test_regression_csrf(self, validator):
        token = "a" * 64
        cand_diff_start = "b" + "a" * 63
        cand_diff_end = "a" * 63 + "b"

        assert validator.verify_csrf(token, cand_diff_start)["valid"] is False
        assert validator.verify_csrf(token, cand_diff_end)["valid"] is False
