import pytest
from scanners.network.target_validation import normalize_target, is_ip_allowed


def test_normalize_target():
    assert normalize_target("badssl.com") == ("badssl.com", 443)
    assert normalize_target("badssl.com:8443") == ("badssl.com", 8443)
    assert normalize_target("https://badssl.com") == ("badssl.com", 443)
    assert normalize_target("https://badssl.com:8443") == ("badssl.com", 8443)

    with pytest.raises(ValueError):
        normalize_target("badssl.com:invalid_port")


def test_is_ip_allowed():
    assert is_ip_allowed("8.8.8.8", False) is True
    assert is_ip_allowed("127.0.0.1", False) is False
    assert is_ip_allowed("192.168.1.1", False) is False
    assert is_ip_allowed("192.168.1.1", True) is True
    assert is_ip_allowed("invalid", False) is False
