"""
Category: Post-Quantum Cryptography (PQC) Examples (Phase 22.3 Golden Corpus)
Contains quantum-resistant cryptographic primitives standardized by NIST:
- ML-KEM / CRYSTALS-Kyber (FIPS 203 Key Encapsulation Mechanism)
- ML-DSA / CRYSTALS-Dilithium (FIPS 204 Digital Signature Algorithm)
- SLH-DSA / SPHINCS+ (FIPS 205 Stateless Hash-Based Signature)
- Falcon (Lattice-based digital signature)
"""


class MockOqsKem:
    def __init__(self, kem_name: str):
        self.kem_name = kem_name  # e.g., "Kyber512", "Kyber768", "Kyber1024", "ML-KEM-768"

    def keypair(self) -> tuple:
        return b"pqc_public_key", b"pqc_private_key"

    def encap(self, public_key: bytes) -> tuple:
        return b"ciphertext", b"shared_secret"


class MockOqsSig:
    def __init__(self, sig_name: str):
        self.sig_name = sig_name  # e.g., "Dilithium2", "Dilithium3", "Dilithium5", "ML-DSA-65", "SPHINCS+"

    def keypair(self) -> tuple:
        return b"pqc_sig_pub", b"pqc_sig_priv"

    def sign(self, message: bytes, private_key: bytes) -> bytes:
        return b"pqc_signature"


def demonstrate_nist_pqc():
    """Demonstrates primary NIST PQC algorithms."""
    # 1. Key Encapsulation (ML-KEM / Kyber-768)
    kem_kyber768 = MockOqsKem("Kyber768")
    pub_kem, priv_kem = kem_kyber768.keypair()
    ct, ss = kem_kyber768.encap(pub_kem)

    # 2. Digital Signatures (ML-DSA / Dilithium-3)
    sig_dilithium = MockOqsSig("Dilithium3")
    pub_sig, priv_sig = sig_dilithium.keypair()
    signature = sig_dilithium.sign(b"Document signed with ML-DSA", priv_sig)

    # 3. Hash-Based Signature (SLH-DSA / SPHINCS+)
    sig_sphincs = MockOqsSig("SPHINCS+")
    pub_sp, priv_sp = sig_sphincs.keypair()

    # 4. Falcon signature
    sig_falcon = MockOqsSig("Falcon-512")

    return {
        "kem": kem_kyber768.kem_name,
        "sig": sig_dilithium.sig_name,
        "hash_sig": sig_sphincs.sig_name,
        "falcon": sig_falcon.sig_name,
    }
