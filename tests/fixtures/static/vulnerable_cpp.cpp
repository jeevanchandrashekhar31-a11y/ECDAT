// Comprehensive Insecure C++ Test Fixture (Phase 2.6)
#include <iostream>
#include <string>
#include <openssl/ssl.h>
#include <botan/hash.h>
#include <botan/cipher_mode.h>
#include <botan/rsa.h>
#include <botan/auto_rng.h>

void botan_insecure_calls() {
    Botan::AutoSeeded_RNG rng;

    // 1. Weak Botan Hashes
    auto md5_hash = Botan::HashFunction::create("MD5");
    auto sha1_hash = Botan::HashFunction::create("SHA-1");

    // 2. Weak Botan Ciphers & Modes
    auto des_cipher = Botan::Cipher_Mode::create("DES/CBC", Botan::Cipher_Dir::Encryption);
    auto ecb_cipher = Botan::Cipher_Mode::create("AES-128/ECB", Botan::Cipher_Dir::Encryption);

    // 3. Weak RSA Key Size (1024)
    Botan::RSA_PrivateKey weak_rsa(rng, 1024);

    // 4. Insecure OpenSSL C++ Context
    SSL_CTX *ctx = SSL_CTX_new(TLS_method());
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, nullptr);
}

int main() {
    botan_insecure_calls();
    return 0;
}
