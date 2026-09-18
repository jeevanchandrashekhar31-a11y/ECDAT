"""
Tests for Task 24 (P1 - Scanner Result Integrity)

Verifies:
1. 6 Canonical result states: FOUND, NOT_FOUND, NOT_SCANNED, SCAN_ERROR, UNSUPPORTED, UNKNOWN.
2. Anti-Collapse Invariants:
   - NEVER collapse NOT_SCANNED into NOT_FOUND.
   - NEVER collapse ERROR / SCAN_ERROR into CLEAN.
   - NEVER collapse UNSUPPORTED into NOT_FOUND.
3. Provenance completeness for all findings (location, detection_method, rule_id, tool_name, snippet).
4. Overall scan assessment non-collapsing logic (verdict cannot be CLEAN if unscanned/error items exist).
"""

import pytest
from scanners.common.result_integrity import (
    ResultState,
    CANONICAL_STATES,
    ABSENCE_DISCLAIMER,
    ResultIntegrityViolation,
    validate_result_state,
    assert_no_illegal_collapse,
    FindingProvenance,
    ResultIntegrityTracker,
)


def test_six_canonical_states_defined():
    """Verify all 6 canonical states exist and match user specification."""
    expected_states = {"FOUND", "NOT_FOUND", "NOT_SCANNED", "SCAN_ERROR", "UNSUPPORTED", "UNKNOWN"}
    assert CANONICAL_STATES == expected_states
    for s in expected_states:
        assert validate_result_state(s) == ResultState(s)


def test_invalid_state_rejection():
    """Verify unknown or invented states are rejected."""
    with pytest.raises(ResultIntegrityViolation, match="Invalid scanner result state"):
        validate_result_state("SKIPPED_AND_FINE")

    with pytest.raises(ResultIntegrityViolation, match="Invalid scanner result state"):
        validate_result_state("PASS")


def test_anti_collapse_not_scanned_into_not_found():
    """CRITICAL: Never collapse NOT_SCANNED into NOT_FOUND."""
    # Direct check
    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'NOT_FOUND'"):
        assert_no_illegal_collapse("NOT_FOUND", "NOT_SCANNED", context="oversized_file.dat")

    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'CLEAN'"):
        assert_no_illegal_collapse("CLEAN", "SKIPPED", context="excluded_dir")


def test_anti_collapse_error_into_clean():
    """CRITICAL: Never collapse ERROR / SCAN_ERROR into CLEAN."""
    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'CLEAN'"):
        assert_no_illegal_collapse("CLEAN", "SCAN_ERROR", context="crashed_parser")

    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'NOT_FOUND'"):
        assert_no_illegal_collapse("NOT_FOUND", "ERROR", context="read_permission_denied")

    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'SUCCESS'"):
        assert_no_illegal_collapse("SUCCESS", "CRASH", context="subscanner_segfault")


def test_anti_collapse_unsupported_into_not_found():
    """CRITICAL: Never collapse UNSUPPORTED into NOT_FOUND."""
    with pytest.raises(ResultIntegrityViolation, match="illegally collapsed into 'NOT_FOUND'"):
        assert_no_illegal_collapse("NOT_FOUND", "UNSUPPORTED", context="unsupported_extension.xyz")


def test_finding_provenance_validation_complete():
    """Verify valid finding provenance passes verification."""
    prov = FindingProvenance(
        location="src/crypto/kex.py:54",
        line_number=54,
        snippet="kyber768.encapsulate(pk)",
        detection_method="ast",
        rule_id="ECDAT-AST-MLKEM-001",
        algorithm_or_asset="ML-KEM-768",
        confidence="high",
        tool_name="ECDAT Static Scanner",
        tool_version="1.0.0",
    )
    valid, errors = prov.validate()
    assert valid is True
    assert len(errors) == 0


