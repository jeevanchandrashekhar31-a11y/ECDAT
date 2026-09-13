"""
Unit tests for Java and Kotlin Cryptographic Analysis (Phase 2.3).
Validates detection across JCA/JCE, Cipher, MessageDigest, Mac, Signature,
KeyPairGenerator, KeyStore, SSLContext, TrustManager, and BouncyCastle.
"""

from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.java_handler import JavaLanguageAdapter, KotlinLanguageAdapter


@pytest.fixture
def java_adapter():
    return JavaLanguageAdapter()


@pytest.fixture
def kotlin_adapter():
    return KotlinLanguageAdapter()


def test_java_and_kotlin_adapters_registered():
    registry = get_default_adapter_registry()
    assert isinstance(registry.get_by_extension(".java"), JavaLanguageAdapter)
    assert isinstance(registry.get_by_extension(".kt"), KotlinLanguageAdapter)
    assert isinstance(registry.get_by_extension(".kts"), KotlinLanguageAdapter)

    langs = set(registry.get_supported_languages())
    assert "java" in langs
    assert "kotlin" in langs


def test_java_adapter_capabilities(java_adapter):
    caps = java_adapter.get_capabilities()
    assert caps["language"] == "java"
    assert "17" in caps["supported_versions"]
    assert any("Cipher" in api for api in caps["supported_crypto_apis"])
    assert any("BouncyCastle" in api for api in caps["supported_crypto_apis"])
    assert any("SSLContext" in api for api in caps["supported_crypto_apis"])


def test_kotlin_adapter_capabilities(kotlin_adapter):
    caps = kotlin_adapter.get_capabilities()
    assert caps["language"] == "kotlin"
    assert "2.0" in caps["supported_versions"]
    assert any("Cipher" in api for api in caps["supported_crypto_apis"])


def test_insecure_java_detection(java_adapter):
    fixture_path = Path("tests/fixtures/static/InsecureCrypto.java")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = java_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 10, f"Expected at least 10 findings, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Ciphers and ECB mode
    assert "JAVA_WEAK_CIPHER" in rule_ids
    assert "JAVA_INSECURE_CIPHER_MODE_ECB" in rule_ids
    assert "weak_cipher" in finding_types

    # 2. MessageDigest & Mac & Signature
    assert "JAVA_WEAK_HASH" in rule_ids
    assert "JAVA_WEAK_MAC" in rule_ids
    assert "JAVA_WEAK_SIGNATURE" in rule_ids
    assert "weak_hash" in finding_types
    assert "weak_signature_algorithm" in finding_types

    # 3. KeyPairGenerator weak key size
    assert "JAVA_WEAK_KEY_SIZE" in rule_ids
    assert "weak_asymmetric_key" in finding_types

    # 4. SecretKeyFactory weak algo
    assert "JAVA_WEAK_SECRET_KEY_FACTORY" in rule_ids

    # 5. Insecure TLS & KeyStore
    assert "JAVA_INSECURE_TLS_PROTOCOL" in rule_ids
    assert "JAVA_INSECURE_KEYSTORE_JKS" in rule_ids

    # 6. TrustManager & HostnameVerifier bypasses
    assert "JAVA_TRUST_ALL_CERTS" in rule_ids
    assert "JAVA_HOSTNAME_VERIFIER_TRUE" in rule_ids
    assert "disabled_certificate_validation" in finding_types

    # 7. BouncyCastle provider
    assert "JAVA_BOUNCY_CASTLE_PROVIDER" in rule_ids


def test_secure_java_has_zero_vulnerabilities(java_adapter):
    fixture_path = Path("tests/fixtures/static/SecureCrypto.java")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = java_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Secure Java file produced unexpected findings: {critical_or_high}"


def test_insecure_kotlin_detection(kotlin_adapter):
    fixture_path = Path("tests/fixtures/static/InsecureCrypto.kt")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = kotlin_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 5, f"Expected at least 5 findings in Kotlin, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}

    # Constant propagation of algorithm string into Cipher.getInstance(weakAlgo)
    assert "JAVA_WEAK_CIPHER" in rule_ids
    assert "JAVA_INSECURE_CIPHER_MODE_ECB" in rule_ids

    # Weak hash and mac
    assert "JAVA_WEAK_HASH" in rule_ids
    assert "JAVA_WEAK_MAC" in rule_ids
    assert "JAVA_WEAK_SIGNATURE" in rule_ids

    # Weak key size via numeric constant propagation
    assert "JAVA_WEAK_KEY_SIZE" in rule_ids

    # Insecure SSL protocol
    assert "JAVA_INSECURE_TLS_PROTOCOL" in rule_ids


def test_secure_kotlin_has_zero_vulnerabilities(kotlin_adapter):
    fixture_path = Path("tests/fixtures/static/SecureCrypto.kt")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = kotlin_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Secure Kotlin file produced unexpected findings: {critical_or_high}"
