"""
ECDAT Go Crypto Semantic Detector (Phase 2.5)
Performs static AST analysis on Go source files using tree-sitter-go.
Detects cryptographic algorithms, key sizes, elliptic curves, TLS settings,
and correlates source findings with Go module (go.mod) dependencies.
"""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple
import tree_sitter
from scanners.static.results import StaticFinding


class GoCryptoDetector:
    """
    Semantic AST detector for Go cryptographic primitives, configurations, and dependencies.
    Covers:
    - crypto/aes (AES-128, AES-192, AES-256)
    - crypto/cipher (CBC, GCM, stream modes)
    - crypto/rsa (key size tracking, PKCS#1 v1.5 vs PSS/OAEP)
    - crypto/ecdsa (elliptic curve tracking: P-224, P-256, P-384, P-521)
    - crypto/ed25519 (Ed25519 signatures)
    - crypto/sha* & crypto/md5 (MD5, SHA-1, SHA-256, SHA-512)
    - crypto/hmac (HMAC hash algorithm validation)
    - crypto/tls (InsecureSkipVerify, MinVersion, CipherSuites)
    - crypto/x509 (Certificate creation and signature algorithms)
    - golang.org/x/crypto (Blowfish, CAST5, TEA, ChaCha20-Poly1305, Curve25519)
    - Source and dependency correlation with go.mod
    """

    def __init__(self, file_path: Path, root_dir: Path, source_code: bytes, language: tree_sitter.Language):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_code = source_code
        self.language = language
        self.parser = tree_sitter.Parser(self.language)
        self.source_str = source_code.decode("utf-8", errors="replace")
        self.lines = self.source_str.split("\n")

        # Symbol & context state
        self.imports: Dict[str, str] = {}  # local_alias -> full_import_path
        self.constants: Dict[str, Any] = {}  # const_name -> resolved_val
        self.go_mod_deps: Dict[str, str] = self._find_and_parse_go_mod()
        self.findings: List[StaticFinding] = []

    # =========================================================================
    # Dependency Correlation via go.mod
    # =========================================================================

    def _find_and_parse_go_mod(self) -> Dict[str, str]:
        """Finds the nearest go.mod and extracts module dependencies."""
        deps: Dict[str, str] = {}
        curr = self.file_path.parent if self.file_path.is_file() else self.file_path
        root_resolved = self.root_dir.resolve()

        # Check upward directory hierarchy
        candidates = []
        while True:
            candidates.append(curr / "go.mod")
            if curr.resolve() == root_resolved or curr.parent == curr:
                break
            curr = curr.parent

        if (self.root_dir / "go.mod") not in candidates:
            candidates.append(self.root_dir / "go.mod")

        for cand in candidates:
            if cand.is_file():
                try:
                    content = cand.read_text(encoding="utf-8", errors="replace")
                    in_require = False
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith("//"):
                            continue
                        if line.startswith("require ("):
                            in_require = True
                            continue
                        elif in_require and line == ")":
                            in_require = False
                            continue
                        elif in_require:
                            parts = line.split()
                            if len(parts) >= 2:
                                deps[parts[0]] = parts[1]
                        elif line.startswith("require "):
                            parts = line[len("require ") :].strip().split()
                            if len(parts) >= 2:
                                deps[parts[0]] = parts[1]
                    if deps:
                        break
                except Exception:
                    pass

        return deps

    def _get_correlation_info(self, import_path: str) -> str:
        """Correlates an import path with go.mod or Go standard library."""
        for mod, ver in self.go_mod_deps.items():
            if import_path == mod or import_path.startswith(mod + "/"):
                return f"[Dependency: {mod}@{ver}]"

        if import_path.startswith("crypto/") or import_path == "crypto":
            return "[Standard Library: Go crypto]"
        if import_path.startswith("golang.org/x/crypto"):
            return "[External Library: golang.org/x/crypto]"
        return ""

    # =========================================================================
    # Main Detection Entrypoint
    # =========================================================================

    def detect(self) -> List[StaticFinding]:
        try:
            tree = self.parser.parse(self.source_code)
            if not tree:
                return []
        except Exception:
            return []

        # Pass 1: Collect imports and constant/variable definitions
        self._collect_imports(tree.root_node)
        self._collect_constants_and_vars(tree.root_node)

        # Pass 2: Traverse AST for cryptographic operations and configs
        self._traverse(tree.root_node)

        return self.findings

    # =========================================================================
    # Pass 1: Import and Constant Collection
    # =========================================================================

    def _collect_imports(self, root: tree_sitter.Node):
        """Extracts imports and user aliases from import declarations."""
        for child in root.children:
            if child.type == "import_declaration":
                self._parse_import_declaration(child)

    def _parse_import_declaration(self, decl_node: tree_sitter.Node):
        for child in decl_node.children:
            if child.type == "import_spec":
                self._parse_import_spec(child)
            elif child.type == "import_spec_list":
                for spec in child.children:
                    if spec.type == "import_spec":
                        self._parse_import_spec(spec)

    def _parse_import_spec(self, spec_node: tree_sitter.Node):
        raw_alias = None
        raw_path = None

        for child in spec_node.children:
            if child.type in ("package_identifier", "identifier", "blank_identifier", "dot"):
                raw_alias = child.text.decode("utf-8")
            elif child.type in ("interpreted_string_literal", "raw_string_literal"):
                raw_path = child.text.decode("utf-8").strip('"').strip("`")

        if raw_path:
            # If no explicit alias, default alias is the last segment of the path
            default_alias = raw_path.split("/")[-1]
            alias = raw_alias or default_alias
            self.imports[alias] = raw_path

    def _collect_constants_and_vars(self, root: tree_sitter.Node):
        """Walks AST to record declared constants and package-level variables."""

        def walk_consts(n: tree_sitter.Node):
            if n.type == "const_spec" or n.type == "var_spec":
                name = None
                val_node = None
                for c in n.children:
                    if c.type == "identifier" and name is None:
                        name = c.text.decode("utf-8")
                    elif c.type in ("expression_list", "int_literal", "interpreted_string_literal", "true", "false"):
                        val_node = c

                if name and val_node:
                    val_text = val_node.text.decode("utf-8").strip('"')
                    self.constants[name] = self._resolve_val(val_text)

            elif n.type == "short_var_declaration":
                # a := 1024
                left = n.child_by_field_name("left")
                right = n.child_by_field_name("right")
                if left and right:
                    var_name = left.text.decode("utf-8").strip()
                    val_text = right.text.decode("utf-8").strip().strip('"')
                    self.constants[var_name] = self._resolve_val(val_text)

            for child in n.children:
                walk_consts(child)

        walk_consts(root)

    def _resolve_val(self, val_str: str) -> Any:
        clean = val_str.strip().strip('"').strip("`")
        if clean in self.constants:
            return self.constants[clean]
        if clean.isdigit():
            return int(clean)
        if clean.lower() == "true":
            return True
        if clean.lower() == "false":
            return False
        return clean

    # =========================================================================
    # Pass 2: AST Traversal
    # =========================================================================

    def _traverse(self, node: tree_sitter.Node):
        if node.type == "call_expression":
            self._check_call(node)
        elif node.type == "composite_literal":
            self._check_composite_literal(node)

        for child in node.children:
            self._traverse(child)

    # =========================================================================
    # Call Expression Checker
    # =========================================================================

    def _check_call(self, node: tree_sitter.Node):
        func_node = node.child_by_field_name("function")
        args_node = node.child_by_field_name("arguments")
        if not func_node:
            return

        lineno = node.start_point[0] + 1
        call_text = node.text.decode("utf-8", errors="replace")
        func_text = func_node.text.decode("utf-8", errors="replace")

        # Extract argument strings
        args: List[str] = []
        if args_node:
            for arg_child in args_node.children:
                if arg_child.type not in ("(", ")", ","):
                    args.append(arg_child.text.decode("utf-8", errors="replace").strip())

        # Resolve package and function name
        pkg_alias, func_name = self._resolve_func_target(func_text)
        import_path = self.imports.get(pkg_alias, pkg_alias)
        correlation = self._get_correlation_info(import_path)

        # 1. Hashes: MD5, SHA-1, SHA-256, SHA-512
        if import_path == "crypto/md5" or (pkg_alias == "md5" and func_name in ("New", "Sum")):
            self._add_finding(
                lineno,
                "GO_WEAK_HASH_MD5",
                "MD5",
                "weak_hash",
                "critical",
                f"Weak MD5 hash algorithm detected via {func_text}. {correlation}".strip(),
            )
            return

        if import_path == "crypto/sha1" or (pkg_alias == "sha1" and func_name in ("New", "Sum")):
            self._add_finding(
                lineno,
                "GO_WEAK_HASH_SHA1",
                "SHA-1",
                "weak_hash",
                "high",
                f"Weak SHA-1 hash algorithm detected via {func_text}. {correlation}".strip(),
            )
            return

        if import_path == "crypto/sha256" or (pkg_alias == "sha256" and func_name in ("New", "Sum256")):
            self._add_finding(
                lineno,
                "GO_HASH_SHA256",
                "SHA-256",
                "cryptographic_hash",
                "low",
                f"SHA-256 hash usage detected via {func_text}. {correlation}".strip(),
            )
            return

        if import_path == "crypto/sha512" or (pkg_alias == "sha512" and func_name in ("New", "Sum512", "New384")):
            algo = "SHA-384" if "384" in func_name else "SHA-512"
            self._add_finding(
                lineno,
                "GO_HASH_SHA512",
                algo,
                "cryptographic_hash",
                "low",
                f"{algo} hash usage detected via {func_text}. {correlation}".strip(),
            )
            return

        # 2. HMAC: crypto/hmac
        if import_path == "crypto/hmac" or (pkg_alias == "hmac" and func_name == "New"):
            hash_arg = args[0] if args else ""
            if "md5" in hash_arg.lower():
                self._add_finding(
                    lineno,
                    "GO_WEAK_HMAC_MD5",
                    "HMAC-MD5",
                    "weak_hash",
                    "critical",
                    f"Insecure HMAC with MD5 hash function. {correlation}".strip(),
                )
            elif "sha1" in hash_arg.lower():
                self._add_finding(
                    lineno,
                    "GO_WEAK_HMAC_SHA1",
                    "HMAC-SHA1",
                    "weak_hash",
                    "high",
                    f"HMAC with deprecated SHA-1 hash function. {correlation}".strip(),
                )
            else:
                self._add_finding(
                    lineno,
                    "GO_HMAC_SECURE",
                    "HMAC",
                    "message_authentication_code",
                    "low",
                    f"HMAC usage with secure hash function. {correlation}".strip(),
                )
            return

        # 3. RSA: crypto/rsa
        if import_path == "crypto/rsa" or pkg_alias == "rsa":
            if func_name == "GenerateKey":
                # args[1] is bits
                bits_val = None
                if len(args) >= 2:
                    raw_bits = self._resolve_val(args[1])
                    if isinstance(raw_bits, int):
                        bits_val = raw_bits

                if bits_val is not None:
                    if bits_val < 2048:
                        self._add_finding(
                            lineno,
                            "GO_WEAK_RSA_KEY_SIZE",
                            f"RSA-{bits_val}",
                            "weak_asymmetric_key",
                            "critical" if bits_val <= 1024 else "high",
                            f"Weak RSA key size ({bits_val} bits) < 2048 bits. {correlation}".strip(),
                        )
                    else:
                        self._add_finding(
                            lineno,
                            "GO_RSA_KEY",
                            f"RSA-{bits_val}",
                            "asymmetric_key",
                            "medium",
                            f"RSA key ({bits_val} bits) is classically secure but Shor quantum vulnerable. {correlation}".strip(),
                        )
                else:
                    self._add_finding(
                        lineno,
                        "GO_RSA_KEY",
                        "RSA",
                        "asymmetric_key",
                        "medium",
                        f"RSA key generation detected. {correlation}".strip(),
                    )
                return

            if func_name in ("SignPKCS1v15", "VerifyPKCS1v15", "EncryptPKCS1v15", "DecryptPKCS1v15"):
                self._add_finding(
                    lineno,
                    "GO_LEGACY_RSA_PKCS1_PADDING",
                    "RSA-PKCS1v15",
                    "legacy_padding",
                    "medium",
                    f"Legacy PKCS#1 v1.5 padding used in {func_name}; vulnerable to Bleichenbacher attacks. {correlation}".strip(),
                )
                return

            if func_name in ("SignPSS", "VerifyPSS", "EncryptOAEP", "DecryptOAEP"):
                padding = "PSS" if "PSS" in func_name else "OAEP"
                self._add_finding(
                    lineno,
                    "GO_SECURE_RSA_PADDING",
                    f"RSA-{padding}",
                    "asymmetric_key",
                    "low",
                    f"Secure RSA padding {padding} used. {correlation}".strip(),
                )
                return

        # 4. ECDSA: crypto/ecdsa
        if import_path == "crypto/ecdsa" or pkg_alias == "ecdsa":
            if func_name == "GenerateKey":
                curve_arg = args[0] if args else ""
                resolved_curve = str(self._resolve_val(curve_arg))

                if "P224" in resolved_curve or "P-224" in resolved_curve:
                    self._add_finding(
                        lineno,
                        "GO_WEAK_ECC_CURVE",
                        "ECDSA-P224",
                        "weak_asymmetric_key",
                        "high",
                        f"Weak elliptic curve P-224 offers insufficient cryptographic security. {correlation}".strip(),
                    )
                else:
                    curve_name = "P-256"
                    if "P384" in resolved_curve:
                        curve_name = "P-384"
                    elif "P521" in resolved_curve:
                        curve_name = "P-521"
                    self._add_finding(
                        lineno,
                        "GO_ECC_KEY",
                        f"ECDSA-{curve_name}",
                        "asymmetric_key",
                        "medium",
                        f"ECDSA with curve {curve_name} (Shor quantum vulnerable). {correlation}".strip(),
                    )
                return

        # 5. Ed25519: crypto/ed25519
        if import_path == "crypto/ed25519" or pkg_alias == "ed25519":
            if func_name in ("GenerateKey", "Sign", "Verify"):
                self._add_finding(
                    lineno,
                    "GO_ED25519_KEY",
                    "Ed25519",
                    "asymmetric_key",
                    "medium",
                    f"Ed25519 signature usage detected in {func_name}. {correlation}".strip(),
                )
                return

        # 6. Symmetric Ciphers: crypto/aes & crypto/cipher
        if import_path == "crypto/aes" or (pkg_alias == "aes" and func_name == "NewCipher"):
            key_arg = args[0] if args else ""
            key_size = 256
            if "16" in key_arg:
                key_size = 128
            elif "24" in key_arg:
                key_size = 192

            self._add_finding(
                lineno,
                "GO_AES_CIPHER",
                f"AES-{key_size}",
                "symmetric_cipher",
                "low",
                f"AES-{key_size} cipher initialized. {correlation}".strip(),
            )
            return

        if import_path == "crypto/cipher" or pkg_alias == "cipher":
            if func_name in ("NewCBCEncrypter", "NewCBCDecrypter"):
                self._add_finding(
                    lineno,
                    "GO_INSECURE_CIPHER_MODE_CBC",
                    "CBC",
                    "insecure_cipher_mode",
                    "medium",
                    f"CBC cipher mode used without native authentication; vulnerable to padding oracles. {correlation}".strip(),
                )
                return
            if func_name == "NewGCM":
                self._add_finding(
                    lineno,
                    "GO_AEAD_CIPHER_GCM",
                    "AES-GCM",
                    "symmetric_cipher",
                    "low",
                    f"Authenticated GCM cipher mode used. {correlation}".strip(),
                )
                return

        # 7. Legacy stdlib ciphers: crypto/des, crypto/rc4
        if import_path == "crypto/des" or (pkg_alias == "des" and "Cipher" in func_name):
            self._add_finding(
                lineno,
                "GO_WEAK_CIPHER_DES",
                "DES",
                "weak_cipher",
                "critical",
                f"Obsolete and vulnerable DES cipher used. {correlation}".strip(),
            )
            return

        if import_path == "crypto/rc4" or (pkg_alias == "rc4" and "Cipher" in func_name):
            self._add_finding(
                lineno,
                "GO_WEAK_CIPHER_RC4",
                "RC4",
                "weak_cipher",
                "critical",
                f"Insecure RC4 stream cipher used. {correlation}".strip(),
            )
            return

        # 8. External Library: golang.org/x/crypto
        if "golang.org/x/crypto/blowfish" in import_path or (pkg_alias in ("blowfish", "bf") and "Cipher" in func_name):
            self._add_finding(
                lineno,
                "GO_WEAK_CIPHER_BLOWFISH",
                "Blowfish",
                "weak_cipher",
                "critical",
                f"Blowfish cipher vulnerable to Sweet32 attacks and small 64-bit block size. {correlation}".strip(),
            )
            return

        if any(w in import_path for w in ("cast5", "tea", "xtea")) or (
            pkg_alias in ("cast5", "tea", "xtea") and "Cipher" in func_name
        ):
            legacy_name = "CAST5" if "cast5" in import_path else "TEA"
            self._add_finding(
                lineno,
                "GO_WEAK_CIPHER_LEGACY",
                legacy_name,
                "weak_cipher",
                "high",
                f"Legacy cipher {legacy_name} has insufficient security margin. {correlation}".strip(),
            )
            return

        if "chacha20poly1305" in import_path or (pkg_alias == "chacha20poly1305" and func_name in ("New", "NewX")):
            self._add_finding(
                lineno,
                "GO_AEAD_CHACHA20POLY1305",
                "ChaCha20-Poly1305",
                "symmetric_cipher",
                "low",
                f"Modern ChaCha20-Poly1305 AEAD cipher used. {correlation}".strip(),
            )
            return

        if "curve25519" in import_path or (pkg_alias == "curve25519" and func_name == "X25519"):
            self._add_finding(
                lineno,
                "GO_CURVE25519_KEX",
                "X25519",
                "asymmetric_key",
                "medium",
                f"X25519 key exchange detected (Shor quantum vulnerable). {correlation}".strip(),
            )
            return

        # 9. X.509 Certificate Creation
        if import_path == "crypto/x509" or pkg_alias == "x509":
            if func_name == "CreateCertificate":
                call_body = call_text
                if any(w in call_body for w in ("MD5WithRSA", "x509.MD5")):
                    self._add_finding(
                        lineno,
                        "GO_WEAK_CERT_SIGNATURE_ALGO",
                        "MD5WithRSA",
                        "weak_signature_algorithm",
                        "critical",
                        f"Certificate created with broken MD5WithRSA signature algorithm. {correlation}".strip(),
                    )
                elif any(w in call_body for w in ("SHA1WithRSA", "x509.SHA1")):
                    self._add_finding(
                        lineno,
                        "GO_WEAK_CERT_SIGNATURE_ALGO",
                        "SHA1WithRSA",
                        "weak_signature_algorithm",
                        "high",
                        f"Certificate created with deprecated SHA1WithRSA signature algorithm. {correlation}".strip(),
                    )

    # =========================================================================
    # Composite Literal Checker (&tls.Config{ ... })
    # =========================================================================

    def _check_composite_literal(self, node: tree_sitter.Node):
        lit_text = node.text.decode("utf-8", errors="replace")
        lineno = node.start_point[0] + 1

        # Check if this is a tls.Config literal
        if "tls.Config" in lit_text or "Config" in lit_text:
            correlation = self._get_correlation_info("crypto/tls")
            # Walk keyed elements
            for child in node.children:
                if child.type == "literal_value":
                    for elem in child.children:
                        if elem.type == "keyed_element":
                            key_node = elem.children[0]
                            val_node = elem.children[2] if len(elem.children) > 2 else None

                            if not key_node or not val_node:
                                continue

                            key_name = key_node.text.decode("utf-8").strip()
                            val_text = val_node.text.decode("utf-8").strip()
                            resolved = self._resolve_val(val_text)

                            # 1. InsecureSkipVerify: true
                            if key_name == "InsecureSkipVerify":
                                if resolved is True:
                                    self._add_finding(
                                        lineno,
                                        "GO_DISABLED_CERT_VALIDATION",
                                        "TLS",
                                        "disabled_certificate_validation",
                                        "critical",
                                        f"TLS certificate verification disabled (InsecureSkipVerify: true). {correlation}".strip(),
                                    )

                            # 2. MinVersion: tls.VersionTLS10 / VersionTLS11 / 0x0301 / 0x0302
                            elif key_name == "MinVersion":
                                if any(v in val_text for v in ("VersionTLS10", "VersionTLS11", "0x0301", "0x0302")):
                                    tls_ver = "TLSv1.0" if "10" in val_text or "0301" in val_text else "TLSv1.1"
                                    self._add_finding(
                                        lineno,
                                        "GO_INSECURE_TLS_VERSION",
                                        tls_ver,
                                        "insecure_tls_protocol",
                                        "critical",
                                        f"Insecure minimum TLS version configured ({tls_ver}). {correlation}".strip(),
                                    )
                                elif any(v in val_text for v in ("VersionTLS12", "VersionTLS13")):
                                    tls_ver = "TLSv1.3" if "13" in val_text else "TLSv1.2"
                                    self._add_finding(
                                        lineno,
                                        "GO_SECURE_TLS_VERSION",
                                        tls_ver,
                                        "tls_protocol",
                                        "low",
                                        f"Secure minimum TLS version configured ({tls_ver}). {correlation}".strip(),
                                    )

                            # 3. Insecure CipherSuites
                            elif key_name == "CipherSuites":
                                if any(w in val_text for w in ("RC4", "3DES", "CBC_SHA")):
                                    self._add_finding(
                                        lineno,
                                        "GO_INSECURE_CIPHER_SUITE",
                                        "Insecure-CipherSuite",
                                        "insecure_cipher_suite",
                                        "high",
                                        f"Insecure legacy TLS cipher suite configured: {val_text}. {correlation}".strip(),
                                    )

        # Check if this is an x509.Certificate template
        if "x509.Certificate" in lit_text:
            correlation = self._get_correlation_info("crypto/x509")
            if "MD5WithRSA" in lit_text:
                self._add_finding(
                    lineno,
                    "GO_WEAK_CERT_SIGNATURE_ALGO",
                    "MD5WithRSA",
                    "weak_signature_algorithm",
                    "critical",
                    f"x509 Certificate template configured with MD5WithRSA signature algorithm. {correlation}".strip(),
                )
            elif "SHA1WithRSA" in lit_text:
                self._add_finding(
                    lineno,
                    "GO_WEAK_CERT_SIGNATURE_ALGO",
                    "SHA1WithRSA",
                    "weak_signature_algorithm",
                    "high",
                    f"x509 Certificate template configured with SHA1WithRSA signature algorithm. {correlation}".strip(),
                )

    # =========================================================================
    # Helpers
    # =========================================================================

    def _resolve_func_target(self, func_text: str) -> Tuple[str, str]:
        """Splits 'pkg.Func' or handles single 'Func' calls."""
        if "." in func_text:
            parts = func_text.split(".", 1)
            return parts[0], parts[1]
        return "", func_text

    def _add_finding(
        self,
        line_number: int,
        rule_id: str,
        algorithm: str,
        finding_type: str,
        severity: str,
        reason: str,
    ):
        evidence_line = ""
        if 1 <= line_number <= len(self.lines):
            evidence_line = self.lines[line_number - 1].strip()

        rel_path = (
            str(self.file_path.relative_to(self.root_dir)).replace("\\", "/")
            if self.root_dir in self.file_path.parents or self.file_path == self.root_dir
            else str(self.file_path).replace("\\", "/")
        )

        finding = StaticFinding(
            file_path=rel_path,
            line_number=line_number,
            rule_id=rule_id,
            algorithm=algorithm,
            evidence=evidence_line,
            confidence="high",
            finding_type=finding_type,
            severity=severity,
            analysis_source="ast_semantic",
            needs_human_review=(severity in ("critical", "high")),
            reason=reason,
        )
        self.findings.append(finding)
