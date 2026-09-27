"""
ECDAT Rust Semantic Crypto Detector (Phase 2.7)
Performs static AST analysis on Rust source files using tree-sitter-rust.
Covers:
- ring
- RustCrypto (md5, sha1, sha2, sha3, aes, des, blowfish)
- rustls
- common crypto crates (ed25519-dalek, x25519-dalek)

Distinguishes:
- PRESENT: Crate is declared in Cargo.toml dependencies but NOT actively called in code.
- OBSERVED / REACHABLE: Crate is imported and cryptographic methods/primitives are actively invoked.
"""

from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set
import tree_sitter
from scanners.static.results import StaticFinding


# Map crate names to their primary cryptographic capability categories
RUST_CRATE_CAPABILITY_MAP: Dict[str, Dict[str, str]] = {
    "ring": {
        "capability": "General Cryptographic Primitives (AEAD, Digest, Key Exchange, Signatures)",
        "category": "crypto_library",
    },
    "rustls": {"capability": "TLS Protocol Implementation", "category": "tls_library"},
    "webpki": {"capability": "X.509 Certificate Validation", "category": "certificate_library"},
    "md-5": {"capability": "MD5 Hash Algorithm (Broken)", "category": "weak_hash"},
    "md5": {"capability": "MD5 Hash Algorithm (Broken)", "category": "weak_hash"},
    "sha-1": {"capability": "SHA-1 Hash Algorithm (Deprecated)", "category": "weak_hash"},
    "sha1": {"capability": "SHA-1 Hash Algorithm (Deprecated)", "category": "weak_hash"},
    "sha2": {"capability": "SHA-256 / SHA-512 Hash Algorithms", "category": "cryptographic_hash"},
    "sha3": {"capability": "SHA-3 Hash Algorithms", "category": "cryptographic_hash"},
    "aes": {"capability": "AES Block Cipher", "category": "symmetric_cipher"},
    "des": {"capability": "DES / 3DES Block Cipher (Insecure)", "category": "weak_cipher"},
    "blowfish": {"capability": "Blowfish Block Cipher (Insecure)", "category": "weak_cipher"},
    "rc4": {"capability": "RC4 Stream Cipher (Broken)", "category": "weak_cipher"},
    "ed25519-dalek": {"capability": "Ed25519 Digital Signatures", "category": "asymmetric_key"},
    "x25519-dalek": {"capability": "X25519 Diffie-Hellman Key Exchange", "category": "asymmetric_key"},
    "rsa": {"capability": "RSA Asymmetric Cryptography", "category": "asymmetric_key"},
    "p256": {"capability": "NIST P-256 Elliptic Curve", "category": "asymmetric_key"},
    "p384": {"capability": "NIST P-384 Elliptic Curve", "category": "asymmetric_key"},
    "k256": {"capability": "secp256k1 Elliptic Curve", "category": "asymmetric_key"},
    "chacha20poly1305": {"capability": "ChaCha20-Poly1305 AEAD", "category": "symmetric_cipher"},
    "aes-gcm": {"capability": "AES-GCM Authenticated Encryption", "category": "symmetric_cipher"},
}


