"""
ECDAT Safe C & C++ Cryptographic Discovery Engine (Phase 2.6)
Performs static AST analysis using tree-sitter-c and tree-sitter-cpp.

Covers common cryptographic APIs from:
- OpenSSL / BoringSSL / LibreSSL
- mbedTLS
- wolfSSL
- libsodium
- Botan (C++)

Recognizes:
- EVP APIs (ciphers, digests, key management)
- RSA / ECDSA / EdDSA (key sizes, elliptic curves, padding)
- Digest APIs (legacy & modern)
- TLS configuration (certificate verification, protocol versions, cipher suites)
- Certificate APIs (X.509 signature algorithms, verification)

Safety Guardrails:
- Never compiles or executes scanned source code.
- File size limit (5MB max) and parser timeout protection (concurrent ThreadPool timeout).
"""

import concurrent.futures
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple
import tree_sitter

from scanners.domain.errors import ParserFailureError, UnsupportedFormatError
from scanners.static.results import StaticFinding

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
PARSER_TIMEOUT_SECONDS = 5.0


class CCppCryptoDetector:
    """
    AST semantic detector for C/C++ cryptographic APIs across OpenSSL, BoringSSL,
    LibreSSL, mbedTLS, wolfSSL, libsodium, and Botan.
    """

    def __init__(
        self,
        file_path: Path,
        root_dir: Path,
        source_code: bytes,
        language: tree_sitter.Language,
        is_cpp: bool = False,
    ):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_code = source_code
        self.language = language
        self.is_cpp = is_cpp
        self.source_str = source_code.decode("utf-8", errors="replace")
        self.lines = self.source_str.split("\n")

        self.constants: Dict[str, Any] = {}
        self.findings: List[StaticFinding] = []

    def detect(self) -> List[StaticFinding]:
        # Guardrail 1: Enforce file size limit
        if len(self.source_code) > MAX_FILE_SIZE_BYTES:
            raise UnsupportedFormatError(
                f"Source file {self.file_path.name} ({len(self.source_code)} bytes) exceeds max limit of {MAX_FILE_SIZE_BYTES} bytes"
            )

        # Guardrail 2: Enforce parser timeout protection
        parser = tree_sitter.Parser(self.language)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(parser.parse, self.source_code)
                tree = future.result(timeout=PARSER_TIMEOUT_SECONDS)
                if not tree:
                    return []
        except concurrent.futures.TimeoutError as e:
            raise ParserFailureError(
                f"Parser timed out after {PARSER_TIMEOUT_SECONDS}s on {self.file_path.name}", fatal=False
            ) from e
        except Exception as e:
            if isinstance(e, (UnsupportedFormatError, ParserFailureError)):
                raise
            return []

        # Pass 1: Extract macro definitions (#define) and const variables
        self._collect_constants(tree.root_node)

        # Pass 2: Traverse AST for call expressions and macro invocations
        self._traverse(tree.root_node)

        return self.findings

    # =========================================================================
    # Constant and Macro Extraction
    # =========================================================================

    def _collect_constants(self, root_node: tree_sitter.Node):
        """Extracts #define macros and const integer/string declarations."""
        # Regex pass for macros: #define RSA_KEY_SIZE 1024
        macro_re = re.compile(r"^\s*#define\s+([a-zA-Z0-9_$]+)\s+([a-zA-Z0-9_$\"']+)", re.MULTILINE)
        for m in macro_re.finditer(self.source_str):
            name, raw_val = m.group(1), m.group(2).strip().strip('"').strip("'")
            if raw_val.isdigit():
                self.constants[name] = int(raw_val)
            else:
                self.constants[name] = raw_val

        # AST pass for const declarations: const int key_size = 1024;
        def walk_declarations(node: tree_sitter.Node):
            if node.type in ("declaration", "init_declarator"):
                text = node.text.decode("utf-8", errors="replace") if node.text else ""
                if "const " in text or "constexpr " in text:
                    m = re.search(r"\b([a-zA-Z0-9_$]+)\s*=\s*([0-9]+)\b", text)
                    if m:
                        self.constants[m.group(1)] = int(m.group(2))
            for child in node.children:
                walk_declarations(child)

        walk_declarations(root_node)

    def _resolve_val(self, raw_str: str) -> Any:
        clean = raw_str.strip().strip('"').strip("'")
        if clean in self.constants:
            return self.constants[clean]
        if clean.isdigit():
            return int(clean)
        return clean

    # =========================================================================
    # AST Traversal
    # =========================================================================

    def _traverse(self, node: tree_sitter.Node):
        if node.type == "call_expression":
            self._check_call(node)
        elif node.type == "declaration":
            self._check_declaration(node)

        for child in node.children:
            self._traverse(child)

    def _check_declaration(self, node: tree_sitter.Node):
        decl_text = node.text.decode("utf-8", errors="replace").strip()
        lineno = node.start_point[0] + 1

        if "RSA_PrivateKey" in decl_text:
            m = re.search(r"RSA_PrivateKey\s+[a-zA-Z0-9_$]+\s*\([^,]+,\s*([a-zA-Z0-9_$]+)\)", decl_text)
            if m:
                raw = self._resolve_val(m.group(1))
                if isinstance(raw, int):
                    if raw < 2048:
                        self._add_finding(
                            lineno,
                            "CPP_BOTAN_WEAK_RSA",
                            f"RSA-{raw}",
                            "weak_asymmetric_key",
                            "critical" if raw <= 1024 else "high",
                            "Botan",
                            f"Weak Botan RSA private key ({raw} bits) initialized",
                        )
                    else:
                        self._add_finding(
                            lineno,
                            "CPP_BOTAN_RSA_KEY",
                            f"RSA-{raw}",
                            "asymmetric_key",
                            "medium",
                            "Botan",
                            f"Botan RSA private key ({raw} bits) initialized",
                        )

    # =========================================================================
    # Call Expression Analysis
    # =========================================================================

    def _check_call(self, node: tree_sitter.Node):
        func_node = node.child_by_field_name("function")
        args_node = node.child_by_field_name("arguments")
        if not func_node:
            return

        lineno = node.start_point[0] + 1
        func_text = func_node.text.decode("utf-8", errors="replace").strip()
        call_text = node.text.decode("utf-8", errors="replace").strip()

        # Extract argument strings
        args: List[str] = []
        if args_node:
            for arg_child in args_node.children:
                if arg_child.type not in ("(", ")", ","):
                    args.append(arg_child.text.decode("utf-8", errors="replace").strip())

        # ---------------------------------------------------------------------
        # 1. OpenSSL / BoringSSL / LibreSSL
        # ---------------------------------------------------------------------

        # 1.1 EVP Digests
        if func_text in ("EVP_md5", "EVP_md4", "EVP_md2"):
            self._add_finding(lineno, "C_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "OpenSSL", f"Weak hash {func_text}() used via OpenSSL EVP API")
            return
        if func_text in ("EVP_sha1", "EVP_dss1"):
            self._add_finding(lineno, "C_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "OpenSSL", f"Deprecated hash {func_text}() used via OpenSSL EVP API")
            return
        if func_text in ("EVP_sha256", "EVP_sha384", "EVP_sha512", "EVP_sha3_256", "EVP_sha3_512"):
            algo = func_text.replace("EVP_", "").upper().replace("_", "-")
            self._add_finding(lineno, "C_HASH_SECURE", algo, "cryptographic_hash", "low", "OpenSSL", f"Secure hash {func_text}() used via OpenSSL EVP API")
            return

        # 1.2 Direct Hashes
        if func_text in ("MD5_Init", "MD5", "MD4_Init", "MD2_Init"):
            self._add_finding(lineno, "C_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "OpenSSL", f"Direct legacy hash {func_text}() used")
            return
        if func_text in ("SHA1_Init", "SHA1"):
            self._add_finding(lineno, "C_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "OpenSSL", f"Direct deprecated hash {func_text}() used")
            return
        if func_text in ("SHA256_Init", "SHA256", "SHA384_Init", "SHA512_Init", "SHA512"):
            algo = "SHA-256" if "256" in func_text else ("SHA-384" if "384" in func_text else "SHA-512")
            self._add_finding(lineno, "C_HASH_SECURE", algo, "cryptographic_hash", "low", "OpenSSL", f"Direct secure hash {func_text}() used")
            return

        # 1.3 EVP Ciphers
        if func_text.startswith("EVP_"):
            # Weak ciphers: DES, 3DES, RC4, Blowfish, RC2, CAST5
            if any(w in func_text for w in ("des_ede3", "des_ede", "des_cbc", "des_cfb", "des_ecb", "desx")):
                self._add_finding(lineno, "C_WEAK_CIPHER_DES", "DES/3DES", "weak_cipher", "critical", "OpenSSL", f"Insecure DES cipher {func_text}() used via OpenSSL")
                return
            if "rc4" in func_text:
                self._add_finding(lineno, "C_WEAK_CIPHER_RC4", "RC4", "weak_cipher", "critical", "OpenSSL", f"Insecure RC4 stream cipher {func_text}() used")
                return
            if "bf_" in func_text or func_text.startswith("EVP_bf"):
                self._add_finding(lineno, "C_WEAK_CIPHER_BLOWFISH", "Blowfish", "weak_cipher", "critical", "OpenSSL", f"Vulnerable Blowfish cipher {func_text}() used (Sweet32 vulnerability)")
                return
            if "rc2_" in func_text:
                self._add_finding(lineno, "C_WEAK_CIPHER_RC2", "RC2", "weak_cipher", "critical", "OpenSSL", f"Broken RC2 cipher {func_text}() used")
                return

            # Insecure mode: ECB
            if func_text.endswith("_ecb"):
                algo = func_text.replace("EVP_", "").upper()
                self._add_finding(lineno, "C_INSECURE_CIPHER_MODE_ECB", f"{algo} [ECB]", "insecure_cipher_mode", "critical", "OpenSSL", f"Insecure ECB block cipher mode used in {func_text}()")
                return

            # Secure AEAD: AES-GCM, ChaCha20-Poly1305
            if "aes_256_gcm" in func_text or "chacha20_poly1305" in func_text:
                algo = "AES-256-GCM" if "aes" in func_text else "ChaCha20-Poly1305"
                self._add_finding(lineno, "C_AEAD_CIPHER", algo, "symmetric_cipher", "low", "OpenSSL", f"Authenticated cipher {func_text}() used")
                return

        # 1.4 RSA Key Generation & Padding
        if func_text in ("RSA_generate_key_ex", "RSA_generate_key"):
            # RSA_generate_key_ex(rsa, bits, e, cb) -> args[1] is bits
            # RSA_generate_key(bits, e, cb, NULL) -> args[0] is bits
            bits_idx = 1 if func_text == "RSA_generate_key_ex" else 0
            bits_val = None
            if len(args) > bits_idx:
                raw = self._resolve_val(args[bits_idx])
                if isinstance(raw, int):
                    bits_val = raw

            if bits_val is not None:
                if bits_val < 2048:
                    self._add_finding(
                        lineno, "C_WEAK_RSA_KEY_SIZE", f"RSA-{bits_val}", "weak_asymmetric_key",
                        "critical" if bits_val <= 1024 else "high", "OpenSSL",
                        f"Weak RSA key size ({bits_val} bits) < 2048 bits generated via {func_text}"
                    )
                else:
                    self._add_finding(
                        lineno, "C_RSA_KEY", f"RSA-{bits_val}", "asymmetric_key", "medium", "OpenSSL",
                        f"RSA key ({bits_val} bits) is classically secure but Shor quantum vulnerable"
                    )
            else:
                self._add_finding(lineno, "C_RSA_KEY", "RSA", "asymmetric_key", "medium", "OpenSSL", f"RSA key generation detected via {func_text}")
            return

        if func_text == "EVP_PKEY_CTX_set_rsa_keygen_bits":
            if len(args) >= 2:
                raw = self._resolve_val(args[1])
                if isinstance(raw, int) and raw < 2048:
                    self._add_finding(
                        lineno, "C_WEAK_RSA_KEY_SIZE", f"RSA-{raw}", "weak_asymmetric_key",
                        "critical" if raw <= 1024 else "high", "OpenSSL",
                        f"Weak RSA key size ({raw} bits) configured via EVP_PKEY_CTX_set_rsa_keygen_bits"
                    )
                    return

        # 1.5 EC Curves: EC_KEY_new_by_curve_name
        if func_text == "EC_KEY_new_by_curve_name":
            curve_arg = args[0] if args else ""
            if any(w in curve_arg for w in ("secp224", "NID_secp224k1", "NID_secp224r1")):
                self._add_finding(lineno, "C_WEAK_ECC_CURVE", "ECDSA-P224", "weak_asymmetric_key", "high", "OpenSSL", "Weak elliptic curve P-224 (insufficient security margin)")
            else:
                curve_name = "P-256" if "256" in curve_arg else ("P-384" if "384" in curve_arg else "P-521")
                self._add_finding(lineno, "C_ECC_KEY", f"ECDSA-{curve_name}", "asymmetric_key", "medium", "OpenSSL", f"ECDSA with curve {curve_name} (Shor quantum vulnerable)")
            return

        # 1.6 EdDSA / Ed25519
        if func_text in ("EVP_PKEY_new_raw_private_key", "EVP_PKEY_new_raw_public_key") or "ED25519" in call_text:
            if "ED25519" in call_text:
                self._add_finding(lineno, "C_ED25519_KEY", "Ed25519", "asymmetric_key", "medium", "OpenSSL", "Ed25519 signature key detected")
                return

        # 1.7 TLS Configuration (SSL_CTX_set_verify, SSL_set_verify, SSL_CTX_set_min_proto_version)
        if func_text in ("SSL_CTX_set_verify", "SSL_set_verify"):
            # SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL)
            if len(args) >= 2 and "SSL_VERIFY_NONE" in args[1]:
                self._add_finding(lineno, "C_DISABLED_CERT_VALIDATION", "TLS", "disabled_certificate_validation", "critical", "OpenSSL", "TLS certificate verification disabled (SSL_VERIFY_NONE)")
                return

        if func_text in ("SSL_CTX_set_min_proto_version", "SSL_set_min_proto_version"):
            # SSL_CTX_set_min_proto_version(ctx, TLS1_VERSION)
            ver_arg = args[1] if len(args) >= 2 else ""
            if any(w in ver_arg for w in ("TLS1_VERSION", "TLS1_1_VERSION", "SSL3_VERSION", "DTLS1_VERSION")):
                ver_name = "TLSv1.0" if "TLS1_VERSION" in ver_arg else ("TLSv1.1" if "TLS1_1" in ver_arg else "SSLv3")
                self._add_finding(lineno, "C_INSECURE_TLS_VERSION", ver_name, "insecure_tls_protocol", "critical", "OpenSSL", f"Insecure minimum TLS version configured ({ver_name})")
                return
            elif any(w in ver_arg for w in ("TLS1_2_VERSION", "TLS1_3_VERSION")):
                ver_name = "TLSv1.3" if "1_3" in ver_arg else "TLSv1.2"
                self._add_finding(lineno, "C_SECURE_TLS_VERSION", ver_name, "tls_protocol", "low", "OpenSSL", f"Secure minimum TLS version configured ({ver_name})")
                return

        if func_text in ("SSL_CTX_set_cipher_list", "SSL_set_cipher_list"):
            cipher_str = args[1] if len(args) >= 2 else ""
            if any(w in cipher_str.upper() for w in ("RC4", "3DES", "DES", "NULL", "MD5", "EXPORT")):
                self._add_finding(lineno, "C_INSECURE_CIPHER_SUITE", "Insecure-CipherSuite", "insecure_cipher_suite", "high", "OpenSSL", f"Legacy or weak cipher suite configured: {cipher_str}")
                return

        # 1.8 Certificate APIs: X509_sign with weak digest
        if func_text == "X509_sign":
            md_arg = args[2] if len(args) >= 3 else ""
            if "md5" in md_arg.lower():
                self._add_finding(lineno, "C_WEAK_CERT_SIGNATURE_ALGO", "MD5WithRSA", "weak_signature_algorithm", "critical", "OpenSSL", "X509 certificate signed using broken MD5 digest")
                return
            elif "sha1" in md_arg.lower():
                self._add_finding(lineno, "C_WEAK_CERT_SIGNATURE_ALGO", "SHA1WithRSA", "weak_signature_algorithm", "high", "OpenSSL", "X509 certificate signed using deprecated SHA-1 digest")
                return

        # ---------------------------------------------------------------------
        # 2. mbedTLS
        # ---------------------------------------------------------------------
        if func_text.startswith("mbedtls_"):
            if "md5" in func_text:
                self._add_finding(lineno, "C_MBEDTLS_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "mbedTLS", f"Weak mbedTLS MD5 hash used in {func_text}")
                return
            if "sha1" in func_text:
                self._add_finding(lineno, "C_MBEDTLS_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "mbedTLS", f"Deprecated mbedTLS SHA-1 hash used in {func_text}")
                return
            if "des" in func_text:
                self._add_finding(lineno, "C_MBEDTLS_WEAK_CIPHER_DES", "DES", "weak_cipher", "critical", "mbedTLS", f"Insecure mbedTLS DES cipher used in {func_text}")
                return
            if "arc4" in func_text:
                self._add_finding(lineno, "C_MBEDTLS_WEAK_CIPHER_RC4", "RC4", "weak_cipher", "critical", "mbedTLS", f"Insecure mbedTLS RC4 cipher used in {func_text}")
                return
            if func_text == "mbedtls_rsa_gen_key":
                # mbedtls_rsa_gen_key(&rsa, f_rng, p_rng, nbits, exponent)
                if len(args) >= 4:
                    raw = self._resolve_val(args[3])
                    if isinstance(raw, int) and raw < 2048:
                        self._add_finding(lineno, "C_MBEDTLS_WEAK_RSA", f"RSA-{raw}", "weak_asymmetric_key", "critical" if raw <= 1024 else "high", "mbedTLS", f"Weak mbedTLS RSA key size ({raw} bits)")
                        return
            if func_text == "mbedtls_ssl_conf_authmode":
                if len(args) >= 2 and "MBEDTLS_SSL_VERIFY_NONE" in args[1]:
                    self._add_finding(lineno, "C_MBEDTLS_DISABLED_CERT_VALIDATION", "TLS", "disabled_certificate_validation", "critical", "mbedTLS", "mbedTLS certificate verification disabled (MBEDTLS_SSL_VERIFY_NONE)")
                    return
            if func_text == "mbedtls_ssl_conf_min_version":
                if any(w in call_text for w in ("MBEDTLS_SSL_MINOR_VERSION_1", "MBEDTLS_SSL_MINOR_VERSION_0")):
                    self._add_finding(lineno, "C_MBEDTLS_INSECURE_TLS_VERSION", "TLSv1.0", "insecure_tls_protocol", "critical", "mbedTLS", "mbedTLS configured with insecure minimum TLS version")
                    return

        # ---------------------------------------------------------------------
        # 3. wolfSSL
        # ---------------------------------------------------------------------
        if func_text.startswith("wc_") or func_text.startswith("wolfSSL_"):
            if any(w in func_text for w in ("Md5Hash", "InitMd5")):
                self._add_finding(lineno, "C_WOLFSSL_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "wolfSSL", f"Weak wolfSSL MD5 hash used in {func_text}")
                return
            if any(w in func_text for w in ("ShaHash", "InitSha")) and not any(w in func_text for w in ("256", "384", "512")):
                self._add_finding(lineno, "C_WOLFSSL_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "wolfSSL", f"Deprecated wolfSSL SHA-1 hash used in {func_text}")
                return
            if "Des" in func_text:
                self._add_finding(lineno, "C_WOLFSSL_WEAK_CIPHER_DES", "DES", "weak_cipher", "critical", "wolfSSL", f"Insecure wolfSSL DES cipher used in {func_text}")
                return
            if func_text == "wc_MakeRsaKey":
                # wc_MakeRsaKey(&key, size, ...)
                if len(args) >= 2:
                    raw = self._resolve_val(args[1])
                    if isinstance(raw, int) and raw < 2048:
                        self._add_finding(lineno, "C_WOLFSSL_WEAK_RSA", f"RSA-{raw}", "weak_asymmetric_key", "critical" if raw <= 1024 else "high", "wolfSSL", f"Weak wolfSSL RSA key size ({raw} bits)")
                        return
            if func_text == "wolfSSL_CTX_set_verify":
                if "WOLFSSL_VERIFY_NONE" in call_text or (len(args) >= 2 and "SSL_VERIFY_NONE" in args[1]):
                    self._add_finding(lineno, "C_WOLFSSL_DISABLED_CERT_VALIDATION", "TLS", "disabled_certificate_validation", "critical", "wolfSSL", "wolfSSL certificate verification disabled (WOLFSSL_VERIFY_NONE)")
                    return

        # ---------------------------------------------------------------------
        # 4. libsodium
        # ---------------------------------------------------------------------
        if func_text.startswith("crypto_"):
            if func_text.startswith("crypto_secretbox"):
                self._add_finding(lineno, "C_LIBSODIUM_SECRETBOX", "XSalsa20-Poly1305", "symmetric_cipher", "low", "libsodium", "libsodium secretbox (XSalsa20-Poly1305) authenticated encryption")
                return
            if func_text.startswith("crypto_aead"):
                self._add_finding(lineno, "C_LIBSODIUM_AEAD", "ChaCha20-Poly1305", "symmetric_cipher", "low", "libsodium", "libsodium AEAD (ChaCha20-Poly1305) authenticated encryption")
                return
            if func_text.startswith("crypto_sign"):
                self._add_finding(lineno, "C_LIBSODIUM_ED25519", "Ed25519", "asymmetric_key", "medium", "libsodium", "libsodium Ed25519 signature operation")
                return
            if func_text.startswith("crypto_box") or func_text.startswith("crypto_scalarmult"):
                self._add_finding(lineno, "C_LIBSODIUM_X25519", "X25519", "asymmetric_key", "medium", "libsodium", "libsodium X25519 key exchange operation")
                return
            if func_text.startswith("crypto_pwhash"):
                self._add_finding(lineno, "C_LIBSODIUM_ARGON2", "Argon2id", "key_derivation", "low", "libsodium", "libsodium Argon2 password hashing")
                return
            if func_text.startswith("crypto_generichash"):
                self._add_finding(lineno, "C_LIBSODIUM_BLAKE2B", "BLAKE2b", "cryptographic_hash", "low", "libsodium", "libsodium BLAKE2b generic hashing")
                return

        # ---------------------------------------------------------------------
        # 5. Botan (C++)
        # ---------------------------------------------------------------------
        if "Botan::" in func_text or "Botan::" in call_text:
            if "HashFunction::create" in func_text or "HashFunction::create" in call_text:
                algo_arg = str(self._resolve_val(args[0] if args else "")).upper()
                if "MD5" in algo_arg or "MD4" in algo_arg:
                    self._add_finding(lineno, "CPP_BOTAN_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "Botan", f"Weak Botan HashFunction '{algo_arg}' created")
                    return
                if "SHA-1" in algo_arg or "SHA1" in algo_arg:
                    self._add_finding(lineno, "CPP_BOTAN_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "Botan", f"Deprecated Botan HashFunction '{algo_arg}' created")
                    return
                if "SHA-256" in algo_arg or "SHA-512" in algo_arg:
                    self._add_finding(lineno, "CPP_BOTAN_HASH_SECURE", algo_arg, "cryptographic_hash", "low", "Botan", f"Secure Botan HashFunction '{algo_arg}' created")
                    return

            if "Cipher_Mode::create" in func_text or "Cipher_Mode::create" in call_text:
                algo_arg = str(self._resolve_val(args[0] if args else "")).upper()
                if any(w in algo_arg for w in ("DES", "3DES", "RC4", "BLOWFISH")):
                    self._add_finding(lineno, "CPP_BOTAN_WEAK_CIPHER", algo_arg, "weak_cipher", "critical", "Botan", f"Weak Botan cipher mode '{algo_arg}' created")
                    return
                if "/ECB" in algo_arg or algo_arg.endswith("ECB"):
                    self._add_finding(lineno, "CPP_BOTAN_INSECURE_CIPHER_MODE_ECB", f"{algo_arg} [ECB]", "insecure_cipher_mode", "critical", "Botan", f"Insecure ECB cipher mode '{algo_arg}' in Botan")
                    return
                if "GCM" in algo_arg:
                    self._add_finding(lineno, "CPP_BOTAN_AEAD", algo_arg, "symmetric_cipher", "low", "Botan", f"Secure Botan AEAD cipher '{algo_arg}' created")
                    return

            if "RSA_PrivateKey" in func_text or "RSA_PrivateKey" in call_text:
                if len(args) >= 2:
                    raw = self._resolve_val(args[1])
                    if isinstance(raw, int) and raw < 2048:
                        self._add_finding(lineno, "CPP_BOTAN_WEAK_RSA", f"RSA-{raw}", "weak_asymmetric_key", "critical" if raw <= 1024 else "high", "Botan", f"Weak Botan RSA private key ({raw} bits)")
                        return

        # ---------------------------------------------------------------------
        # 6. Insecure PRNG (rand, srand)
        # ---------------------------------------------------------------------
        if func_text in ("rand", "srand"):
            self._add_finding(lineno, "C_WEAK_RAND", "rand()", "weak_prng", "low", "C-Stdlib", "Insecure pseudo-random number generator rand() used for potential crypto/security context")

    def _add_finding(
        self,
        line_number: int,
        rule_id: str,
        algorithm: str,
        finding_type: str,
        severity: str,
        library: str,
        reason: str,
    ):
        evidence_line = ""
        if 1 <= line_number <= len(self.lines):
            evidence_line = self.lines[line_number - 1].strip()

        rel_path = str(self.file_path.relative_to(self.root_dir)).replace("\\", "/") if self.root_dir in self.file_path.parents or self.file_path == self.root_dir else str(self.file_path).replace("\\", "/")

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
            reason=f"[{library}] {reason}",
        )
        self.findings.append(finding)
