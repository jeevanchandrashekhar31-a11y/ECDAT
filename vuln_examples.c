/* Synthetic test file — deliberate crypto weaknesses for scanner validation.
 * API calls modeled on real OpenSSL usage patterns. */
#include <openssl/md5.h>
#include <openssl/sha.h>
#include <openssl/rsa.h>
#include <openssl/evp.h>

/* --- MD5 usage (legacy + EVP interface) --- */
void hash_password_legacy(const char *pw) {
    unsigned char digest[MD5_DIGEST_LENGTH];
    MD5((unsigned char *)pw, strlen(pw), digest);
}

void hash_password_evp(void) {
    const EVP_MD *md = EVP_md5();
    (void)md;
}

/* --- SHA-1 usage --- */
void sign_legacy_data(const unsigned char *data, size_t len) {
    unsigned char digest[SHA_DIGEST_LENGTH];
    SHA1(data, len, digest);
}

/* --- Weak RSA key generation --- */
RSA *make_weak_key(void) {
    RSA *rsa = RSA_generate_key(1024, RSA_F4, NULL, NULL);
    return rsa;
}

int make_weak_key_ex(RSA *rsa) {
    return RSA_generate_key_ex(rsa, 512, NULL, NULL);
}

/* --- Acceptable RSA size, still quantum-critical (should be flagged, level 0) --- */
RSA *make_strong_classical_key(RSA *rsa, BIGNUM *e, BN_GENCB *cb) {
    RSA_generate_key_ex(rsa, 4096, e, cb);
    return rsa;
}

/* --- Non-literal RSA key size --- */
#define MY_KEY_BITS 2048
RSA *make_macro_size_key(RSA *rsa, BIGNUM *e, BN_GENCB *cb) {
    RSA_generate_key_ex(rsa, MY_KEY_BITS, e, cb);
    return rsa;
}

/* --- EC/DH Key Generation --- */
void make_ec_key(void) {
    EC_KEY *key = EC_KEY_generate_key(NULL);
    (void)key;
}

void make_dh_key(DH *dh) {
    DH_generate_key(dh);
}

void make_ec_param_ctx(EVP_PKEY_CTX *ctx, int nid) {
    EVP_PKEY_CTX_set_ec_paramgen_curve_nid(ctx, nid);
}

void make_dh_params(DH *dh, int prime_len, int generator, BN_GENCB *cb) {
    DH_generate_parameters_ex(dh, prime_len, generator, cb);
}

/* --- Hardcoded private key material --- */
static const char *EMBEDDED_KEY =
"-----BEGIN RSA PRIVATE KEY-----\n"
"MIIEpAIBAAKCAQEA1c7+9z5Pad7OejecsQ0bu3aumqCkGVfnQ7CS1UQwoDXcyLYt\n"
"-----END RSA PRIVATE KEY-----\n";

/* --- Clean / acceptable crypto usage (should NOT be flagged) --- */
void safe_hash(const unsigned char *data, size_t len, unsigned char *out) {
    const EVP_MD *md = EVP_sha256();
    (void)md; (void)data; (void)len; (void)out;
}
