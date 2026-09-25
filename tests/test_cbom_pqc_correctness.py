"""
Phase 3 — CBOM / PQC Correctness Tests

Validates:
1. CycloneDX version targeted: production contract is strictly CycloneDX 1.6.
   Validates real generated CBOMs from actual scanners against the official
   CycloneDX 1.6 JSON schema (cyclonedx.validation.json.JsonValidator).
2. Provenance and unknown field fidelity:
   Every component carries complete scanner provenance (ecdat:scanner, ecdat:file, evidence: occurrences).
   Unknown fields render as null/"unknown", never guessed defaults (zero invented 2048 or AES).
3. 4-tier PQC readiness classification:
   Distinguishes dependency installed vs. algorithm imported vs. runtime invoked vs. explicitly configured.
   Invariant: A component must NEVER be marked PQC_READY on dependency presence alone.
   0 assets / unassessed render as null/"not assessed", never default 100%.
4. Algorithm classification for all required families:
   RSA, ECC, AES, SHA-2, TLS 1.2/1.3, X.509 certificates, ML-KEM, ML-DSA, SLH-DSA
   (finalized NIST FIPS 203/204/205 standard names), hybrid classical+PQC, and explicitly unknown.
5. Migration recommendations use-case matching:
   Key establishment findings never recommend signature algorithms and vice versa.
   Catches this class of mismatch with ValueError.
"""

import json
import pytest
from cyclonedx.schema import SchemaVersion
from cyclonedx.validation.json import JsonValidator

from scanners.cbom_mapping import (
    code_finding_to_cbom,
    network_finding_to_cbom,
    binary_metadata_to_cbom,
    serialize_cbom,
)
from scanners.models import CodeCryptoFinding, NetworkCryptoFinding
from scanners.common.crypto_classifier import (
    CryptoClassifier,
    CLASS_QUANTUM_VULNERABLE,
    CLASS_QUANTUM_RESISTANT,
    CLASS_QUANTUM_SAFE_SYMMETRIC,
    CLASS_HYBRID,
    CLASS_UNKNOWN,
    PqcReadinessTier,
    PqcReadinessStatus,
    PqcReadinessEvidence,
    PqcReadinessEvaluation,
    evaluate_pqc_readiness,
)
from scanners.migration_planner import (
    detect_cryptographic_use_case,
    validate_migration_use_case_match,
    identify_replacement_candidates,
)


from scanners.binary_container.parsers.base import (
    BinaryMetadata,
    BinaryFormat,
    Endianness,
    CertificateMetadata,
)


@pytest.fixture
def v16_validator():
    """Official CycloneDX 1.6 JSON schema validator."""
    return JsonValidator(SchemaVersion.V1_6)


# =============================================================================
# 1. REAL GENERATED CBOM SCHEMA VALIDATION (CYCLONEDX 1.6)
# =============================================================================

def test_real_generated_code_finding_cbom_validates_against_cyclonedx_16_schema(v16_validator):
    """
    Validates a REAL generated CBOM from the code scanner finding pipeline
    against the official CycloneDX 1.6 JSON schema (not a fixture).
    """
    real_finding = CodeCryptoFinding(
        rule_id="crypto-rsa-call",
        language="python",
        finding_type="algorithm",
        file_path="backend/src/auth/jwt_verifier.py",
        line=88,
        column=12,
        algorithm="RSA",
        key_size=2048,
        confidence="HIGH",
        analysis_source="ast_parser",
        bom_ref="code:algorithm/rsa-2048@backend/src/auth/jwt_verifier.py:88",
    )

    # Generate real CBOM
    bom = code_finding_to_cbom(real_finding)
    cbom_json_str = serialize_cbom(bom)
    cbom_dict = json.loads(cbom_json_str)

    # Must strictly target CycloneDX 1.6
    assert cbom_dict["bomFormat"] == "CycloneDX"
    assert cbom_dict["specVersion"] == "1.6"

    # Official schema validation MUST pass
    validation_error = v16_validator.validate_str(cbom_json_str)
    assert validation_error is None, f"Generated CBOM failed CycloneDX 1.6 schema: {validation_error}"


