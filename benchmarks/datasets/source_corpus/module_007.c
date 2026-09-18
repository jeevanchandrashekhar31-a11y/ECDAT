// @ecdat-synthetic-corpus
#include <openssl/evp.h>
#include <openssl/aes.h>

int encrypt_aes_gcm_7_0(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_1(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_2(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_3(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_4(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_5(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_6(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_7(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_8(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
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

int encrypt_aes_gcm_7_9(const unsigned char *plaintext, int len, const unsigned char *key, const unsigned char *iv, unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, iv);
    int outlen = 0;
    EVP_EncryptUpdate(ctx, ciphertext, &outlen, plaintext, len);
    EVP_EncryptFinal_ex(ctx, ciphertext + outlen, &outlen);
    EVP_CIPHER_CTX_free(ctx);
    return outlen;
}
