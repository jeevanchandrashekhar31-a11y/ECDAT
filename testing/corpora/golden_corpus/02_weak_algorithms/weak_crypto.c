/*
 * Category: Weak Algorithms (Phase 22.3 Golden Corpus)
 * C / OpenSSL legacy calls:
 * - MD5_Init
 * - SHA1_Init
 * - DES_ecb_encrypt
 * - RC4
 */

#include <stdio.h>
#include <openssl/md5.h>
#include <openssl/sha.h>
#include <openssl/des.h>
#include <openssl/rc4.h>

void perform_legacy_crypto(const unsigned char *data, size_t len) {
    // 1. MD5 Digest
    MD5_CTX md5_ctx;
    unsigned char md5_out[MD5_DIGEST_LENGTH];
    MD5_Init(&md5_ctx);
    MD5_Update(&md5_ctx, data, len);
    MD5_Final(md5_out, &md5_ctx);

    // 2. SHA-1 Digest
    SHA_CTX sha1_ctx;
    unsigned char sha1_out[SHA_DIGEST_LENGTH];
    SHA1_Init(&sha1_ctx);
    SHA1_Update(&sha1_ctx, data, len);
    SHA1_Final(sha1_out, &sha1_ctx);

    // 3. Single DES
    DES_key_schedule schedule;
    DES_cblock key = {0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef};
    DES_set_key(&key, &schedule);

    // 4. RC4 Stream
    RC4_KEY rc4_key;
    RC4_set_key(&rc4_key, 16, key);
}