def test_real_generated_network_finding_cbom_validates_against_cyclonedx_16_schema(v16_validator):
    """
    Validates a REAL generated CBOM from the network scanner finding pipeline
    against the official CycloneDX 1.6 JSON schema.
    """
    real_net_finding = NetworkCryptoFinding(
        host="gateway.internal.corp",
        port=443,
        protocol="TLSv1.3",
        cipher_suite="TLS_AES_256_GCM_SHA384",
        key_exchange="ECDH-P256",
        cert_subject="CN=gateway.internal.corp",
        cert_issuer="CN=Enterprise Internal Intermediate CA",
        cert_expiry="2027-12-31T23:59:59Z",
        cert_valid=True,
        cert_algo="RSA-SHA256",
        cert_key_size=2048,
        rule_id="net-tls13-ciphersuite",
        confidence="HIGH",
        bom_ref="net:host/gateway.internal.corp:443",
    )

    bom = network_finding_to_cbom(real_net_finding)
    cbom_json_str = serialize_cbom(bom)
    cbom_dict = json.loads(cbom_json_str)

    assert cbom_dict["bomFormat"] == "CycloneDX"
    assert cbom_dict["specVersion"] == "1.6"

    validation_error = v16_validator.validate_str(cbom_json_str)
    assert validation_error is None, f"Generated network CBOM failed CycloneDX 1.6 schema: {validation_error}"


def test_real_generated_binary_cbom_validates_against_cyclonedx_16_schema(v16_validator):
    """
    Validates a REAL generated CBOM from binary container scanner metadata
    against the official CycloneDX 1.6 JSON schema.
    """
    metadata = BinaryMetadata(
        file_path="/usr/lib/libcrypto.so.3",
        file_size=3145728,
        file_hash_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        binary_format=BinaryFormat.ELF,
        architecture="x86_64",
        bit_width=64,
        endianness=Endianness.LITTLE,
        imported_libraries=["libssl.so.3", "libc.so.6"],
        certificates=[
            CertificateMetadata(
                subject="CN=Internal Signing",
                issuer="CN=Root CA",
                serial_number="1234567890",
                public_key_algorithm="RSA",
                key_size_bits=4096,
            )
        ],
    )

    bom = binary_metadata_to_cbom(metadata)
    cbom_json_str = serialize_cbom(bom)
    cbom_dict = json.loads(cbom_json_str)

    assert cbom_dict["bomFormat"] == "CycloneDX"
    assert cbom_dict["specVersion"] == "1.6"

    validation_error = v16_validator.validate_str(cbom_json_str)
    assert validation_error is None, f"Generated binary CBOM failed CycloneDX 1.6 schema: {validation_error}"


# =============================================================================
# 2. PROVENANCE & UNKNOWN FIELD FIDELITY (ZERO GUESSED DEFAULTS)
# =============================================================================

