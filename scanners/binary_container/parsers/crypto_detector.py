"""
ECDAT Binary Crypto Detector — Correlates Libraries, Symbols, and Strings to Crypto Capabilities
"""

import re
from typing import List, Dict, Any, Set, Optional
from scanners.binary_container.parsers.base import CryptoIndicator, SymbolMetadata

KNOWN_CRYPTO_LIBRARIES: Dict[str, Dict[str, Any]] = {
    "OpenSSL": {
        "lib_patterns": [r"libcrypto(?:\.so|\.dylib|\.a)?", r"libssl(?:\.so|\.dylib|\.a)?"],
        "symbol_prefixes": ["EVP_", "SSL_", "RSA_", "EC_KEY_", "X509_", "HMAC_", "BN_", "BIO_"],
        "string_keywords": ["OpenSSL", "openssl.org", "MD_CTX", "EVP_CIPHER"],
    },
    "BoringSSL": {
        "lib_patterns": [r"libboringssl"],
        "symbol_prefixes": ["bssl_", "BORINGSSL_"],
        "string_keywords": ["BoringSSL"],
    },
    "LibreSSL": {
        "lib_patterns": [r"libressl", r"libtls"],
        "symbol_prefixes": ["tls_init", "tls_config", "tls_connect"],
        "string_keywords": ["LibreSSL"],
    },
    "mbedTLS": {
        "lib_patterns": [r"libmbedtls", r"libmbedcrypto", r"libmbedx509"],
        "symbol_prefixes": ["mbedtls_"],
        "string_keywords": ["mbed TLS", "mbedtls_"],
    },
    "wolfSSL": {
        "lib_patterns": [r"libwolfssl", r"libcyassl"],
        "symbol_prefixes": ["wolfSSL_", "wc_"],
        "string_keywords": ["wolfSSL", "CyaSSL"],
    },
    "libsodium": {
        "lib_patterns": [r"libsodium"],
        "symbol_prefixes": ["crypto_box_", "crypto_secretbox_", "crypto_sign_", "crypto_pwhash_", "sodium_"],
        "string_keywords": ["libsodium"],
    },
    "Botan": {
        "lib_patterns": [r"libbotan"],
        "symbol_prefixes": ["botan_", "_ZN5Botan"],
        "string_keywords": ["Botan"],
    },
    "Windows CNG / CryptoAPI": {
        "lib_patterns": [r"bcrypt\.dll", r"crypt32\.dll", r"ncrypt\.dll", r"advapi32\.dll"],
        "symbol_prefixes": [
            "BCrypt", "NCrypt", "CryptAcquireContext", "CryptGenKey", "CryptEncrypt",
            "CertOpenSystemStore", "CertFindCertificateInStore"
        ],
        "string_keywords": ["Microsoft Software Key Storage Provider", "Microsoft Enhanced Cryptographic Provider"],
    },
    "Apple CommonCrypto / Security": {
        "lib_patterns": [r"libcommonCrypto", r"Security\.framework"],
        "symbol_prefixes": ["CC_MD5", "CC_SHA", "CCCrypt", "SecKey", "SecCertificate"],
        "string_keywords": ["CommonCrypto"],
    },
}


from scanners.binary_container.parsers.library_fingerprinter import (
    LibraryFingerprinter,
    FingerprintEvidence,
)

_fingerprinter_instance: Optional[LibraryFingerprinter] = None


def get_fingerprinter() -> LibraryFingerprinter:
    global _fingerprinter_instance
    if _fingerprinter_instance is None:
        _fingerprinter_instance = LibraryFingerprinter()
    return _fingerprinter_instance


def detect_crypto_indicators(
    imported_libraries: List[str],
    symbols: List[SymbolMetadata],
    strings: List[str],
) -> List[CryptoIndicator]:
    """
    Correlates metadata from binaries against known cryptographic libraries
    using robust multi-signal fingerprinting (Phase 4.2).
    A single string alone NEVER triggers a positive cryptographic library fingerprint.
    """
    fingerprinter = get_fingerprinter()
    evidence_list = fingerprinter.fingerprint(imported_libraries, symbols, strings)

    indicators: List[CryptoIndicator] = []
    for ev in evidence_list:
        indicators.append(
            CryptoIndicator(
                library_name=ev.library_name,
                confidence=ev.confidence,
                matched_libraries=ev.matched_libraries,
                matched_symbols=ev.matched_symbols,
                matched_strings=ev.matched_strings,
                description=ev.rationale,
            )
        )

    return indicators

