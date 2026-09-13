"""
Unit tests for Parser Abstraction (Phase 2.1).
Validates LanguageAdapter, Parser, ASTNormalizer, CryptoRuleProvider, DataFlowProvider,
metadata declarations, capability introspection, and execution against the tested corpus.
"""

from pathlib import Path
import pytest

from scanners.static.ast.abstraction import (
    ASTNormalizer,
    CryptoRuleProvider,
    DataFlowProvider,
    LanguageAdapter,
    Parser,
)
from scanners.static.ast.adapters import (
    CLanguageAdapter,
    CppLanguageAdapter,
    GoLanguageAdapter,
    JavascriptLanguageAdapter,
    get_default_adapter_registry,
)


def test_adapter_capability_declarations():
    adapters = [
        CLanguageAdapter(),
        CppLanguageAdapter(),
        GoLanguageAdapter(),
        JavascriptLanguageAdapter(),
    ]

    for adapter in adapters:
        caps = adapter.get_capabilities()
        assert "language" in caps
        assert "supported_versions" in caps
        assert len(caps["supported_versions"]) > 0
        assert "parser_version" in caps
        assert "supported_crypto_apis" in caps
        assert len(caps["supported_crypto_apis"]) > 0
        assert "unsupported_constructs" in caps
        assert len(caps["unsupported_constructs"]) > 0
        assert "confidence_behavior" in caps
        assert len(caps["confidence_behavior"]) > 0
        assert "tested_corpus" in caps
        assert len(caps["tested_corpus"]) > 0


def test_do_not_claim_language_support_beyond_tested_corpus():
    registry = get_default_adapter_registry()
    supported_langs = registry.get_supported_languages()

    # Must only claim languages in the tested corpus: c, cpp, go, javascript, python, java, kotlin, typescript, csharp, rust
    assert set(supported_langs) == {"c", "cpp", "go", "javascript", "python", "java", "kotlin", "typescript", "csharp", "rust"}

    # Must not claim untrusted/untested languages (e.g. ruby, swift, php)
    assert registry.get_by_extension(".swift") is None
    assert registry.get_by_extension(".rb") is None
    assert registry.get_by_extension(".php") is None
    assert registry.get_by_language("ruby") is None
    assert registry.get_by_language("swift") is None


def test_adapter_subcomponents_instantiation():
    adapters = [
        CLanguageAdapter(),
        CppLanguageAdapter(),
        GoLanguageAdapter(),
        JavascriptLanguageAdapter(),
    ]

    for adapter in adapters:
        parser = adapter.get_parser()
        assert isinstance(parser, Parser)

        normalizer = adapter.get_ast_normalizer()
        assert isinstance(normalizer, ASTNormalizer)

        rule_provider = adapter.get_crypto_rule_provider()
        assert isinstance(rule_provider, CryptoRuleProvider)
        rules = rule_provider.get_rules()
        assert len(rules) > 0

        data_flow = adapter.get_data_flow_provider()
        assert isinstance(data_flow, DataFlowProvider)


def test_c_adapter_extracts_from_tested_corpus():
    adapter = CLanguageAdapter()
    fixture_path = Path("tests/fixtures/static/vulnerable_c.c")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) > 0
    # MD5 or DES should be discovered in vulnerable_c.c
    algos = {f.algorithm for f in findings}
    assert any("md5" in a.lower() or "des" in a.lower() or "evp" in a.lower() for a in algos)


def test_go_adapter_extracts_from_tested_corpus():
    adapter = GoLanguageAdapter()
    fixture_path = Path("tests/fixtures/static/vulnerable_go.go")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) > 0
    algos = {f.algorithm for f in findings}
    assert any("md5" in a.lower() or "des" in a.lower() or "rsa" in a.lower() for a in algos)


def test_javascript_adapter_extracts_from_tested_corpus():
    adapter = JavascriptLanguageAdapter()
    fixture_path = Path("tests/fixtures/static/vulnerable_js.js")
    assert fixture_path.exists()

    source_bytes = fixture_path.read_bytes()
    findings = adapter.extract_findings(source_bytes, fixture_path, Path("tests/fixtures/static"))

    assert len(findings) > 0
    algos = {f.algorithm for f in findings}
    assert any("md5" in a.lower() or "des" in a.lower() for a in algos)


def test_adapter_registry_routing():
    registry = get_default_adapter_registry()

    assert isinstance(registry.get_by_extension(".c"), CLanguageAdapter)
    assert isinstance(registry.get_by_extension(".h"), CLanguageAdapter)
    assert isinstance(registry.get_by_extension(".cpp"), CppLanguageAdapter)
    assert isinstance(registry.get_by_extension(".go"), GoLanguageAdapter)
    assert isinstance(registry.get_by_extension(".js"), JavascriptLanguageAdapter)
    assert isinstance(registry.get_by_extension(".mjs"), JavascriptLanguageAdapter)
