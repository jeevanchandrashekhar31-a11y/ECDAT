"""
Test Suite for C# & Rust Cryptographic Discovery (Phase 2.7)
Validates AST detection, System.Security.Cryptography, certificates, TLS settings,
ring, RustCrypto, rustls, dalek crates, and PRESENT vs OBSERVED reachability.
"""

from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.csharp_handler import CSharpLanguageAdapter
from scanners.static.ast.rust_handler import RustLanguageAdapter


@pytest.fixture
def cs_adapter():
    return CSharpLanguageAdapter()


@pytest.fixture
def rust_adapter():
    return RustLanguageAdapter()


def test_cs_and_rust_adapters_registered():
    registry = get_default_adapter_registry()

    cs_from_reg = registry.get_by_extension(".cs")
    assert cs_from_reg is not None
    assert isinstance(cs_from_reg, CSharpLanguageAdapter)
    assert cs_from_reg.language == "csharp"

    rust_from_reg = registry.get_by_extension(".rs")
    assert rust_from_reg is not None
    assert isinstance(rust_from_reg, RustLanguageAdapter)
    assert rust_from_reg.language == "rust"


def test_insecure_csharp_detection(cs_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_cs.cs")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = cs_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 8, f"Expected at least 8 findings in vulnerable_cs.cs, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Weak Hashes: MD5 & SHA-1
    assert "CS_WEAK_HASH_MD5" in rule_ids
    assert "CS_WEAK_HASH_SHA1" in rule_ids
    assert "weak_hash" in finding_types

    # 2. Insecure Ciphers & Modes
    assert "CS_WEAK_CIPHER_DES" in rule_ids
    assert "CS_WEAK_CIPHER_3DES" in rule_ids
    assert "CS_WEAK_CIPHER_RC2" in rule_ids
    assert "CS_INSECURE_CIPHER_MODE_ECB" in rule_ids
    assert "weak_cipher" in finding_types
    assert "insecure_cipher_mode" in finding_types

    # 3. Weak RSA Key Size & Curve
    assert "CS_WEAK_RSA_KEY_SIZE" in rule_ids
    rsa_finding = next(f for f in findings if f.rule_id == "CS_WEAK_RSA_KEY_SIZE")
    assert rsa_finding.algorithm == "RSA-1024"
    assert rsa_finding.severity == "critical"

    assert "CS_WEAK_ECC_CURVE" in rule_ids
    ecc_finding = next(f for f in findings if f.rule_id == "CS_WEAK_ECC_CURVE")
    assert ecc_finding.algorithm == "ECDSA-P224"

    # 4. Insecure TLS & Disabled Validation
    assert "CS_DISABLED_CERT_VALIDATION" in rule_ids
    assert "CS_INSECURE_TLS_VERSION" in rule_ids
    assert "disabled_certificate_validation" in finding_types
    tls_finding = next(f for f in findings if f.rule_id == "CS_INSECURE_TLS_VERSION")
    assert tls_finding.algorithm == "TLSv1.0"

    # 5. Weak Certificate Signature
    assert "CS_WEAK_CERT_SIGNATURE_ALGO" in rule_ids
    cert_finding = next(f for f in findings if f.rule_id == "CS_WEAK_CERT_SIGNATURE_ALGO")
    assert cert_finding.algorithm == "MD5WithRSA"


def test_clean_csharp_detection(cs_adapter):
    fixture_path = Path("tests/fixtures/static/clean_cs.cs")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = cs_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Unexpected critical/high findings in clean C# code: {critical_or_high}"

    rule_ids = {f.rule_id for f in findings}
    assert "CS_HASH_SHA256" in rule_ids
    assert "CS_HASH_SHA512" in rule_ids
    assert "CS_CIPHER_AES" in rule_ids
    assert "CS_RSA_KEY" in rule_ids
    assert "CS_ECC_KEY" in rule_ids
    assert "CS_SECURE_TLS_VERSION" in rule_ids


def test_insecure_rust_and_reachability(rust_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_rust.rs")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = rust_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    rule_ids = {f.rule_id for f in findings}

    # 1. OBSERVED weak crypto calls in code
    assert "RUST_WEAK_HASH_MD5" in rule_ids
    assert "RUST_WEAK_CIPHER_DES" in rule_ids
    assert "RUST_WEAK_CIPHER_BLOWFISH" in rule_ids

    observed_md5 = next(f for f in findings if f.rule_id == "RUST_WEAK_HASH_MD5")
    assert "[OBSERVED]" in observed_md5.reason
    assert observed_md5.severity == "critical"

    # 2. PRESENT-only dependencies in Cargo.toml that are NOT invoked
    present_findings = [f for f in findings if f.rule_id == "RUST_CRATE_PRESENT_ONLY"]
    assert len(present_findings) > 0

    present_algorithms = {f.algorithm for f in present_findings}
    # rustls and p256 are in Cargo.toml but not called in vulnerable_rust.rs
    assert "rustls" in present_algorithms
    assert "p256" in present_algorithms
    assert "chacha20poly1305" in present_algorithms

    # Ensure PRESENT findings have 'info' severity and explicit distinction
    for pf in present_findings:
        assert pf.severity == "info"
        assert "[PRESENT_ONLY]" in pf.reason
        assert "NOT OBSERVED/REACHABLE" in pf.reason


def test_clean_rust_detection(rust_adapter):
    fixture_path = Path("tests/fixtures/static/clean_rust.rs")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = rust_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Unexpected critical/high findings in clean Rust code: {critical_or_high}"

    rule_ids = {f.rule_id for f in findings}
    assert "RUST_HASH_SHA2" in rule_ids
    assert "RUST_AEAD_AES_GCM" in rule_ids
    assert "RUST_ED25519_KEY" in rule_ids
    assert "RUST_X25519_KEX" in rule_ids
    assert "RUST_RING_DIGEST" in rule_ids
