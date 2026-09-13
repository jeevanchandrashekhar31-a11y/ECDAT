"""
ECDAT Go AST Handlers and Language Adapter (Phase 2.5)
Provides:
- GoLanguageAdapter
- GoHandler
- GoCryptoRuleProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_go

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
from scanners.static.ast.go_detector import GoCryptoDetector
from scanners.static.results import StaticFinding


class GoTreeSitterParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str = "go"):
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


class GoGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class GoGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class GoCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("GO_WEAK_HASH_MD5", "MD5", "md5.New()", "weak_hash", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_HASH_SHA1", "SHA-1", "sha1.New()", "weak_hash", "high", "high"),
            CryptoDetectionRule("GO_WEAK_HMAC_MD5", "HMAC-MD5", "hmac.New(md5.New, key)", "weak_hash", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_RSA_KEY_SIZE", "RSA-Weak", "rsa.GenerateKey(rand, 1024)", "weak_asymmetric_key", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_ECC_CURVE", "ECDSA-P224", "ecdsa.GenerateKey(elliptic.P224(), rand)", "weak_asymmetric_key", "high", "high"),
            CryptoDetectionRule("GO_DISABLED_CERT_VALIDATION", "InsecureSkipVerify: true", "tls.Config{ InsecureSkipVerify: true }", "disabled_certificate_validation", "critical", "high"),
            CryptoDetectionRule("GO_INSECURE_TLS_VERSION", "TLSv1.0", "tls.Config{ MinVersion: tls.VersionTLS10 }", "insecure_tls_protocol", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_CIPHER_BLOWFISH", "Blowfish", "blowfish.NewCipher(key)", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_CIPHER_DES", "DES", "des.NewCipher(key)", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("GO_WEAK_CERT_SIGNATURE_ALGO", "MD5WithRSA", "x509.CreateCertificate(..., MD5WithRSA)", "weak_signature_algorithm", "critical", "high"),
        ]


class GoHandler(AstHandler):
    """Retained for backward compatibility while using GoCryptoDetector."""

    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_go.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = GoCryptoDetector(file_path, root_dir, source_code, self.language)
        return detector.detect()


# =====================================================================
# Go Language Adapter
# =====================================================================
class GoLanguageAdapter(LanguageAdapter):
    language = "go"
    supported_versions = ["1.18", "1.19", "1.20", "1.21", "1.22", "1.23"]
    parser_version = "tree-sitter-go 0.23.0"
    supported_crypto_apis = [
        "crypto/aes",
        "crypto/cipher (GCM, CBC, CFB, OFB)",
        "crypto/rsa (GenerateKey, SignPKCS1v15, SignPSS, EncryptOAEP)",
        "crypto/ecdsa (GenerateKey, Sign, Verify, elliptic curves P-224, P-256, P-384, P-521)",
        "crypto/ed25519 (GenerateKey, Sign, Verify)",
        "crypto/sha256",
        "crypto/sha512",
        "crypto/sha1",
        "crypto/md5",
        "crypto/hmac",
        "crypto/tls (tls.Config, InsecureSkipVerify, MinVersion, CipherSuites)",
        "crypto/x509 (CreateCertificate, Certificate, SignatureAlgorithm)",
        "golang.org/x/crypto/blowfish",
        "golang.org/x/crypto/cast5",
        "golang.org/x/crypto/chacha20poly1305",
        "golang.org/x/crypto/curve25519",
    ]
    unsupported_constructs = [
        "reflect package dynamic function calls",
        "unsafe package memory reinterpretation",
        "cgo runtime foreign function bindings",
    ]
    confidence_behavior = {
        "standard_package_call": "high",
        "renamed_import_call": "high",
        "constant_propagated_argument": "high",
        "dynamic_expression": "medium",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_go.go",
        "tests/fixtures/static/clean_go.go",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_go.language())
        self._parser = GoTreeSitterParser(self._lang, "go")
        self._normalizer = GoGenericNormalizer()
        self._rule_provider = GoCryptoRuleProvider()
        self._data_flow = GoGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = GoCryptoDetector(file_path, root_dir, source_bytes, self._lang)
        return detector.detect()
