"""
ECDAT C# AST Handlers and Language Adapter (Phase 2.7)
Provides:
- CSharpLanguageAdapter
- CSharpHandler
- CSharpCryptoRuleProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_c_sharp

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
from scanners.static.ast.csharp_detector import CSharpCryptoDetector
from scanners.static.results import StaticFinding


class CSharpTreeSitterParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str = "csharp"):
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


class CSharpGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class CSharpGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class CSharpCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("CS_WEAK_HASH_MD5", "MD5", "MD5.Create()", "weak_hash", "critical", "high"),
            CryptoDetectionRule("CS_WEAK_HASH_SHA1", "SHA-1", "SHA1.Create()", "weak_hash", "high", "high"),
            CryptoDetectionRule("CS_WEAK_CIPHER_DES", "DES", "DES.Create()", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("CS_WEAK_CIPHER_3DES", "3DES", "TripleDES.Create()", "weak_cipher", "critical", "high"),
            CryptoDetectionRule("CS_INSECURE_CIPHER_MODE_ECB", "ECB", "CipherMode.ECB", "insecure_cipher_mode", "critical", "high"),
            CryptoDetectionRule("CS_WEAK_RSA_KEY_SIZE", "RSA-Weak", "RSA.Create(1024)", "weak_asymmetric_key", "critical", "high"),
            CryptoDetectionRule("CS_DISABLED_CERT_VALIDATION", "ServerCertificateValidationCallback => true", "ServerCertificateValidationCallback = ... => true", "disabled_certificate_validation", "critical", "high"),
            CryptoDetectionRule("CS_INSECURE_TLS_VERSION", "TLSv1.0", "SecurityProtocolType.Tls", "insecure_tls_protocol", "critical", "high"),
            CryptoDetectionRule("CS_WEAK_CERT_SIGNATURE_ALGO", "MD5WithRSA", "CertificateRequest(..., HashAlgorithmName.MD5)", "weak_signature_algorithm", "critical", "high"),
        ]


class CSharpHandler(AstHandler):
    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_c_sharp.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CSharpCryptoDetector(file_path, root_dir, source_code, self.language)
        return detector.detect()


class CSharpLanguageAdapter(LanguageAdapter):
    language = "csharp"
    supported_versions = [".NET 6", ".NET 7", ".NET 8", ".NET 9", "C# 10", "C# 11", "C# 12"]
    parser_version = "tree-sitter-c-sharp 0.23.5"
    supported_crypto_apis = [
        "System.Security.Cryptography",
        "System.Security.Cryptography.X509Certificates",
        "System.Net.Security (SslStream, SslProtocols)",
    ]
    unsupported_constructs = [
        "reflection MethodInfo.Invoke dynamic crypto loading",
        "P/Invoke native binary interop",
    ]
    confidence_behavior = {
        "standard_class_instantiation": "high",
        "factory_method_call": "high",
        "callback_assignment": "high",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_cs.cs",
        "tests/fixtures/static/clean_cs.cs",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_c_sharp.language())
        self._parser = CSharpTreeSitterParser(self._lang, "csharp")
        self._normalizer = CSharpGenericNormalizer()
        self._rule_provider = CSharpCryptoRuleProvider()
        self._data_flow = CSharpGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CSharpCryptoDetector(file_path, root_dir, source_bytes, self._lang)
        return detector.detect()
