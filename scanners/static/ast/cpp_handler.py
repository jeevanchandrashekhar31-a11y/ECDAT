"""
ECDAT C++ AST Handlers and Language Adapter (Phase 2.6)
Provides:
- CppLanguageAdapter
- CppHandler
- CppCryptoRuleProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_cpp

from scanners.domain.errors import ParserFailureError
from scanners.static.ast.abstraction import (
    ASTNormalizer,
    CryptoDetectionRule,
    CryptoRuleProvider,
    DataFlowProvider,
    LanguageAdapter,
    NormalizedAssignmentNode,
    NormalizedCallNode,
    Parser,
)
from scanners.static.ast.base import AstHandler
from scanners.static.ast.c_cpp_detector import CCppCryptoDetector
from scanners.static.results import StaticFinding


class CppTreeSitterParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str = "cpp"):
        self.language = language
        self.lang_name = lang_name
        self._parser = tree_sitter.Parser(self.language)

    def parse(self, source_bytes: bytes) -> tree_sitter.Tree:
        try:
            tree = self._parser.parse(source_bytes)
            if not tree:
                raise ParserFailureError(f"Failed to parse {self.lang_name} source text")
            return tree
        except Exception as e:
            if isinstance(e, ParserFailureError):
                raise
            raise ParserFailureError(f"Tree-sitter {self.lang_name} parse failure: {e}", fatal=False) from e


class CppGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class CppGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class CppCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("CPP_BOTAN_WEAK_HASH_MD5", "MD5", "Botan::HashFunction::create(\"MD5\")", "weak_hash", "critical", "high"),
            CryptoDetectionRule("CPP_BOTAN_WEAK_HASH_SHA1", "SHA-1", "Botan::HashFunction::create(\"SHA-1\")", "weak_hash", "high", "high"),
            CryptoDetectionRule("CPP_BOTAN_WEAK_CIPHER", "DES", "Botan::Cipher_Mode::create(\"DES/CBC\", ...)", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("CPP_BOTAN_INSECURE_CIPHER_MODE_ECB", "ECB", "Botan::Cipher_Mode::create(\"AES-128/ECB\", ...)", "insecure_cipher_mode", "critical", "high"),
            CryptoDetectionRule("CPP_BOTAN_WEAK_RSA", "RSA-Weak", "Botan::RSA_PrivateKey(rng, 1024)", "weak_asymmetric_key", "critical", "high"),
            CryptoDetectionRule("C_WEAK_HASH_MD5", "MD5", "EVP_md5() / MD5()", "weak_hash", "critical", "high"),
            CryptoDetectionRule("C_DISABLED_CERT_VALIDATION", "SSL_VERIFY_NONE", "SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL)", "disabled_certificate_validation", "critical", "high"),
        ]


class CppHandler(AstHandler):
    """Retained for backward compatibility while using CCppCryptoDetector."""

    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_cpp.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CCppCryptoDetector(file_path, root_dir, source_code, self.language, is_cpp=True)
        return detector.detect()


# =====================================================================
# C++ Language Adapter
# =====================================================================
class CppLanguageAdapter(LanguageAdapter):
    language = "cpp"
    supported_versions = ["C++11", "C++14", "C++17", "C++20"]
    parser_version = "tree-sitter-cpp 0.23.0"
    supported_crypto_apis = [
        "OpenSSL / BoringSSL / LibreSSL C++",
        "mbedTLS",
        "wolfSSL",
        "libsodium",
        "Botan",
    ]
    unsupported_constructs = [
        "complex template metaprogramming instantiation",
        "virtual method dispatch through abstract interfaces",
        "runtime dlopen/dlsym symbol resolution",
    ]
    confidence_behavior = {
        "namespace_qualified_instantiation": "high",
        "direct_function_call": "high",
        "typedef_alias": "medium",
        "virtual_call_site": "low",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_cpp.cpp",
        "tests/fixtures/static/clean_cpp.cpp",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_cpp.language())
        self._parser = CppTreeSitterParser(self._lang, "cpp")
        self._normalizer = CppGenericNormalizer()
        self._rule_provider = CppCryptoRuleProvider()
        self._data_flow = CppGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CCppCryptoDetector(file_path, root_dir, source_bytes, self._lang, is_cpp=True)
        return detector.detect()
