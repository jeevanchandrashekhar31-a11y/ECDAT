"""
Test Suite for Go Cryptographic Discovery (Phase 2.5)
Validates AST detection, metadata tracking, curve/key size resolution,
TLS & certificate settings, and go.mod dependency correlation.
"""

from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.go_handler import GoLanguageAdapter


@pytest.fixture
def go_adapter():
    return GoLanguageAdapter()


def test_go_adapter_registered():
    registry = get_default_adapter_registry()
    adapter = registry.get_by_extension(".go")
    assert adapter is not None
    assert isinstance(adapter, GoLanguageAdapter)
    assert adapter.language == "go"

    caps = adapter.get_capabilities()
    assert "1.21" in caps["supported_versions"]
    assert "crypto/aes" in caps["supported_crypto_apis"]
    assert "golang.org/x/crypto/blowfish" in caps["supported_crypto_apis"]
    assert len(caps["tested_corpus"]) >= 2


def test_insecure_go_detection(go_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_go.go")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = go_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 9, f"Expected at least 9 findings in vulnerable_go.go, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Weak Hashes (MD5 and SHA-1)
    assert "GO_WEAK_HASH_MD5" in rule_ids
    assert "GO_WEAK_HASH_SHA1" in rule_ids
    assert "weak_hash" in finding_types

    # 2. Insecure HMAC
    assert "GO_WEAK_HMAC_MD5" in rule_ids

    # 3. Weak RSA Key Size & Padding
    assert "GO_WEAK_RSA_KEY_SIZE" in rule_ids
    assert "GO_LEGACY_RSA_PKCS1_PADDING" in rule_ids
    rsa_finding = next(f for f in findings if f.rule_id == "GO_WEAK_RSA_KEY_SIZE")
    assert rsa_finding.algorithm == "RSA-1024"
    assert rsa_finding.severity == "critical"

    # 4. Weak Elliptic Curve P-224
    assert "GO_WEAK_ECC_CURVE" in rule_ids
    ecc_finding = next(f for f in findings if f.rule_id == "GO_WEAK_ECC_CURVE")
    assert ecc_finding.algorithm == "ECDSA-P224"
    assert ecc_finding.severity == "high"

    # 5. Weak Ciphers (DES & Blowfish)
    assert "GO_WEAK_CIPHER_DES" in rule_ids
    assert "GO_WEAK_CIPHER_BLOWFISH" in rule_ids
    assert "weak_cipher" in finding_types

    # 6. Insecure Cipher Mode (CBC)
    assert "GO_INSECURE_CIPHER_MODE_CBC" in rule_ids
    assert "insecure_cipher_mode" in finding_types

    # 7. Insecure TLS: InsecureSkipVerify & MinVersion TLS 1.0
    assert "GO_DISABLED_CERT_VALIDATION" in rule_ids
    assert "GO_INSECURE_TLS_VERSION" in rule_ids
    assert "disabled_certificate_validation" in finding_types
    tls_finding = next(f for f in findings if f.rule_id == "GO_INSECURE_TLS_VERSION")
    assert tls_finding.algorithm == "TLSv1.0"

    # 8. Broken Certificate Signature Algorithm (MD5WithRSA)
    assert "GO_WEAK_CERT_SIGNATURE_ALGO" in rule_ids
    cert_finding = next(f for f in findings if f.rule_id == "GO_WEAK_CERT_SIGNATURE_ALGO")
    assert cert_finding.algorithm == "MD5WithRSA"


def test_go_mod_dependency_correlation(go_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_go.go")
    source_bytes = fixture_path.read_bytes()
    findings = go_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    # Check Blowfish finding has correlation with golang.org/x/crypto from go.mod
    bf_finding = next((f for f in findings if f.rule_id == "GO_WEAK_CIPHER_BLOWFISH"), None)
    assert bf_finding is not None
    assert "[Dependency: golang.org/x/crypto@v0.21.0]" in bf_finding.reason

    # Check standard library finding has Go crypto stdlib marker
    md5_finding = next((f for f in findings if f.rule_id == "GO_WEAK_HASH_MD5"), None)
    assert md5_finding is not None
    assert "[Standard Library: Go crypto]" in md5_finding.reason


def test_clean_go_detection(go_adapter):
    fixture_path = Path("tests/fixtures/static/clean_go.go")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = go_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    # Clean code must have 0 critical or high severity findings
    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Found unexpected critical/high findings in clean Go code: {critical_or_high}"

    rule_ids = {f.rule_id for f in findings}

    # Verify secure primitives detected
    assert "GO_HASH_SHA256" in rule_ids
    assert "GO_HASH_SHA512" in rule_ids
    assert "GO_HMAC_SECURE" in rule_ids
    assert "GO_RSA_KEY" in rule_ids
    assert "GO_SECURE_RSA_PADDING" in rule_ids
    assert "GO_ECC_KEY" in rule_ids
    assert "GO_ED25519_KEY" in rule_ids
    assert "GO_AES_CIPHER" in rule_ids
    assert "GO_AEAD_CIPHER_GCM" in rule_ids
    assert "GO_SECURE_TLS_VERSION" in rule_ids


def test_renamed_import_and_constant_propagation(go_adapter):
    source = b"""package main
import (
    myhash "crypto/md5"
    "crypto/rsa"
    "crypto/rand"
)

const SmallKey = 512

func f() {
    _ = myhash.New()
    _, _ = rsa.GenerateKey(rand.Reader, SmallKey)
}
"""
    findings = go_adapter.extract_findings(source, Path("main.go"), Path("."))
    rule_ids = {f.rule_id for f in findings}

    assert "GO_WEAK_HASH_MD5" in rule_ids
    assert "GO_WEAK_RSA_KEY_SIZE" in rule_ids

    rsa_finding = next(f for f in findings if f.rule_id == "GO_WEAK_RSA_KEY_SIZE")
    assert rsa_finding.algorithm == "RSA-512"
    assert rsa_finding.severity == "critical"
