import pytest
from scanners.migration_planner import (
    AssetClassification, MoscaResult, generate_roadmap, build_current_state,
    compute_priority, compute_migration_complexity, get_hybrid_logic, build_scope_statement
)

@pytest.fixture
def base_mosca():
    return MoscaResult(margin_years=5.0, quantum_vulnerable=True, status="AT_RISK")

@pytest.fixture
def classifications(base_mosca):
    # 3 DES calls in crypto/des/impl.c (production, unguarded)
    # 2 DES calls in test/destest.c
    # 1 DES call under #ifdef OPENSSL_NO_DES with build config NOT defining it by default
    c_des = AssetClassification(
        id="c1",
        algorithm="DES",
        total_occurrences=6,
        file_count=3,
        occurrences_by_context={"production": 4, "test": 2},
        guarded_occurrences=1,
        reachable_by_default=True,
        reachable_rationale="no build configuration found; assuming reachable (unverified)",
        is_library=True,
        public_api_surface=True,
        downstream_consumer_count=None,
        base_severity="critical",
        confidence_level="high",
        mosca=base_mosca,
        sample_locations=["crypto/des/impl.c:10", "crypto/des/impl.c:15", "crypto/des/impl.c:20"],
        single_call_site_wraps_all_uses=False,
        data_sensitivity="high"
    )

    # 1 MD5 call with exactly 1 occurrence
    c_md5 = AssetClassification(
        id="c2",
        algorithm="MD5",
        total_occurrences=1,
        file_count=1,
        occurrences_by_context={"production": 1},
        guarded_occurrences=0,
        reachable_by_default=True,
        reachable_rationale="no build config found",
        is_library=True,
        public_api_surface=False,
        downstream_consumer_count=0,
        base_severity="high",
        confidence_level="high",
        mosca=base_mosca,
        sample_locations=["apps/crl.c:71"],
        single_call_site_wraps_all_uses=True,
        data_sensitivity="unknown"
    )

    # KEM-role algorithm
    c_ecdh = AssetClassification(
        id="c3",
        algorithm="ECDH",
        total_occurrences=5,
        file_count=2,
        occurrences_by_context={"production": 5},
        guarded_occurrences=0,
        reachable_by_default=True,
        reachable_rationale="default",
        is_library=True,
        public_api_surface=True,
        downstream_consumer_count=5,
        base_severity="high",
        confidence_level="high",
        mosca=base_mosca,
        sample_locations=["crypto/ec/ecdh.c:10", "crypto/ec/ecdh.c:20", "crypto/ec/ecdh_kdf.c:30"],
        single_call_site_wraps_all_uses=False,
        data_sensitivity="unknown"
    )

    # Test only algorithm (should not be critical)
    c_test_only = AssetClassification(
        id="c4",
        algorithm="RC4",
        total_occurrences=10,
        file_count=5,
        occurrences_by_context={"test": 10},
        guarded_occurrences=0,
        reachable_by_default=False,
        reachable_rationale="test only",
        is_library=False,
        public_api_surface=False,
        downstream_consumer_count=0,
        base_severity="critical",
        confidence_level="high",
        mosca=base_mosca,
        sample_locations=["test/rc4test.c:10"],
        single_call_site_wraps_all_uses=False,
        data_sensitivity="unknown"
    )
    
    return [c_des, c_md5, c_ecdh, c_test_only]

def test_context_classification_matches_fixture(classifications):
    roadmap = generate_roadmap(classifications, 100)
    entries = roadmap["entries"]
    
    # DES has production occurrences and is reachable
    des_entry = next(e for e in entries if e["algorithm"] == "DES")
    assert des_entry["context_bucket"] == "production_default_reachable"
    
    # RC4 is test only
    rc4_entry = next(e for e in entries if e["algorithm"] == "RC4")
    assert rc4_entry["context_bucket"] == "test_or_example"