def test_cbom_provenance_and_zero_guessed_defaults():
    """
    Every CBOM component must carry complete provenance (which scanner, which file/location,
    and evidence). Unknown fields must render as null/"unknown", never guessed defaults.
    """
    # Finding with intentionally unknown key size and custom unknown primitive
    finding = CodeCryptoFinding(
        rule_id="crypto-unknown-func",
        language="c",
        finding_type="algorithm",
        file_path="embedded/crypto_stub.c",
        line=42,
        column=5,
        algorithm="CUSTOM-PRIMITIVE",
        key_size=None,  # Real value is unknown: MUST NOT guess 2048 or 256!
        confidence="LOW",
        analysis_source="regex_pattern",
        bom_ref="code:algorithm/custom-primitive@embedded/crypto_stub.c:42",
    )

    bom = code_finding_to_cbom(finding)
    cbom_dict = json.loads(serialize_cbom(bom))

    # Check components for provenance and zero guessed defaults
    found_algo_comp = False
    for comp in cbom_dict["components"]:
        props = {p["name"]: p["value"] for p in comp.get("properties", [])}

        # Provenance checks
        assert "ecdat:scanner" in props, f"Component {comp['name']} missing ecdat:scanner"
        assert props["ecdat:scanner"] in ["static_scanner", "network_scanner", "binary_scanner"]
        assert "ecdat:file" in props, f"Component {comp['name']} missing ecdat:file"
        assert props["ecdat:file"] == "embedded/crypto_stub.c"

        # Evidence occurrence check
        evidence = comp.get("evidence", {})
        occurrences = evidence.get("occurrences", [])
        assert len(occurrences) > 0, f"Component {comp['name']} missing evidence occurrences"
        assert any("embedded/crypto_stub.c" in occ.get("location", "") for occ in occurrences)

        # Check cryptographic asset specifics
        if comp.get("cryptoProperties", {}).get("assetType") == "algorithm":
            found_algo_comp = True
            algo_props = comp["cryptoProperties"].get("algorithmProperties", {})
            # Must NOT guess a default key size when unknown
            assert algo_props.get("parameterSetIdentifier") is None
            # Classification must be unknown, not guessed
            assert props.get("ecdat:quantumClassification") == CLASS_UNKNOWN

    assert found_algo_comp, "Expected cryptographic algorithm component in generated CBOM"


# =============================================================================
# 3. ALGORITHM CLASSIFICATION FOR ALL REQUIRED FAMILIES
# =============================================================================