def test_finding_provenance_validation_detects_missing_metadata():
    """Verify incomplete provenance is caught and rejected."""
    # Missing location
    prov1 = FindingProvenance(
        location="",
        detection_method="ast",
        rule_id="ECDAT-001",
        tool_name="ECDAT",
    )
    valid1, errs1 = prov1.validate()
    assert valid1 is False
    assert any("auditable physical location" in e for e in errs1)

    # Missing detection method
    prov2 = FindingProvenance(
        location="src/auth.py:10",
        detection_method="unknown",
        rule_id="ECDAT-001",
        tool_name="ECDAT",
    )
    valid2, errs2 = prov2.validate()
    assert valid2 is False
    assert any("detection_method" in e for e in errs2)

    # Placeholder rule ID
    prov3 = FindingProvenance(
        location="src/auth.py:10",
        detection_method="ast",
        rule_id="TODO",
        tool_name="ECDAT",
    )
    valid3, errs3 = prov3.validate()
    assert valid3 is False
    assert any("rule_id" in e for e in errs3)


def test_result_integrity_tracker_all_six_states():
    """Verify tracker accurately counts each state and enforces non-collapsing verdict."""
    tracker = ResultIntegrityTracker("Full Pipeline Scanner")

    # 1. FOUND
    prov = FindingProvenance(
        location="src/sec.py:10",
        detection_method="ast",
        rule_id="ECDAT-AES",
        tool_name="ECDAT",
    )
    tracker.record_found(
        item_id="f1",
        target="src/sec.py",
        findings=[{"algo": "AES"}],
        provenance_list=[prov],
    )

    # 2. NOT_FOUND
    tracker.record_not_found("f2", "src/utils.py")

    # 3. NOT_SCANNED
    tracker.record_not_scanned("f3", "data/huge_dump.bin", "exceeds 5MB max file size")

    # 4. SCAN_ERROR
    tracker.record_scan_error("f4", "src/unreadable.py", "Permission denied")

    # 5. UNSUPPORTED
    tracker.record_unsupported("f5", "assets/model.onnx", "Machine learning binary weights")

    # 6. UNKNOWN
    tracker.record_unknown("f6", "src/obfuscated.js", "Eval payload dynamic reflection")

    summary = tracker.get_summary()
    assert summary["total_items"] == 6
    assert summary["found_count"] == 1
    assert summary["not_found_count"] == 1
    assert summary["not_scanned_count"] == 1
    assert summary["scan_error_count"] == 1
    assert summary["unsupported_count"] == 1
    assert summary["unknown_count"] == 1

    # Because scan_error_count > 0, verdict MUST be SCAN_ERROR (never CLEAN)
    assert summary["overall_verdict"] == "SCAN_ERROR"
    assert summary["clean_certified"] is False
    assert summary["absence_of_finding_disclaimer"] == ABSENCE_DISCLAIMER


def test_result_integrity_tracker_unscanned_items_prevent_clean_verdict():
    """Verify that having NOT_SCANNED items prevents clean certification even if 0 findings."""
    tracker = ResultIntegrityTracker("Partial Scanner")

    # Target 1: verified clean
    tracker.record_not_found("f1", "src/clean1.py")
    # Target 2: verified clean
    tracker.record_not_found("f2", "src/clean2.py")
    # Target 3: skipped because of exclude directory rule
    tracker.record_not_scanned("f3", "vendor/lib.py", "Excluded directory")

    summary = tracker.get_summary()
    assert summary["found_count"] == 0
    assert summary["scan_error_count"] == 0
    assert summary["not_found_count"] == 2
    assert summary["not_scanned_count"] == 1

    # MUST NOT BE CLEAN! Must be PARTIAL_ASSESSMENT with disclaimer
    assert summary["overall_verdict"] == "PARTIAL_ASSESSMENT"
    assert summary["clean_certified"] is False
    assert ABSENCE_DISCLAIMER in summary["absence_of_finding_disclaimer"]


def test_result_integrity_tracker_only_certified_clean_when_all_inspected():
    """Verify clean is only certified when 100% of discovered items were affirmatively inspected."""
    tracker = ResultIntegrityTracker("Clean Scanner")
    tracker.record_not_found("f1", "src/a.py")
    tracker.record_not_found("f2", "src/b.py")

    summary = tracker.get_summary()
    assert summary["total_items"] == 2
    assert summary["not_found_count"] == 2
    assert summary["not_scanned_count"] == 0
    assert summary["scan_error_count"] == 0
    assert summary["overall_verdict"] == "CLEAN"
    assert summary["clean_certified"] is True
    assert summary["absence_of_finding_disclaimer"] == ""
