// Clean Secure C Test Fixture (Phase 2.6)
#include <stdio.h>
#include <openssl/evp.h>
#include <openssl/rsa.h>
#include <openssl/ec.h>
#include <openssl/ssl.h>
#include <sodium.h>

void safe_crypto_operations() {
    // 1. Secure OpenSSL Hashes
    const EVP_MD *md256 = EVP_sha256();
    const EVP_MD *md512 = EVP_sha512();

    // 2. Modern AEAD Ciphers
    const EVP_CIPHER *gcm = EVP_aes_256_gcm();

    // 3. Strong RSA (4096) & Classical P-256 Curve
    RSA *rsa = RSA_new();
    RSA_generate_key_ex(rsa, 4096, NULL, NULL);
    EC_KEY *ec = EC_KEY_new_by_curve_name(NID_X9_62_prime256v1);

    // 4. Secure TLS 1.3 Configuration
    SSL_CTX *ctx = SSL_CTX_new(TLS_method());
    SSL_CTX_set_min_proto_version(ctx, TLS1_3_VERSION);

    // 5. libsodium Modern Cryptography
    crypto_secretbox_easy(NULL, NULL, 0, NULL, NULL);
    crypto_aead_chacha20poly1305_ietf_encrypt(NULL, NULL, NULL, 0, NULL, 0, NULL, NULL, NULL);
    crypto_sign_ed25519(NULL, NULL, NULL, 0, NULL);
}

int main() {
    safe_crypto_operations();
    return 0;
}
