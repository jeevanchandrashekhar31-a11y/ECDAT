"""
ECDAT Java & Kotlin Cryptographic AST & Semantic Detector (Phase 2.3)
Detects JCA/JCE and BouncyCastle vulnerabilities:
- Cipher, MessageDigest, Mac, Signature, KeyGenerator, KeyPairGenerator, SecretKeyFactory
- SSLContext, TrustManager, KeyStore, BouncyCastleProvider
- Resolves algorithm strings, mode/padding components, and provider configuration
- Performs intra-procedural constant propagation
"""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple
import tree_sitter

from scanners.static.results import StaticFinding


class JavaKotlinCryptoDetector:
    """
    AST-based Semantic Detector for Java and Kotlin Cryptography.
    """

    WEAK_HASH_ALGOS = {"MD5", "MD2", "MD4", "SHA-1", "SHA1"}
    WEAK_CIPHER_ALGOS = {"DES", "DESEDE", "TRIPLEDES", "BLOWFISH", "RC4", "RC2", "ARCFOUR"}
    WEAK_MAC_ALGOS = {"HMACMD5", "HMACSHA1"}
    INSECURE_SSL_PROTOCOLS = {"SSL", "SSLV2", "SSLV3", "TLSV1", "TLSV1.0", "TLSV1.1"}

    def __init__(self, file_path: Path, root_dir: Path, source_bytes: bytes, language_name: str, language: tree_sitter.Language):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_bytes = source_bytes
        self.source_lines = source_bytes.decode("utf-8", errors="replace").split("\n")
        self.rel_path = str(file_path.relative_to(root_dir)).replace("\\", "/")
        self.language_name = language_name.lower()
        self.language = language
        self.parser = tree_sitter.Parser(self.language)
        self.findings: List[StaticFinding] = []
        self.constant_table: Dict[str, str] = {}
        self.numeric_table: Dict[str, int] = {}

    def detect(self) -> List[StaticFinding]:
        try:
            tree = self.parser.parse(self.source_bytes)
            if not tree:
                return []
        except Exception:
            return []

        # Pass 1: Extract string constants and numeric assignments
        self._extract_constants(tree.root_node)

        # Pass 2: Traverse AST to identify JCA/JCE method calls and constructs
        self._traverse(tree.root_node)

        # Pass 3: Check TrustManager & HostnameVerifier bypasses
        self._check_trust_manager_bypass()

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
    # Pass 1: Constant Propagation Table Builder
    # =========================================================================

    def _extract_constants(self, node: tree_sitter.Node):
        """Extracts String and integer variable initializations."""
        # Java: variable_declarator: name: (identifier), value: (string_literal / decimal_integer_literal)
        # Kotlin: property_declaration: (variable_declaration (simple_identifier)), value: ...
        text = node.text.decode("utf-8", errors="replace") if node.text else ""

        if node.type in ("variable_declarator", "assignment_expression", "property_declaration"):
            # Simple heuristic regex over single declaration line
            str_match = re.search(r'([a-zA-Z_0-9]+)\s*=\s*"([^"]+)"', text)
            if str_match:
                self.constant_table[str_match.group(1)] = str_match.group(2)

            num_match = re.search(r"([a-zA-Z_0-9]+)\s*=\s*([0-9]{3,5})", text)
            if num_match:
                try:
                    self.numeric_table[num_match.group(1)] = int(num_match.group(2))
                except ValueError:
                    pass

        for child in node.children:
            self._extract_constants(child)

    def _resolve_string_val(self, raw_arg: str) -> str:
        cleaned = raw_arg.strip().strip("'\"")
        return self.constant_table.get(cleaned, cleaned)

    def _resolve_int_val(self, raw_arg: str) -> Optional[int]:
        cleaned = raw_arg.strip()
        if cleaned.isdigit():
            return int(cleaned)
        return self.numeric_table.get(cleaned)

    # =========================================================================
    # Pass 2: AST Traversal
    # =========================================================================

    def _traverse(self, node: tree_sitter.Node):
        # Check method invocation in Java or call_expression in Kotlin
        if node.type in ("method_invocation", "call_expression"):
            self._check_method_call(node)

        for child in node.children:
            self._traverse(child)

    def _check_method_call(self, node: tree_sitter.Node):
        call_text = node.text.decode("utf-8", errors="replace") if node.text else ""
        lineno = node.start_point[0] + 1

        # Match JCA/JCE Factory calls: ClassName.getInstance(...)
        # e.g., Cipher.getInstance("..."), MessageDigest.getInstance("..."), etc.
        m = re.search(
            r"\b(Cipher|MessageDigest|Mac|Signature|KeyGenerator|KeyPairGenerator|SecretKeyFactory|SSLContext|KeyStore)\s*\.\s*getInstance\s*\(([^)]+)\)",
            call_text,
        )
        if m:
            class_name = m.group(1)
            raw_args_str = m.group(2)
            args = [a.strip() for a in raw_args_str.split(",")]
            algo_arg = self._resolve_string_val(args[0])
            provider_arg = self._resolve_string_val(args[1]) if len(args) > 1 else None

            self._evaluate_jca_instance(class_name, algo_arg, provider_arg, lineno)

        # Match KeyPairGenerator.initialize(keySize) or KeyGenerator.init(keySize)
        init_match = re.search(r"\b(initialize|init)\s*\(\s*([a-zA-Z0-9_]+)\s*\)", call_text)
        if init_match:
            size_val = self._resolve_int_val(init_match.group(2))
            if size_val and size_val < 2048:
                self._add_finding(
                    lineno,
                    "JAVA_WEAK_KEY_SIZE",
                    f"RSA/DSA-{size_val}",
                    "weak_asymmetric_key",
                    "critical" if size_val <= 1024 else "high",
                )

        # Match BouncyCastle direct provider addition: Security.addProvider(new BouncyCastleProvider())
        if "BouncyCastleProvider" in call_text or "addProvider" in call_text:
            if "BouncyCastleProvider" in call_text:
                self._add_finding(
                    lineno,
                    "JAVA_BOUNCY_CASTLE_PROVIDER",
                    "BouncyCastleProvider",
                    "crypto_library",
                    "low",
                )

    def _evaluate_jca_instance(self, class_name: str, algo: str, provider: Optional[str], lineno: int):
        clean_algo = algo.strip().strip("'\"")
        algo_upper = clean_algo.upper()

        # 1. Cipher
        if class_name == "Cipher":
            parts = algo_upper.split("/")
            base_algo = parts[0]
            mode = parts[1] if len(parts) > 1 else None

            # Check weak cipher algorithm
            if any(weak in base_algo for weak in self.WEAK_CIPHER_ALGOS):
                self._add_finding(lineno, "JAVA_WEAK_CIPHER", clean_algo, "weak_cipher", "critical")

            # Check insecure mode (ECB)
            if mode == "ECB" or (mode is None and any(base_algo == weak for weak in ("DES", "AES", "BLOWFISH"))):
                self._add_finding(lineno, "JAVA_INSECURE_CIPHER_MODE_ECB", f"{clean_algo} [ECB]", "insecure_cipher_mode", "critical")

        # 2. MessageDigest
        elif class_name == "MessageDigest":
            if any(algo_upper == weak or algo_upper.startswith(weak) for weak in self.WEAK_HASH_ALGOS):
                severity = "critical" if "MD5" in algo_upper or "MD2" in algo_upper or "MD4" in algo_upper else "high"
                self._add_finding(lineno, "JAVA_WEAK_HASH", clean_algo, "weak_hash", severity)

        # 3. Mac
        elif class_name == "Mac":
            if any(weak in algo_upper for weak in ("MD5", "SHA1")):
                self._add_finding(lineno, "JAVA_WEAK_MAC", clean_algo, "weak_hash", "critical" if "MD5" in algo_upper else "high")

        # 4. Signature
        elif class_name == "Signature":
            if any(algo_upper.startswith(weak) for weak in ("MD5WITH", "SHA1WITH", "MD2WITH")):
                self._add_finding(lineno, "JAVA_WEAK_SIGNATURE", clean_algo, "weak_signature_algorithm", "critical" if "MD" in algo_upper else "high")

        # 5. KeyGenerator
        elif class_name == "KeyGenerator":
            if any(weak in algo_upper for weak in self.WEAK_CIPHER_ALGOS):
                self._add_finding(lineno, "JAVA_WEAK_KEYGEN_ALGO", clean_algo, "weak_cipher", "critical")

        # 6. SecretKeyFactory
        elif class_name == "SecretKeyFactory":
            if any(weak in algo_upper for weak in ("DES", "PBKDF1", "MD5")):
                self._add_finding(lineno, "JAVA_WEAK_SECRET_KEY_FACTORY", clean_algo, "weak_kdf", "critical")

        # 7. SSLContext
        elif class_name == "SSLContext":
            if any(algo_upper == proto for proto in self.INSECURE_SSL_PROTOCOLS):
                self._add_finding(lineno, "JAVA_INSECURE_TLS_PROTOCOL", clean_algo, "insecure_tls_protocol", "critical")

        # 8. KeyStore
        elif class_name == "KeyStore":
            if algo_upper == "JKS":
                self._add_finding(lineno, "JAVA_INSECURE_KEYSTORE_JKS", "JKS", "weak_keystore_format", "medium")

    # =========================================================================
    # Pass 3: TrustManager & HostnameVerifier Bypass Detection
    # =========================================================================

    def _check_trust_manager_bypass(self):
        source_text = self.source_bytes.decode("utf-8", errors="replace")

        # Detect TrustManager with empty checkServerTrusted or checkClientTrusted
        trust_all_pattern = re.compile(
            r"(?:void\s+)?check(?:Server|Client)Trusted\s*\([^)]*\)\s*\{(?:\s*//[^\n]*|\s*/\*.*?\*/|\s*)\}",
            re.DOTALL,
        )
        for m in trust_all_pattern.finditer(source_text):
            lineno = source_text[: m.start()].count("\n") + 1
            self._add_finding(
                lineno,
                "JAVA_TRUST_ALL_CERTS",
                "TrustAllCerts",
                "disabled_certificate_validation",
                "critical",
            )
            break

        # Detect HostnameVerifier returning true unconditionally
        hostname_pattern = re.compile(
            r"HostnameVerifier[^{]*\{[^}]*verify\s*\([^)]*\)\s*\{\s*return\s+true\s*;\s*\}",
            re.DOTALL,
        )
        for m in hostname_pattern.finditer(source_text):
            lineno = source_text[: m.start()].count("\n") + 1
            self._add_finding(
                lineno,
                "JAVA_HOSTNAME_VERIFIER_TRUE",
                "TrustAllHostnames",
                "disabled_certificate_validation",
                "critical",
            )
