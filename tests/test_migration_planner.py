"""
Test suite for ECDAT Migration Planner (Phase 10.2).
"""

import pytest
from scanners.migration_planner import (
    LIFECYCLE_PHASES,
    identify_why_risky,
    identify_replacement_candidates,
    identify_dependencies,
    identify_affected_services,
    estimate_migration_complexity,
    identify_testing_requirements,
    propose_staged_rollout,
    define_rollback,
    define_rescan_verification,
    plan_asset_migration,
    create_enterprise_migration_plan,
)


def test_step1_identify_why_risky():
    # Broken classical algorithm
    md5_risk = identify_why_risky({"algorithm": "MD5"})
    assert "Broken classical algorithm" in md5_risk["classical_weakness"]

    # Weak RSA key size
    rsa1024_risk = identify_why_risky({"algorithm": "RSA", "key_size": 1024})
    assert "Sub-standard RSA key size" in rsa1024_risk["classical_weakness"]
    assert "Shor's algorithm" in rsa1024_risk["quantum_vulnerability"]

    # Internet exposed with Mosca deficit
    ecdh_risk = identify_why_risky(
        {"algorithm": "ECDH", "is_internet_facing": True, "mosca": {"status": "CRITICAL_URGENT"}}
    )
    assert "Shor's algorithm" in ecdh_risk["quantum_vulnerability"]
    assert "Harvest-Now-Decrypt-Later" in ecdh_risk["environmental_exposure"]
    assert "Critical Mosca deficit" in ecdh_risk["mosca_urgency"]


def test_step2_identify_replacement_candidates():
    # TLS key exchange
    tls_asset = {"algorithm": "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"}
    tls_cands = identify_replacement_candidates(tls_asset)
    assert any(c["algorithm"] == "X25519MLKEM768" for c in tls_cands)
    assert any(c["algorithm"] == "SecP256r1MLKEM768" for c in tls_cands)

    # Digital signature / certificate
    cert_asset = {"algorithm": "RSA-2048", "asset_type": "certificate"}
    cert_cands = identify_replacement_candidates(cert_asset)
    assert any(c["algorithm"] == "ML-DSA-65" for c in cert_cands)
    assert any(c["algorithm"] == "SLH-DSA-SHA2-128s" for c in cert_cands)

    # Firmware signing (Stateful hash LMS/HSS)
    fw_asset = {"algorithm": "RSA-3072", "asset_type": "firmware"}
    fw_cands = identify_replacement_candidates(fw_asset)
    assert any(c["algorithm"] == "LMS/HSS" for c in fw_cands)


def test_step3_identify_dependencies():
    asset = {"algorithm": "ECDH"}
    cand = {"algorithm": "X25519MLKEM768"}
    deps = identify_dependencies(asset, cand)
    assert any("TLS 1.3" in p for p in deps["protocols"])
    assert any("OpenSSL" in lib for lib in deps["cryptographic_libraries"])

    # LMS/HSS hardware monotonic counter requirement
    lms_asset = {"algorithm": "RSA", "asset_type": "firmware"}
    lms_cand = {"algorithm": "LMS/HSS"}
    lms_deps = identify_dependencies(lms_asset, lms_cand)
    assert any("monotonic" in h for h in lms_deps["hardware_requirements"])


def test_step4_identify_affected_services():
    asset = {
        "asset_id": "auth_token_cert",
        "application": "auth-service",
        "dependency_blast_radius": 4,
        "is_internet_facing": True,
    }
    affected = identify_affected_services(asset)
    assert affected["primary_application"] == "auth-service"
    assert affected["total_dependent_services"] == 4
    assert len(affected["affected_services"]) == 4
    assert affected["external_clients_affected"] is True


def test_step5_estimate_migration_complexity():
    asset = {"algorithm": "RSA-1024", "asset_type": "signing_key"}
    cand = {"algorithm": "ML-DSA-65"}
    comp = estimate_migration_complexity(asset, cand)
    assert 1 <= comp["complexity_score"] <= 10
    assert comp["effort_level"] in ["LOW", "MEDIUM", "HIGH", "COMPLEX"]
    assert comp["estimated_person_days"] > 0
    assert len(comp["breakdown"]) > 0


