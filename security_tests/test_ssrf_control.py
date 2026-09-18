# @ecdat-synthetic-corpus
"""
Adversarial Security Test: SSRF & Network Security Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import pytest
from scanners.common.input_validation import (
    validate_url,
    validate_ip_address,
    InputValidationError,
    BoundsValidationError,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "ssrf_payloads.json"


class TestSSRFControl:
    """
    Security Control: Server-Side Request Forgery (SSRF) Defense
    Guarantees that outbound network requests cannot target cloud metadata, loopback, or private ranges.
    """

    @pytest.fixture
    def payloads(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Public HTTPS URLs validate successfully
    def test_positive_ssrf(self, payloads):
        pos_list = payloads.get("positive", [
            "https://api.github.com/repos/example/repo",
            "https://pypi.org/pypi/requests/json",
        ])
        for url in pos_list:
            res = validate_url(url, require_https=False, allow_localhost=False)
            assert res == url

        # Public IP address validates successfully
        ip = validate_ip_address("8.8.8.8", allow_private=False)
        assert str(ip) == "8.8.8.8"

    # 2. NEGATIVE TEST: Malformed, empty, or schemeless URLs fail cleanly
    def test_negative_ssrf(self, payloads):
        neg_list = payloads.get("negative", [
            "not_a_valid_url",
            "http://",
            "://missing-scheme.com",
        ])
        for url in neg_list:
            with pytest.raises(InputValidationError):
                validate_url(url, allow_localhost=False)

        with pytest.raises(InputValidationError):
            validate_url("", allow_localhost=False)

    # 3. BOUNDARY TEST: Max URL length & public IP edge boundaries
    def test_boundary_ssrf(self):
        # Exact 2048-char boundary
        base = "https://example.com/"
        valid_2048 = base + "a" * (2048 - len(base))
        assert validate_url(valid_2048, max_length=2048) == valid_2048

        # 2049 chars raises BoundsValidationError
        invalid_2049 = valid_2048 + "x"
        with pytest.raises(BoundsValidationError):
            validate_url(invalid_2049, max_length=2048)

        # Boundary public IPv4 (1.1.1.1)
        assert str(validate_ip_address("1.1.1.1", allow_private=False)) == "1.1.1.1"

    # 4. MALICIOUS TEST: Intentionally malicious SSRF exploit payloads blocked
    def test_malicious_ssrf(self, payloads):
        mal_list = payloads.get("malicious", [
            "http://169.254.169.254/latest/meta-data/",
            "http://127.0.0.1:8080/admin",
            "http://0.0.0.0:80/secret",
            "http://10.0.0.1/internal-api",
            "http://192.168.1.1/router",
            "file:///etc/passwd",
            "gopher://127.0.0.1:6379/_FLUSHALL",
        ])
        for target in mal_list:
            with pytest.raises(InputValidationError) as exc_info:
                validate_url(target, allow_localhost=False)
            err_msg = str(exc_info.value).lower()
            assert any(term in err_msg for term in ["ssrf", "prohibited", "forbidden", "protocol"])

        # Private & loopback IPs fail validate_ip_address
        for priv_ip in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1"]:
            with pytest.raises(InputValidationError):
                validate_ip_address(priv_ip, allow_private=False)

    # 5. REGRESSION TEST: Cloud metadata IP (IMDSv1) and internal DNS resolution defense
    def test_regression_ssrf(self, payloads):
        # AWS IMDSv1 address must always be blocked
        with pytest.raises(InputValidationError) as exc_info:
            validate_url("http://169.254.169.254", allow_localhost=False)
        assert "169.254.169.254" in str(exc_info.value) or "ssrf" in str(exc_info.value).lower()

        # Google Cloud metadata DNS name must always be blocked
        with pytest.raises(InputValidationError):
            validate_url("http://metadata.google.internal/computeMetadata/v1/", allow_localhost=False)
