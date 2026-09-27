"""
ECDAT Python Cryptographic AST & Semantic Detector (Phase 2.2)
Performs AST-based semantic analysis, alias tracking, constant propagation,
and rule evaluation across:
- hashlib, hmac, secrets
- cryptography (hazmat, ciphers, modes, asymmetric keys, serialization)
- PyCryptodome (Crypto.Cipher, Crypto.PublicKey, Crypto.Hash)
- TLS / SSL / requests / urllib3
- JWT libraries (pyjwt)
- Cloud SDK KMS (boto3, google.cloud.kms, azure.keyvault.keys)
- Insecure randomness (random vs secrets)
- Hardcoded private keys and symmetric key material
"""

import ast
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from scanners.static.results import StaticFinding


@dataclass
class SemanticContext:
    imports: Dict[str, str]  # local_name -> canonical_qualified_name
    variables: Dict[str, Any]  # var_name -> literal_value


class PythonSemanticResolver(ast.NodeVisitor):
    """
    Tracks import aliases and local variable assignments within a module/scope
    to resolve symbols and propagate constants into crypto function calls.
    """

    def __init__(self):
        self.imports: Dict[str, str] = {}
        self.variables: Dict[str, Any] = {}

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            local = alias.asname or alias.name
            self.imports[local] = alias.name
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        mod = node.module or ""
        for alias in node.names:
            local = alias.asname or alias.name
            qualified = f"{mod}.{alias.name}" if mod else alias.name
            self.imports[local] = qualified
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign):
        # Extract constant or simple literal assignments
        try:
            val = self._extract_literal(node.value)
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.variables[target.id] = val
        except Exception:
            pass
        self.generic_visit(node)

    def _extract_literal(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.List):
            return [self._extract_literal(elem) for elem in node.elts]
        if isinstance(node, ast.Dict):
            d = {}
            for k, v in zip(node.keys, node.values):
                k_val = self._extract_literal(k) if k else None
                if k_val is not None:
                    d[k_val] = self._extract_literal(v)
            return d
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
            return -node.operand.value
        return None

    def resolve_symbol(self, node: ast.AST) -> str:
        """Resolves an AST Name or Attribute into a canonical qualified string."""
        if isinstance(node, ast.Name):
            return self.imports.get(node.id, node.id)

        if isinstance(node, ast.Attribute):
            left = self.resolve_symbol(node.value)
            return f"{left}.{node.attr}"

        return ""

    def resolve_val(self, node: ast.AST) -> Any:
        """Resolves a node value either from direct constant or tracked variable."""
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return self.variables.get(node.id, None)
        return None


