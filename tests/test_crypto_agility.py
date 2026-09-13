"""
Test suite for ECDAT Crypto-Agility Scoring Engine (Phase 10.3).
"""

import pytest
from scanners.crypto_agility import (
    AGILITY_DIMENSIONS,
    DEFAULT_WEIGHTS,
    calculate_crypto_agility,
    resolve_maturity_tier,
)


def test_evaluates_all_10_architecture_dimensions():
    result = calculate_crypto_agility([])

    assert 0.0 <= result["overall_agility_score"] <= 100.0
    assert result["maturity_tier"] in ["OPTIMAL", "HIGH", "MODERATE", "LOW", "RIGID"]
    assert "mathematical_proof" in result

    dims = result["dimensions"]
    assert len(dims) == 10

    for expected in AGILITY_DIMENSIONS:
        assert expected in dims
        dim = dims[expected]
        assert isinstance(dim["raw_score"], (int, float))
        assert isinstance(dim["weight_percent"], (int, float))
        assert isinstance(dim["weighted_contribution"], (int, float))
        assert dim["calculation_formula"]
        assert isinstance(dim["actionable_recommendations"], list)


def test_mathematical_transparency_and_proof():
    meta = {
        "centralized_config": {"has_crypto_policy_file": True},
        "replaceability": {"interface_based_crypto_design": True},
        "key_lifecycle": {"kms_hsm_integration": True},
        "protocol_agility": {"tls_1_3_dynamic_groups": True},
        "certificate_automation": {"acme_automated_renewal": True},
        "provider_abstraction": {"standard_provider_framework": True},
        "dependency_coupling": {"isolated_crypto_service_module": True},
        "test_coverage": {"known_answer_tests_kat": True},
        "pqc_hybrid_readiness": {"pqc_capable_library_dependency": True},
        "rollback_capability": {"runtime_feature_flag_rollback": True},
    }

    result = calculate_crypto_agility([], architecture_metadata=meta)
    proof = result["mathematical_proof"]

    assert "Overall Agility Score = Sum" in proof["formula"]
    assert proof["checksum_verified"] is True
    assert len(proof["step_by_step_calculation"]) == 10

    # Verify manual sum of step contributions matches overall score
    manual_sum = sum(step["weighted_contribution"] for step in proof["step_by_step_calculation"])
    assert abs(manual_sum - result["overall_agility_score"]) < 0.2


def test_modern_agile_architecture_optimal_rating():
    meta = {
        "has_crypto_policy_file": True,
        "has_central_registry": True,
        "uses_interfaces": True,
        "uses_algorithm_factory": True,
        "uses_kms": True,
        "automated_key_rotation": True,
        "tls_1_3_enabled": True,
        "acme_enabled": True,
        "short_lived_certs": True,
        "uses_standard_provider": True,
        "isolated_crypto_service": True,
        "crypto_blast_radius": 1,
        "has_kat_tests": True,
        "has_downgrade_tests": True,
        "has_pqc_library": True,
        "hybrid_supported": True,
        "has_feature_flags": True,
        "dual_stack_supported": True,
    }
    findings = [{"algorithm": "X25519MLKEM768", "asset_type": "protocol"}]

    result = calculate_crypto_agility(findings, architecture_metadata=meta)

    assert result["overall_agility_score"] >= 85.0
    assert result["maturity_tier"] in ["OPTIMAL", "HIGH"]
    assert len(result["primary_agility_blockers"]) == 0
    assert len(result["agility_strengths"]) >= 7
    assert result["maturity_label"] in result["executive_summary"]


def test_brittle_legacy_architecture_blockers_and_quick_wins():
    meta = {
        "centralized_config": {"hardcoded_algorithm_strings_inline": True},
        "replaceability": {"concrete_class_coupling": True, "fixed_size_signature_buffer": True},
        "key_lifecycle": {"hardcoded_static_keys": True},
        "protocol_agility": {"pinned_legacy_protocol": True},
        "certificate_automation": {"manual_certificate_provisioning": True, "expired_or_imminent_expiration": True},
        "provider_abstraction": {"vendor_lock_in_api": True},
        "dependency_coupling": {"high_blast_radius_sprawl": True},
        "test_coverage": {"zero_crypto_test_coverage": True},
        "pqc_hybrid_readiness": {"pqc_intolerant_buffer_limits": True},
        "rollback_capability": {"irreversible_crypto_migration": True},
    }
    findings = [
        {"algorithm": "DES", "asset_type": "hardcoded_private_key"},
        {"algorithm": "TLS 1.0", "asset_type": "protocol"},
        {"algorithm": "RSA-1024", "certificate_properties": {"isExpired": True}},
    ]

    result = calculate_crypto_agility(findings, architecture_metadata=meta)

    assert result["overall_agility_score"] <= 25.0
    assert result["maturity_tier"] == "RIGID"
    assert len(result["primary_agility_blockers"]) >= 8

    # Check urgent blockers
    urgent = [b for b in result["primary_agility_blockers"] if b["remediation_priority"] == "URGENT_BLOCKER"]
    assert len(urgent) >= 5

    # Check quick wins
    assert len(result["quick_wins"]) >= 2
    assert any(q["effort"] == "LOW" for q in result["quick_wins"])


def test_custom_weights_modulation():
    custom_weights = {
        "pqc_hybrid_readiness": 50.0,
        "rollback_capability": 50.0,
        "centralized_algorithm_configuration": 0.0,
        "replaceability": 0.0,
        "key_lifecycle_management": 0.0,
        "protocol_agility": 0.0,
        "certificate_automation": 0.0,
        "provider_abstraction": 0.0,
        "dependency_coupling": 0.0,
        "test_coverage": 0.0,
    }
    meta = {
        "pqc_hybrid_readiness": {"pqc_capable_library_dependency": True, "hybrid_key_exchange_support": True},
        "rollback_capability": {"runtime_feature_flag_rollback": True, "dual_stack_fallback": True},
    }

    result = calculate_crypto_agility([], architecture_metadata=meta, options={"weights": custom_weights})

    assert result["dimensions"]["pqc_hybrid_readiness"]["weight_percent"] == 50.0
    assert result["dimensions"]["rollback_capability"]["weight_percent"] == 50.0
    assert result["dimensions"]["centralized_algorithm_configuration"]["weight_percent"] == 0.0
    assert result["overall_agility_score"] >= 80.0
