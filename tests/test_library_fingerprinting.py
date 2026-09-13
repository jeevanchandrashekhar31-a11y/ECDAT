"""
Tests for Phase 4.2: Crypto-Library Fingerprinting
Verifies robust multi-signal evidence accumulation and the invariant:
"Fingerprint by robust evidence, not one string."
"""

import pytest
from scanners.binary_container.parsers.library_fingerprinter import (
    LibraryFingerprinter,
    FingerprintEvidence,
)
from scanners.binary_container.parsers.base import SymbolMetadata


@pytest.fixture
def fingerprinter():
    return LibraryFingerprinter()


def make_symbols(names):
    return [
        SymbolMetadata(
            name=n,
            is_imported=True,
            symbol_type="function",
            binding="global",
        )
        for n in names
    ]


# ---------------------------------------------------------------------------
# Invariant: Never Fingerprint by One String Alone
# ---------------------------------------------------------------------------

def test_reject_single_string_match_openssl(fingerprinter):
    """A single string alone MUST NOT produce a positive fingerprint."""
    results = fingerprinter.fingerprint(
        imported_libraries=[],
        symbols=[],
        strings=["OpenSSL 3.0.8"],
    )
    # Must be empty (rejected as inconclusive)
    assert len(results) == 0


def test_reject_single_string_match_all_targets(fingerprinter):
    """Tests that a single string alone is rejected for all 10 libraries."""
    single_strings = [
        "OpenSSL",
        "BoringSSL",
        "LibreSSL",
        "mbed TLS",
        "wolfSSL",
        "Botan",
        "libsodium",
        "Bouncy Castle",
        "Microsoft Software Key Storage Provider",
        "Apple CommonCrypto",
    ]
    for s in single_strings:
        res = fingerprinter.fingerprint(
            imported_libraries=[],
            symbols=[],
            strings=[s],
        )
        assert len(res) == 0, f"Single string '{s}' unexpectedly produced positive fingerprint: {res}"


def test_multiple_strings_produce_low_confidence(fingerprinter):
    """Multiple distinctive strings without symbols or libraries yield LOW confidence."""
    results = fingerprinter.fingerprint(
        imported_libraries=[],
        symbols=[],
        strings=["OpenSSL 3.0.8", "OPENSSLDIR: /etc/ssl", "ENGINESDIR: /usr/lib/engines"],
    )
    assert len(results) == 1
    ev = results[0]
    assert ev.library_id == "openssl"
    assert ev.confidence == "low"
    assert "STRING" in ev.signal_categories
    assert "LIBRARY" not in ev.signal_categories
    assert "SYMBOL" not in ev.signal_categories


# ---------------------------------------------------------------------------
# Test All 10 Target Cryptographic Libraries
# ---------------------------------------------------------------------------

def test_fingerprint_openssl(fingerprinter):
    symbols = make_symbols(["EVP_CIPHER_CTX_new", "OSSL_PROVIDER_load", "X509_verify_cert"])
    strings = ["OpenSSL 3.1.2", "OPENSSLDIR: /usr/local/ssl"]
    libs = ["libcrypto.so.3", "libssl.so.3"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "openssl")
    assert ev.confidence == "high"
    assert "LIBRARY" in ev.signal_categories
    assert "SYMBOL" in ev.signal_categories
    assert "STRING" in ev.signal_categories
    assert "libcrypto.so.3" in ev.matched_libraries
    assert "OSSL_PROVIDER_load" in ev.matched_symbols
    assert ev.version_hint == "3.1.2"