class RustCryptoDetector:
    """
    Semantic AST detector for Rust crypto crates and configurations.
    Enforces PRESENT vs OBSERVED/REACHABLE distinction.
    """

    def __init__(self, file_path: Path, root_dir: Path, source_code: bytes, language: tree_sitter.Language):
        self.file_path = file_path
        self.root_dir = root_dir
        self.source_code = source_code
        self.language = language
        self.parser = tree_sitter.Parser(self.language)
        self.source_str = source_code.decode("utf-8", errors="replace")
        self.lines = self.source_str.split("\n")

        self.cargo_toml_deps: Dict[str, str] = self._find_and_parse_cargo_toml()
        self.observed_crates: Set[str] = set()
        self.findings: List[StaticFinding] = []

    def _find_and_parse_cargo_toml(self) -> Dict[str, str]:
        """Discovers Cargo.toml in parent directories and maps crate dependencies."""
        deps: Dict[str, str] = {}
        curr = self.file_path.parent if self.file_path.is_file() else self.file_path
        root_resolved = self.root_dir.resolve()

        candidates = []
        while True:
            candidates.append(curr / "Cargo.toml")
            if curr.resolve() == root_resolved or curr.parent == curr:
                break
            curr = curr.parent

        if (self.root_dir / "Cargo.toml") not in candidates:
            candidates.append(self.root_dir / "Cargo.toml")

        for cand in candidates:
            if cand.is_file():
                try:
                    content = cand.read_text(encoding="utf-8", errors="replace")
                    in_deps = False
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if line.startswith("[dependencies]") or line.startswith("[dev-dependencies]"):
                            in_deps = True
                            continue
                        elif line.startswith("[") and in_deps:
                            in_deps = False
                            continue
                        elif in_deps:
                            # e.g. ring = "0.17" or aes = { version = "0.8" }
                            m = re.match(r"^([a-zA-Z0-9_-]+)\s*=\s*(.*)", line)
                            if m:
                                crate_name = m.group(1)
                                ver_raw = m.group(2).strip('"')
                                deps[crate_name] = ver_raw
                    if deps:
                        break
                except Exception:
                    pass

        return deps

    def detect(self) -> List[StaticFinding]:
        try:
            tree = self.parser.parse(self.source_code)
            if not tree:
                return []
        except Exception:
            return []

        # Pass 1: Walk AST to identify OBSERVED / REACHABLE crypto calls and usages
        self._traverse(tree.root_node)

        # Pass 2: Record PRESENT dependencies (crates declared in Cargo.toml that were NOT observed)
        self._record_present_dependencies()

        return self.findings

    def _traverse(self, node: tree_sitter.Node):
        if node.type == "call_expression":
            self._check_call(node)
        elif node.type == "use_declaration":
            self._check_use_declaration(node)

        for child in node.children:
            self._traverse(child)

    def _check_use_declaration(self, node: tree_sitter.Node):
        use_text = node.text.decode("utf-8", errors="replace").strip()
        for crate in RUST_CRATE_CAPABILITY_MAP:
            normalized_crate = crate.replace("-", "_")
            if f"use {normalized_crate}" in use_text or f"use {crate}" in use_text:
                self.observed_crates.add(crate)

    def _check_call(self, node: tree_sitter.Node):
        call_text = node.text.decode("utf-8", errors="replace").strip()
        lineno = node.start_point[0] + 1

        # 1. RustCrypto: MD5 & SHA-1 (Broken/Weak)
        if "Md5::new()" in call_text or "md5::compute(" in call_text or "Md5::digest(" in call_text:
            self.observed_crates.add("md5")
            self._add_finding(
                lineno,
                "RUST_WEAK_HASH_MD5",
                "MD5",
                "weak_hash",
                "critical",
                "OBSERVED",
                "md5",
                "Broken MD5 hash algorithm called via RustCrypto",
            )
            return
        if "Sha1::new()" in call_text or "sha1::compute(" in call_text or "Sha1::digest(" in call_text:
            self.observed_crates.add("sha1")
            self._add_finding(
                lineno,
                "RUST_WEAK_HASH_SHA1",
                "SHA-1",
                "weak_hash",
                "high",
                "OBSERVED",
                "sha1",
                "Deprecated SHA-1 hash algorithm called via RustCrypto",
            )
            return

        # 2. RustCrypto: Secure Hashes (SHA-2, SHA-3)
        if "Sha256::new()" in call_text or "Sha256::digest(" in call_text or "Sha512::new()" in call_text:
            self.observed_crates.add("sha2")
            algo = "SHA-512" if "512" in call_text else "SHA-256"
            self._add_finding(
                lineno,
                "RUST_HASH_SHA2",
                algo,
                "cryptographic_hash",
                "low",
                "OBSERVED",
                "sha2",
                f"Secure {algo} hash algorithm called",
            )
            return

        # 3. RustCrypto: Ciphers (DES, Blowfish vs AES)
        if "Des::new(" in call_text or "DesEde3::new(" in call_text:
            self.observed_crates.add("des")
            self._add_finding(
                lineno,
                "RUST_WEAK_CIPHER_DES",
                "DES",
                "weak_cipher",
                "critical",
                "OBSERVED",
                "des",
                "Insecure DES block cipher initialized",
            )
            return
        if "Blowfish::new(" in call_text:
            self.observed_crates.add("blowfish")
            self._add_finding(
                lineno,
                "RUST_WEAK_CIPHER_BLOWFISH",
                "Blowfish",
                "weak_cipher",
                "critical",
                "OBSERVED",
                "blowfish",
                "Insecure Blowfish block cipher initialized (Sweet32 vulnerability)",
            )
            return
        if "Aes256Gcm::new(" in call_text or "Aes128Gcm::new(" in call_text:
            self.observed_crates.add("aes-gcm")
            algo = "AES-256-GCM" if "256" in call_text else "AES-128-GCM"
            self._add_finding(
                lineno,
                "RUST_AEAD_AES_GCM",
                algo,
                "symmetric_cipher",
                "low",
                "OBSERVED",
                "aes-gcm",
                f"Modern authenticated {algo} AEAD initialized",
            )
            return

        # 4. ring: digest, aead, signature, agreement
        if "digest::digest(" in call_text or "ring::digest::" in call_text:
            self.observed_crates.add("ring")
            if "SHA1_FOR_LEGACY_USE_ONLY" in call_text:
                self._add_finding(
                    lineno,
                    "RUST_RING_WEAK_SHA1",
                    "SHA-1",
                    "weak_hash",
                    "high",
                    "OBSERVED",
                    "ring",
                    "ring SHA1_FOR_LEGACY_USE_ONLY used",
                )
            else:
                self._add_finding(
                    lineno,
                    "RUST_RING_DIGEST",
                    "SHA-256",
                    "cryptographic_hash",
                    "low",
                    "OBSERVED",
                    "ring",
                    "ring secure cryptographic digest invoked",
                )
            return
        if "aead::SealingKey::new(" in call_text or "ring::aead::" in call_text:
            self.observed_crates.add("ring")
            self._add_finding(
                lineno,
                "RUST_RING_AEAD",
                "AEAD",
                "symmetric_cipher",
                "low",
                "OBSERVED",
                "ring",
                "ring authenticated encryption (AEAD) invoked",
            )
            return

        # 5. rustls: ClientConfig, ServerConfig, DangerousClientConfig (ServerCertVerifier)
        if (
            "set_certificate_verifier(" in call_text
            or "DangerousClientConfig" in call_text
            or "NoServerAuth" in call_text
        ):
            self.observed_crates.add("rustls")
            if any(w in call_text for w in ("NoServerAuth", "DummyVerifier", "danger().set_certificate_verifier")):
                self._add_finding(
                    lineno,
                    "RUST_RUSTLS_DISABLED_CERT_VALIDATION",
                    "TLS",
                    "disabled_certificate_validation",
                    "critical",
                    "OBSERVED",
                    "rustls",
                    "rustls custom certificate verifier disables verification",
                )
                return
        if "ClientConfig::builder(" in call_text or "ServerConfig::builder(" in call_text:
            self.observed_crates.add("rustls")
            self._add_finding(
                lineno,
                "RUST_RUSTLS_CONFIG",
                "TLS",
                "tls_protocol",
                "low",
                "OBSERVED",
                "rustls",
                "rustls secure TLS configuration builder initialized",
            )
            return

        # 6. Dalek Crates: ed25519-dalek & x25519-dalek
        if "SigningKey::generate(" in call_text or "ed25519_dalek::" in call_text:
            self.observed_crates.add("ed25519-dalek")
            self._add_finding(
                lineno,
                "RUST_ED25519_KEY",
                "Ed25519",
                "asymmetric_key",
                "medium",
                "OBSERVED",
                "ed25519-dalek",
                "ed25519-dalek digital signature operation",
            )
            return
        if "EphemeralSecret::random(" in call_text or "x25519_dalek::" in call_text:
            self.observed_crates.add("x25519-dalek")
            self._add_finding(
                lineno,
                "RUST_X25519_KEX",
                "X25519",
                "asymmetric_key",
                "medium",
                "OBSERVED",
                "x25519-dalek",
                "x25519-dalek Diffie-Hellman key exchange",
            )
            return

    def _record_present_dependencies(self):
        """
        Adheres to: 'Do not label a crate used cryptographically merely because it is installed;
        distinguish PRESENT from OBSERVED/REACHABLE.'
        """
        for crate, ver in self.cargo_toml_deps.items():
            info = RUST_CRATE_CAPABILITY_MAP.get(crate)
            if not info:
                continue

            # If crate is in Cargo.toml dependencies but has not been observed/invoked in source code
            if crate not in self.observed_crates and crate.replace("-", "_") not in self.observed_crates:
                rel_path = (
                    str(self.file_path.relative_to(self.root_dir)).replace("\\", "/")
                    if self.root_dir in self.file_path.parents or self.file_path == self.root_dir
                    else str(self.file_path).replace("\\", "/")
                )
                capability = info["capability"]

                finding = StaticFinding(
                    file_path=rel_path,
                    line_number=1,
                    rule_id="RUST_CRATE_PRESENT_ONLY",
                    algorithm=crate,
                    evidence=f"{crate} = {ver} // [PRESENT in Cargo.toml but not OBSERVED in source code]",
                    confidence="high",
                    finding_type="dependency_present",
                    severity="info",
                    analysis_source="manifest_dependency",
                    needs_human_review=False,
                    reason=f"[PRESENT_ONLY] Crate '{crate}@{ver}' is installed providing '{capability}', but is NOT OBSERVED/REACHABLE in code execution.",
                )
                self.findings.append(finding)

    def _add_finding(
        self,
        line_number: int,
        rule_id: str,
        algorithm: str,
        finding_type: str,
        severity: str,
        reachability: str,
        crate: str,
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

        dep_info = f"@{self.cargo_toml_deps.get(crate, 'unknown')}" if crate in self.cargo_toml_deps else ""
        cap_desc = RUST_CRATE_CAPABILITY_MAP.get(crate, {}).get("capability", "Cryptographic API")

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
            reason=f"[{reachability}] [{crate}{dep_info}] (Capability: {cap_desc}) {reason}",
        )
        self.findings.append(finding)
