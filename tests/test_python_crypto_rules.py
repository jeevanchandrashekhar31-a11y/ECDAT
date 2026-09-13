"""
Unit tests for Python Cryptographic Detection (Phase 2.2).
Validates AST + semantic detection across:
- hashlib, hmac, secrets
- cryptography hazmat (ciphers, modes, asymmetric keys, serialization)
- PyCryptodome (Cipher, PublicKey, Hash)
- TLS / SSL / requests cert validation
- Insecure randomness (random vs secrets)
- JWT verification bypass and 'none' algorithm
- Cloud SDK KMS weak key creation
- Hardcoded private and symmetric key material
"""

from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.python_handler import PythonLanguageAdapter


@pytest.fixture
def python_adapter():
    return PythonLanguageAdapter()


@pytest.fixture
def vulnerable_python_path():
    return Path("tests/fixtures/static/vulnerable_python.py")


@pytest.fixture
def clean_python_path():
    return Path("tests/fixtures/static/clean_python.py")


def test_python_adapter_in_registry():
    registry = get_default_adapter_registry()
    adapter = registry.get_by_extension(".py")
    assert isinstance(adapter, PythonLanguageAdapter)
    assert "python" in registry.get_supported_languages()


def test_python_adapter_capabilities():
    adapter = PythonLanguageAdapter()
    caps = adapter.get_capabilities()
    assert caps["language"] == "python"
    assert "3.11" in caps["supported_versions"]
    assert any("hashlib" in api for api in caps["supported_crypto_apis"])
    assert any("cryptography" in api for api in caps["supported_crypto_apis"])
    assert any("PyCryptodome" in api for api in caps["supported_crypto_apis"])
    assert any("ssl" in api for api in caps["supported_crypto_apis"])
    assert any("boto3" in api for api in caps["supported_crypto_apis"])


def test_vulnerable_python_detection_comprehensive(python_adapter, vulnerable_python_path):
    source_bytes = vulnerable_python_path.read_bytes()
    findings = python_adapter.extract_findings(source_bytes, vulnerable_python_path, Path("tests/fixtures/static"))

    assert len(findings) >= 12, f"Expected at least 12 findings, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Weak Hashes & HMAC
    assert "PY_HASHLIB_MD5" in rule_ids
    assert "PY_HASHLIB_SHA1" in rule_ids
    assert "PY_HMAC_MD5" in rule_ids
    assert "weak_hash" in finding_types

    # 2. Weak Asymmetric Key Sizes (via Semantic Constant Propagation)
    assert "PY_WEAK_RSA_KEY_SIZE" in rule_ids
    assert "PY_WEAK_DSA_KEY_SIZE" in rule_ids
    assert "weak_asymmetric_key" in finding_types

    # 3. Weak Ciphers and Insecure Modes (TripleDES, DES, ECB)
    assert "PY_CIPHER_DES" in rule_ids or "PY_PYCRYPTODOME_DES" in rule_ids
    assert "PY_INSECURE_MODE_ECB" in rule_ids
    assert "insecure_cipher_mode" in finding_types

    # 4. Disabled Certificate Validation
    assert "PY_DISABLED_CERT_VALIDATION" in rule_ids
    assert "PY_DISABLED_HOSTNAME_VERIFICATION" in rule_ids
    assert "disabled_certificate_validation" in finding_types

    # 5. Insecure Randomness
    assert "PY_INSECURE_RANDOMNESS" in rule_ids
    assert "insecure_randomness" in finding_types

    # 6. Insecure JWT
    assert "PY_JWT_VERIFY_FALSE" in rule_ids or "PY_JWT_NONE_ALGORITHM" in rule_ids

    # 7. Cloud SDK KMS
    assert "PY_CLOUD_KMS_WEAK_KEY" in rule_ids

    # 8. Hardcoded Private and Symmetric Key Material
    assert "PY_HARDCODED_PRIVATE_KEY" in rule_ids
    assert "PY_HARDCODED_SYMMETRIC_KEY" in rule_ids
    assert "hardcoded_private_key" in finding_types

    # 9. Unsafe Key Loading
    assert "PY_UNSAFE_KEY_LOADING_UNENCRYPTED" in rule_ids


def test_clean_python_produces_zero_vulnerabilities(python_adapter, clean_python_path):
    source_bytes = clean_python_path.read_bytes()
    findings = python_adapter.extract_findings(source_bytes, clean_python_path, Path("tests/fixtures/static"))

    # Clean code should produce 0 critical or high findings
    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Clean python file produced unexpected vulnerabilities: {critical_or_high}"


def test_alias_semantic_resolution():
    """Verify that aliased imports are resolved properly through the AST semantic resolver."""
    code = b"""
import hashlib as custom_hasher
from cryptography.hazmat.primitives.asymmetric import rsa as rsa_generator

def test_alias():
    h = custom_hasher.md5(b'data').hexdigest()
    key = rsa_generator.generate_private_key(public_exponent=65537, key_size=1024)
    return h, key
"""
    adapter = PythonLanguageAdapter()
    findings = adapter.extract_findings(code, Path("test_alias.py"), Path("."))

    rule_ids = {f.rule_id for f in findings}
    assert "PY_HASHLIB_MD5" in rule_ids
    assert "PY_WEAK_RSA_KEY_SIZE" in rule_ids