def test_algorithm_classification_all_required_families():
    """
    Unit tests covering correct classification of:
    - RSA
    - ECC
    - AES (128 vs 256 vs missing key size)
    - SHA-2
    - TLS 1.2 / TLS 1.3
    - X.509 certificates
    - ML-KEM (NIST FIPS 203 finalized standard name)
    - ML-DSA (NIST FIPS 204 finalized standard name)
    - SLH-DSA (NIST FIPS 205 finalized standard name)
    - Hybrid classical+PQC
    - Explicitly unknown case
    """
    # 1. RSA -> quantum-vulnerable, Shor
    rsa_res = CryptoClassifier.classify("RSA", key_size=2048)
    assert rsa_res.classification == CLASS_QUANTUM_VULNERABLE
    assert rsa_res.threat_model == "Shor"

    # 2. ECC -> quantum-vulnerable, Shor
    ecc_res = CryptoClassifier.classify("ECC", key_size=256)
    assert ecc_res.classification == CLASS_QUANTUM_VULNERABLE
    assert ecc_res.threat_model == "Shor"

    ecdsa_res = CryptoClassifier.classify("ECDSA", key_size=256)
    assert ecdsa_res.classification == CLASS_QUANTUM_VULNERABLE
    assert ecdsa_res.threat_model == "Shor"

    ecdh_res = CryptoClassifier.classify("ECDH", key_size=384)
    assert ecdh_res.classification == CLASS_QUANTUM_VULNERABLE
    assert ecdh_res.threat_model == "Shor"

    # 3. AES -> 128 Grover-vulnerable, 256 Grover-resistant, unknown key size -> unknown
    aes128_res = CryptoClassifier.classify("AES-128", key_size=128)
    assert aes128_res.classification == CLASS_QUANTUM_VULNERABLE
    assert aes128_res.threat_model == "Grover"

    aes256_res = CryptoClassifier.classify("AES-256", key_size=256)
    assert aes256_res.classification == CLASS_QUANTUM_SAFE_SYMMETRIC
    assert aes256_res.threat_model == "Grover"

    aes_unknown_res = CryptoClassifier.classify("AES")
    assert aes_unknown_res.classification == CLASS_UNKNOWN

    # 4. SHA-2 -> quantum-resistant, Grover/BHT
    sha2_res = CryptoClassifier.classify("SHA-2")
    assert sha2_res.classification == CLASS_QUANTUM_RESISTANT
    assert sha2_res.threat_model == "Grover/BHT"

    sha256_res = CryptoClassifier.classify("SHA-256")
    assert sha256_res.classification == CLASS_QUANTUM_RESISTANT
    assert sha256_res.threat_model == "Grover/BHT"

    # 5. TLS 1.2 / TLS 1.3
    tls12_res = CryptoClassifier.classify("TLS 1.2")
    assert tls12_res.classification == CLASS_QUANTUM_VULNERABLE
    assert tls12_res.threat_model == "Shor"

    tls13_res = CryptoClassifier.classify("TLS 1.3")
    assert tls13_res.classification == CLASS_QUANTUM_VULNERABLE
    assert tls13_res.threat_model == "Shor"

    tls13_hybrid_res = CryptoClassifier.classify("TLS 1.3", parameters={"key_exchange": "X25519MLKEM768"})
    assert tls13_hybrid_res.classification == CLASS_HYBRID
    assert tls13_hybrid_res.threat_model == "Validated_Hybrid"

    # 6. X.509 Certificates -> classical PKI signature vulnerable to Shor
    x509_res = CryptoClassifier.classify("X.509")
    assert x509_res.classification == CLASS_QUANTUM_VULNERABLE
    assert x509_res.threat_model == "Shor"

    # 7. ML-KEM (NIST FIPS 203 finalized standard name)
    mlkem768_res = CryptoClassifier.classify("ML-KEM-768")
    assert mlkem768_res.classification == CLASS_QUANTUM_RESISTANT
    assert mlkem768_res.threat_model == "Validated_PQC"
    assert mlkem768_res.nist_pqc_category == 3

    mlkem_bare_res = CryptoClassifier.classify("ML-KEM")
    assert mlkem_bare_res.classification == CLASS_QUANTUM_RESISTANT
    assert mlkem_bare_res.threat_model == "Validated_PQC"

    # Historical alias Kyber recognized
    kyber768_res = CryptoClassifier.classify("Kyber-768")
    assert kyber768_res.classification == CLASS_QUANTUM_RESISTANT

    # 8. ML-DSA (NIST FIPS 204 finalized standard name)
    mldsa65_res = CryptoClassifier.classify("ML-DSA-65")
    assert mldsa65_res.classification == CLASS_QUANTUM_RESISTANT
    assert mldsa65_res.threat_model == "Validated_PQC"
    assert mldsa65_res.nist_pqc_category == 3

    mldsa_bare_res = CryptoClassifier.classify("ML-DSA")
    assert mldsa_bare_res.classification == CLASS_QUANTUM_RESISTANT
    assert mldsa_bare_res.threat_model == "Validated_PQC"

    # Historical alias Dilithium recognized
    dilithium3_res = CryptoClassifier.classify("Dilithium3")
    assert dilithium3_res.classification == CLASS_QUANTUM_RESISTANT

    # 9. SLH-DSA (NIST FIPS 205 finalized standard name)
    slhdsa_res = CryptoClassifier.classify("SLH-DSA-SHA2-128s")
    assert slhdsa_res.classification == CLASS_QUANTUM_RESISTANT
    assert slhdsa_res.threat_model == "Validated_PQC"

    slhdsa_bare_res = CryptoClassifier.classify("SLH-DSA")
    assert slhdsa_bare_res.classification == CLASS_QUANTUM_RESISTANT
    assert slhdsa_bare_res.threat_model == "Validated_PQC"

    # Historical alias SPHINCS+ recognized
    sphincs_res = CryptoClassifier.classify("SPHINCS+-SHA2-128s")
    assert sphincs_res.classification == CLASS_QUANTUM_RESISTANT

    # 10. Hybrid classical+PQC
    hybrid_res = CryptoClassifier.classify("X25519MLKEM768")
    assert hybrid_res.classification == CLASS_HYBRID
    assert hybrid_res.threat_model == "Validated_Hybrid"
    assert hybrid_res.hybrid_details["classical_component"] == "X25519"
    assert hybrid_res.hybrid_details["post_quantum_component"] == "ML-KEM-768"

    # 11. Explicitly unknown case
    unknown_res = CryptoClassifier.classify("CUSTOM-PROPRIETARY-CIPHER-V1")
    assert unknown_res.classification == CLASS_UNKNOWN
    assert unknown_res.threat_model == "Unverified"
    assert not unknown_res.is_approved


