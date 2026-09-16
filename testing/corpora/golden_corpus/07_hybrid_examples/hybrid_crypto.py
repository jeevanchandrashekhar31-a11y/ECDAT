"""
Category: Hybrid Cryptography Examples (Phase 22.3 Golden Corpus)
Contains hybrid schemes combining classical and post-quantum cryptography:
- X25519Kyber768Draft00 (IETF Draft Hybrid KEM standard)
- SecP256r1Kyber768 (NIST curve P-256 + Kyber-768)
- Dual-Signature schemes (ECDSA + ML-DSA dual verification)
"""

import hashlib
from cryptography.hazmat.primitives.asymmetric import x25519, ec


class HybridKEM_X25519_Kyber768:
    """
    Implements X25519 + Kyber-768 hybrid key agreement.
    Derives combined shared secret: HKDF(classical_secret || pqc_secret).
    """

    def __init__(self):
        self.algorithm_name = "X25519Kyber768Draft00"
        self.is_hybrid = True
        self.classical_part = "X25519"
        self.pqc_part = "Kyber768"

    def encapsulate(self) -> dict:
        classical_priv = x25519.X25519PrivateKey.generate()
        classical_pub = classical_priv.public_key()
        pqc_ct = b"pqc_kyber768_ciphertext_1088_bytes"
        return {
            "algorithm": self.algorithm_name,
            "classical_public": classical_pub,
            "pqc_ciphertext": pqc_ct,
        }


class HybridSig_ECDSA_Dilithium:
    """Dual signature requiring valid signatures from both ECDSA P-256 and Dilithium-3."""

    def __init__(self):
        self.algorithm_name = "ECDSA_P256_Dilithium3_Hybrid"
        self.is_hybrid = True

    def sign_both(self, message: bytes) -> dict:
        return {
            "classical_sig": b"ecdsa_p256_der_sig",
            "pqc_sig": b"dilithium3_raw_sig",
            "hybrid_scheme": self.algorithm_name,
        }
