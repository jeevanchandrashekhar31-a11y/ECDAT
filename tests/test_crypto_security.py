"""
Phase 22 (P1) Cryptographic Security & PQC Classification Tests (Python)

Verifies:
- Approved algorithms;
- Secure randomness;
- Secure key generation;
- Key separation;
- Authenticated encryption;
- Secure hashing;
- Password hashing;
- Constant-time comparisons where relevant;
- Secure key storage;
- Zeroization where practical;
- No hardcoded production secrets.

Explicitly classifies algorithms:
- quantum-vulnerable
- quantum-resistant
- hybrid
- unknown

Ensures PQC security is NOT inferred solely from algorithm names.
"""

import pytest
import hashlib
import hmac
import os
import secrets

from scanners.common.crypto_classifier import (
    CryptoClassifier,
    CLASS_QUANTUM_VULNERABLE,
    CLASS_QUANTUM_RESISTANT,
    CLASS_HYBRID,
    CLASS_UNKNOWN,
)
from scanners.common.crypto_audit import (
    CryptoSecurityAuditor,
    zeroize_buffer,
    hkdf_extract_and_expand,
    KEY_DOMAINS,
)


class TestCryptoClassifier:
    """Tests for the 4-class PQC Cryptographic Classifier."""

    def test_shor_vulnerable_asymmetric_algorithms(self):
        """Asymmetric algorithms broken by Shor's algorithm must be classified as quantum-vulnerable."""
        shor_test_cases = [
            ("RSA", 2048),
            ("RSA-4096", 4096),
            ("ECDSA", 256),
            ("ECDSA-P384", 384),
            ("ECDH", 256),
            ("Ed25519", 256),
            ("X25519", 256),
            ("Diffie-Hellman", 2048),
            ("DSA", 2048),
            ("ElGamal", 2048),
        ]

        for algo, ksize in shor_test_cases:
            res = CryptoClassifier.classify(algo, key_size=ksize)
            assert res.classification == CLASS_QUANTUM_VULNERABLE, f"Failed for {algo}"
            assert res.threat_model == "Shor"
            assert "Shor's algorithm" in res.justification

    def test_does_not_infer_pqc_solely_from_name_aes(self):
        """
        CRITICAL: Verifies that algorithm names alone do not determine PQC status.
        AES-128 is Grover-vulnerable (quantum-vulnerable).
        AES-256 provides 128-bit quantum security (quantum-resistant).
        """
        # AES-128 has 64-bit quantum security -> quantum-vulnerable
        res_128 = CryptoClassifier.classify("AES-128-GCM", key_size=128)
        assert res_128.classification == CLASS_QUANTUM_VULNERABLE
        assert res_128.threat_model == "Grover"
        assert "Grover's algorithm" in res_128.justification
        assert "64" in res_128.justification

        # AES-256 has 128-bit quantum security -> quantum-resistant
        res_256 = CryptoClassifier.classify("AES-256-GCM", key_size=256)
        assert res_256.classification == CLASS_QUANTUM_RESISTANT
        assert res_256.threat_model == "Grover"
        assert "128" in res_256.justification

        # Generic "AES" with missing key size cannot be guessed -> unknown
        res_bare = CryptoClassifier.classify("AES")
        assert res_bare.classification == CLASS_UNKNOWN
        assert "lacks key size" in res_bare.justification

    def test_verified_pqc_standards_classified_as_quantum_resistant(self):
        """Standardized NIST PQC algorithms with verified parameters are quantum-resistant."""
        # FIPS 203 ML-KEM
        mlkem512 = CryptoClassifier.classify("ML-KEM-512")
        assert mlkem512.classification == CLASS_QUANTUM_RESISTANT
        assert mlkem512.nist_pqc_category == 1

        mlkem768 = CryptoClassifier.classify("ML-KEM-768")
        assert mlkem768.classification == CLASS_QUANTUM_RESISTANT
        assert mlkem768.nist_pqc_category == 3

        mlkem1024 = CryptoClassifier.classify("ML-KEM-1024")
        assert mlkem1024.classification == CLASS_QUANTUM_RESISTANT
        assert mlkem1024.nist_pqc_category == 5

        # FIPS 204 ML-DSA
        mldsa65 = CryptoClassifier.classify("ML-DSA-65")
        assert mldsa65.classification == CLASS_QUANTUM_RESISTANT
        assert mldsa65.nist_pqc_category == 3

        # FIPS 205 SLH-DSA
        slhdsa = CryptoClassifier.classify("SLH-DSA-SHA2-128s")
        assert slhdsa.classification == CLASS_QUANTUM_RESISTANT

        # Stateful Hash Signatures
        lms = CryptoClassifier.classify("LMS_SHA256_M32_H10")
        assert lms.classification == CLASS_QUANTUM_RESISTANT

        # Falcon
        falcon = CryptoClassifier.classify("Falcon-512")
        assert falcon.classification == CLASS_QUANTUM_RESISTANT

    def test_does_not_infer_pqc_solely_from_name_invalid_pqc_parameters(self):
        """
        CRITICAL: PQC name claims with invalid, non-standard, or missing parameters
        must NOT be classified as quantum-resistant; they must be classified as 'unknown'.
        """
        # ML-KEM with invalid parameter set
        fake_mlkem = CryptoClassifier.classify("ML-KEM-999")
        assert fake_mlkem.classification == CLASS_UNKNOWN
        assert "lacks a standard parameter set" in fake_mlkem.justification

        # Kyber with non-standard name/parameter
        fake_kyber = CryptoClassifier.classify("Kyber-Custom-128")
        assert fake_kyber.classification == CLASS_UNKNOWN

        # ML-DSA with invalid parameter set
        fake_mldsa = CryptoClassifier.classify("ML-DSA-99")
        assert fake_mldsa.classification == CLASS_UNKNOWN

        # Marketing claim of "quantumsafe" in unverified algorithm
        marketing_claim = CryptoClassifier.classify("SuperPostQuantumCipher-v2")
        assert marketing_claim.classification == CLASS_UNKNOWN

    def test_hybrid_algorithm_classification(self):
        """Valid hybrid combinations combining classical and PQC must be classified as 'hybrid'."""
        # Standard IETF draft hybrid groups
        x25519_mlkem = CryptoClassifier.classify("X25519MLKEM768")
        assert x25519_mlkem.classification == CLASS_HYBRID
        assert x25519_mlkem.threat_model == "Validated_Hybrid"
        assert x25519_mlkem.hybrid_details["classical_component"] == "X25519"
        assert x25519_mlkem.hybrid_details["post_quantum_component"] == "ML-KEM-768"

        secp256_mlkem = CryptoClassifier.classify("SecP256r1MLKEM768")
        assert secp256_mlkem.classification == CLASS_HYBRID

        # Explicit hybrid component map
        custom_hybrid = CryptoClassifier.classify(
            "CustomHybridGroup",
            hybrid_components={
                "classical": "ECDH-P256",
                "pqc": "ML-KEM-768",
                "combiner": "IETF Dual-KEM HKDF",
            },
        )
        assert custom_hybrid.classification == CLASS_HYBRID

    def test_unknown_and_synthetic_algorithms(self):
        """Unrecognized algorithms must be classified as 'unknown'."""
        res = CryptoClassifier.classify("Custom-Stream-Algo-XYZ")
        assert res.classification == CLASS_UNKNOWN
        assert not res.is_approved


