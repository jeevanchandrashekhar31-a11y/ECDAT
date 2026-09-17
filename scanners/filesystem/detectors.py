"""
ECDAT Filesystem Crypto Detectors (Phase 4.4)
Detects:
- Certificate files (X.509, PKCS#7, CRL)
- Public keys (PEM, OpenSSH, JWK)
- Crypto configuration (OpenSSL, GnuPG, IPsec, Java security, Kerberos)
- TLS configuration (Nginx, Apache, HAProxy, Envoy, SSHD)
- Library installations (Shared libraries fingerprinted via LibraryFingerprinter)
- References to key stores (JKS, PKCS#12, PKCS#11, Cloud KMS)
"""

import hashlib
import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from scanners.filesystem.models import FilesystemCryptoAsset, FilesystemAssetType
from scanners.binary_container.parsers.library_fingerprinter import LibraryFingerprinter

# Compiled regex patterns for TLS and Crypto configuration directives
TLS_CONFIG_PATTERNS = [
    (re.compile(r"ssl_protocols\s+([^;]+);", re.IGNORECASE), "nginx:ssl_protocols"),
    (re.compile(r"ssl_ciphers\s+['\"]?([^;'\"]+)['\"]?;", re.IGNORECASE), "nginx:ssl_ciphers"),
    (re.compile(r"SSLProtocol\s+([^\n\r]+)", re.IGNORECASE), "apache:SSLProtocol"),
    (re.compile(r"SSLCipherSuite\s+([^\n\r]+)", re.IGNORECASE), "apache:SSLCipherSuite"),
    (re.compile(r"ssl-default-bind-ciphers\s+([^\n\r]+)", re.IGNORECASE), "haproxy:ciphers"),
    (re.compile(r"Ciphers\s+([^\n\r]+)", re.IGNORECASE), "sshd:Ciphers"),
    (re.compile(r"KexAlgorithms\s+([^\n\r]+)", re.IGNORECASE), "sshd:KexAlgorithms"),
    (re.compile(r"MACs\s+([^\n\r]+)", re.IGNORECASE), "sshd:MACs"),
]

CRYPTO_CONFIG_PATTERNS = [
    (re.compile(r"CipherString\s*=\s*([^\n\r]+)", re.IGNORECASE), "openssl:CipherString"),
    (re.compile(r"MinProtocol\s*=\s*([^\n\r]+)", re.IGNORECASE), "openssl:MinProtocol"),
    (re.compile(r"jdk\.tls\.disabledAlgorithms\s*=\s*([^\n\r]+)", re.IGNORECASE), "java:disabledAlgorithms"),
    (re.compile(r"crypto\.policy\s*=\s*([^\n\r]+)", re.IGNORECASE), "java:crypto.policy"),
    (re.compile(r"personal-cipher-preferences\s+([^\n\r]+)", re.IGNORECASE), "gpg:cipher-preferences"),
    (re.compile(r"personal-digest-preferences\s+([^\n\r]+)", re.IGNORECASE), "gpg:digest-preferences"),
    (re.compile(r"ike\s*=\s*([^\n\r]+)", re.IGNORECASE), "ipsec:ike_ciphers"),
    (re.compile(r"esp\s*=\s*([^\n\r]+)", re.IGNORECASE), "ipsec:esp_ciphers"),
]

CLOUD_KMS_PATTERNS = [
    re.compile(r"arn:aws:kms:[a-z0-9-]+:\d{12}:key/[a-f0-9-]+", re.IGNORECASE),
    re.compile(r"projects/[^/]+/locations/[^/]+/keyRings/[^/]+/cryptoKeys/[^/]+", re.IGNORECASE),
    re.compile(r"https://[a-z0-9-]+\.vault\.azure\.net/keys/[^/\s]+", re.IGNORECASE),
    re.compile(r"vault:(?:v1|secret)/[a-zA-Z0-9_-]+", re.IGNORECASE),
]


