"""
Category: Algorithm Aliases (Phase 22.3 Golden Corpus)
Contains algorithm names represented via standardized and vendor-specific aliases:
- Rijndael-128 / Rijndael-256 (Canonical AES name)
- TripleDES / DESede (3DES aliases)
- SHA256withRSA (Combined signature alias)
- ECDSA_P256 (Elliptic curve signature alias)
"""

ALGORITHM_ALIAS_MAP = {
    "Rijndael": "AES",
    "Rijndael-128": "AES-128",
    "Rijndael-256": "AES-256",
    "TripleDES": "3DES",
    "DESede": "3DES",
    "SHA256withRSA": "RSA-SHA256",
    "ECDSA_P256": "ECDSA-secp256r1",
}


def lookup_crypto_alias(alias_name: str) -> str:
    """Resolves algorithm alias to canonical name."""
    return ALGORITHM_ALIAS_MAP.get(alias_name, alias_name)