def test_step6_identify_testing_requirements():
    asset = {"algorithm": "ECDH", "is_internet_facing": True}
    cand = {"algorithm": "X25519MLKEM768"}
    testing = identify_testing_requirements(asset, cand)
    assert len(testing["functional_tests"]) > 0
    assert any("MTU" in t or "fragmentation" in t for t in testing["interoperability_tests"])
    assert len(testing["performance_benchmarks"]) > 0
    assert len(testing["rollback_smoke_tests"]) > 0


def test_step7_propose_staged_rollout():
    asset = {"asset_id": "edge_proxy"}
    cand = {"algorithm": "X25519MLKEM768"}
    rollout = propose_staged_rollout(asset, cand)
    assert len(rollout) == 4
    assert rollout[0]["phase"] == 1
    assert rollout[1]["phase"] == 2
    assert rollout[2]["phase"] == 3
    assert rollout[3]["phase"] == 4
    for r in rollout:
        assert r["duration_weeks"] > 0
        assert r["exit_criteria"]


def test_step8_define_rollback():
    asset = {"asset_id": "ingress_tls"}
    rollback = define_rollback(asset)
    assert any("Handshake error rate" in t for t in rollback["pre_condition_triggers"])
    assert len(rollback["automated_procedure"]) >= 3
    assert rollback["zero_downtime_guaranteed"] is True


def test_step9_define_rescan_verification():
    asset = {"asset_id": "api_gateway", "algorithm": "RSA-1024"}
    cand = {"algorithm": "ML-DSA-65"}
    rescan = define_rescan_verification(asset, cand)
    assert "CI/CD" in rescan["verification_trigger"]
    assert "Never treat absence of a finding" in rescan["absence_proof_disclaimer"]
    assert rescan["expected_cbom_diff"]["removed_components"][0]["algorithm"] == "RSA-1024"
    assert rescan["expected_cbom_diff"]["new_components"][0]["algorithm"] == "ML-DSA-65"
    assert len(rescan["regression_checks"]) > 0


def test_plan_asset_migration():
    asset = {
        "asset_id": "cert_tls_1",
        "algorithm": "ECDH",
        "asset_type": "protocol",
        "is_internet_facing": True,
    }
    plan = plan_asset_migration(asset)
    assert plan["asset_id"] == "cert_tls_1"
    assert plan["why_risky"] is not None
    assert len(plan["replacement_candidates"]) > 0
    assert plan["selected_candidate"] is not None
    assert plan["dependencies"] is not None
    assert plan["affected_services"] is not None
    assert plan["migration_complexity"] is not None
    assert plan["testing_requirements"] is not None
    assert plan["staged_rollout"] is not None
    assert plan["rollback_plan"] is not None
    assert plan["rescan_verification"] is not None


def test_create_enterprise_migration_plan_lifecycle():
    inventory = [
        {
            "asset_id": "edge_tls",
            "algorithm": "ECDH",
            "asset_type": "protocol",
            "is_internet_facing": True,
        },
        {
            "asset_id": "api_signer",
            "algorithm": "RSA",
            "key_size": 1024,
            "asset_type": "certificate",
            "is_internet_facing": False,
        },
        {
            "asset_id": "hash_store",
            "algorithm": "MD5",
            "asset_type": "hash",
            "is_internet_facing": False,
        },
    ]

    plan = create_enterprise_migration_plan(inventory)

    # Supported lifecycle phases
    assert plan["lifecycle_phases_supported"] == ["DISCOVER", "ASSESS", "PLAN", "SIMULATE", "REMEDIATE", "VERIFY"]

    # DISCOVER
    assert plan["discover_phase"]["discovered_assets_count"] == 3

    # ASSESS
    assert plan["assess_phase"]["assessed_assets_count"] == 3

    # PLAN
    assert len(plan["plan_phase"]["asset_plans"]) == 3

    # SIMULATE
    assert len(plan["simulate_phase"]["simulation_results"]) == 3
    for s in plan["simulate_phase"]["simulation_results"]:
        assert s["simulation_passed"] is True
        assert s["middlebox_fragmentation_risk"] is not None

    # REMEDIATE
    assert len(plan["remediate_phase"]["recipes"]) >= 2
    edge_recipe = next(r for r in plan["remediate_phase"]["recipes"] if r["asset_id"] == "edge_tls")
    assert "ssl_protocols TLSv1.3" in edge_recipe["remediation_snippet"]

    # VERIFY
    assert plan["verify_phase"]["total_assets_to_verify"] == 3
    assert len(plan["verify_phase"]["automated_rules"]) >= 4
