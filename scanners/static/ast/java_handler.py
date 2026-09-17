"""
ECDAT Java & Kotlin Language Adapters & AST Handlers (Phase 2.3)
Implements:
- JavaLanguageAdapter
- KotlinLanguageAdapter
Conforming strictly to:
- LanguageAdapter
- Parser
- ASTNormalizer
- CryptoRuleProvider
- DataFlowProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_java
import tree_sitter_kotlin

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
from scanners.static.ast.java_detector import JavaKotlinCryptoDetector
from scanners.static.results import StaticFinding


class TreeSitterGenericParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str):
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


class GenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class GenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class JavaCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule(
                "JAVA_WEAK_CIPHER", "DES", 'Cipher.getInstance("DES")', "weak_cipher", "critical", "high"
            ),
            CryptoDetectionRule(
                "JAVA_INSECURE_CIPHER_MODE_ECB",
                "ECB",
                'Cipher.getInstance(".../ECB/...")',
                "insecure_cipher_mode",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JAVA_WEAK_HASH", "MD5", 'MessageDigest.getInstance("MD5")', "weak_hash", "critical", "high"
            ),
            CryptoDetectionRule(
                "JAVA_WEAK_MAC", "HmacMD5", 'Mac.getInstance("HmacMD5")', "weak_hash", "critical", "high"
            ),
            CryptoDetectionRule(
                "JAVA_WEAK_SIGNATURE",
                "SHA1withRSA",
                'Signature.getInstance("SHA1withRSA")',
                "weak_signature_algorithm",
                "high",
                "high",
            ),
            CryptoDetectionRule(
                "JAVA_WEAK_KEY_SIZE",
                "RSA-Weak",
                "KeyPairGenerator.initialize(1024)",
                "weak_asymmetric_key",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JAVA_INSECURE_TLS_PROTOCOL",
                "SSLv3",
                'SSLContext.getInstance("SSLv3")',
                "insecure_tls_protocol",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JAVA_TRUST_ALL_CERTS",
                "TrustAllCerts",
                "X509TrustManager empty checkServerTrusted",
                "disabled_certificate_validation",
                "critical",
                "high",
            ),
        ]


# =====================================================================
# Java Language Adapter
# =====================================================================
class JavaLanguageAdapter(LanguageAdapter):
    language = "java"
    supported_versions = ["8", "11", "17", "21"]
    parser_version = "tree-sitter-java 0.23.5"
    supported_crypto_apis = [
        "JCA/JCE",
        "javax.crypto.Cipher",
        "java.security.MessageDigest",
        "java.security.Mac",
        "java.security.Signature",
        "java.security.KeyGenerator",
        "java.security.KeyPairGenerator",
        "java.security.SecretKeyFactory",
        "javax.net.ssl.SSLContext",
        "javax.net.ssl.X509TrustManager",
        "java.security.KeyStore",
        "BouncyCastleProvider",
    ]
    unsupported_constructs = [
        "reflection Class.forName dynamic method invocation",
        "runtime bytecode instrumentation",
    ]
    confidence_behavior = {
        "jca_factory_call": "high",
        "constant_propagated_algorithm": "high",
        "dynamic_expression": "medium",
    }
    tested_corpus = [
        "tests/fixtures/static/InsecureCrypto.java",
        "tests/fixtures/static/SecureCrypto.java",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_java.language())
        self._parser = TreeSitterGenericParser(self._lang, "java")
        self._normalizer = GenericNormalizer()
        self._rule_provider = JavaCryptoRuleProvider()
        self._data_flow = GenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = JavaKotlinCryptoDetector(file_path, root_dir, source_bytes, "java", self._lang)
        return detector.detect()


# =====================================================================
# Kotlin Language Adapter
# =====================================================================
class KotlinLanguageAdapter(LanguageAdapter):
    language = "kotlin"
    supported_versions = ["1.8", "1.9", "2.0"]
    parser_version = "tree-sitter-kotlin 1.1.0"
    supported_crypto_apis = [
        "JCA/JCE in Kotlin",
        "javax.crypto.Cipher",
        "java.security.MessageDigest",
        "java.security.Mac",
        "java.security.Signature",
        "java.security.KeyPairGenerator",
        "javax.net.ssl.SSLContext",
        "BouncyCastleProvider",
    ]
    unsupported_constructs = [
        "Kotlin reflection KClass dynamic invocation",
        "compiler plugin code generation",
    ]
    confidence_behavior = {
        "jca_factory_call": "high",
        "constant_propagated_algorithm": "high",
        "dynamic_expression": "medium",
    }
    tested_corpus = [
        "tests/fixtures/static/InsecureCrypto.kt",
        "tests/fixtures/static/SecureCrypto.kt",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_kotlin.language())
        self._parser = TreeSitterGenericParser(self._lang, "kotlin")
        self._normalizer = GenericNormalizer()
        self._rule_provider = JavaCryptoRuleProvider()
        self._data_flow = GenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = JavaKotlinCryptoDetector(file_path, root_dir, source_bytes, "kotlin", self._lang)
        return detector.detect()