# =============================================================================
# 4. 4-TIER PQC READINESS CLASSIFICATION
# =============================================================================

def test_pqc_readiness_distinguishes_four_tiers():
    """
    PQC readiness classification must distinguish with evidence for each:
    - Library installed in dependencies vs.
    - Algorithm actually imported vs.
    - Algorithm actually invoked at runtime vs.
    - Explicitly configured.

    CRITICAL INVARIANT: A component must NOT be marked PQC_READY on dependency presence alone!
    """
    # Tier 1: Dependency installed ONLY (must NOT be marked PQC_READY)
    dep_evidence = [
        PqcReadinessEvidence(
            tier=PqcReadinessTier.DEPENDENCY_INSTALLED,
            source="package.json",
            details="npm package 'liboqs-node' ^0.8.0 listed in dependencies",
        )
    ]
    eval_dep_only = evaluate_pqc_readiness("ML-KEM-768", evidence=dep_evidence)
    assert eval_dep_only.is_pqc_ready is False, "Component must NOT be marked PQC_READY on dependency presence alone"
    assert eval_dep_only.status == PqcReadinessStatus.PQC_CAPABLE
    assert eval_dep_only.primary_tier == PqcReadinessTier.DEPENDENCY_INSTALLED
    assert "Cannot be marked PQC_READY on dependency presence alone" in eval_dep_only.justification

    # Tier 2: Algorithm imported in source code
    import_evidence = [
        PqcReadinessEvidence(
            tier=PqcReadinessTier.ALGORITHM_IMPORTED,
            source="src/crypto/kex.py",
            line_number=14,
            details="from oqs import KeyEncapsulation; kex = KeyEncapsulation('ML-KEM-768')",
        )
    ]
    eval_imported = evaluate_pqc_readiness("ML-KEM-768", evidence=import_evidence)
    assert eval_imported.is_pqc_ready is True
    assert eval_imported.status == PqcReadinessStatus.PQC_READY
    assert eval_imported.primary_tier == PqcReadinessTier.ALGORITHM_IMPORTED
    assert eval_imported.readiness_score >= 0.75

    # Tier 3: Algorithm invoked at runtime
    runtime_evidence = [
        PqcReadinessEvidence(
            tier=PqcReadinessTier.RUNTIME_INVOKED,
            source="runtime_event_ebpf",
            details="EVP_PKEY_encapsulate executed with ML-KEM-768 during active TLS session",
        )
    ]
    eval_runtime = evaluate_pqc_readiness("ML-KEM-768", evidence=runtime_evidence)
    assert eval_runtime.is_pqc_ready is True
    assert eval_runtime.status == PqcReadinessStatus.PQC_READY
    assert eval_runtime.primary_tier == PqcReadinessTier.RUNTIME_INVOKED
    assert eval_runtime.readiness_score == 1.0

    # Tier 4: Explicitly configured
    config_evidence = [
        PqcReadinessEvidence(
            tier=PqcReadinessTier.EXPLICITLY_CONFIGURED,
            source="config/tls_profiles.yaml",
            details="ssl_curves: X25519MLKEM768:P256MLKEM768",
        )
    ]
    eval_config = evaluate_pqc_readiness("X25519MLKEM768", evidence=config_evidence)
    assert eval_config.is_pqc_ready is True
    assert eval_config.status == PqcReadinessStatus.PQC_READY
    assert eval_config.primary_tier == PqcReadinessTier.EXPLICITLY_CONFIGURED
    assert eval_config.readiness_score >= 0.9

    # Classical algorithms are NOT_READY regardless of runtime execution
    classical_runtime = [
        PqcReadinessEvidence(
            tier=PqcReadinessTier.RUNTIME_INVOKED,
            source="runtime_event",
            details="RSA_sign executed with 2048-bit key",
        )
    ]
    eval_classical = evaluate_pqc_readiness("RSA", evidence=classical_runtime, key_size=2048)
    assert eval_classical.is_pqc_ready is False
    assert eval_classical.status == PqcReadinessStatus.NOT_READY
    assert eval_classical.readiness_score == 0.0

    # Zero assets / unassessed case: renders null / NOT_ASSESSED
    eval_zero = evaluate_pqc_readiness(None)
    assert eval_zero.is_pqc_ready is False
    assert eval_zero.status == PqcReadinessStatus.NOT_ASSESSED
    assert eval_zero.readiness_score is None


