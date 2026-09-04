import pytest
from scanners.network.cert_parser import get_key_info
from cryptography.hazmat.primitives.asymmetric import rsa


def test_get_key_info():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()
    algo, size = get_key_info(key)
    assert algo == "RSA"
    assert size == 2048