class PythonCryptoDetector(ast.NodeVisitor):
    """
    Comprehensive AST + Semantic Cryptographic Detector for Python.
    """

    PEM_PRIVATE_KEY_REGEX = re.compile(r"-----BEGIN (RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----", re.IGNORECASE)

    def __init__(self, file_path: Path, root_dir: Path, source_bytes: bytes):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_bytes = source_bytes
        self.source_lines = source_bytes.decode("utf-8", errors="replace").split("\n")
        self.rel_path = str(file_path.relative_to(root_dir)).replace("\\", "/")
        self.findings: List[StaticFinding] = []
        self.resolver = PythonSemanticResolver()

    def detect(self) -> List[StaticFinding]:
        try:
            tree = ast.parse(self.source_bytes)
        except SyntaxError:
            return []

        # 1. First pass: build semantic table (imports & variable assignments)
        self.resolver.visit(tree)

        # 2. Second pass: evaluate crypto rules
        self.visit(tree)
        return self.findings

    def _get_evidence(self, lineno: int) -> str:
        if 1 <= lineno <= len(self.source_lines):
            return self.source_lines[lineno - 1].strip()
        return ""

    def _add_finding(
        self,
        lineno: int,
        rule_id: str,
        algorithm: str,
        finding_type: str,
        severity: str,
        confidence: str = "high",
    ):
        self.findings.append(
            StaticFinding(
                file_path=self.rel_path,
                line_number=lineno,
                rule_id=rule_id,
                algorithm=algorithm,
                evidence=self._get_evidence(lineno),
                confidence=confidence,
                finding_type=finding_type,
                severity=severity,
            )
        )

    # =========================================================================
    # Rule Evaluation Visitors
    # =========================================================================

    def visit_Call(self, node: ast.Call):
        func_sym = self.resolver.resolve_symbol(node.func)

        # 1. hashlib & hmac
        self._check_hashlib_and_hmac(node, func_sym)

        # 2. cryptography hazmat asymmetric (RSA, DSA, DH, EC) key generation
        self._check_cryptography_asymmetric(node, func_sym)

        # 3. cryptography hazmat ciphers & modes (AES, DES, 3DES, Blowfish, ARC4, ECB)
        self._check_cryptography_ciphers(node, func_sym)

        # 4. PyCryptodome (Crypto.Cipher, Crypto.PublicKey, Crypto.Hash)
        self._check_pycryptodome(node, func_sym)

        # 5. TLS / SSL & Insecure Protocol Settings
        self._check_tls_and_ssl(node, func_sym)

        # 6. Disabled Certificate Validation (requests, urllib3, ssl)
        self._check_cert_validation(node, func_sym)

        # 7. Insecure Randomness (random module vs secrets / os.urandom)
        self._check_randomness(node, func_sym)

        # 8. JWT Libraries (pyjwt verify=False, algorithms=['none'])
        self._check_jwt(node, func_sym)

        # 9. Cloud SDK KMS (boto3, google.cloud.kms, azure.keyvault.keys)
        self._check_cloud_kms(node, func_sym)

        # 10. Unsafe serialization / key loading
        self._check_unsafe_key_loading(node, func_sym)

        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign):
        # Check hardcoded key material in assignments
        self._check_hardcoded_keys(node)

        # Check property assignments like context.check_hostname = False
        self._check_attribute_assignment(node)

        self.generic_visit(node)

    # -------------------------------------------------------------------------
    # Rule Handlers
    # -------------------------------------------------------------------------

    def _check_hashlib_and_hmac(self, node: ast.Call, func_sym: str):
        # hashlib.md5(), hashlib.sha1()
        if func_sym in ("hashlib.md5", "md5"):
            self._add_finding(node.lineno, "PY_HASHLIB_MD5", "MD5", "weak_hash", "critical")
        elif func_sym in ("hashlib.sha1", "sha1"):
            self._add_finding(node.lineno, "PY_HASHLIB_SHA1", "SHA1", "weak_hash", "high")
        elif func_sym in ("hashlib.new",):
            # hashlib.new("md5")
            if node.args:
                algo_val = str(self.resolver.resolve_val(node.args[0]) or "").lower()
                if "md5" in algo_val:
                    self._add_finding(node.lineno, "PY_HASHLIB_MD5", "MD5", "weak_hash", "critical")
                elif "sha1" in algo_val:
                    self._add_finding(node.lineno, "PY_HASHLIB_SHA1", "SHA1", "weak_hash", "high")

        # hmac.new(key, msg, digestmod)
        if func_sym.endswith("hmac.new") or func_sym == "hmac.HMAC":
            digestmod = None
            if len(node.args) >= 3:
                digestmod = node.args[2]
            for kw in node.keywords:
                if kw.arg == "digestmod":
                    digestmod = kw.value

            if digestmod:
                digest_str = str(
                    self.resolver.resolve_val(digestmod) or self.resolver.resolve_symbol(digestmod)
                ).lower()
                if "md5" in digest_str:
                    self._add_finding(node.lineno, "PY_HMAC_MD5", "MD5", "weak_hash", "critical")
                elif "sha1" in digest_str:
                    self._add_finding(node.lineno, "PY_HMAC_SHA1", "SHA1", "weak_hash", "high")

    def _check_cryptography_asymmetric(self, node: ast.Call, func_sym: str):
        # rsa.generate_private_key(public_exponent=..., key_size=1024)
        if "rsa.generate_private_key" in func_sym:
            key_size = self._get_keyword_or_arg_val(node, "key_size", arg_index=1)
            if key_size is not None and isinstance(key_size, int) and key_size < 2048:
                self._add_finding(
                    node.lineno,
                    "PY_WEAK_RSA_KEY_SIZE",
                    f"RSA-{key_size}",
                    "weak_asymmetric_key",
                    "critical" if key_size <= 1024 else "high",
                )

        # dsa.generate_private_key(key_size=1024)
        if "dsa.generate_private_key" in func_sym:
            key_size = self._get_keyword_or_arg_val(node, "key_size", arg_index=0)
            if key_size is not None and isinstance(key_size, int) and key_size < 2048:
                self._add_finding(
                    node.lineno,
                    "PY_WEAK_DSA_KEY_SIZE",
                    f"DSA-{key_size}",
                    "weak_asymmetric_key",
                    "critical",
                )

        # dh.generate_parameters(generator=2, key_size=1024)
        if "dh.generate_parameters" in func_sym:
            key_size = self._get_keyword_or_arg_val(node, "key_size", arg_index=1)
            if key_size is not None and isinstance(key_size, int) and key_size < 2048:
                self._add_finding(
                    node.lineno,
                    "PY_WEAK_DH_KEY_SIZE",
                    f"DH-{key_size}",
                    "weak_asymmetric_key",
                    "critical",
                )

        # ec.generate_private_key(curve)
        if "ec.generate_private_key" in func_sym and node.args:
            curve_sym = self.resolver.resolve_symbol(node.args[0])
            if "192" in curve_sym:
                self._add_finding(
                    node.lineno,
                    "PY_WEAK_ECC_CURVE",
                    "ECC-192",
                    "weak_asymmetric_key",
                    "critical",
                )

    def _check_cryptography_ciphers(self, node: ast.Call, func_sym: str):
        # cryptography algorithms
        sym_lower = func_sym.lower()
        if sym_lower.endswith(".tripledes") or sym_lower.endswith(".des") or sym_lower.endswith(".des3"):
            self._add_finding(node.lineno, "PY_CIPHER_DES", "DES", "weak_cipher", "critical")
        elif sym_lower.endswith(".blowfish"):
            self._add_finding(node.lineno, "PY_CIPHER_BLOWFISH", "Blowfish", "weak_cipher", "high")
        elif sym_lower.endswith(".arc4") or sym_lower.endswith(".rc4"):
            self._add_finding(node.lineno, "PY_CIPHER_ARC4", "RC4", "weak_cipher", "critical")

        # Insecure mode: ECB
        if sym_lower.endswith(".ecb") or "modes.ecb" in sym_lower:
            self._add_finding(node.lineno, "PY_INSECURE_MODE_ECB", "ECB", "insecure_cipher_mode", "critical")

    def _check_pycryptodome(self, node: ast.Call, func_sym: str):
        sym_lower = func_sym.lower()
        if "crypto.cipher.des" in sym_lower:
            self._add_finding(node.lineno, "PY_PYCRYPTODOME_DES", "DES", "weak_cipher", "critical")
        elif "crypto.cipher.arc4" in sym_lower:
            self._add_finding(node.lineno, "PY_PYCRYPTODOME_RC4", "RC4", "weak_cipher", "critical")
        elif "crypto.cipher.blowfish" in sym_lower:
            self._add_finding(node.lineno, "PY_PYCRYPTODOME_BLOWFISH", "Blowfish", "weak_cipher", "high")

        # Mode ECB in PyCryptodome: AES.new(..., AES.MODE_ECB)
        for arg in node.args[1:] + [kw.value for kw in node.keywords]:
            arg_sym = self.resolver.resolve_symbol(arg)
            if "mode_ecb" in arg_sym.lower():
                self._add_finding(node.lineno, "PY_INSECURE_MODE_ECB", "ECB", "insecure_cipher_mode", "critical")

        # RSA.generate(1024)
        if "crypto.publickey.rsa.generate" in sym_lower or sym_lower.endswith("rsa.generate"):
            bits = self._get_keyword_or_arg_val(node, "bits", arg_index=0)
            if bits is not None and isinstance(bits, int) and bits < 2048:
                self._add_finding(
                    node.lineno,
                    "PY_WEAK_RSA_KEY_SIZE",
                    f"RSA-{bits}",
                    "weak_asymmetric_key",
                    "critical" if bits <= 1024 else "high",
                )

    def _check_tls_and_ssl(self, node: ast.Call, func_sym: str):
        # Insecure protocol constants in SSL calls: ssl.PROTOCOL_SSLv2, PROTOCOL_SSLv3, PROTOCOL_TLSv1, PROTOCOL_TLSv1_1
        for arg in node.args + [kw.value for kw in node.keywords]:
            arg_sym = self.resolver.resolve_symbol(arg).upper()
            if any(
                p in arg_sym
                for p in ("PROTOCOL_SSLV2", "PROTOCOL_SSLV3", "PROTOCOL_TLSV1_0", "PROTOCOL_TLSV1_1", "PROTOCOL_TLSV1")
            ):
                proto = "SSLv3" if ("PROTOCOL_SSLV2" in arg_sym or "PROTOCOL_SSLV3" in arg_sym) else "TLS 1.0/1.1"
                self._add_finding(node.lineno, "PY_INSECURE_TLS_PROTOCOL", proto, "insecure_tls_protocol", "critical")

    def _check_cert_validation(self, node: ast.Call, func_sym: str):
        # requests.get/post(..., verify=False)
        # urllib3.PoolManager(cert_reqs='CERT_NONE' or ssl.CERT_NONE)
        # ssl.wrap_socket(..., cert_reqs=ssl.CERT_NONE)
        verify_val = self._get_keyword_or_arg_val(node, "verify")
        if verify_val is False:
            self._add_finding(
                node.lineno,
                "PY_DISABLED_CERT_VALIDATION",
                "TLS_NO_VERIFY",
                "disabled_certificate_validation",
                "critical",
            )

        cert_reqs = self._get_keyword_or_arg_val(node, "cert_reqs")
        if cert_reqs is not None:
            cert_reqs_str = str(cert_reqs).upper()
            if "NONE" in cert_reqs_str or cert_reqs == 0:
                self._add_finding(
                    node.lineno,
                    "PY_DISABLED_CERT_VALIDATION",
                    "CERT_NONE",
                    "disabled_certificate_validation",
                    "critical",
                )

    def _check_randomness(self, node: ast.Call, func_sym: str):
        # Insecure random module used in security context (random.randint, random.random, random.choice)
        if func_sym.startswith("random.") or func_sym in ("randint", "random", "choice", "randrange"):
            # Check if variable being assigned or call site has security semantics
            # We flag standard random generation as insecure randomness if named key, token, salt, iv, secret, nonce
            parent = getattr(node, "_parent", None)
            snippet = self._get_evidence(node.lineno).lower()
            if any(
                sec_word in snippet
                for sec_word in ("key", "token", "salt", "iv", "secret", "nonce", "auth", "passwd", "password")
            ):
                self._add_finding(
                    node.lineno,
                    "PY_INSECURE_RANDOMNESS",
                    "pseudo_random_number_generator",
                    "insecure_randomness",
                    "high",
                )

    def _check_jwt(self, node: ast.Call, func_sym: str):
        # jwt.decode(..., verify=False) or options={"verify_signature": False} or algorithms=['none']
        if "jwt.decode" in func_sym:
            verify_kw = self._get_keyword_or_arg_val(node, "verify")
            if verify_kw is False:
                self._add_finding(node.lineno, "PY_JWT_VERIFY_FALSE", "JWT", "insecure_jwt_verification", "critical")

            algos_kw = self._get_keyword_or_arg_val(node, "algorithms")
            if isinstance(algos_kw, list) and any(str(a).lower() == "none" for a in algos_kw):
                self._add_finding(
                    node.lineno, "PY_JWT_NONE_ALGORITHM", "JWT-NONE", "insecure_jwt_algorithm", "critical"
                )

            options_kw = self._get_keyword_or_arg_val(node, "options")
            if isinstance(options_kw, dict) and options_kw.get("verify_signature") is False:
                self._add_finding(
                    node.lineno, "PY_JWT_VERIFY_SIGNATURE_FALSE", "JWT", "insecure_jwt_verification", "critical"
                )

    def _check_cloud_kms(self, node: ast.Call, func_sym: str):
        # AWS KMS create_key(KeySpec='RSA_1024')
        key_spec = self._get_keyword_or_arg_val(node, "KeySpec")
        if key_spec and "1024" in str(key_spec):
            self._add_finding(node.lineno, "PY_CLOUD_KMS_WEAK_KEY", "KMS-RSA-1024", "weak_asymmetric_key", "critical")

        # GCP KMS template algorithm
        algo_kw = self._get_keyword_or_arg_val(node, "algorithm")
        if algo_kw and "1024" in str(algo_kw):
            self._add_finding(node.lineno, "PY_CLOUD_KMS_WEAK_KEY", "KMS-RSA-1024", "weak_asymmetric_key", "critical")

    def _check_unsafe_key_loading(self, node: ast.Call, func_sym: str):
        # serialization.load_pem_private_key(data, password=None)
        if "load_pem_private_key" in func_sym:
            pwd_val = self._get_keyword_or_arg_val(node, "password", arg_index=1)
            if pwd_val is None:
                self._add_finding(
                    node.lineno,
                    "PY_UNSAFE_KEY_LOADING_UNENCRYPTED",
                    "Unencrypted-Private-Key",
                    "unsafe_key_loading",
                    "high",
                )

    def _check_hardcoded_keys(self, node: ast.Assign):
        # 1. Hardcoded PEM private key in string / bytes literal
        try:
            val = self.resolver._extract_literal(node.value)
            if isinstance(val, (str, bytes)):
                str_val = val.decode("utf-8", errors="ignore") if isinstance(val, bytes) else val
                if self.PEM_PRIVATE_KEY_REGEX.search(str_val):
                    from scanners.static.secret_detector import SecretSafeDetector

                    classified_type = SecretSafeDetector.classify_pem(str_val)
                    fingerprint = SecretSafeDetector.generate_fingerprint(str_val)
                    redacted_tok = f"[REDACTED_PRIVATE_KEY:{classified_type}:{fingerprint}]"

                    target_name = "private_key"
                    if node.targets and isinstance(node.targets[0], ast.Name):
                        target_name = node.targets[0].id
                    minimal_evidence = f'{target_name} = "{redacted_tok}"'

                    self.findings.append(
                        StaticFinding(
                            file_path=self.rel_path,
                            line_number=node.lineno,
                            rule_id="PY_HARDCODED_PRIVATE_KEY",
                            algorithm=classified_type,
                            evidence=minimal_evidence,
                            confidence="high",
                            finding_type="hardcoded_private_key",
                            severity="critical",
                            analysis_source="ast",
                            fingerprint=fingerprint,
                            secret_type=classified_type,
                        )
                    )
                    return

            # 2. Hardcoded symmetric key assigned to variables like aes_key = b"1234567812345678"
            for target in node.targets:
                if isinstance(target, ast.Name):
                    target_name = target.id.lower()
                    if any(
                        k in target_name for k in ("aes_key", "secret_key", "des_key", "private_key", "encryption_key")
                    ):
                        if isinstance(val, (str, bytes)) and len(val) in (8, 16, 24, 32):
                            from scanners.static.secret_detector import SecretSafeDetector

                            str_val = val.decode("utf-8", errors="ignore") if isinstance(val, bytes) else str(val)
                            fingerprint = SecretSafeDetector.generate_fingerprint(str_val)
                            redacted_tok = f"[REDACTED_KEY:SYMMETRIC_KEY:{fingerprint}]"
                            minimal_evidence = f'{target.id} = "{redacted_tok}"'

                            self.findings.append(
                                StaticFinding(
                                    file_path=self.rel_path,
                                    line_number=node.lineno,
                                    rule_id="PY_HARDCODED_SYMMETRIC_KEY",
                                    algorithm="Hardcoded-Symmetric-Key",
                                    evidence=minimal_evidence,
                                    confidence="high",
                                    finding_type="hardcoded_symmetric_key",
                                    severity="high",
                                    analysis_source="ast",
                                    fingerprint=fingerprint,
                                    secret_type="SYMMETRIC_KEY",
                                )
                            )
        except Exception:
            pass

    def _check_attribute_assignment(self, node: ast.Assign):
        # context.check_hostname = False
        # context.verify_mode = ssl.CERT_NONE
        for target in node.targets:
            if isinstance(target, ast.Attribute):
                attr_name = target.attr
                val = self.resolver.resolve_val(node.value)
                if attr_name == "check_hostname" and val is False:
                    self._add_finding(
                        node.lineno,
                        "PY_DISABLED_HOSTNAME_VERIFICATION",
                        "check_hostname=False",
                        "disabled_certificate_validation",
                        "critical",
                    )
                elif attr_name == "verify_mode":
                    sym = self.resolver.resolve_symbol(node.value)
                    if "CERT_NONE" in sym or val == 0:
                        self._add_finding(
                            node.lineno,
                            "PY_DISABLED_CERT_VALIDATION",
                            "CERT_NONE",
                            "disabled_certificate_validation",
                            "critical",
                        )

    # -------------------------------------------------------------------------
    # Helper utilities
    # -------------------------------------------------------------------------

    def _get_keyword_or_arg_val(self, call_node: ast.Call, kw_name: str, arg_index: Optional[int] = None) -> Any:
        # Check keywords
        for kw in call_node.keywords:
            if kw.arg == kw_name:
                return self.resolver.resolve_val(kw.value)

        # Check positional args if arg_index provided
        if arg_index is not None and len(call_node.args) > arg_index:
            return self.resolver.resolve_val(call_node.args[arg_index])

        return None
