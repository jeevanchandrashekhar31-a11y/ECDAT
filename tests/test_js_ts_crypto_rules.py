"""
Unit tests for JavaScript and TypeScript Cryptographic Discovery (Phase 2.4).
Validates discovery across:
- Node.js crypto (hashes, ciphers, key pairs, Diffie-Hellman)
- Destructured imports and imported aliases
- Wrapper functions and dynamic constant strings
- Insecure TLS configuration (rejectUnauthorized, minVersion, env vars)
- JWT none algorithm
- CryptoJS
- Pure static AST analysis (no code execution of scanned projects)
"""

from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.static.ast.javascript_handler import JavascriptLanguageAdapter, TypescriptLanguageAdapter


@pytest.fixture
def js_adapter():
    return JavascriptLanguageAdapter()


@pytest.fixture
def ts_adapter():
    return TypescriptLanguageAdapter()


def test_js_and_ts_adapters_registered():
    registry = get_default_adapter_registry()
    assert isinstance(registry.get_by_extension(".js"), JavascriptLanguageAdapter)
    assert isinstance(registry.get_by_extension(".mjs"), JavascriptLanguageAdapter)
    assert isinstance(registry.get_by_extension(".cjs"), JavascriptLanguageAdapter)
    assert isinstance(registry.get_by_extension(".ts"), TypescriptLanguageAdapter)
    assert isinstance(registry.get_by_extension(".tsx"), TypescriptLanguageAdapter)

    langs = set(registry.get_supported_languages())
    assert "javascript" in langs
    assert "typescript" in langs


def test_js_ts_capabilities(js_adapter, ts_adapter):
    js_caps = js_adapter.get_capabilities()
    assert js_caps["language"] == "javascript"
    assert any("node:crypto" in api for api in js_caps["supported_crypto_apis"])
    assert any("jsonwebtoken" in api for api in js_caps["supported_crypto_apis"])

    ts_caps = ts_adapter.get_capabilities()
    assert ts_caps["language"] == "typescript"
    assert "5.x" in ts_caps["supported_versions"]


def test_insecure_javascript_detection(js_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_js.js")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = js_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 8, f"Expected at least 8 findings, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}
    finding_types = {f.finding_type for f in findings}

    # 1. Hashes via destructured & aliased imports & constant propagation
    assert "JS_WEAK_HASH" in rule_ids
    assert "weak_hash" in finding_types

    # 2. Insecure Ciphers and ECB mode
    assert "JS_WEAK_CIPHER" in rule_ids
    assert "JS_INSECURE_CIPHER_MODE_ECB" in rule_ids
    assert "insecure_cipher_mode" in finding_types

    # 3. Weak RSA Key Size & Diffie-Hellman
    assert "JS_WEAK_RSA_KEY_SIZE" in rule_ids
    assert "JS_WEAK_DH_KEY_SIZE" in rule_ids
    assert "weak_asymmetric_key" in finding_types

    # 4. TLS Configuration Bypasses
    assert "JS_DISABLED_CERT_VALIDATION" in rule_ids
    assert "JS_INSECURE_TLS_VERSION" in rule_ids
    assert "JS_ENV_TLS_REJECT_DISABLED" in rule_ids
    assert "disabled_certificate_validation" in finding_types

    # 5. JWT None Algorithm
    assert "JS_JWT_NONE_ALGORITHM" in rule_ids
    assert "insecure_jwt_algorithm" in finding_types

    # 6. CryptoJS
    assert "JS_CRYPTOJS_MD5" in rule_ids


def test_clean_javascript_has_zero_vulnerabilities(js_adapter):
    fixture_path = Path("tests/fixtures/static/clean_js.js")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = js_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Clean JavaScript file produced unexpected findings: {critical_or_high}"


def test_insecure_typescript_detection(ts_adapter):
    fixture_path = Path("tests/fixtures/static/vulnerable_ts.ts")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = ts_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) >= 5, f"Expected at least 5 findings in TypeScript, got {len(findings)}"

    rule_ids = {f.rule_id for f in findings}

    assert "JS_WEAK_HASH" in rule_ids
    assert "JS_WEAK_CIPHER" in rule_ids
    assert "JS_WEAK_RSA_KEY_SIZE" in rule_ids
    assert "JS_DISABLED_CERT_VALIDATION" in rule_ids
    assert "JS_JWT_NONE_ALGORITHM" in rule_ids


def test_clean_typescript_has_zero_vulnerabilities(ts_adapter):
    fixture_path = Path("tests/fixtures/static/clean_ts.ts")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = ts_adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    critical_or_high = [f for f in findings if f.severity in ("critical", "high")]
    assert len(critical_or_high) == 0, f"Clean TypeScript file produced unexpected findings: {critical_or_high}"
