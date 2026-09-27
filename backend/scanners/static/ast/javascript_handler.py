"""
ECDAT JavaScript & TypeScript AST Handlers and Language Adapters (Phase 2.4)
Provides:
- JavascriptLanguageAdapter
- TypescriptLanguageAdapter
- JavascriptHandler
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import tree_sitter
import tree_sitter_javascript
import tree_sitter_typescript

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
from scanners.static.ast.javascript_detector import JavascriptCryptoDetector
from scanners.static.results import StaticFinding


class JSTSTreeSitterParser(Parser):
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


class JSTSGenericNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        return []

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        return []


class JSTSGenericDataFlow(DataFlowProvider):
    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        return None


class JSTSCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("JS_WEAK_HASH", "MD5", "crypto.createHash('md5')", "weak_hash", "critical", "high"),
            CryptoDetectionRule(
                "JS_WEAK_CIPHER", "DES", "crypto.createCipheriv('des-ecb')", "weak_cipher", "critical", "high"
            ),
            CryptoDetectionRule(
                "JS_INSECURE_CIPHER_MODE_ECB",
                "ECB",
                "createCipheriv('aes-128-ecb')",
                "insecure_cipher_mode",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JS_WEAK_RSA_KEY_SIZE",
                "RSA-Weak",
                "generateKeyPairSync('rsa', { modulusLength: 1024 })",
                "weak_asymmetric_key",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JS_DISABLED_CERT_VALIDATION",
                "rejectUnauthorized: false",
                "https.Agent({ rejectUnauthorized: false })",
                "disabled_certificate_validation",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JS_INSECURE_TLS_VERSION",
                "TLSv1.0",
                "https.createServer({ minVersion: 'TLSv1' })",
                "insecure_tls_protocol",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "JS_JWT_NONE_ALGORITHM",
                "JWT-NONE",
                "jwt.verify(..., { algorithms: ['none'] })",
                "insecure_jwt_algorithm",
                "critical",
                "high",
            ),
            CryptoDetectionRule("JS_CRYPTOJS_MD5", "MD5", "CryptoJS.MD5(...)", "weak_hash", "critical", "high"),
        ]


class JavascriptHandler(AstHandler):
    """Retained for backward compatibility while using the advanced semantic detector."""

    def __init__(self):
        super().__init__(tree_sitter.Language(tree_sitter_javascript.language()))

    def extract_findings(self, source_code: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = JavascriptCryptoDetector(file_path, root_dir, source_code, self.language, is_typescript=False)
        return detector.detect()


# =====================================================================
# 1. JavaScript Language Adapter
# =====================================================================
class JavascriptLanguageAdapter(LanguageAdapter):
    language = "javascript"
    supported_versions = ["ES6+", "Node.js 16+", "Node.js 18+", "Node.js 20+", "Node.js 22+"]
    parser_version = "tree-sitter-javascript 0.23.0"
    supported_crypto_apis = [
        "node:crypto",
        "crypto.createHash",
        "crypto.createHmac",
        "crypto.createCipheriv",
        "crypto.generateKeyPairSync",
        "crypto.createDiffieHellman",
        "window.crypto.subtle",
        "https.Agent ({ rejectUnauthorized: false })",
        "crypto-js",
        "node-forge",
        "jsonwebtoken (jwt.verify)",
    ]
    unsupported_constructs = [
        "runtime eval() dynamic code string evaluation",
        "Function() constructor string evaluation",
        "dynamically computed property access over network strings",
    ]
    confidence_behavior = {
        "destructured_import_call": "high",
        "aliased_require_call": "high",
        "constant_propagated_argument": "high",
        "wrapper_function_call": "high",
        "dynamic_eval_expression": "low",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_js.js",
        "tests/fixtures/static/clean_js.js",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_javascript.language())
        self._parser = JSTSTreeSitterParser(self._lang, "javascript")
        self._normalizer = JSTSGenericNormalizer()
        self._rule_provider = JSTSCryptoRuleProvider()
        self._data_flow = JSTSGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = JavascriptCryptoDetector(file_path, root_dir, source_bytes, self._lang, is_typescript=False)
        return detector.detect()


# =====================================================================
# 2. TypeScript Language Adapter
# =====================================================================
class TypescriptLanguageAdapter(LanguageAdapter):
    language = "typescript"
    supported_versions = ["4.x", "5.x"]
    parser_version = "tree-sitter-typescript 0.23.2"
    supported_crypto_apis = [
        "node:crypto",
        "crypto.createHash",
        "crypto.createHmac",
        "crypto.createCipheriv",
        "crypto.generateKeyPairSync",
        "window.crypto.subtle",
        "https.Agent ({ rejectUnauthorized: false })",
        "crypto-js",
        "node-forge",
        "jsonwebtoken",
    ]
    unsupported_constructs = [
        "runtime eval() dynamic code string evaluation",
        "Function() constructor string evaluation",
    ]
    confidence_behavior = {
        "destructured_import_call": "high",
        "aliased_require_call": "high",
        "constant_propagated_argument": "high",
        "wrapper_function_call": "high",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_ts.ts",
        "tests/fixtures/static/clean_ts.ts",
    ]

    def __init__(self):
        self._lang = tree_sitter.Language(tree_sitter_typescript.language_typescript())
        self._parser = JSTSTreeSitterParser(self._lang, "typescript")
        self._normalizer = JSTSGenericNormalizer()
        self._rule_provider = JSTSCryptoRuleProvider()
        self._data_flow = JSTSGenericDataFlow()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = JavascriptCryptoDetector(file_path, root_dir, source_bytes, self._lang, is_typescript=True)
        return detector.detect()
