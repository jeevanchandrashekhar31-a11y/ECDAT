// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_0(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_1(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_2(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_3(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_4(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_5(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_6(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_7(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_8(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}

// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_128_9(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}
