"""
ECDAT C# Semantic Crypto Detector (Phase 2.7)
Performs static AST analysis on C# source files using tree-sitter-c-sharp.
Covers:
- System.Security.Cryptography
- Certificate APIs (X509Certificate, X509Certificate2, X509Chain, CertificateRequest)
- TLS settings (SslProtocols, ServerCertificateValidationCallback, SslStream)
"""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional
import tree_sitter
from scanners.static.results import StaticFinding


class CSharpCryptoDetector:
    """
    Semantic AST detector for C# cryptographic primitives, certificates, and TLS configurations.
    """

    def __init__(self, file_path: Path, root_dir: Path, source_code: bytes, language: tree_sitter.Language):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_code = source_code
        self.language = language
        self.parser = tree_sitter.Parser(self.language)
        self.source_str = source_code.decode("utf-8", errors="replace")
        self.lines = self.source_str.split("\n")

        self.constants: Dict[str, Any] = {}
        self.findings: List[StaticFinding] = []

    def detect(self) -> List[StaticFinding]:
        try:
            tree = self.parser.parse(self.source_code)
            if not tree:
                return []
        except Exception:
            return []

        # Pass 1: Collect constants
        self._collect_constants(tree.root_node)

        # Pass 2: Traverse AST
        self._traverse(tree.root_node)

        return self.findings

    def _collect_constants(self, root: tree_sitter.Node):
        const_re = re.compile(r"\bconst\s+[a-zA-Z0-9_<>[\]]+\s+([a-zA-Z0-9_$]+)\s*=\s*([0-9]+|true|false|\"[^\"]*\");")
        for m in const_re.finditer(self.source_str):
            name, raw_val = m.group(1), m.group(2).strip('"')
            if raw_val.isdigit():
                self.constants[name] = int(raw_val)
            elif raw_val.lower() == "true":
                self.constants[name] = True
            elif raw_val.lower() == "false":
                self.constants[name] = False
            else:
                self.constants[name] = raw_val

    def _resolve_val(self, raw_str: str) -> Any:
        clean = raw_str.strip().strip('"')
        if clean in self.constants:
            return self.constants[clean]
        if clean.isdigit():
            return int(clean)
        if clean.lower() == "true":
            return True
        if clean.lower() == "false":
            return False
        return clean

    def _traverse(self, node: tree_sitter.Node):
        if node.type in ("invocation_expression", "object_creation_expression"):
            self._check_invocation(node)
        elif node.type == "assignment_expression":
            self._check_assignment(node)

        for child in node.children:
            self._traverse(child)

    def _check_invocation(self, node: tree_sitter.Node):
        call_text = node.text.decode("utf-8", errors="replace").strip()
        lineno = node.start_point[0] + 1

        # 1. Hashes: MD5, SHA1, SHA256, SHA384, SHA512
        if "MD5.Create(" in call_text or "new MD5CryptoServiceProvider(" in call_text or "MD5CryptoServiceProvider" in call_text:
            self._add_finding(lineno, "CS_WEAK_HASH_MD5", "MD5", "weak_hash", "critical", "Broken MD5 hash algorithm initialized via System.Security.Cryptography")
            return
        if "SHA1.Create(" in call_text or "new SHA1CryptoServiceProvider(" in call_text or "SHA1Managed" in call_text:
            self._add_finding(lineno, "CS_WEAK_HASH_SHA1", "SHA-1", "weak_hash", "high", "Deprecated SHA-1 hash algorithm initialized via System.Security.Cryptography")
            return
        if any(w in call_text for w in ("SHA256.Create(", "new SHA256Managed(", "SHA256CryptoServiceProvider")):
            self._add_finding(lineno, "CS_HASH_SHA256", "SHA-256", "cryptographic_hash", "low", "Secure SHA-256 hash algorithm initialized")
            return
        if any(w in call_text for w in ("SHA512.Create(", "new SHA512Managed(", "SHA384.Create(")):
            algo = "SHA-384" if "384" in call_text else "SHA-512"
            self._add_finding(lineno, "CS_HASH_SHA512", algo, "cryptographic_hash", "low", f"Secure {algo} hash algorithm initialized")
            return

        # 2. Ciphers: TripleDES (checked before DES), DES, RC2, Rijndael, Aes
        if "TripleDESCryptoServiceProvider" in call_text or "TripleDES.Create(" in call_text or "TripleDES" in call_text:
            self._add_finding(lineno, "CS_WEAK_CIPHER_3DES", "3DES", "weak_cipher", "critical", "Vulnerable TripleDES cipher initialized")
            return
        if "DESCryptoServiceProvider" in call_text or "DES.Create(" in call_text or re.search(r"\bDES\.Create\(", call_text):
            self._add_finding(lineno, "CS_WEAK_CIPHER_DES", "DES", "weak_cipher", "critical", "Broken DES cipher initialized")
            return
        if "RC2CryptoServiceProvider" in call_text or "RC2.Create(" in call_text:
            self._add_finding(lineno, "CS_WEAK_CIPHER_RC2", "RC2", "weak_cipher", "critical", "Broken RC2 cipher initialized")
            return
        if "Aes.Create(" in call_text or "AesManaged" in call_text:
            self._add_finding(lineno, "CS_CIPHER_AES", "AES", "symmetric_cipher", "low", "Standard AES cipher initialized")
            return

        # 3. Asymmetric: RSA, ECDsa, ECDiffieHellman
        if "RSA.Create(" in call_text or "new RSACryptoServiceProvider(" in call_text:
            # Check key size argument: RSA.Create(1024) or new RSACryptoServiceProvider(1024)
            size_m = re.search(r"\((?:keySize:\s*)?([a-zA-Z0-9_$]+)\)", call_text)
            key_size = 2048
            if size_m:
                val = self._resolve_val(size_m.group(1))
                if isinstance(val, int):
                    key_size = val

            if key_size < 2048:
                self._add_finding(
                    lineno, "CS_WEAK_RSA_KEY_SIZE", f"RSA-{key_size}", "weak_asymmetric_key",
                    "critical" if key_size <= 1024 else "high",
                    f"Weak RSA key size ({key_size} bits) < 2048 bits"
                )
            else:
                self._add_finding(
                    lineno, "CS_RSA_KEY", f"RSA-{key_size}", "asymmetric_key", "medium",
                    f"RSA key ({key_size} bits) is classically secure but Shor quantum vulnerable"
                )
            return

        if "ECDsa.Create(" in call_text:
            # Check curve
            if any(w in call_text for w in ("nistP224", "secp224")):
                self._add_finding(lineno, "CS_WEAK_ECC_CURVE", "ECDSA-P224", "weak_asymmetric_key", "high", "Weak elliptic curve P-224 configured")
            else:
                curve = "P-256"
                if "nistP384" in call_text:
                    curve = "P-384"
                elif "nistP521" in call_text:
                    curve = "P-521"
                self._add_finding(lineno, "CS_ECC_KEY", f"ECDSA-{curve}", "asymmetric_key", "medium", f"ECDSA curve {curve} (Shor quantum vulnerable)")
            return

        # 4. Certificates: CertificateRequest & X509Certificate
        if "CertificateRequest" in call_text:
            if any(w in call_text for w in ("HashAlgorithmName.MD5", "MD5")):
                self._add_finding(lineno, "CS_WEAK_CERT_SIGNATURE_ALGO", "MD5WithRSA", "weak_signature_algorithm", "critical", "X509 CertificateRequest configured with broken MD5 signature hash")
                return
            elif any(w in call_text for w in ("HashAlgorithmName.SHA1", "SHA1")):
                self._add_finding(lineno, "CS_WEAK_CERT_SIGNATURE_ALGO", "SHA1WithRSA", "weak_signature_algorithm", "high", "X509 CertificateRequest configured with deprecated SHA-1 signature hash")
                return

    def _check_assignment(self, node: tree_sitter.Node):
        assign_text = node.text.decode("utf-8", errors="replace").strip()
        lineno = node.start_point[0] + 1

        # 1. Disabled Certificate Validation:
        if "ServerCertificateValidationCallback" in assign_text:
            if re.search(r"=>\s*true\b", assign_text) or "return true" in assign_text:
                self._add_finding(
                    lineno, "CS_DISABLED_CERT_VALIDATION", "TLS", "disabled_certificate_validation", "critical",
                    "TLS certificate validation disabled via ServerCertificateValidationCallback returning unconditionally true"
                )
                return

        # 2. Insecure TLS Protocols:
        if "SecurityProtocol" in assign_text or "EnabledSslProtocols" in assign_text or "SslProtocols" in assign_text:
            if any(re.search(pat, assign_text) for pat in (r"\bSsl3\b", r"SecurityProtocolType\.Tls\b", r"SslProtocols\.Tls\b", r"\bTls11\b")):
                proto = "TLSv1.0" if ("Tls11" not in assign_text and "Ssl3" not in assign_text) else ("SSLv3" if "Ssl3" in assign_text else "TLSv1.1")
                self._add_finding(
                    lineno, "CS_INSECURE_TLS_VERSION", proto, "insecure_tls_protocol", "critical",
                    f"Insecure legacy TLS/SSL protocol enabled: {proto}"
                )
                return
            elif any(w in assign_text for w in ("Tls12", "Tls13")):
                proto = "TLSv1.3" if "Tls13" in assign_text else "TLSv1.2"
                self._add_finding(
                    lineno, "CS_SECURE_TLS_VERSION", proto, "tls_protocol", "low",
                    f"Secure TLS protocol enabled: {proto}"
                )
                return

        # 3. Insecure Cipher Mode:
        # cipher.Mode = CipherMode.ECB;
        if "Mode" in assign_text and "CipherMode.ECB" in assign_text:
            self._add_finding(
                lineno, "CS_INSECURE_CIPHER_MODE_ECB", "ECB", "insecure_cipher_mode", "critical",
                "Insecure Electronic Codebook (ECB) cipher mode configured in C# SymmetricAlgorithm"
            )
            return

    def _add_finding(self, line_number: int, rule_id: str, algorithm: str, finding_type: str, severity: str, reason: str):
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
            reason=f"[System.Security.Cryptography] {reason}",
        )
        self.findings.append(finding)
