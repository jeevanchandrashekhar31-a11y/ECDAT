"""
ECDAT Rust AST Handlers and Language Adapter (Phase 2.7)
Provides:
- RustLanguageAdapter
- RustHandler
- RustCryptoRuleProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_rust

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
from scanners.static.ast.rust_detector import RustCryptoDetector
from scanners.static.results import StaticFinding


class RustTreeSitterParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str = "rust"):
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


class RustGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class RustGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class RustCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("RUST_WEAK_HASH_MD5", "MD5", "Md5::new()", "weak_hash", "critical", "high"),
            CryptoDetectionRule("RUST_WEAK_HASH_SHA1", "SHA-1", "Sha1::new()", "weak_hash", "high", "high"),
            CryptoDetectionRule("RUST_WEAK_CIPHER_DES", "DES", "Des::new()", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("RUST_WEAK_CIPHER_BLOWFISH", "Blowfish", "Blowfish::new()", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("RUST_RUSTLS_DISABLED_CERT_VALIDATION", "danger().set_certificate_verifier", "set_certificate_verifier(NoServerAuth)", "disabled_certificate_validation", "critical", "high"),
            CryptoDetectionRule("RUST_CRATE_PRESENT_ONLY", "Dependency", "Cargo.toml dependency present without observed execution", "dependency_present", "info", "high"),
        ]


class RustHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_rust.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = RustCryptoDetector(file_path, root_dir, source_code, self.language)
        return detector.detect()


class RustLanguageAdapter(LanguageAdapter):
    language = "rust"
    supported_versions = ["2018 Edition", "2021 Edition", "Rust 1.70 - 1.85"]
    parser_version = "tree-sitter-rust 0.24.2"
    supported_crypto_apis = [
        "ring",
        "RustCrypto (md5, sha1, sha2, sha3, aes, des, blowfish)",
        "rustls",
        "ed25519-dalek",
        "x25519-dalek",
    ]
    unsupported_constructs = [
        "procedural macro code generation",
        "unsafe extern 'C' foreign function bindings",
    ]
    confidence_behavior = {
        "crate_method_call": "high",
        "trait_implementation_call": "high",
        "dependency_manifest_present": "high",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_rust.rs",
        "tests/fixtures/static/clean_rust.rs",
        "tests/fixtures/static/Cargo.toml",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_rust.language())
        self._parser = RustTreeSitterParser(self._lang, "rust")
        self._normalizer = RustGenericNormalizer()
        self._rule_provider = RustCryptoRuleProvider()
        self._data_flow = RustGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = RustCryptoDetector(file_path, root_dir, source_bytes, self._lang)
        return detector.detect()