# =============================================================================
# 5. MIGRATION USE-CASE MATCHING & MISMATCH DETECTION
# =============================================================================

def test_migration_recommendations_preserve_use_case_boundary():
    """
    Migration recommendations must strictly match the detected cryptographic use case:
    - Key-establishment findings must NEVER recommend signature algorithms (e.g. ML-DSA, SLH-DSA).
    - Digital signature findings must NEVER recommend key-establishment algorithms (e.g. ML-KEM).
    """
    # 1. Key Establishment Finding -> Must recommend KEM / Hybrid KEX
    kex_finding = {
        "algorithm": "ECDH",
        "category": "key_exchange",
        "key_size": 256,
        "name": "Session KEX",
    }
    use_case_kex = detect_cryptographic_use_case(kex_finding)
    assert use_case_kex == "KEY_ESTABLISHMENT"

    kex_candidates = identify_replacement_candidates(kex_finding)
    assert len(kex_candidates) > 0
    for cand in kex_candidates:
        algo = cand["algorithm"]
        # Must be KEM or hybrid KEX
        assert any(k in algo for k in ["ML-KEM", "X25519MLKEM768", "SecP256r1MLKEM768", "KEM"])
        # Must NEVER be a digital signature algorithm!
        assert not any(s in algo for s in ["ML-DSA", "SLH-DSA", "Dilithium", "SPHINCS", "LMS", "XMSS"])

    # 2. Digital Signature Finding -> Must recommend PQC signature
    sig_finding = {
        "algorithm": "ECDSA",
        "category": "signature",
        "key_size": 256,
        "name": "Auth Token Signer",
    }
    use_case_sig = detect_cryptographic_use_case(sig_finding)
    assert use_case_sig == "DIGITAL_SIGNATURE"

    sig_candidates = identify_replacement_candidates(sig_finding)
    assert len(sig_candidates) > 0
    for cand in sig_candidates:
        algo = cand["algorithm"]
        # Must be digital signature standard
        assert any(s in algo for s in ["ML-DSA", "SLH-DSA", "LMS", "SPHINCS"])
        # Must NEVER be a KEM!
        assert not any(k in algo for k in ["ML-KEM", "Kyber", "X25519MLKEM768"])


def test_migration_recommendation_use_case_mismatch_raises_error():
    """
    Enforces that recommending a signature algorithm for key establishment or vice versa
    raises a ValueError. This test catches this class of mismatch.
    """
    # Mismatch 1: Key Establishment finding given a signature algorithm
    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("KEY_ESTABLISHMENT", "ML-DSA-65")

    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("KEY_ESTABLISHMENT", "SLH-DSA-SHA2-128s")

    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("KEY_ESTABLISHMENT", "LMS/HSS")

    # Mismatch 2: Digital Signature finding given a KEM algorithm
    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("DIGITAL_SIGNATURE", "ML-KEM-768")

    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("DIGITAL_SIGNATURE", "X25519MLKEM768")

    with pytest.raises(ValueError, match="Cryptographic Use Case Mismatch"):
        validate_migration_use_case_match("DIGITAL_SIGNATURE", "SecP256r1MLKEM768")

    # Valid matches must return True without error
    assert validate_migration_use_case_match("KEY_ESTABLISHMENT", "ML-KEM-768") is True
    assert validate_migration_use_case_match("KEY_ESTABLISHMENT", "X25519MLKEM768") is True
    assert validate_migration_use_case_match("DIGITAL_SIGNATURE", "ML-DSA-65") is True
    assert validate_migration_use_case_match("DIGITAL_SIGNATURE", "SLH-DSA-SHA2-128s") is True
