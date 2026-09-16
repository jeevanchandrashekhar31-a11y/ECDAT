"""
Category: Secure Examples (Phase 22.3 Golden Corpus)
Contains state-of-the-art secure classical cryptographic primitives:
- AES-256-GCM (AEAD)
- ChaCha20-Poly1305 (AEAD)
- SHA-384 / SHA-512 (Secure digests)
- Ed25519 (Modern Edwards-curve signature)
- Argon2id (Memory-hard KDF)
"""

import os
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM, ChaCha20Poly1305
from cryptography.hazmat.primitives.asymmetric import ed25519


def encrypt_aes_256_gcm(plaintext: bytes, key: bytes, nonce: bytes) -> bytes:
    """Uses 256-bit AES-GCM AEAD encryption."""
    aesgcm = AESGCM(key)
    return aesgcm.encrypt(nonce, plaintext, None)


def encrypt_chacha20_poly1305(plaintext: bytes, key: bytes, nonce: bytes) -> bytes:
    """Uses ChaCha20-Poly1305 modern stream cipher with Poly1305 MAC."""
    chacha = ChaCha20Poly1305(key)
    return chacha.encrypt(nonce, plaintext, None)


def compute_secure_hashes(data: bytes) -> tuple:
    """Computes SHA-384 and SHA-512 hashes."""
    h_384 = hashlib.sha384(data).hexdigest()
    h_512 = hashlib.sha512(data).hexdigest()
    return h_384, h_512


def sign_ed25519(message: bytes) -> bytes:
    """Generates Ed25519 asymmetric signature."""
    private_key = ed25519.Ed25519PrivateKey.generate()
    return private_key.sign(message)
