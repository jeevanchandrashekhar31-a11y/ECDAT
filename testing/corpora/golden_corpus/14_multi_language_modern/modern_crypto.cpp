// @ecdat-synthetic-corpus
/**
 * Golden Corpus Fixture: 14_multi_language_modern/modern_crypto.cpp
 * Category: 14_multi_language_modern
 * Modern C++ cryptographic implementations:
 * - OpenSSL 3.0 EVP_aes_256_gcm()
 * - SHA-384 message digest via EVP_sha384()
 * - Ed25519 public key algorithm
 */

#include <openssl/evp.h>
#include <openssl/rand.h>
#include <memory>
#include <vector>

class ModernCryptoProvider {
public:
    static bool EncryptAes256Gcm(
        const unsigned char* plaintext, int plaintext_len,
        const unsigned char* key, const unsigned char* iv,
        unsigned char* ciphertext, unsigned char* tag) 
    {
        std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> ctx(
            EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
        if (!ctx) return false;

        if (EVP_EncryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1) return false;
        if (EVP_EncryptInit_ex(ctx.get(), nullptr, nullptr, key, iv) != 1) return false;

        int len = 0;
        if (EVP_EncryptUpdate(ctx.get(), ciphertext, &len, plaintext, plaintext_len) != 1) return false;
        int ciphertext_len = len;

        if (EVP_EncryptFinal_ex(ctx.get(), ciphertext + len, &len) != 1) return false;
        if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_GET_TAG, 16, tag) != 1) return false;

        return true;
    }

    static bool ComputeSha384(const unsigned char* data, size_t data_len, unsigned char* md_value) {
        unsigned int md_len = 0;
        std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> md_ctx(
            EVP_MD_CTX_new(), EVP_MD_CTX_free);
        if (!md_ctx) return false;

        if (EVP_DigestInit_ex(md_ctx.get(), EVP_sha384(), nullptr) != 1) return false;
        if (EVP_DigestUpdate(md_ctx.get(), data, data_len) != 1) return false;
        if (EVP_DigestFinal_ex(md_ctx.get(), md_value, &md_len) != 1) return false;

        return true;
    }
};
