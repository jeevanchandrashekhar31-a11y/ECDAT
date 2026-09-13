const test = require("node:test");
const assert = require("node:assert");
const { LibraryFingerprinter } = require("../../src/binary/library_fingerprinter");

test("Library Fingerprinting - Invariant: Single string match is rejected as inconclusive", () => {
  const fp = new LibraryFingerprinter();
  const singleStrings = [
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
  ];

  for (const s of singleStrings) {
    const results = fp.fingerprint([], [], [s]);
    assert.strictEqual(
      results.length,
      0,
      `Single string '${s}' must not produce a positive fingerprint`
    );
  }
});

test("Library Fingerprinting - Multiple strings without symbols yields LOW confidence", () => {
  const fp = new LibraryFingerprinter();
  const results = fp.fingerprint(
    [],
    [],
    ["OpenSSL 3.0.8", "OPENSSLDIR: /etc/ssl", "ENGINESDIR: /usr/lib/engines"]
  );
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].library_id, "openssl");
  assert.strictEqual(results[0].confidence, "low");
  assert.ok(results[0].signal_categories.includes("STRING"));
  assert.ok(!results[0].signal_categories.includes("LIBRARY"));
});

test("Library Fingerprinting - OpenSSL positive multi-signal detection", () => {
  const fp = new LibraryFingerprinter();
  const results = fp.fingerprint(
    ["libcrypto.so.3", "libssl.so.3"],
    ["EVP_CIPHER_CTX_new", "OSSL_PROVIDER_load", "X509_verify_cert"],
    ["OpenSSL 3.1.2", "OPENSSLDIR: /usr/local/ssl"]
  );
  assert.ok(results.length >= 1);
  const ev = results.find((r) => r.library_id === "openssl");
  assert.ok(ev);
  assert.strictEqual(ev.confidence, "high");
  assert.ok(ev.signal_categories.includes("LIBRARY"));
  assert.ok(ev.signal_categories.includes("SYMBOL"));
  assert.ok(ev.signal_categories.includes("STRING"));
});

test("Library Fingerprinting - BoringSSL disambiguation from OpenSSL", () => {
  const fp = new LibraryFingerprinter();
  const results = fp.fingerprint(
    ["libboringssl.so"],
    ["EVP_EncryptInit_ex", "BORINGSSL_bcm_power_on_self_test", "CRYPTO_library_init"],
    ["BORINGSSL_bcm_power_on_self_test", "BoringSSL"]
  );
  assert.ok(results.length >= 1);
  const bssl = results.find((r) => r.library_id === "boringssl");
  assert.ok(bssl);
  assert.strictEqual(bssl.confidence, "high");

  const openssl = results.find((r) => r.library_id === "openssl");
  assert.strictEqual(openssl, undefined, "OpenSSL must be suppressed when BoringSSL matches");
});

test("Library Fingerprinting - LibreSSL disambiguation from OpenSSL", () => {
  const fp = new LibraryFingerprinter();
  const results = fp.fingerprint(
    ["libtls.so.26"],
    ["tls_init", "tls_config_new", "tls_connect"],
    ["LIBRESSL_VERSION_TEXT", "LibreSSL 3.8.1"]
  );
  assert.ok(results.length >= 1);
  const lssl = results.find((r) => r.library_id === "libressl");
  assert.ok(lssl);
  assert.strictEqual(lssl.confidence, "high");

  const openssl = results.find((r) => r.library_id === "openssl");
  assert.strictEqual(openssl, undefined, "OpenSSL must be suppressed when LibreSSL matches");
});

test("Library Fingerprinting - mbedTLS, wolfSSL, Botan, libsodium", () => {
  const fp = new LibraryFingerprinter();

  // mbedTLS
  const mbedRes = fp.fingerprint(
    ["libmbedtls.so.14"],
    ["mbedtls_ssl_init", "mbedtls_aes_crypt_cbc"],
    ["mbed TLS 3.5.0", "MBEDTLS_ERR_SSL_WANT_READ"]
  );
  assert.ok(mbedRes.some((r) => r.library_id === "mbedtls" && r.confidence === "high"));

  // wolfSSL
  const wolfRes = fp.fingerprint(
    ["libwolfssl.so"],
    ["wolfSSL_Init", "wc_InitSha256"],
    ["wolfSSL version 5.6.4", "www.wolfssl.com"]
  );
  assert.ok(wolfRes.some((r) => r.library_id === "wolfssl" && r.confidence === "high"));

  // Botan
  const botanRes = fp.fingerprint(
    ["libbotan-3.so.3"],
    ["botan_cipher_init", "_ZN5Botan"],
    ["Botan 3.2.0", "Botan::BlockCipher"]
  );
  assert.ok(botanRes.some((r) => r.library_id === "botan" && r.confidence === "high"));

  // libsodium
  const sodiumRes = fp.fingerprint(
    ["libsodium.so.23"],
    ["sodium_init", "crypto_box_easy"],
    ["sodium_version_string", "sodium_init() failed"]
  );
  assert.ok(sodiumRes.some((r) => r.library_id === "libsodium" && r.confidence === "high"));
});

test("Library Fingerprinting - JCA/JCE, Windows CNG, Apple Security", () => {
  const fp = new LibraryFingerprinter();

  // JCA/JCE
  const jcaRes = fp.fingerprint(
    ["bcprov-jdk18on-1.77.jar"],
    ["org/bouncycastle/jce/provider/BouncyCastleProvider", "Java_sun_security_ec_ECDHKeyAgreement_deriveKey"],
    ["org.bouncycastle.jce.provider.BouncyCastleProvider", "SunJCE Provider"]
  );
  assert.ok(jcaRes.some((r) => r.library_id === "jca_jce" && r.confidence === "high"));

  // Windows CNG
  const winRes = fp.fingerprint(
    ["bcrypt.dll", "ncrypt.dll"],
    ["BCryptOpenAlgorithmProvider", "NCryptOpenStorageProvider"],
    ["Microsoft Software Key Storage Provider", "MS_ENH_RSA_AES_PROV"]
  );
  assert.ok(winRes.some((r) => r.library_id === "windows_cng" && r.confidence === "high"));

  // Apple Security
  const appleRes = fp.fingerprint(
    ["libcommonCrypto.dylib", "Security.framework"],
    ["CCCrypt", "SecKeyEncrypt"],
    ["Apple CommonCrypto", "com.apple.security"]
  );
  assert.ok(appleRes.some((r) => r.library_id === "apple_security" && r.confidence === "high"));
});
