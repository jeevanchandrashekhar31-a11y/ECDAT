// @ecdat-synthetic-corpus
/**
 * Golden Corpus Fixture: 03_weak_keys/weak_keys.c
 * Category: 03_weak_keys
 * C implementation of deprecated and weak asymmetric key sizes using OpenSSL:
 * - RSA 512-bit (dangerously weak)
 * - RSA 1024-bit (deprecated, vulnerable to factorization)
 */

#include <openssl/rsa.h>
#include <openssl/bn.h>

RSA* generate_insecure_512_rsa() {
    BIGNUM* e = BN_new();
    BN_set_word(e, RSA_F4);
    RSA* rsa = RSA_new();
    // Vulnerable: 512-bit RSA key
    RSA_generate_key_ex(rsa, 512, e, NULL);
    BN_free(e);
    return rsa;
}

RSA* generate_deprecated_1024_rsa() {
    BIGNUM* e = BN_new();
    BN_set_word(e, RSA_F4);
    RSA* rsa = RSA_new();
    // Deprecated: 1024-bit RSA key
    RSA_generate_key_ex(rsa, 1024, e, NULL);
    BN_free(e);
    return rsa;
}
