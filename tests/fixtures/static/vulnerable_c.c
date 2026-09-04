#include <stdio.h>
#include <stdlib.h>
#include <openssl/evp.h>

void safe_crypto() {
    EVP_MD_CTX *mdctx = EVP_MD_CTX_new();
    const EVP_MD *md = EVP_sha256();
    EVP_DigestInit_ex(mdctx, md, NULL);
    // secure
}

void weak_crypto() {
    EVP_MD_CTX *mdctx = EVP_MD_CTX_new();
    const EVP_MD *md = EVP_md5(); // vulnerable
    EVP_DigestInit_ex(mdctx, md, NULL);
}

int main() {
    weak_crypto();
    return 0;
}
