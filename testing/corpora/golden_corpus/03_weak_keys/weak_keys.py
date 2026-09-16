"""
Category: Weak Keys (Phase 22.3 Golden Corpus)
Contains insufficient key lengths:
- RSA 512-bit (Factoring attack practical in hours)
- RSA 1024-bit (Deprecated by NIST SP 800-131A, below 112 bits of security)
- ECC with short curves (< 224 bits, e.g., secp160r1)
- Symmetric key < 128 bits
"""

from cryptography.hazmat.primitives.asymmetric import rsa, ec


def generate_short_rsa_keys():
    """Generates dangerously weak 512-bit and 1024-bit RSA keys."""
    # 512-bit RSA
    key_512 = rsa.generate_private_key(
        public_exponent=65537,
        key_size=512,
    )

    # 1024-bit RSA
    key_1024 = rsa.generate_private_key(
        public_exponent=65537,
        key_size=1024,
    )
    return key_512, key_1024


def generate_short_ecc_key():
    """Generates weak elliptic curve key on secp160r1 curve."""
    key_ecc_160 = ec.generate_private_key(ec.SECP160R1())
    return key_ecc_160
