"""
ECDAT C AST Handlers and Language Adapter (Phase 2.6)
Provides:
- CLanguageAdapter
- CHandler
- CCryptoRuleProvider
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_c

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


class CTreeSitterParser(Parser):
    def __init__(self, language: tree_sitter.Language, lang_name: str = "c"):
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


class CGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class CGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class CCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("C_WEAK_HASH_MD5", "MD5", "EVP_md5() / MD5()", "weak_hash", "critical", "high"),
            CryptoDetectionRule("C_WEAK_HASH_SHA1", "SHA-1", "EVP_sha1() / SHA1()", "weak_hash", "high", "high"),
            CryptoDetectionRule(
                "C_WEAK_CIPHER_DES", "DES", "EVP_des_cbc() / mbedtls_des_crypt_ecb()", "weak_cipher", "critical", "high"
            ),
            CryptoDetectionRule("C_WEAK_CIPHER_RC4", "RC4", "EVP_rc4()", "weak_cipher", "critical", "high"),
            CryptoDetectionRule(
                "C_WEAK_CIPHER_BLOWFISH", "Blowfish", "EVP_bf_cbc()", "weak_cipher", "critical", "high"
            ),
            CryptoDetectionRule(
                "C_INSECURE_CIPHER_MODE_ECB", "ECB", "EVP_aes_128_ecb()", "insecure_cipher_mode", "critical", "high"
            ),
            CryptoDetectionRule(
                "C_WEAK_RSA_KEY_SIZE",
                "RSA-Weak",
                "RSA_generate_key_ex(rsa, 1024, ...)",
                "weak_asymmetric_key",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "C_WEAK_ECC_CURVE",
                "ECDSA-P224",
                "EC_KEY_new_by_curve_name(NID_secp224k1)",
                "weak_asymmetric_key",
                "high",
                "high",
            ),
            CryptoDetectionRule(
                "C_DISABLED_CERT_VALIDATION",
                "SSL_VERIFY_NONE",
                "SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL)",
                "disabled_certificate_validation",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "C_INSECURE_TLS_VERSION",
                "TLSv1.0",
                "SSL_CTX_set_min_proto_version(ctx, TLS1_VERSION)",
                "insecure_tls_protocol",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "C_WEAK_CERT_SIGNATURE_ALGO",
                "MD5WithRSA",
                "X509_sign(x, pkey, EVP_md5())",
                "weak_signature_algorithm",
                "critical",
                "high",
            ),
        ]


class CHandler(AstHandler):
    """Retained for backward compatibility while using CCppCryptoDetector."""

    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_c.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CCppCryptoDetector(file_path, root_dir, source_code, self.language, is_cpp=False)
        return detector.detect()


# =====================================================================
# C Language Adapter
# =====================================================================
class CLanguageAdapter(LanguageAdapter):
    language = "c"
    supported_versions = ["C99", "C11", "C17"]
    parser_version = "tree-sitter-c 0.23.0"
    supported_crypto_apis = [
        "OpenSSL / BoringSSL / LibreSSL EVP",
        "OpenSSL direct hash (MD5, SHA1, SHA256)",
        "libcrypto RSA/EC_KEY/DH/Ed25519",
        "mbedTLS",
        "wolfSSL",
        "libsodium",
    ]
    unsupported_constructs = [
        "complex preprocessor macro metaprogramming",
        "dynamic function pointer dispatch",
        "inline assembly crypto blocks",
    ]
    confidence_behavior = {
        "direct_function_call": "high",
        "macro_expanded_call": "high",
        "function_pointer_target": "low",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_c.c",
        "tests/fixtures/static/clean_c.c",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_c.language())
        self._parser = CTreeSitterParser(self._lang, "c")
        self._normalizer = CGenericNormalizer()
        self._rule_provider = CCryptoRuleProvider()
        self._data_flow = CGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = CCppCryptoDetector(file_path, root_dir, source_bytes, self._lang, is_cpp=False)
        return detector.detect()