class FilesystemAssetDetector:
    """
    Analyzes safe files on the filesystem for cryptographic assets and configurations.
    """

    def __init__(self):
        self.fingerprinter = LibraryFingerprinter()

    def inspect_file(
        self,
        file_path: Path,
        rel_path: str,
        content_sample: bytes,
        file_size: int,
    ) -> List[FilesystemCryptoAsset]:
        """
        Inspects a file and returns discovered cryptographic assets.
        """
        assets: List[FilesystemCryptoAsset] = []
        file_name = file_path.name.lower()
        sha256_hash = hashlib.sha256(content_sample).hexdigest()

        # 1. Detect Certificate Files
        cert_asset = self._detect_certificate(
            file_name, rel_path, str(file_path), content_sample, file_size, sha256_hash
        )
        if cert_asset:
            assets.append(cert_asset)

        # 2. Detect Public Keys
        pubkey_asset = self._detect_public_key(
            file_name, rel_path, str(file_path), content_sample, file_size, sha256_hash
        )
        if pubkey_asset:
            assets.append(pubkey_asset)

        # 3. Detect Key Stores and Key Store References
        keystore_asset = self._detect_key_store(
            file_name, rel_path, str(file_path), content_sample, file_size, sha256_hash
        )
        if keystore_asset:
            assets.append(keystore_asset)

        # 4. Detect Crypto Configurations
        crypto_cfg_asset = self._detect_crypto_config(
            file_name, rel_path, str(file_path), content_sample, file_size, sha256_hash
        )
        if crypto_cfg_asset:
            assets.append(crypto_cfg_asset)

        # 5. Detect TLS Configurations
        tls_cfg_asset = self._detect_tls_config(
            file_name, rel_path, str(file_path), content_sample, file_size, sha256_hash
        )
        if tls_cfg_asset:
            assets.append(tls_cfg_asset)

        # 6. Detect Cryptographic Shared Libraries
        lib_asset = self._detect_library_installation(file_name, rel_path, str(file_path), file_size, sha256_hash)
        if lib_asset:
            assets.append(lib_asset)

        return assets

    def _detect_certificate(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        is_cert = False
        cert_format = "PEM"

        if any(file_name.endswith(ext) for ext in [".crt", ".cer", ".pem", ".p7b", ".p7c", ".crl"]):
            is_cert = True

        if b"-----BEGIN CERTIFICATE-----" in content:
            is_cert = True
            cert_format = "X.509 PEM"
        elif b"-----BEGIN PKCS7-----" in content:
            is_cert = True
            cert_format = "PKCS#7 PEM"
        elif b"-----BEGIN X509 CRL-----" in content:
            is_cert = True
            cert_format = "X.509 CRL"
        elif content.startswith(b"\x30\x82") and (file_name.endswith(".der") or file_name.endswith(".cer")):
            is_cert = True
            cert_format = "X.509 DER"

        if not is_cert:
            return None

        # Parse basic X.509 text metadata if PEM
        subject = None
        issuer = None
        valid_not_before = None
        valid_not_after = None

        text = content.decode("utf-8", errors="ignore")
        for line in text.splitlines():
            line_str = line.strip()
            if line_str.startswith("Subject:"):
                subject = line_str.split("Subject:")[1].strip()
            elif line_str.startswith("Issuer:"):
                issuer = line_str.split("Issuer:")[1].strip()
            elif "Not Before:" in line_str:
                valid_not_before = line_str.split("Not Before:")[1].strip()
            elif "Not After :" in line_str or "Not After:" in line_str:
                valid_not_after = line_str.split("Not After")[1].replace(":", "").strip()

        return FilesystemCryptoAsset(
            asset_id=f"cert:{rel_path}",
            asset_type=FilesystemAssetType.CERTIFICATE,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence="high" if b"BEGIN CERTIFICATE" in content else "medium",
            description=f"Certificate asset ({cert_format})",
            metadata={
                "format": cert_format,
                "subject": subject or file_name,
                "issuer": issuer,
                "not_before": valid_not_before,
                "not_after": valid_not_after,
            },
        )

    def _detect_public_key(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        text = content.decode("utf-8", errors="ignore")
        key_type = None

        if "-----BEGIN PUBLIC KEY-----" in text:
            key_type = "Generic SubjectPublicKeyInfo (PEM)"
        elif "-----BEGIN RSA PUBLIC KEY-----" in text:
            key_type = "PKCS#1 RSA Public Key (PEM)"
        elif "-----BEGIN EC PUBLIC KEY-----" in text:
            key_type = "SEC1 EC Public Key (PEM)"
        elif "-----BEGIN DSA PUBLIC KEY-----" in text:
            key_type = "DSA Public Key (PEM)"
        elif (file_name.endswith(".pub") or file_name in ["authorized_keys", "known_hosts"]) and any(
            proto in text for proto in ["ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256"]
        ):
            key_type = "OpenSSH Public Key"
        elif file_name.endswith(".json") and '"kty":' in text and '"d":' not in text:
            # Check for JWK public key
            try:
                data = json.loads(text)
                if isinstance(data, dict) and "kty" in data and ("n" in data or "x" in data):
                    key_type = f"JWK Public Key ({data.get('kty')})"
                elif isinstance(data, dict) and "keys" in data and isinstance(data["keys"], list):
                    key_type = "JWK Set (JWKS)"
            except Exception:
                pass

        if not key_type:
            return None

        return FilesystemCryptoAsset(
            asset_id=f"pubkey:{rel_path}",
            asset_type=FilesystemAssetType.PUBLIC_KEY,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence="high",
            description=f"Cryptographic Public Key ({key_type})",
            metadata={"key_type": key_type},
        )

    def _detect_key_store(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        store_type = None

        # 1. Java KeyStore binary magic (0xFEEDFEED) or extensions
        if (
            content.startswith(b"\xfe\xed\xfe\xed")
            or file_name.endswith(".jks")
            or file_name.endswith(".keystore")
            or file_name.endswith(".truststore")
        ):
            store_type = "Java KeyStore (JKS)"

        # 2. PKCS#12 bundle
        elif file_name.endswith(".p12") or file_name.endswith(".pfx"):
            store_type = "PKCS#12 Keystore Bundle"

        # 3. PKCS#11 / HSM configurations
        elif file_name in ["softhsm2.conf", "pkcs11.cfg", "sunpkcs11.cfg"]:
            store_type = "PKCS#11 HSM Provider Configuration"

        # 4. Cloud KMS references in config text
        else:
            text = content.decode("utf-8", errors="ignore")
            for pattern in CLOUD_KMS_PATTERNS:
                match = pattern.search(text)
                if match:
                    store_type = f"Cloud KMS Key Reference: {match.group(0)[:60]}"
                    break

        if not store_type:
            return None

        return FilesystemCryptoAsset(
            asset_id=f"keystore:{rel_path}",
            asset_type=FilesystemAssetType.KEY_STORE_REFERENCE,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence="high",
            description=f"Cryptographic Key Store / Provider ({store_type})",
            metadata={"store_type": store_type},
        )

    def _detect_crypto_config(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        is_candidate = any(
            file_name.endswith(ext)
            for ext in [".cnf", ".cfg", ".conf", ".ini", ".yaml", ".yml", ".json", ".properties", ".security"]
        ) or file_name in ["openssl.cnf", "java.security", "gpg.conf", "krb5.conf", "ipsec.conf"]

        if not is_candidate:
            return None

        text = content.decode("utf-8", errors="ignore")
        matched_directives: Dict[str, str] = {}

        for pattern, tag in CRYPTO_CONFIG_PATTERNS:
            match = pattern.search(text)
            if match:
                matched_directives[tag] = match.group(1).strip()

        if not matched_directives:
            return None

        return FilesystemCryptoAsset(
            asset_id=f"crypto_cfg:{rel_path}",
            asset_type=FilesystemAssetType.CRYPTO_CONFIG,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence="high" if len(matched_directives) >= 2 else "medium",
            description="Cryptographic configuration file",
            metadata={"directives": matched_directives},
        )

    def _detect_tls_config(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        content: bytes,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        is_candidate = (
            file_name in ["nginx.conf", "httpd.conf", "ssl.conf", "haproxy.cfg", "sshd_config"]
            or file_name.endswith(".conf")
            or file_name.endswith(".yaml")
            or file_name.endswith(".yml")
        )
        if not is_candidate:
            return None

        text = content.decode("utf-8", errors="ignore")
        matched_tls: Dict[str, str] = {}

        for pattern, tag in TLS_CONFIG_PATTERNS:
            match = pattern.search(text)
            if match:
                matched_tls[tag] = match.group(1).strip()

        if not matched_tls:
            return None

        return FilesystemCryptoAsset(
            asset_id=f"tls_cfg:{rel_path}",
            asset_type=FilesystemAssetType.TLS_CONFIG,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence="high" if len(matched_tls) >= 2 else "medium",
            description="TLS/SSL service configuration",
            metadata={"tls_settings": matched_tls},
        )

    def _detect_library_installation(
        self,
        file_name: str,
        rel_path: str,
        abs_path: str,
        file_size: int,
        sha256_hash: str,
    ) -> Optional[FilesystemCryptoAsset]:
        # Only inspect shared library extensions
        if not (".so" in file_name or file_name.endswith(".dylib") or file_name.endswith(".dll")):
            return None

        # Evaluate against fingerprinter
        fingerprints = self.fingerprinter.fingerprint(
            imported_libraries=[file_name],
            symbols=[],
            strings=[],
        )

        if not fingerprints:
            return None

        top_fp = fingerprints[0]
        return FilesystemCryptoAsset(
            asset_id=f"lib:{rel_path}",
            asset_type=FilesystemAssetType.LIBRARY_INSTALLATION,
            file_path=rel_path,
            absolute_path=abs_path,
            file_size_bytes=file_size,
            sha256_hash=sha256_hash,
            confidence=top_fp.confidence,
            description=f"Cryptographic Library Installation: {top_fp.library_name}",
            metadata={
                "library_name": top_fp.library_name,
                "capabilities": top_fp.typical_capabilities,
                "matched_libraries": top_fp.matched_libraries,
            },
        )
