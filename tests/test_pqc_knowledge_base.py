"""
Test suite for ECDAT Versioned PQC Knowledge Base (Phase 10.1).
"""

import pytest
from scanners.pqc_knowledge_base import (
    load_pqc_catalog,
    lookup_pqc_algorithm,
    list_algorithms_by_category,
    list_algorithms_by_usage,
    get_authority_recommendations,
    get_stateful_hash_guidelines,
    get_hybrid_tls_guidelines,
)


def test_pqc_catalog_version_and_authorities():
    cat = load_pqc_catalog()
    assert cat["catalog_version"] == "2.0.0"
    assert len(cat["algorithms"]) >= 15

    authorities = cat["authorities_tracked"]
    assert "nist" in authorities
    assert "anssi" in authorities
    assert "bsi" in authorities
    assert "nsa_cnsa" in authorities
    assert "ietf" in authorities


def test_ml_kem_fips_203():
    mlkem768 = lookup_pqc_algorithm("ML-KEM-768")
    assert mlkem768 is not None
    assert mlkem768["standard_reference"] == "NIST FIPS 203"
    assert mlkem768["nist_quantum_security_level"] == 3
    assert mlkem768["harvest_now_decrypt_later_resilient"] is True
    assert mlkem768["characteristics"]["public_key_bytes"] == 1184
    assert mlkem768["characteristics"]["ciphertext_bytes"] == 1088

    # Alias check
    by_kyber = lookup_pqc_algorithm("kyber768")
    assert by_kyber["id"] == "ml_kem_768"


def test_ml_dsa_fips_204():
    mldsa65 = lookup_pqc_algorithm("ML-DSA-65")
    assert mldsa65 is not None
    assert mldsa65["standard_reference"] == "NIST FIPS 204"
    assert mldsa65["mechanism_type"] == "digital_signature"
    assert mldsa65["characteristics"]["signature_bytes"] == 3309

    by_dilithium = lookup_pqc_algorithm("Dilithium3")
    assert by_dilithium["id"] == "ml_dsa_65"


def test_slh_dsa_fips_205():
    slhdsa = lookup_pqc_algorithm("SLH-DSA-SHA2-128s")
    assert slhdsa is not None
    assert slhdsa["standard_reference"] == "NIST FIPS 205"
    assert slhdsa["characteristics"]["public_key_bytes"] == 32
    assert "Stateless" in slhdsa["migration_considerations"]["state_management"]


def test_stateful_hash_signatures():
    lms = lookup_pqc_algorithm("LMS/HSS")
    assert lms is not None
    assert lms["mechanism_type"] == "stateful_hash_signature"
    assert lms["usage_category"] == "FIRMWARE_CODE_SIGNING"
    assert "CRITICAL HAZARD" in lms["migration_considerations"]["state_management"]

    guidelines = get_stateful_hash_guidelines()
    assert "completely destroys private key security" in guidelines["state_management_hazard"]
    assert any("monotonic" in r for r in guidelines["hardware_security_module_requirements"])


def test_hybrid_key_establishment():
    tls_hybrid = lookup_pqc_algorithm("X25519MLKEM768")
    assert tls_hybrid is not None
    assert tls_hybrid["iana_tls_group_id"] == 4588
    assert tls_hybrid["iana_tls_group_hex"] == "0x11ec"
    assert tls_hybrid["hybrid_components"]["combiner_function"] == "HKDF-SHA256"


def test_multi_authority_recommendations_no_single_vendor_bias():
    recs = get_authority_recommendations("ML-KEM-1024")
    assert recs is not None
    auths = recs["authorities"]
    assert "nist" in auths
    assert "anssi" in auths
    assert "bsi" in auths
    assert "nsa_cnsa" in auths

    # NSA mandates Level 5 exclusively, while NIST general recommendation is ML-KEM-768
    assert "MANDATORY" in auths["nsa_cnsa"]


def test_hybrid_tls_guidelines():
    tls = get_hybrid_tls_guidelines()
    assert "0x11ec" in tls["primary_recommended_group"]
    assert any(g["iana_hex"] == "0x11ec" for g in tls["supported_groups"])
    assert "draft-ietf-tls-hybrid-design" in tls["standards_track"]
