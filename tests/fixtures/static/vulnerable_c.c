// Comprehensive Insecure C Test Fixture (Phase 2.6)
#include <stdio.h>
#include <stdlib.h>
#include <openssl/evp.h>
#include <openssl/rsa.h>
#include <openssl/ec.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <mbedtls/md5.h>
#include <mbedtls/ssl.h>
#include <wolfssl/ssl.h>
#include <wolfssl/wolfcrypt/md5.h>

#define WEAK_RSA_KEY_SIZE 1024

void test_openssl_insecure() {
    // 1. Weak Hashes: EVP & Direct
    const EVP_MD *md_md5 = EVP_md5();
    const EVP_MD *md_sha1 = EVP_sha1();
    MD5(NULL, 0, NULL);
    SHA1(NULL, 0, NULL);

    // 2. Insecure Ciphers & Modes
    const EVP_CIPHER *cipher_des = EVP_des_cbc();
    const EVP_CIPHER *cipher_rc4 = EVP_rc4();
    const EVP_CIPHER *cipher_bf = EVP_bf_cbc();
    const EVP_CIPHER *cipher_ecb = EVP_aes_128_ecb();

    // 3. Weak RSA Key Size & Weak Curve
    RSA *rsa = RSA_new();
    RSA_generate_key_ex(rsa, WEAK_RSA_KEY_SIZE, NULL, NULL);
    EC_KEY *ec = EC_KEY_new_by_curve_name(NID_secp224k1);

    // 4. Insecure TLS Configuration
    SSL_CTX *ctx = SSL_CTX_new(TLS_method());
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, NULL);
    SSL_CTX_set_min_proto_version(ctx, TLS1_VERSION);
    SSL_CTX_set_cipher_list(ctx, "RC4:3DES:DES");

    // 5. Weak Certificate Signature Algorithm
    X509 *cert = X509_new();
    EVP_PKEY *pkey = EVP_PKEY_new();
    X509_sign(cert, pkey, EVP_md5());
}

void test_mbedtls_and_wolfssl() {
    // 6. mbedTLS weak functions
    mbedtls_md5_context md5_ctx;
    mbedtls_md5_starts(&md5_ctx);

    mbedtls_ssl_config conf;
    mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_NONE);

    // 7. wolfSSL weak functions
    wc_Md5Hash(NULL, 0, NULL);
    WOLFSSL_CTX *wctx = wolfSSL_CTX_new(wolfTLSv1_2_client_method());
    wolfSSL_CTX_set_verify(wctx, WOLFSSL_VERIFY_NONE, NULL);
}

int main() {
    test_openssl_insecure();
    test_mbedtls_and_wolfssl();
    return 0;
}
