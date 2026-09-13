"""
ECDAT JavaScript & TypeScript Cryptographic AST & Semantic Detector (Phase 2.4)
Handles:
- Node.js crypto (createHash, createHmac, createCipheriv, generateKeyPairSync, createDiffieHellman)
- Web Crypto API (crypto.subtle.digest, generateKey)
- TLS configuration (rejectUnauthorized: false, minVersion: 'TLSv1', 'TLSv1.1', NODE_TLS_REJECT_UNAUTHORIZED)
- Common crypto libraries (crypto-js, node-forge, jsonwebtoken)
- Destructured imports & aliases
- Intra-procedural constant propagation & dynamic strings
- Safe static analysis (NEVER executes scanned JavaScript code)
"""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set
import tree_sitter

from scanners.static.results import StaticFinding


class JavascriptSemanticContext:
    def __init__(self):
        # Maps local identifier name -> canonical function or module
        # e.g. "makeHash" -> "crypto.createHash", "myCrypto" -> "crypto"
        self.symbol_table: Dict[str, str] = {}
        # Maps variable name -> resolved string/number/boolean constant
        self.constant_table: Dict[str, Any] = {}


class JavascriptCryptoDetector:
    """
    AST-based Semantic Detector for JavaScript and TypeScript Cryptography.
    """

    WEAK_HASHES = {"MD5", "MD2", "MD4", "SHA1", "SHA-1"}
    WEAK_CIPHERS = {"DES", "DES-EDE", "DES-EDE3", "TRIPLEDES", "BLOWFISH", "RC4", "RC2"}
    INSECURE_TLS_VERSIONS = {"TLSV1", "TLSV1.0", "TLSV1.1", "SSLV2", "SSLV3"}

    def __init__(
        self,
        file_path: Path,
        root_dir: Path,
        source_bytes: bytes,
        language: tree_sitter.Language,
        is_typescript: bool = False,
    ):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_bytes = source_bytes
        self.source_lines = source_bytes.decode("utf-8", errors="replace").split("\n")
        self.rel_path = str(file_path.relative_to(root_dir)).replace("\\", "/")
        self.language = language
        self.is_typescript = is_typescript
        self.parser = tree_sitter.Parser(self.language)
        self.context = JavascriptSemanticContext()
        self.findings: List[StaticFinding] = []

    def detect(self) -> List[StaticFinding]:
        try:
            tree = self.parser.parse(self.source_bytes)
            if not tree:
                return []
        except Exception:
            return []

        # Pass 1: Build semantic table (imports, requires, destructuring, constant variables)
        self._build_semantic_table(tree.root_node)

        # Pass 2: Traverse AST for cryptographic calls and configurations
        self._traverse_node(tree.root_node)

        # Pass 3: Process configuration statements (e.g. NODE_TLS_REJECT_UNAUTHORIZED = '0')
        self._check_config_and_env()

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
    # Pass 1: Semantic Table Builder
    # =========================================================================

    def _build_semantic_table(self, root: tree_sitter.Node):
        source_text = self.source_bytes.decode("utf-8", errors="replace")

        # 1. require() assignments:
        # const crypto = require('crypto');
        # const { createHash, createCipheriv } = require('crypto');
        # const { createHash: makeHash } = require('node:crypto');
        req_pattern = re.compile(
            r"(?:const|let|var)\s+([^=]+)\s*=\s*require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",
            re.MULTILINE,
        )
        for m in req_pattern.finditer(source_text):
            lhs = m.group(1).strip()
            pkg = m.group(2).strip()

            if pkg in ("crypto", "node:crypto"):
                if lhs.startswith("{") and lhs.endswith("}"):
                    # Destructured require
                    inner = lhs[1:-1]
                    for item in inner.split(","):
                        item = item.strip()
                        if ":" in item:
                            orig, alias = [p.strip() for p in item.split(":", 1)]
                            self.context.symbol_table[alias] = f"crypto.{orig}"
                        elif item:
                            self.context.symbol_table[item] = f"crypto.{item}"
                else:
                    self.context.symbol_table[lhs] = "crypto"

            elif pkg == "crypto-js":
                self.context.symbol_table[lhs] = "crypto-js"
            elif pkg == "node-forge":
                self.context.symbol_table[lhs] = "node-forge"
            elif pkg == "jsonwebtoken":
                self.context.symbol_table[lhs] = "jsonwebtoken"

        # 2. ES Module import statements:
        # import crypto from 'crypto';
        # import * as crypto from 'crypto';
        # import { createHash, createCipheriv as cipherMaker } from 'crypto';
        import_pattern = re.compile(
            r"import\s+(?:(?:\*\s+as\s+([a-zA-Z0-9_$]+))|([a-zA-Z0-9_$]+)|(?:\{([^}]+)\}))\s+from\s+['\"]([^'\"]+)['\"]",
            re.MULTILINE,
        )
        for m in import_pattern.finditer(source_text):
            star_alias = m.group(1)
            default_alias = m.group(2)
            destructured = m.group(3)
            pkg = m.group(4)

            if pkg in ("crypto", "node:crypto"):
                if star_alias:
                    self.context.symbol_table[star_alias] = "crypto"
                elif default_alias:
                    self.context.symbol_table[default_alias] = "crypto"
                elif destructured:
                    for item in destructured.split(","):
                        item = item.strip()
                        if " as " in item:
                            orig, alias = [p.strip() for p in item.split(" as ", 1)]
                            self.context.symbol_table[alias] = f"crypto.{orig}"
                        elif item:
                            self.context.symbol_table[item] = f"crypto.{item}"
            elif "crypto-js" in pkg:
                alias = star_alias or default_alias or "CryptoJS"
                self.context.symbol_table[alias] = "crypto-js"

        # 3. Simple variable / constant assignments (supporting JS and TS type annotations):
        # const ALGO = 'md5'; const KEY_SIZE: number = 1024; const NO_VERIFY = false;
        var_pattern = re.compile(
            r"(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*[a-zA-Z0-9_<>[\]]+)?\s*=\s*(?:['\"]([^'\"]+)['\"]|([0-9]+)|(true|false))",
            re.MULTILINE,
        )
        for m in var_pattern.finditer(source_text):
            var_name = m.group(1)
            str_val = m.group(2)
            num_val = m.group(3)
            bool_val = m.group(4)

            if str_val is not None:
                self.context.constant_table[var_name] = str_val
            elif num_val is not None:
                self.context.constant_table[var_name] = int(num_val)
            elif bool_val is not None:
                self.context.constant_table[var_name] = bool_val == "true"

    def _resolve_val(self, raw: str) -> Any:
        clean = raw.strip().strip("'\"`")
        val = self.context.constant_table.get(clean, clean)
        if isinstance(val, str):
            if val.isdigit():
                try:
                    return int(val)
                except ValueError:
                    pass
            elif val.lower() == "true":
                return True
            elif val.lower() == "false":
                return False
        return val

    # =========================================================================
    # Pass 2: AST Traversal & Method Calls
    # =========================================================================

    def _traverse_node(self, node: tree_sitter.Node):
        if node.type == "call_expression":
            self._check_call_expression(node)
        elif node.type == "object":
            self._check_config_object(node)

        for child in node.children:
            self._traverse_node(child)

    def _check_call_expression(self, node: tree_sitter.Node):
        call_text = node.text.decode("utf-8", errors="replace") if node.text else ""
        lineno = node.start_point[0] + 1

        # 1. Direct or resolved call to createHash / createHmac
        # crypto.createHash('md5') or makeHash('md5') or CryptoJS.MD5(...)
        m_hash = re.search(
            r"\b([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)?)\s*\(\s*([^)]*)\)",
            call_text,
        )
        if m_hash:
            callee = m_hash.group(1)
            args_str = m_hash.group(2)
            args = [a.strip() for a in args_str.split(",") if a.strip()]

            # Resolve callee
            resolved_callee = self.context.symbol_table.get(callee, callee)

            # Check createHash / createHmac
            if any(resolved_callee.endswith(f) for f in ("createHash", "createHmac", "createSign", "createVerify")):
                if args:
                    algo_val = str(self._resolve_val(args[0])).upper()
                    clean_algo = algo_val.replace("-", "")
                    if clean_algo in ("MD5", "MD4", "MD2", "SHA1") or "MD5" in clean_algo or "SHA1" in clean_algo:
                        self._add_finding(
                            lineno,
                            "JS_WEAK_HASH",
                            algo_val,
                            "weak_hash",
                            "critical" if "MD5" in clean_algo else "high",
                        )

            # Check createCipher / createCipheriv (insecure ciphers and ECB mode)
            if any(resolved_callee.endswith(f) for f in ("createCipher", "createCipheriv")):
                if args:
                    algo_val = str(self._resolve_val(args[0])).upper()
                    # Check weak cipher algorithm
                    if any(w in algo_val for w in ("DES", "RC4", "BLOWFISH", "RC2")):
                        self._add_finding(lineno, "JS_WEAK_CIPHER", algo_val, "weak_cipher", "critical")

                    # Check insecure mode ECB
                    if "ECB" in algo_val or (resolved_callee.endswith("createCipher") and "ECB" in algo_val):
                        self._add_finding(lineno, "JS_INSECURE_CIPHER_MODE_ECB", f"{algo_val} [ECB]", "insecure_cipher_mode", "critical")

            # Check generateKeyPairSync / generateKeyPair for weak key sizes
            if resolved_callee.endswith("generateKeyPairSync") or resolved_callee.endswith("generateKeyPair"):
                if "modulusLength" in call_text:
                    size_match = re.search(r"modulusLength\s*:\s*([a-zA-Z0-9_$]+)", call_text)
                    if size_match:
                        size_val = self._resolve_val(size_match.group(1))
                        if isinstance(size_val, int) and size_val < 2048:
                            self._add_finding(
                                lineno,
                                "JS_WEAK_RSA_KEY_SIZE",
                                f"RSA-{size_val}",
                                "weak_asymmetric_key",
                                "critical" if size_val <= 1024 else "high",
                            )

            # Check createDiffieHellman prime length < 2048
            if resolved_callee.endswith("createDiffieHellman"):
                if args:
                    size_val = self._resolve_val(args[0])
                    if isinstance(size_val, int) and size_val < 2048:
                        self._add_finding(
                            lineno,
                            "JS_WEAK_DH_KEY_SIZE",
                            f"DH-{size_val}",
                            "weak_asymmetric_key",
                            "critical",
                        )

            # 2. Web Crypto API: crypto.subtle.digest / subtle.generateKey
            if "subtle.digest" in call_text:
                if any(w in call_text.upper() for w in ("SHA-1", "SHA1")):
                    self._add_finding(lineno, "JS_WEAK_HASH", "SHA-1", "weak_hash", "high")

            if "subtle.generateKey" in call_text and "modulusLength" in call_text:
                size_match = re.search(r"modulusLength\s*:\s*([a-zA-Z0-9_$]+)", call_text)
                if size_match:
                    size_val = self._resolve_val(size_match.group(1))
                    if isinstance(size_val, int) and size_val < 2048:
                        self._add_finding(lineno, "JS_WEAK_RSA_KEY_SIZE", f"RSA-{size_val}", "weak_asymmetric_key", "critical")

            # 3. CryptoJS calls: CryptoJS.MD5, CryptoJS.SHA1, CryptoJS.DES, CryptoJS.RC4
            if "CryptoJS" in call_text or resolved_callee == "crypto-js":
                if any(w in call_text for w in ("CryptoJS.MD5", "MD5(")):
                    self._add_finding(lineno, "JS_CRYPTOJS_MD5", "MD5", "weak_hash", "critical")
                elif any(w in call_text for w in ("CryptoJS.SHA1", "SHA1(")):
                    self._add_finding(lineno, "JS_CRYPTOJS_SHA1", "SHA1", "weak_hash", "high")
                elif any(w in call_text for w in ("CryptoJS.DES", "DES.encrypt")):
                    self._add_finding(lineno, "JS_WEAK_CIPHER", "DES", "weak_cipher", "critical")
                elif any(w in call_text for w in ("CryptoJS.RC4", "RC4.encrypt")):
                    self._add_finding(lineno, "JS_WEAK_CIPHER", "RC4", "weak_cipher", "critical")

            # 4. JWT signing/verification: jwt.verify(token, secret, { algorithms: ['none'] })
            if "jwt.verify" in call_text or "jwt.decode" in call_text:
                if re.search(r"algorithms\s*:\s*\[[^\]]*['\"]none['\"][^\]]*\]", call_text, re.IGNORECASE):
                    self._add_finding(lineno, "JS_JWT_NONE_ALGORITHM", "JWT-NONE", "insecure_jwt_algorithm", "critical")

                if re.search(r"ignoreExpiration\s*:\s*true", call_text):
                    self._add_finding(lineno, "JS_JWT_IGNORE_EXPIRATION", "JWT", "insecure_jwt_verification", "medium")

    def _check_config_object(self, node: tree_sitter.Node):
        """Checks configuration objects for TLS and crypto security settings."""
        obj_text = node.text.decode("utf-8", errors="replace") if node.text else ""
        lineno = node.start_point[0] + 1

        # Check rejectUnauthorized: false
        if re.search(r"rejectUnauthorized\s*:\s*([a-zA-Z0-9_$]+)", obj_text):
            m = re.search(r"rejectUnauthorized\s*:\s*([a-zA-Z0-9_$]+)", obj_text)
            if m:
                val = self._resolve_val(m.group(1))
                if val is False:
                    self._add_finding(
                        lineno,
                        "JS_DISABLED_CERT_VALIDATION",
                        "rejectUnauthorized: false",
                        "disabled_certificate_validation",
                        "critical",
                    )

        # Check minVersion: 'TLSv1' or 'TLSv1.1'
        if re.search(r"minVersion\s*:\s*['\"]([^'\"]+)['\"]", obj_text):
            m = re.search(r"minVersion\s*:\s*['\"]([^'\"]+)['\"]", obj_text)
            if m:
                ver_val = m.group(1).upper()
                if ver_val in self.INSECURE_TLS_VERSIONS:
                    self._add_finding(
                        lineno,
                        "JS_INSECURE_TLS_VERSION",
                        ver_val,
                        "insecure_tls_protocol",
                        "critical",
                    )

    # =========================================================================
    # Pass 3: Environment & Configuration Statement Check
    # =========================================================================

    def _check_config_and_env(self):
        source_text = self.source_bytes.decode("utf-8", errors="replace")

        # Detect process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
        env_tls_pattern = re.compile(
            r"process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['\"]0['\"]",
            re.MULTILINE,
        )
        for m in env_tls_pattern.finditer(source_text):
            lineno = source_text[: m.start()].count("\n") + 1
            self._add_finding(
                lineno,
                "JS_ENV_TLS_REJECT_DISABLED",
                "NODE_TLS_REJECT_UNAUTHORIZED=0",
                "disabled_certificate_validation",
                "critical",
            )