class TestCryptoSecurityAuditor:
    """Tests for platform cryptographic operations audit."""

    def test_crypto_auditor_full_run_passes_all_11_dimensions(self):
        """Executes the full 11-dimension cryptographic security audit."""
        auditor = CryptoSecurityAuditor()
        report = auditor.run_full_audit()

        assert report.all_passed is True
        assert report.summary["total"] == 11
        assert report.summary["passed"] == 11
        assert report.summary["failed"] == 0

        check_ids = {f.check_id for f in report.findings}
        assert check_ids == {
            "CRYPTO-AUDIT-001",  # Approved algorithms
            "CRYPTO-AUDIT-002",  # Secure randomness
            "CRYPTO-AUDIT-003",  # Secure key generation
            "CRYPTO-AUDIT-004",  # Key separation
            "CRYPTO-AUDIT-005",  # Authenticated encryption
            "CRYPTO-AUDIT-006",  # Secure hashing
            "CRYPTO-AUDIT-007",  # Password hashing
            "CRYPTO-AUDIT-008",  # Constant-time comparisons
            "CRYPTO-AUDIT-009",  # Secure key storage
            "CRYPTO-AUDIT-010",  # Zeroization where practical
            "CRYPTO-AUDIT-011",  # No hardcoded production secrets
        }

    def test_buffer_zeroization(self):
        """Verifies in-memory buffer zeroization."""
        buf = bytearray(b"super_sensitive_plain_key_material_2026")
        assert any(b != 0 for b in buf)

        success = zeroize_buffer(buf)
        assert success is True
        assert all(b == 0 for b in buf), "Buffer must be overwritten with all zeroes"

    def test_key_separation_domain_isolation(self):
        """Verifies that HKDF domain derivation creates mutually exclusive subkeys."""
        master = secrets.token_bytes(32)
        derived = {}
        for domain, info in KEY_DOMAINS.items():
            key = hkdf_extract_and_expand(
                salt=b"test_salt",
                ikm=master,
                info=info.encode("utf-8"),
                length=32,
            )
            derived[domain] = key

        # Verify all keys are pairwise distinct
        keys = list(derived.values())
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                assert not hmac.compare_digest(keys[i], keys[j])

    def test_constant_time_comparison(self):
        """Verifies timing-safe comparison."""
        sig_a = b"signature_digest_12345"
        sig_b = b"signature_digest_12345"
        sig_c = b"signature_digest_99999"

        assert hmac.compare_digest(sig_a, sig_b) is True
        assert hmac.compare_digest(sig_a, sig_c) is False
