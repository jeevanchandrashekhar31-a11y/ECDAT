"""
ECDAT Python Language Adapter & AST Handler (Phase 2.2)
Full compliance with:
- LanguageAdapter
- Parser
- ASTNormalizer
- CryptoRuleProvider
- DataFlowProvider
"""

import ast
from pathlib import Path
from typing import Any, Dict, List, Optional

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
from scanners.static.ast.python_detector import PythonCryptoDetector, PythonSemanticResolver
from scanners.static.results import StaticFinding


class PythonNativeParser(Parser):
    def parse(self, source_bytes: bytes) -> ast.AST:
        try:
            return ast.parse(source_bytes)
        except SyntaxError as e:
            raise ParserFailureError(f"Python syntax parse failure: {e}", fatal=False) from e


class PythonASTNormalizer(ASTNormalizer):
    def extract_function_calls(self, tree: Any, source_bytes: bytes) -> List[NormalizedCallNode]:
        calls = []
        source_lines = source_bytes.decode("utf-8", errors="replace").split("\n")
        resolver = PythonSemanticResolver()
        resolver.visit(tree)

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                callee_sym = resolver.resolve_symbol(node.func)
                line_no = node.lineno
                snippet = source_lines[line_no - 1].strip() if 1 <= line_no <= len(source_lines) else ""
                calls.append(
                    NormalizedCallNode(callee=callee_sym, arguments=node.args, line_number=line_no, raw_snippet=snippet)
                )
        return calls

    def extract_assignments(self, tree: Any, source_bytes: bytes) -> List[NormalizedAssignmentNode]:
        assignments = []
        resolver = PythonSemanticResolver()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                val = resolver._extract_literal(node.value)
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        assignments.append(
                            NormalizedAssignmentNode(
                                variable_name=t.id,
                                value=val,
                                inferred_type=type(val).__name__ if val is not None else "Unknown",
                                line_number=node.lineno,
                            )
                        )
        return assignments


class PythonDataFlowProvider(DataFlowProvider):
    def __init__(self):
        from scanners.static.ast.dataflow_interprocedural import BoundedDataFlowEngine

        self.engine = BoundedDataFlowEngine()

    def resolve_constant(self, var_name: str, assignments: List[NormalizedAssignmentNode]) -> Optional[Any]:
        for assign in reversed(assignments):
            if assign.variable_name == var_name:
                return assign.value
        return None

    def trace_interprocedural_flow(
        self,
        entry_func: str,
        initial_arg_value: Any,
        target_crypto_api: str,
        param_index: int = 0,
    ) -> Any:
        return self.engine.trace_parameter_flow(entry_func, initial_arg_value, target_crypto_api, param_index)

    def trace_configuration_flow(
        self,
        config_key: str,
        target_init_func: str,
    ) -> Any:
        return self.engine.trace_configuration_flow(config_key, target_init_func)


class PythonCryptoRuleProvider(CryptoRuleProvider):
    def get_rules(self) -> List[CryptoDetectionRule]:
        return [
            CryptoDetectionRule("PY_HASHLIB_MD5", "MD5", "hashlib.md5", "weak_hash", "critical", "high"),
            CryptoDetectionRule("PY_HASHLIB_SHA1", "SHA1", "hashlib.sha1", "weak_hash", "high", "high"),
            CryptoDetectionRule("PY_HMAC_MD5", "MD5", "hmac.new(..., md5)", "weak_hash", "critical", "high"),
            CryptoDetectionRule(
                "PY_WEAK_RSA_KEY_SIZE",
                "RSA-Weak",
                "rsa.generate_private_key",
                "weak_asymmetric_key",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "PY_CIPHER_DES", "DES", "ciphers.algorithms.TripleDES", "weak_cipher", "critical", "high"
            ),
            CryptoDetectionRule(
                "PY_INSECURE_MODE_ECB", "ECB", "ciphers.modes.ECB", "insecure_cipher_mode", "critical", "high"
            ),
            CryptoDetectionRule(
                "PY_DISABLED_CERT_VALIDATION",
                "TLS_NO_VERIFY",
                "requests.get(verify=False)",
                "disabled_certificate_validation",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "PY_INSECURE_RANDOMNESS", "PRNG", "random.randint", "insecure_randomness", "high", "high"
            ),
            CryptoDetectionRule(
                "PY_JWT_VERIFY_FALSE",
                "JWT",
                "jwt.decode(verify=False)",
                "insecure_jwt_verification",
                "critical",
                "high",
            ),
            CryptoDetectionRule(
                "PY_HARDCODED_PRIVATE_KEY",
                "Hardcoded-Key",
                "PEM Private Key Literal",
                "hardcoded_private_key",
                "critical",
                "high",
            ),
        ]


class PythonLanguageAdapter(LanguageAdapter):
    language = "python"
    supported_versions = ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"]
    parser_version = "python-ast standard library"
    supported_crypto_apis = [
        "hashlib",
        "hmac",
        "secrets",
        "cryptography.hazmat.primitives (ciphers, modes, asymmetric, serialization)",
        "PyCryptodome (Crypto.Cipher, Crypto.PublicKey, Crypto.Hash)",
        "ssl / TLS (create_default_context, wrap_socket)",
        "requests / urllib3 (verify=False, cert_reqs)",
        "pyjwt (jwt.decode, algorithms=['none'])",
        "boto3.client('kms') (create_key KeySpec)",
        "google.cloud.kms",
        "azure.keyvault.keys",
    ]
    unsupported_constructs = [
        "runtime exec() arbitrary code string evaluation",
        "ctypes direct raw memory injection",
        "obfuscated bytecode dynamic import hook",
    ]
    confidence_behavior = {
        "ast_semantic_call": "high",
        "constant_propagated_argument": "high",
        "dynamic_eval_expression": "low",
    }
    tested_corpus = [
        "tests/fixtures/static/vulnerable_python.py",
        "tests/fixtures/static/clean_python.py",
    ]

    def __init__(self):
        self._parser = PythonNativeParser()
        self._normalizer = PythonASTNormalizer()
        self._rule_provider = PythonCryptoRuleProvider()
        self._data_flow = PythonDataFlowProvider()

    def get_parser(self) -> Parser:
        return self._parser

    def get_ast_normalizer(self) -> ASTNormalizer:
        return self._normalizer

    def get_crypto_rule_provider(self) -> CryptoRuleProvider:
        return self._rule_provider

    def get_data_flow_provider(self) -> DataFlowProvider:
        return self._data_flow

    def extract_findings(self, source_bytes: bytes, file_path: Path, root_dir: Path) -> List[StaticFinding]:
        detector = PythonCryptoDetector(file_path, root_dir, source_bytes)
        return detector.detect()
