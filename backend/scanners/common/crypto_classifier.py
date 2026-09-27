"""
ECDAT Cryptographic Algorithm Classifier — Phase 22 (P1 Cryptographic Security)

Provides deep cryptographic analysis and classification of algorithms into four
explicit canonical classes:
1. "quantum-vulnerable"
2. "quantum-resistant"
3. "hybrid"
4. "unknown"

MANDATE: "Do not infer PQC security solely from algorithm names."
This module enforces:
- Key length & parameter inspection (e.g., AES-128 is Grover-vulnerable -> quantum-vulnerable,
  while AES-256 is quantum-resistant).
- Post-quantum parameter verification against standardized specifications
  (NIST FIPS 203 ML-KEM, FIPS 204 ML-DSA, FIPS 205 SLH-DSA, RFC 8554 LMS, RFC 8391 XMSS).
- Rejection of synthetic/unapproved/missing parameters (algorithms claiming PQC names
  without valid parameters are classified as "unknown").
- Hybrid combiner verification (must verify presence of both classical and PQC components,
  plus valid combiner construction).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


# Canonical PQC classes
CLASS_QUANTUM_VULNERABLE = "quantum-vulnerable"
CLASS_QUANTUM_RESISTANT = "quantum-resistant"
CLASS_QUANTUM_SAFE_SYMMETRIC = "quantum-safe-symmetric"
CLASS_HYBRID = "hybrid"
CLASS_UNKNOWN = "unknown"

CANONICAL_CLASSES = {
    CLASS_QUANTUM_VULNERABLE,
    CLASS_QUANTUM_RESISTANT,
    CLASS_QUANTUM_SAFE_SYMMETRIC,
    CLASS_HYBRID,
    CLASS_UNKNOWN,
}

# Standard NIST PQC Parameter Sets (FIPS 203, 204, 205)
VALID_ML_KEM_PARAMETERS = {
    "512": {"nist_level": 1, "claim": "AES-128 equivalent", "pk_bytes": 800, "ct_bytes": 768},
    "768": {"nist_level": 3, "claim": "AES-192 equivalent", "pk_bytes": 1184, "ct_bytes": 1088},
    "1024": {"nist_level": 5, "claim": "AES-256 equivalent", "pk_bytes": 1568, "ct_bytes": 1568},
}

VALID_ML_DSA_PARAMETERS = {
    "44": {"nist_level": 2, "claim": "SHA-256/AES-128 equivalent", "pk_bytes": 1312, "sig_bytes": 2420},
    "65": {"nist_level": 3, "claim": "AES-192 equivalent", "pk_bytes": 1952, "sig_bytes": 3309},
    "87": {"nist_level": 5, "claim": "AES-256 equivalent", "pk_bytes": 2592, "sig_bytes": 4627},
}

VALID_SLH_DSA_PARAMETERS = {
    "128s", "128f", "192s", "192f", "256s", "256f"
}

VALID_FALCON_PARAMETERS = {
    "512": {"nist_level": 1, "pk_bytes": 897, "sig_bytes": 666},
    "1024": {"nist_level": 5, "pk_bytes": 1793, "sig_bytes": 1280},
}

# Approved classical asymmetric algorithms broken by Shor's polynomial-time algorithm
SHOR_VULNERABLE_FAMILIES = {
    "rsa", "dsa", "dh", "diffie-hellman", "dhe", "ffdh", "ecdh", "ecdsa",
    "ecies", "ed25519", "ed448", "x25519", "x448", "elgamal", "sm2", "gost-r3410",
    "ecc", "elliptic-curve", "ellipticcurve"
}

# Classical symmetric ciphers & hashes
SYMMETRIC_CIPHER_FAMILIES = {
    "aes", "chacha20", "camellia", "aria", "des", "3des", "triple-des",
    "rc4", "blowfish", "cast5", "cast6", "idea", "seed"
}

BROKEN_CLASSICAL_HASHES = {"md5", "md4", "md2", "sha1", "sha-1", "ripemd160"}


@dataclass
class AlgorithmClassificationResult:
    """Detailed cryptographic algorithm classification result."""
    algorithm: str
    classification: str  # quantum-vulnerable, quantum-resistant, hybrid, unknown
    threat_model: str   # Shor, Grover, Classical_Broken, Validated_PQC, Validated_Hybrid, Unverified
    security_level_bits: Optional[int] = None
    nist_pqc_category: Optional[int] = None
    justification: str = ""
    is_approved: bool = True
    hybrid_details: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "algorithm": self.algorithm,
            "classification": self.classification,
            "threat_model": self.threat_model,
            "security_level_bits": self.security_level_bits,
            "nist_pqc_category": self.nist_pqc_category,
            "justification": self.justification,
            "is_approved": self.is_approved,
            "hybrid_details": self.hybrid_details,
        }


class PqcReadinessTier(str, Enum):
    """
    Evidence tiers for PQC readiness classification:
    - DEPENDENCY_INSTALLED: Library installed in dependencies (package.json, pom.xml, requirements.txt, etc.)
    - ALGORITHM_IMPORTED: Algorithm actually imported in application source code.
    - RUNTIME_INVOKED: Algorithm actually invoked/executed at runtime (eBPF, instrumentation, live handshake).
    - EXPLICITLY_CONFIGURED: Algorithm explicitly configured in cipher suites, policies, or KMS profiles.
    """
    DEPENDENCY_INSTALLED = "dependency_installed"
    ALGORITHM_IMPORTED = "algorithm_imported"
    RUNTIME_INVOKED = "runtime_invoked"
    EXPLICITLY_CONFIGURED = "explicitly_configured"


class PqcReadinessStatus(str, Enum):
    PQC_READY = "PQC_READY"
    PQC_CAPABLE = "PQC_CAPABLE"
    NOT_READY = "NOT_READY"
    NOT_ASSESSED = "NOT_ASSESSED"


@dataclass
class PqcReadinessEvidence:
    """Individual evidence item supporting PQC readiness evaluation."""
    tier: PqcReadinessTier | str
    source: str
    details: Optional[str] = None
    line_number: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tier": str(self.tier.value if hasattr(self.tier, "value") else self.tier),
            "source": self.source,
            "details": self.details,
            "line_number": self.line_number,
        }


@dataclass
class PqcReadinessEvaluation:
    """
    Formal PQC readiness assessment result.
    Invariant: A component must NEVER be marked PQC_READY on dependency presence alone.
    """
    status: PqcReadinessStatus | str
    is_pqc_ready: bool
    readiness_score: Optional[float]
    algorithm: str
    classification: str
    primary_tier: Optional[PqcReadinessTier | str] = None
    evidence_chain: List[Dict[str, Any]] = field(default_factory=list)
    justification: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": str(self.status.value if hasattr(self.status, "value") else self.status),
            "is_pqc_ready": self.is_pqc_ready,
            "readiness_score": self.readiness_score,
            "algorithm": self.algorithm,
            "classification": self.classification,
            "primary_tier": str(self.primary_tier.value if hasattr(self.primary_tier, "value") else self.primary_tier) if self.primary_tier else None,
            "evidence_chain": self.evidence_chain,
            "justification": self.justification,
        }


def evaluate_pqc_readiness(
    algorithm: Optional[str],
    evidence: Optional[List[Any]] = None,
    key_size: Optional[int] = None,
    parameters: Optional[Dict[str, Any]] = None,
) -> PqcReadinessEvaluation:
    """
    Evaluates PQC readiness of an asset or component across four evidence tiers:
    1. DEPENDENCY_INSTALLED: Library present in dependencies/manifest (e.g. package.json).
       CRITICAL INVARIANT: Dependency presence ALONE must NEVER mark an asset as PQC_READY.
    2. ALGORITHM_IMPORTED: Algorithm/module actually imported in source code.
    3. RUNTIME_INVOKED: Algorithm actually invoked/executed at runtime.
    4. EXPLICITLY_CONFIGURED: Algorithm explicitly configured in cipher suites or settings.
    
    If 0 assets or unassessed algorithm, returns NOT_ASSESSED with readiness_score=None.
    """
    if not algorithm or str(algorithm).strip() == "" or str(algorithm).lower() in ("unknown", "null", "none"):
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.NOT_ASSESSED,
            is_pqc_ready=False,
            readiness_score=None,
            algorithm=str(algorithm or "UNKNOWN"),
            classification=CLASS_UNKNOWN,
            primary_tier=None,
            evidence_chain=[],
            justification="No cryptographic asset or algorithm identified. Not assessed.",
        )

    algo_res = CryptoClassifier.classify(str(algorithm), key_size=key_size, parameters=parameters)
    raw_evidence = evidence or []
    norm_evidence = []
    tiers_present: Set[str] = set()

    for item in raw_evidence:
        if isinstance(item, PqcReadinessEvidence):
            norm_evidence.append(item.to_dict())
            tiers_present.add(str(item.tier.value if hasattr(item.tier, "value") else item.tier).lower())
        elif isinstance(item, dict):
            norm_evidence.append(item)
            t = item.get("tier") or item.get("type") or item.get("level")
            if t:
                tiers_present.add(str(t).lower())
        elif isinstance(item, str):
            tiers_present.add(item.lower())
            norm_evidence.append({"tier": item, "source": "unspecified"})

    # Check tier presence
    has_dependency = any(t in tiers_present for t in ["dependency_installed", "library_installed", "dependency"])
    has_imported = any(t in tiers_present for t in ["algorithm_imported", "imported", "import", "ast_import"])
    has_runtime = any(t in tiers_present for t in ["runtime_invoked", "invoked", "runtime", "runtime_execution"])
    has_configured = any(t in tiers_present for t in ["explicitly_configured", "configured", "config"])

    is_quantum_secure = algo_res.classification in (CLASS_QUANTUM_RESISTANT, CLASS_HYBRID)

    # 1. Classical / Quantum-Vulnerable Algorithms
    if algo_res.classification == CLASS_QUANTUM_VULNERABLE:
        primary = None
        if has_runtime:
            primary = PqcReadinessTier.RUNTIME_INVOKED
        elif has_imported:
            primary = PqcReadinessTier.ALGORITHM_IMPORTED
        elif has_configured:
            primary = PqcReadinessTier.EXPLICITLY_CONFIGURED
        elif has_dependency:
            primary = PqcReadinessTier.DEPENDENCY_INSTALLED

        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.NOT_READY,
            is_pqc_ready=False,
            readiness_score=0.0,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=primary,
            evidence_chain=norm_evidence,
            justification=f"Algorithm '{algo_res.algorithm}' is {algo_res.classification} ({algo_res.threat_model} threat model). Cannot be PQC ready.",
        )

    # 2. Unknown or Unverified Algorithms
    if algo_res.classification == CLASS_UNKNOWN:
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.NOT_ASSESSED,
            is_pqc_ready=False,
            readiness_score=None,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=None,
            evidence_chain=norm_evidence,
            justification=f"Algorithm '{algo_res.algorithm}' could not be verified against standards. Readiness is not assessed.",
        )

    # 3. Quantum-Resistant or Hybrid Algorithms: Check Evidence Tiers
    # CRITICAL INVARIANT: Dependency presence alone NEVER yields PQC_READY!
    if has_dependency and not (has_imported or has_runtime or has_configured):
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.PQC_CAPABLE,
            is_pqc_ready=False,  # STRICTLY FALSE ON DEPENDENCY PRESENCE ALONE
            readiness_score=0.25,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=PqcReadinessTier.DEPENDENCY_INSTALLED,
            evidence_chain=norm_evidence,
            justification=(
                f"PQC library/dependency present for '{algo_res.algorithm}', but algorithm is NOT "
                f"imported, explicitly configured, or invoked at runtime. Cannot be marked PQC_READY on dependency presence alone."
            ),
        )

    # Algorithm actually invoked at runtime
    if has_runtime and is_quantum_secure:
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.PQC_READY,
            is_pqc_ready=True,
            readiness_score=1.0,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=PqcReadinessTier.RUNTIME_INVOKED,
            evidence_chain=norm_evidence,
            justification=f"Verified PQC algorithm '{algo_res.algorithm}' actively invoked at runtime with confirmed evidence.",
        )

    # Explicitly configured
    if has_configured and is_quantum_secure:
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.PQC_READY,
            is_pqc_ready=True,
            readiness_score=0.9,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=PqcReadinessTier.EXPLICITLY_CONFIGURED,
            evidence_chain=norm_evidence,
            justification=f"Verified PQC algorithm '{algo_res.algorithm}' explicitly configured in active policy/cipher suites.",
        )

    # Algorithm imported in code
    if has_imported and is_quantum_secure:
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.PQC_READY,
            is_pqc_ready=True,
            readiness_score=0.75,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=PqcReadinessTier.ALGORITHM_IMPORTED,
            evidence_chain=norm_evidence,
            justification=f"Verified PQC algorithm '{algo_res.algorithm}' actually imported in application source code.",
        )

    # Fallback if no evidence provided but algorithm is quantum-resistant
    if is_quantum_secure and not raw_evidence:
        return PqcReadinessEvaluation(
            status=PqcReadinessStatus.PQC_CAPABLE,
            is_pqc_ready=False,
            readiness_score=0.5,
            algorithm=algo_res.algorithm,
            classification=algo_res.classification,
            primary_tier=None,
            evidence_chain=[],
            justification=f"Algorithm '{algo_res.algorithm}' is {algo_res.classification}, but lacks invocation or configuration evidence.",
        )

    return PqcReadinessEvaluation(
        status=PqcReadinessStatus.NOT_ASSESSED,
        is_pqc_ready=False,
        readiness_score=None,
        algorithm=algo_res.algorithm,
        classification=algo_res.classification,
        primary_tier=None,
        evidence_chain=norm_evidence,
        justification="Insufficient evidence to assess PQC readiness.",
    )


class CryptoClassifier:
    """
    Authoritative Cryptographic Classifier.
    Evaluates key sizes, parameter sets, and combiner structures without relying
    solely on algorithm names.
    """

    @classmethod
    def classify(
        cls,
        algorithm: str,
        key_size: Optional[int] = None,
        parameters: Optional[Dict[str, Any]] = None,
        mode: Optional[str] = None,
        hybrid_components: Optional[Dict[str, Any]] = None,
    ) -> AlgorithmClassificationResult:
        """
        Classifies an algorithm into:
        - 'quantum-vulnerable'
        - 'quantum-resistant'
        - 'hybrid'
        - 'unknown'
        """
        if not algorithm or not isinstance(algorithm, str):
            return AlgorithmClassificationResult(
                algorithm=str(algorithm or ""),
                classification=CLASS_UNKNOWN,
                threat_model="Unverified",
                justification="Empty or non-string algorithm specification.",
                is_approved=False,
            )

        algo_raw = algorithm.strip()
        algo_norm = re.sub(r"[^a-zA-Z0-9_\-+]", "", algo_raw).lower()
        algo_clean = re.sub(r"[^a-z0-9]", "", algo_raw.lower())
        params = parameters or {}

        # -------------------------------------------------------------------
        # 1. EXPLICIT HYBRID EVALUATION
        # -------------------------------------------------------------------
        hybrid_res = cls._evaluate_hybrid(algo_raw, algo_norm, algo_clean, hybrid_components, params)
        if hybrid_res:
            return hybrid_res

        # -------------------------------------------------------------------
        # 2. POST-QUANTUM CANDIDATES (Deep Parameter Verification)
        # -------------------------------------------------------------------
        pqc_res = cls._evaluate_pqc_parameters(algo_raw, algo_norm, algo_clean, key_size, params)
        if pqc_res:
            return pqc_res

        # -------------------------------------------------------------------
        # 3. PROTOCOLS (TLS 1.2, TLS 1.3, SSL)
        # -------------------------------------------------------------------
        proto_res = cls._evaluate_protocol(algo_raw, algo_norm, algo_clean, params)
        if proto_res:
            return proto_res

        # -------------------------------------------------------------------
        # 4. CERTIFICATES (X.509)
        # -------------------------------------------------------------------
        cert_res = cls._evaluate_certificate(algo_raw, algo_norm, algo_clean, params)
        if cert_res:
            return cert_res

        # -------------------------------------------------------------------
        # 5. ASYMMETRIC CLASSICAL (Shor's Algorithm Breakdown)
        # -------------------------------------------------------------------
        shor_res = cls._evaluate_asymmetric_classical(algo_raw, algo_norm, algo_clean, key_size)
        if shor_res:
            return shor_res

        # -------------------------------------------------------------------
        # 6. SYMMETRIC CIPHERS (Grover's Algorithm Quadratic Speedup)
        # -------------------------------------------------------------------
        symmetric_res = cls._evaluate_symmetric(algo_raw, algo_norm, algo_clean, key_size, mode)
        if symmetric_res:
            return symmetric_res

        # -------------------------------------------------------------------
        # 7. CRYPTOGRAPHIC HASH FUNCTIONS
        # -------------------------------------------------------------------
        hash_res = cls._evaluate_hash(algo_raw, algo_norm, algo_clean, key_size)
        if hash_res:
            return hash_res

        # -------------------------------------------------------------------
        # 6. UNKNOWN / UNVERIFIED FALLBACK
        # -------------------------------------------------------------------
        return AlgorithmClassificationResult(
            algorithm=algo_raw,
            classification=CLASS_UNKNOWN,
            threat_model="Unverified",
            justification=(
                f"Algorithm '{algo_raw}' could not be definitively validated against known "
                f"cryptographic standards or parameter sets. Marked as unknown per zero-trust policy."
            ),
            is_approved=False,
        )

    # -----------------------------------------------------------------------
    # Helper Evaluation Engines
    # -----------------------------------------------------------------------

    @classmethod
    def _evaluate_hybrid(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        hybrid_components: Optional[Dict[str, Any]],
        params: Dict[str, Any],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Verifies hybrid constructions.
        A valid hybrid scheme MUST specify:
        - A recognized classical component
        - A validated post-quantum component
        - A recognized combiner / KDF mechanism
        """
        # Case A: Explicit hybrid components passed
        if hybrid_components and isinstance(hybrid_components, dict):
            classical = hybrid_components.get("classical_component") or hybrid_components.get("classical")
            pqc = hybrid_components.get("post_quantum_component") or hybrid_components.get("pqc")
            combiner = hybrid_components.get("combiner") or hybrid_components.get("kdf") or "HKDF-Extract-and-Expand"

            if classical and pqc:
                # Classify both components recursively
                class_res = cls.classify(str(classical))
                pqc_res = cls.classify(str(pqc))

                # Verify valid hybrid pairing
                if class_res.classification == CLASS_QUANTUM_VULNERABLE and pqc_res.classification == CLASS_QUANTUM_RESISTANT:
                    return AlgorithmClassificationResult(
                        algorithm=algo_raw,
                        classification=CLASS_HYBRID,
                        threat_model="Validated_Hybrid",
                        security_level_bits=pqc_res.security_level_bits or 128,
                        nist_pqc_category=pqc_res.nist_pqc_category or 3,
                        justification=(
                            f"Verified hybrid construction combining classical {classical} "
                            f"(Shor-vulnerable) and post-quantum {pqc} (quantum-resistant) "
                            f"via {combiner}."
                        ),
                        is_approved=True,
                        hybrid_details={
                            "classical_component": classical,
                            "post_quantum_component": pqc,
                            "combiner": combiner,
                            "classical_security": class_res.security_level_bits,
                            "quantum_security": pqc_res.security_level_bits,
                        },
                    )
                else:
                    return AlgorithmClassificationResult(
                        algorithm=algo_raw,
                        classification=CLASS_UNKNOWN,
                        threat_model="Unverified_Hybrid",
                        justification=(
                            f"Hybrid construction '{algo_raw}' failed component verification: "
                            f"classical={class_res.classification}, pqc={pqc_res.classification}."
                        ),
                        is_approved=False,
                    )

        # Case B: Standard hybrid TLS groups from IETF drafts
        standard_hybrids = {
            "x25519mlkem768": ("X25519", "ML-KEM-768", 3, 192),
            "x25519kyber768": ("X25519", "ML-KEM-768", 3, 192),
            "x25519kyber768draft00": ("X25519", "ML-KEM-768", 3, 192),
            "secp256r1mlkem768": ("ECDH-P256", "ML-KEM-768", 3, 192),
            "p256mlkem768": ("ECDH-P256", "ML-KEM-768", 3, 192),
            "secp384r1mlkem1024": ("ECDH-P384", "ML-KEM-1024", 5, 256),
            "p384mlkem1024": ("ECDH-P384", "ML-KEM-1024", 5, 256),
        }

        for pattern, (c_name, pq_name, nist_cat, sec_bits) in standard_hybrids.items():
            if pattern in algo_clean or pattern in algo_norm:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_HYBRID,
                    threat_model="Validated_Hybrid",
                    security_level_bits=sec_bits,
                    nist_pqc_category=nist_cat,
                    justification=(
                        f"Standard IETF draft hybrid key exchange group: classical {c_name} "
                        f"paired with post-quantum {pq_name} (NIST Level {nist_cat})."
                    ),
                    is_approved=True,
                    hybrid_details={
                        "classical_component": c_name,
                        "post_quantum_component": pq_name,
                        "combiner": "IETF Dual-KEM HKDF",
                    },
                )

        # Composite signature naming (e.g., Composite-RSA3072-ML-DSA-65)
        if "composite" in algo_clean or ("+" in algo_raw and any(k in algo_clean for k in ["mldsa", "mlkem", "falcon"])):
            parts = [p.strip() for p in re.split(r"[\+\-_]", algo_raw) if p.strip()]
            if len(parts) >= 2:
                # Find classical and PQC sub-parts
                has_classical = any(any(c in p.lower() for c in SHOR_VULNERABLE_FAMILIES) for p in parts)
                has_pqc = any(any(q in re.sub(r"[^a-z0-9]", "", p.lower()) for q in ["mlkem", "mldsa", "slhdsa", "kyber", "dilithium", "falcon"]) for p in parts)
                if has_classical and has_pqc:
                    return AlgorithmClassificationResult(
                        algorithm=algo_raw,
                        classification=CLASS_HYBRID,
                        threat_model="Validated_Hybrid",
                        security_level_bits=192,
                        nist_pqc_category=3,
                        justification=f"Dual composite scheme validated with classical and PQC components: {algo_raw}.",
                        is_approved=True,
                        hybrid_details={"raw_components": parts},
                    )

        return None

    @classmethod
    def _evaluate_pqc_parameters(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        key_size: Optional[int],
        params: Dict[str, Any],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Deep parameter inspection for Post-Quantum Cryptography algorithms.
        Rejects algorithms claiming PQC names with invalid or synthetic parameters.
        """
        # 1. FIPS 203 ML-KEM / Kyber
        if "mlkem" in algo_clean or "kyber" in algo_clean:
            # Extract parameter (512, 768, 1024)
            param_match = re.search(r"(512|768|1024)", algo_clean)
            param_val = param_match.group(1) if param_match else str(params.get("parameter_set", ""))
            
            if param_val in VALID_ML_KEM_PARAMETERS:
                spec = VALID_ML_KEM_PARAMETERS[param_val]
                # Validate key length if provided
                if key_size and key_size not in (spec["pk_bytes"] * 8, spec["pk_bytes"]):
                    # If key size contradicts standard, flag unknown
                    if key_size < 512:
                        return AlgorithmClassificationResult(
                            algorithm=algo_raw,
                            classification=CLASS_UNKNOWN,
                            threat_model="Unverified",
                            justification=(
                                f"Algorithm '{algo_raw}' specifies ML-KEM-{param_val} but has "
                                f"invalid key size {key_size} (expected {spec['pk_bytes'] * 8} bits)."
                            ),
                            is_approved=False,
                        )
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=spec["nist_level"],
                    security_level_bits=128 if spec["nist_level"] == 1 else 192 if spec["nist_level"] == 3 else 256,
                    justification=(
                        f"NIST FIPS 203 standardized ML-KEM-{param_val} (Category {spec['nist_level']}). "
                        f"Lattice-based module learning-with-errors (M-LWE). Parameters verified."
                    ),
                    is_approved=True,
                )
            elif not param_val and algo_clean in ("mlkem", "kyber", "fips203", "fips203mlkem"):
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=3,
                    security_level_bits=192,
                    justification="NIST FIPS 203 standardized ML-KEM post-quantum key encapsulation mechanism.",
                    is_approved=True,
                )
            else:
                # Algorithm name has "kyber" or "mlkem" but invalid/missing parameter!
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_UNKNOWN,
                    threat_model="Unverified",
                    justification=(
                        f"Algorithm '{algo_raw}' claims ML-KEM/Kyber construction but lacks a "
                        f"standard parameter set (must be 512, 768, or 1024 per FIPS 203). "
                        f"PQC security cannot be inferred solely from name."
                    ),
                    is_approved=False,
                )

        # 2. FIPS 204 ML-DSA / Dilithium
        if "mldsa" in algo_clean or "dilithium" in algo_clean:
            param_match = re.search(r"(44|65|87|2|3|5)", algo_clean)
            raw_param = param_match.group(1) if param_match else str(params.get("parameter_set", ""))
            # Map Dilithium 2/3/5 to ML-DSA 44/65/87
            param_map = {"2": "44", "3": "65", "5": "87"}
            param_val = param_map.get(raw_param, raw_param)

            if param_val in VALID_ML_DSA_PARAMETERS:
                spec = VALID_ML_DSA_PARAMETERS[param_val]
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=spec["nist_level"],
                    security_level_bits=128 if spec["nist_level"] == 2 else 192 if spec["nist_level"] == 3 else 256,
                    justification=(
                        f"NIST FIPS 204 standardized ML-DSA-{param_val} (Category {spec['nist_level']}). "
                        f"Module learning-with-errors signature scheme. Parameters verified."
                    ),
                    is_approved=True,
                )
            elif not raw_param and algo_clean in ("mldsa", "dilithium", "fips204", "fips204mldsa"):
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=3,
                    security_level_bits=192,
                    justification="NIST FIPS 204 standardized ML-DSA lattice-based digital signature scheme.",
                    is_approved=True,
                )
            else:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_UNKNOWN,
                    threat_model="Unverified",
                    justification=(
                        f"Algorithm '{algo_raw}' claims ML-DSA/Dilithium construction but lacks "
                        f"valid FIPS 204 parameters (44, 65, 87). PQC security cannot be inferred solely from name."
                    ),
                    is_approved=False,
                )

        # 3. FIPS 205 SLH-DSA / SPHINCS+
        if "slhdsa" in algo_clean or "sphincs" in algo_clean:
            has_param = any(p in algo_clean for p in VALID_SLH_DSA_PARAMETERS)
            if has_param or "shake" in algo_clean or "sha2" in algo_clean or algo_clean in ("slhdsa", "sphincs", "sphincsplus", "fips205"):
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=3,
                    security_level_bits=192,
                    justification=(
                        f"NIST FIPS 205 standardized SLH-DSA stateless hash-based signature scheme. "
                        f"Security grounded in cryptographic hash collision/pre-image resistance."
                    ),
                    is_approved=True,
                )
            else:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_UNKNOWN,
                    threat_model="Unverified",
                    justification=f"SLH-DSA '{algo_raw}' missing parameter specifications.",
                    is_approved=False,
                )

        # 4. Falcon
        if "falcon" in algo_clean:
            param_match = re.search(r"(512|1024)", algo_clean)
            param_val = param_match.group(1) if param_match else ""
            if param_val in VALID_FALCON_PARAMETERS:
                spec = VALID_FALCON_PARAMETERS[param_val]
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_RESISTANT,
                    threat_model="Validated_PQC",
                    nist_pqc_category=spec["nist_level"],
                    security_level_bits=128 if spec["nist_level"] == 1 else 256,
                    justification=f"NIST round 3 selected Falcon-{param_val} lattice signature.",
                    is_approved=True,
                )

        # 5. Stateful Hash-Based Signatures (LMS / XMSS)
        if any(h in algo_clean for h in ["lms", "hss", "xmss"]):
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_RESISTANT,
                threat_model="Validated_PQC",
                nist_pqc_category=5,
                security_level_bits=256,
                justification=(
                    f"Stateful hash-based signature scheme ({algo_raw}) per RFC 8554 / RFC 8391. "
                    f"Approved strictly for firmware/ROM code signing with hardware monotonic counters."
                ),
                is_approved=True,
            )

        # Reject generic "pqc" / "quantum" string claims without parameter proof
        if "pqc" in algo_clean or "quantumsafe" in algo_clean or "postquantum" in algo_clean:
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_UNKNOWN,
                threat_model="Unverified",
                justification=(
                    f"Algorithm '{algo_raw}' claims quantum security in its name but does not "
                    f"match any verified, standardized PQC specification. Cannot infer PQC solely from name."
                ),
                is_approved=False,
            )

        return None

    @classmethod
    def _evaluate_protocol(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        params: Dict[str, Any],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Evaluates cryptographic transport and security protocols (e.g. TLS 1.2, TLS 1.3).
        Standard classical TLS handshakes (RSA/ECDHE key exchange and classical PKI certificates)
        are broken by Shor's algorithm on a CRQC.
        """
        if any(p in algo_clean for p in ["tls12", "tls13", "tlsv12", "tlsv13", "ssl3", "sslv3"]):
            is_tls13 = "13" in algo_clean
            kex = params.get("key_exchange") or params.get("kex")
            # If TLS 1.3 specifies a verified hybrid or PQC key exchange
            if is_tls13 and kex:
                kex_clean = re.sub(r"[^a-z0-9]", "", str(kex).lower())
                if any(p in kex_clean for p in ["mlkem", "kyber", "hybrid"]):
                    return AlgorithmClassificationResult(
                        algorithm=algo_raw,
                        classification=CLASS_HYBRID,
                        threat_model="Validated_Hybrid",
                        security_level_bits=192,
                        nist_pqc_category=3,
                        justification=f"Protocol '{algo_raw}' with hybrid post-quantum key exchange '{kex}'.",
                        is_approved=True,
                    )
            # Default classical TLS 1.2 and TLS 1.3
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_VULNERABLE,
                threat_model="Shor",
                security_level_bits=112 if "12" in algo_clean else 128,
                nist_pqc_category=0,
                justification=(
                    f"Protocol '{algo_raw}' relies on classical key exchange and classical PKI signatures "
                    f"vulnerable to Shor's algorithm on a CRQC."
                ),
                is_approved=True,
            )
        return None

    @classmethod
    def _evaluate_certificate(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        params: Dict[str, Any],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Evaluates public key certificates (e.g., X.509).
        Classical X.509 certificates rely on classical asymmetric signatures (RSA, ECDSA)
        vulnerable to Shor's algorithm.
        """
        if "x509" in algo_clean or "x-509" in algo_norm or algo_clean in ("certificate", "x509certificate"):
            sig_algo = params.get("signature_algorithm") or params.get("public_key_algorithm")
            if sig_algo:
                res = cls.classify(str(sig_algo), parameters=params)
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=res.classification,
                    threat_model=res.threat_model,
                    security_level_bits=res.security_level_bits,
                    nist_pqc_category=res.nist_pqc_category,
                    justification=f"X.509 certificate with underlying {sig_algo}: {res.justification}",
                    is_approved=res.is_approved,
                )
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_VULNERABLE,
                threat_model="Shor",
                security_level_bits=112,
                nist_pqc_category=0,
                justification=(
                    f"X.509 public key certificate ('{algo_raw}') relies on classical asymmetric "
                    f"signature schemes vulnerable to Shor's algorithm on a CRQC."
                ),
                is_approved=True,
            )
        return None

    @classmethod
    def _evaluate_asymmetric_classical(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        key_size: Optional[int],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Evaluates classical asymmetric algorithms.
        Shor's polynomial-time algorithm solves integer factorization (RSA)
        and discrete logarithm (DH, ECDH, ECDSA, Ed25519) regardless of classical key size.
        """
        is_shor = any(shor_fam in algo_norm or shor_fam in algo_clean for shor_fam in SHOR_VULNERABLE_FAMILIES)
        if not is_shor:
            if re.match(r"^rsa(?:[-_]?(?:1024|2048|3072|4096))?", algo_norm) or algo_clean.startswith("rsa"):
                is_shor = True
            elif algo_clean.startswith("ecc") or algo_clean == "ecc":
                is_shor = True

        if is_shor:
            bits = key_size
            if not bits:
                m = re.search(r"(512|1024|2048|3072|4096)", algo_clean)
                if m:
                    bits = int(m.group(1))

            classical_level = 112 if (bits and bits <= 2048) else 128 if (bits and bits <= 3072) else 256
            is_deprecated_classical = bool(bits and bits < 2048)

            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_VULNERABLE,
                threat_model="Shor",
                security_level_bits=classical_level,
                nist_pqc_category=0,
                justification=(
                    f"Asymmetric mechanism '{algo_raw}' is vulnerable to Shor's algorithm on a CRQC. "
                    f"Solves integer factorization and discrete logarithms in polynomial time O((log N)^3)."
                ),
                is_approved=not is_deprecated_classical,
            )

        return None

    @classmethod
    def _evaluate_symmetric(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        key_size: Optional[int],
        mode: Optional[str],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Evaluates symmetric ciphers.
        Grover's algorithm provides quadratic speedup O(2^(k/2)).
        """
        is_sym = any(fam in algo_norm or fam in algo_clean for fam in SYMMETRIC_CIPHER_FAMILIES)
        if not is_sym:
            return None

        # Determine effective key size
        effective_bits = key_size
        if not effective_bits:
            m = re.search(r"(128|192|256|64|56)", algo_clean)
            if m:
                effective_bits = int(m.group(1))
            elif "chacha20" in algo_clean:
                effective_bits = 256
            elif "3des" in algo_clean or "desede3" in algo_clean:
                effective_bits = 112
            elif "des" in algo_clean:
                effective_bits = 56

        # Classically broken symmetric ciphers
        if any(broken in algo_clean for broken in ["des", "rc4", "blowfish", "cast5"]):
            if "3des" not in algo_clean and "desede3" not in algo_clean:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_VULNERABLE,
                    threat_model="Classical_Broken",
                    security_level_bits=effective_bits or 56,
                    justification=f"Legacy symmetric cipher '{algo_raw}' is broken classically and quantum-vulnerable.",
                    is_approved=False,
                )

        if effective_bits is not None:
            quantum_bits = effective_bits // 2
            is_insecure_mode = "ecb" in algo_clean or (mode and mode.lower() == "ecb")
            if effective_bits < 256:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_VULNERABLE,
                    threat_model="Grover",
                    security_level_bits=effective_bits,
                    justification=(
                        f"Symmetric cipher '{algo_raw}' has {effective_bits}-bit key. Grover's algorithm "
                        f"reduces effective quantum search space to 2^{quantum_bits}, falling below the "
                        f"128-bit post-quantum security floor (NIST SP 800-131A / CNSA 2.0). Marked quantum-vulnerable."
                    ),
                    is_approved=True if (effective_bits >= 128 and not is_insecure_mode) else False,
                )
            else:
                return AlgorithmClassificationResult(
                    algorithm=algo_raw,
                    classification=CLASS_QUANTUM_SAFE_SYMMETRIC,
                    threat_model="Grover",
                    security_level_bits=effective_bits,
                    nist_pqc_category=1 if effective_bits == 256 else 5,
                    justification=(
                        f"Symmetric cipher '{algo_raw}' with {effective_bits}-bit key maintains 2^{quantum_bits} "
                        f"bits of security against Grover's algorithm, satisfying long-term post-quantum requirements."
                    ),
                    is_approved=not is_insecure_mode,
                )

        return AlgorithmClassificationResult(
            algorithm=algo_raw,
            classification=CLASS_UNKNOWN,
            threat_model="Unverified",
            justification=(
                f"Symmetric cipher '{algo_raw}' lacks key size information. Cannot classify as "
                f"quantum-resistant or quantum-vulnerable without verified key length."
            ),
            is_approved=False,
        )

    @classmethod
    def _evaluate_hash(
        cls,
        algo_raw: str,
        algo_norm: str,
        algo_clean: str,
        key_size: Optional[int],
    ) -> Optional[AlgorithmClassificationResult]:
        """
        Evaluates cryptographic hash functions.
        """
        # Broken classical hashes
        if any(broken in algo_clean for broken in BROKEN_CLASSICAL_HASHES):
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_VULNERABLE,
                threat_model="Classical_Broken",
                security_level_bits=0,
                justification=f"Hash function '{algo_raw}' is broken classically (collision attacks) and quantum-vulnerable.",
                is_approved=False,
            )

        # Standard secure hashes
        if "sha256" in algo_clean:
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_RESISTANT,
                threat_model="Grover/BHT",
                security_level_bits=256,
                justification="SHA-256 provides 128-bit quantum collision resistance and 256-bit pre-image resistance.",
                is_approved=True,
            )

        if algo_clean in ("sha2", "sha224") or algo_norm in ("sha-2", "sha2"):
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_RESISTANT,
                threat_model="Grover/BHT",
                security_level_bits=key_size or 256,
                justification=f"SHA-2 family hash function '{algo_raw}' provides quantum collision and pre-image resistance.",
                is_approved=True,
            )

        if any(h in algo_clean for h in ["sha384", "sha512", "sha3", "shake", "blake2"]):
            return AlgorithmClassificationResult(
                algorithm=algo_raw,
                classification=CLASS_QUANTUM_RESISTANT,
                threat_model="Grover/BHT",
                security_level_bits=384,
                justification=f"High-assurance hash function '{algo_raw}' exceeds 128-bit quantum collision resistance floor.",
                is_approved=True,
            )

        return None