def test_fingerprint_boringssl_and_disambiguation(fingerprinter):
    # BoringSSL shares OpenSSL-like EVP symbols but has distinct BoringSSL markers
    symbols = make_symbols(["EVP_EncryptInit_ex", "BORINGSSL_bcm_power_on_self_test", "CRYPTO_library_init"])
    strings = ["BORINGSSL_bcm_power_on_self_test", "BoringSSL"]
    libs = ["libboringssl.so"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    # BoringSSL must be detected
    bssl = next(r for r in results if r.library_id == "boringssl")
    assert bssl.confidence == "high"
    assert "BORINGSSL_bcm_power_on_self_test" in bssl.matched_symbols

    # Generic OpenSSL must be suppressed / disambiguated
    openssl_matches = [r for r in results if r.library_id == "openssl"]
    assert len(openssl_matches) == 0


def test_fingerprint_libressl_and_disambiguation(fingerprinter):
    symbols = make_symbols(["tls_init", "tls_config_new", "tls_connect"])
    strings = ["LIBRESSL_VERSION_TEXT", "LibreSSL 3.8.1"]
    libs = ["libtls.so.26"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    lssl = next(r for r in results if r.library_id == "libressl")
    assert lssl.confidence == "high"
    assert "tls_init" in lssl.matched_symbols
    assert lssl.version_hint == "3.8.1"

    # OpenSSL must not falsely claim LibreSSL binary
    openssl_matches = [r for r in results if r.library_id == "openssl"]
    assert len(openssl_matches) == 0


def test_fingerprint_mbedtls(fingerprinter):
    symbols = make_symbols(["mbedtls_ssl_init", "mbedtls_aes_crypt_cbc", "mbedtls_sha256"])
    strings = ["mbed TLS 3.5.0", "MBEDTLS_ERR_SSL_WANT_READ"]
    libs = ["libmbedtls.so.14", "libmbedcrypto.so.7"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "mbedtls")
    assert ev.confidence == "high"
    assert "mbedtls_ssl_init" in ev.matched_symbols
    assert "libmbedtls.so.14" in ev.matched_libraries


def test_fingerprint_wolfssl(fingerprinter):
    symbols = make_symbols(["wolfSSL_Init", "wc_InitSha256", "wc_AesCbcEncrypt"])
    strings = ["wolfSSL version 5.6.4", "www.wolfssl.com"]
    libs = ["libwolfssl.so"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "wolfssl")
    assert ev.confidence == "high"
    assert "wolfSSL_Init" in ev.matched_symbols
    assert ev.version_hint == "5.6.4"


def test_fingerprint_botan(fingerprinter):
    symbols = make_symbols(["_ZN5Botan11Cipher_Mode4makeERKNSt7__cxx1112basic_stringIcEE", "botan_cipher_init"])
    strings = ["Botan 3.2.0", "Botan::BlockCipher"]
    libs = ["libbotan-3.so.3"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "botan")
    assert ev.confidence == "high"
    assert "botan_cipher_init" in ev.matched_symbols
    assert ev.version_hint == "3.2.0"


def test_fingerprint_libsodium(fingerprinter):
    symbols = make_symbols(["sodium_init", "crypto_box_easy", "crypto_secretbox_easy"])
    strings = ["sodium_version_string", "sodium_init() failed"]
    libs = ["libsodium.so.23"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "libsodium")
    assert ev.confidence == "high"
    assert "sodium_init" in ev.matched_symbols
    assert "libsodium.so.23" in ev.matched_libraries


def test_fingerprint_jca_jce(fingerprinter):
    symbols = make_symbols([
        "Java_sun_security_ec_ECDHKeyAgreement_deriveKey",
        "org/bouncycastle/jce/provider/BouncyCastleProvider",
    ])
    strings = ["org.bouncycastle.jce.provider.BouncyCastleProvider", "SunJCE Provider"]
    libs = ["bcprov-jdk18on-1.77.jar", "libsunec.so"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "jca_jce")
    assert ev.confidence == "high"
    assert "org/bouncycastle/jce/provider/BouncyCastleProvider" in ev.matched_symbols
    assert "bcprov-jdk18on-1.77.jar" in ev.matched_libraries


def test_fingerprint_windows_cng(fingerprinter):
    symbols = make_symbols([
        "BCryptOpenAlgorithmProvider",
        "BCryptEncrypt",
        "NCryptOpenStorageProvider",
    ])
    strings = ["Microsoft Software Key Storage Provider", "MS_ENH_RSA_AES_PROV"]
    libs = ["bcrypt.dll", "ncrypt.dll"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "windows_cng")
    assert ev.confidence == "high"
    assert "BCryptOpenAlgorithmProvider" in ev.matched_symbols
    assert "bcrypt.dll" in ev.matched_libraries


def test_fingerprint_apple_security(fingerprinter):
    symbols = make_symbols(["CCCrypt", "SecKeyEncrypt", "CC_SHA256_Init"])
    strings = ["Apple CommonCrypto", "com.apple.security"]
    libs = ["libcommonCrypto.dylib", "Security.framework"]

    results = fingerprinter.fingerprint(libs, symbols, strings)
    assert len(results) >= 1
    ev = next(r for r in results if r.library_id == "apple_security")
    assert ev.confidence == "high"
    assert "CCCrypt" in ev.matched_symbols
    assert "libcommonCrypto.dylib" in ev.matched_libraries
