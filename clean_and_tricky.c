#include <openssl/evp.h>
#include <openssl/rsa.h>

/* This comment mentions MD5 and SHA1 and RSA_generate_key(1024, ...) but is NOT code. */

/* Near-miss identifiers that should NOT trigger a match */
int MD5Checksum(void) { return 0; }          /* not a call to MD5( */
int compute_md5sum_wrapper(void) { return 1; } /* lowercase, different call */
void SHA1_variant_name_used_elsewhere(void) {}  /* no literal SHA1( call */

/* Strong, modern crypto usage — should be found as algorithm but not "weak" */
void safe_key_setup(RSA *rsa, BIGNUM *e, BN_GENCB *cb) {
    RSA_generate_key_ex(rsa, 3072, e, cb);
}

void safe_hash(void) {
    const EVP_MD *md = EVP_sha256();
    (void)md;
}