def test_priority_never_critical_for_test_only(classifications):
    roadmap = generate_roadmap(classifications, 100)
    entries = roadmap["entries"]
    
    rc4_entry = next(e for e in entries if e["algorithm"] == "RC4")
    assert rc4_entry["context_bucket"] == "test_or_example"
    # priority should be informational for test only or guarded out
    assert rc4_entry["priority"] == "informational"

def test_current_state_cites_real_evidence(classifications):
    roadmap = generate_roadmap(classifications, 100)
    entries = roadmap["entries"]
    
    des_entry = next(e for e in entries if e["algorithm"] == "DES")
    assert "detected in 6 occurrence(s) across 3 file(s)" in des_entry["current_state"]
    assert "crypto/des/impl.c:10" in des_entry["current_state"]
    assert "and 3 more location(s)" in des_entry["current_state"]
    
    md5_entry = next(e for e in entries if e["algorithm"] == "MD5")
    assert md5_entry["current_state"] == "MD5 detected once, at apps/crl.c:71."

def test_no_duplicate_mosca_sources(classifications, base_mosca):
    roadmap = generate_roadmap(classifications, 100)
    entries = roadmap["entries"]
    for e in entries:
        assert e["mosca"]["margin_years"] == base_mosca.margin_years
        assert e["mosca"]["quantum_vulnerable"] == base_mosca.quantum_vulnerable
        assert e["mosca"]["status"] == base_mosca.status

def test_hybrid_only_for_kem_sig_roles(classifications):
    roadmap = generate_roadmap(classifications, 100)
    entries = roadmap["entries"]
    
    ecdh_entry = next(e for e in entries if e["algorithm"] == "ECDH")
    assert ecdh_entry["hybrid_transition_recommended"] is True
    assert "Generic-Hybrid" in ecdh_entry["hybrid_note"] or "X25519-ML-KEM-768" in ecdh_entry["hybrid_note"]
    
    md5_entry = next(e for e in entries if e["algorithm"] == "MD5")
    assert md5_entry["hybrid_transition_recommended"] is False
    assert "MD5 is a hash" in md5_entry["hybrid_note"]
    
    des_entry = next(e for e in entries if e["algorithm"] == "DES")
    assert des_entry["hybrid_transition_recommended"] is False
    assert "DES is a symmetric" in des_entry["hybrid_note"]

def test_scope_statement_numbers_match_input_data(classifications):
    roadmap = generate_roadmap(classifications, 100)
    stmt = roadmap["scope_statement"]
    # 3 assets are production reachable (DES, MD5, ECDH), 1 is excluded (RC4)
    # Total occurrences = 6 + 1 + 5 + 10 = 22
    assert "Total assets scanned: 100." in stmt
    assert "Assets fed into this roadmap as production-reachable: 3." in stmt
    assert "Assets excluded as test-only/guarded-out: 1." in stmt
    assert "4 high confidence, 0 low confidence" in stmt
    assert "from 22 static occurrences" in stmt

def test_phase_assignment_uses_real_entries_not_static_lists(classifications):
    roadmap = generate_roadmap(classifications, 100)
    seq = roadmap["suggested_sequence"]
    
    # Phase 1: Critical/High + Low/Medium Complexity
    # MD5 has single_call_site_wraps_all_uses=True, public_api_surface=False => complexity "low", priority "high"
    assert "MD5" in seq["Phase 1 (0-6mo)"]
    
    # Phase 2: High priority + High/Unknown complexity
    # ECDH has public_api_surface=True, down=5 (not None) => complexity "medium" -> wait, medium is Phase 1
    # DES has complexity "unknown" because public_api_surface=True and down=None => Phase 2 or Phase 5
    # priority for DES: Critical. Wait, Phase 2 is "high" priority but DES is critical. Phase 1 includes "critical".
    # Wait, Phase 5: unknown complexity. DES is unknown complexity.
    assert "DES" in seq["Phase 5 (ongoing)"]
    
    # Phase 3: data_sensitivity == "high"
    assert "DES" in seq["Phase 3 (6-18mo)"]
    
    # Phase 4: hybrid_transition_recommended == True
    assert "ECDH" in seq["Phase 4 (12-24mo)"]
