"""
Test Suite for C & C++ Cryptographic Discovery (Phase 2.6)
Validates AST detection, metadata tracking, key size & curve resolution,
TLS & certificate settings, and file limit / non-execution safety guardrails.
"""

from pathlib import Path
import pytest

from scanners.domain.errors import UnsupportedFormatError
from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.c_handler import CLanguageAdapter
from scanners.static.ast.cpp_handler import CppLanguageAdapter


@pytest.fixture
def c_adapter():
    return CLanguageAdapter()


@pytest.fixture
def cpp_adapter():
    return CppLanguageAdapter()


def test_c_and_cpp_adapters_registered():
    registry = get_default_adapter_registry()

    c_from_reg = registry.get_by_extension(".c")
    assert c_from_reg is not None
    assert isinstance(c_from_reg, CLanguageAdapter)
    assert c_from_reg.language == "c"

    cpp_from_reg = registry.get_by_extension(".cpp")
    assert cpp_from_reg is not None
    assert isinstance(cpp_from_reg, CppLanguageAdapter)
    assert cpp_from_reg.language == "cpp"

    assert isinstance(registry.get_by_extension(".h"), CLanguageAdapter)
    assert isinstance(registry.get_by_extension(".hpp"), CppLanguageAdapter)
    assert isinstance(registry.get_by_extension(".cc"), CppLanguageAdapter)
    assert isinstance(registry.get_by_extension(".cxx"), CppLanguageAdapter)


def test_insecure_c_detection(c_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_c.c")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = c_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 12, f"Expected at least 12 findings in vulnerable_c.c, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Weak Hashes: EVP and Direct
    assert "C_WEAK_HASH_MD5" in rule_ids
    assert "C_WEAK_HASH_SHA1" in rule_ids
    assert "weak_hash" in finding_types

    # 2. Insecure Ciphers & Modes
    assert "C_WEAK_CIPHER_DES" in rule_ids
    assert "C_WEAK_CIPHER_RC4" in rule_ids
    assert "C_WEAK_CIPHER_BLOWFISH" in rule_ids
    assert "C_INSECURE_CIPHER_MODE_ECB" in rule_ids
    assert "weak_cipher" in finding_types
    assert "insecure_cipher_mode" in finding_types

    # 3. Weak RSA Key Size & Curve
    assert "C_WEAK_RSA_KEY_SIZE" in rule_ids
    rsa_finding = next(f for f in findings if f.rule_id == "C_WEAK_RSA_KEY_SIZE")
    assert rsa_finding.algorithm == "RSA-1024"
    assert rsa_finding.severity == "critical"

    assert "C_WEAK_ECC_CURVE" in rule_ids
    ecc_finding = next(f for f in findings if f.rule_id == "C_WEAK_ECC_CURVE")
    assert ecc_finding.algorithm == "ECDSA-P224"
    assert ecc_finding.severity == "high"

    # 4. Insecure TLS Settings
    assert "C_DISABLED_CERT_VALIDATION" in rule_ids
    assert "C_INSECURE_TLS_VERSION" in rule_ids
    assert "C_INSECURE_CIPHER_SUITE" in rule_ids
    assert "disabled_certificate_validation" in finding_types
    tls_finding = next(f for f in findings if f.rule_id == "C_INSECURE_TLS_VERSION")
    assert tls_finding.algorithm == "TLSv1.0"

    # 5. Broken Certificate Signature
    assert "C_WEAK_CERT_SIGNATURE_ALGO" in rule_ids
    cert_finding = next(f for f in findings if f.rule_id == "C_WEAK_CERT_SIGNATURE_ALGO")
    assert cert_finding.algorithm == "MD5WithRSA"

    # 6. mbedTLS & wolfSSL
    assert "C_MBEDTLS_WEAK_HASH_MD5" in rule_ids
    assert "C_MBEDTLS_DISABLED_CERT_VALIDATION" in rule_ids
    assert "C_WOLFSSL_WEAK_HASH_MD5" in rule_ids
    assert "C_WOLFSSL_DISABLED_CERT_VALIDATION" in rule_ids


def test_insecure_cpp_detection(cpp_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_cpp.cpp")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = cpp_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 5, f"Expected at least 5 findings in vulnerable_cpp.cpp, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}

    # 1. Botan Weak Hashes
    assert "CPP_BOTAN_WEAK_HASH_MD5" in rule_ids
    assert "CPP_BOTAN_WEAK_HASH_SHA1" in rule_ids

    # 2. Botan Weak Ciphers & Modes
    assert "CPP_BOTAN_WEAK_CIPHER" in rule_ids
    assert "CPP_BOTAN_INSECURE_CIPHER_MODE_ECB" in rule_ids

    # 3. Botan Weak RSA Key Size
    assert "CPP_BOTAN_WEAK_RSA" in rule_ids
    rsa_f = next(f for f in findings if f.rule_id == "CPP_BOTAN_WEAK_RSA")
    assert rsa_f.algorithm == "RSA-1024"

    # 4. OpenSSL C++ Disabled Verification
    assert "C_DISABLED_CERT_VALIDATION" in rule_ids


def test_clean_c_and_cpp_detection(c_adapter, cpp_adapter):
    # Test Clean C
    c_fixture = Path("tests/fixtures/static/clean_c.c")
    c_bytes = c_fixture.read_bytes()
    c_findings = c_adapter.extract_findings(c_bytes, c_fixture, Path("tests/fixtures/static"))

    critical_or_high_c = [f for f in c_findings if f.severity in ("critical", "high")]
    assert len(critical_or_high_c) == 0, f"Unexpected critical/high findings in clean C code: {critical_or_high_c}"

    c_rules = {f.rule_id for f in c_findings}
    assert "C_HASH_SECURE" in c_rules
    assert "C_AEAD_CIPHER" in c_rules
    assert "C_RSA_KEY" in c_rules
    assert "C_ECC_KEY" in c_rules
    assert "C_SECURE_TLS_VERSION" in c_rules
    assert "C_LIBSODIUM_SECRETBOX" in c_rules
    assert "C_LIBSODIUM_AEAD" in c_rules
    assert "C_LIBSODIUM_ED25519" in c_rules

    # Test Clean C++
    cpp_fixture = Path("tests/fixtures/static/clean_cpp.cpp")
    cpp_bytes = cpp_fixture.read_bytes()
    cpp_findings = cpp_adapter.extract_findings(cpp_bytes, cpp_fixture, Path("tests/fixtures/static"))

    critical_or_high_cpp = [f for f in cpp_findings if f.severity in ("critical", "high")]
    assert len(critical_or_high_cpp) == 0, f"Unexpected critical/high findings in clean C++ code: {critical_or_high_cpp}"

    cpp_rules = {f.rule_id for f in cpp_findings}
    assert "CPP_BOTAN_HASH_SECURE" in cpp_rules
    assert "CPP_BOTAN_AEAD" in cpp_rules
    assert "C_SECURE_TLS_VERSION" in cpp_rules


def test_file_size_limit_guardrail(c_adapter):
    # Oversized payload exceeding 5MB
    large_payload = b"int x = 1;\n" * (600 * 1024)  # ~6.6 MB
    with pytest.raises(UnsupportedFormatError) as exc_info:
        c_adapter.extract_findings(large_payload, Path("giant.c"), Path("."))
    assert "exceeds max limit" in str(exc_info.value)
