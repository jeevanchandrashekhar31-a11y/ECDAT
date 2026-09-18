# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Scanner Result Integrity & Fail-Closed Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.common.result_integrity import (
    ResultState,
    validate_result_state,
    assert_no_illegal_collapse,
    ResultIntegrityViolation,
    FindingProvenance,
)


class TestScannerFailClosedControl:
    """
    Security Control: Scanner Result Integrity & Anti-Collapse Invariant Enforcement
    Guarantees that scanners never collapse SCAN_ERROR into CLEAN, or NOT_SCANNED into NOT_FOUND.
    """

    # 1. POSITIVE TEST: Canonical 6-state values validate cleanly
    def test_positive_scanner_fail_closed(self):
        for state in ResultState:
            validated = validate_result_state(state.value)
            assert validated == state

        # Provenance model validation succeeds
        prov = FindingProvenance(
            location="src/crypto.py",
            line_number=42,
            tool_name="crypto-ast-scanner",
            tool_version="1.6.0",
            rule_id="RULE-AES-GCM-256",
            detection_method="ast",
            snippet="Cipher.getInstance('AES/GCM/NoPadding')",
        )
        assert prov.tool_name == "crypto-ast-scanner"
        is_valid, errors = prov.validate()
        assert is_valid is True
        assert len(errors) == 0

    # 2. NEGATIVE TEST: Non-canonical status string raises ResultIntegrityViolation
    def test_negative_scanner_fail_closed(self):
        with pytest.raises(ResultIntegrityViolation) as exc_info:
            validate_result_state("PASS")
        assert "invalid scanner result state" in str(exc_info.value).lower()

        with pytest.raises(ResultIntegrityViolation):
            validate_result_state("CLEAN")

    # 3. BOUNDARY TEST: Case normalization & whitespace handling
    def test_boundary_scanner_fail_closed(self):
        # Mixed casing and whitespace normalized
        assert validate_result_state("  found  ") == ResultState.FOUND
        assert validate_result_state("not_scanned") == ResultState.NOT_SCANNED
        assert validate_result_state("Scan_Error") == ResultState.SCAN_ERROR

    # 4. MALICIOUS TEST: Attempting to collapse SCAN_ERROR into CLEAN / NOT_FOUND blocked
    def test_malicious_scanner_fail_closed(self):
        # Hostile or faulty reporting attempting to mask a crash/error as CLEAN / NOT_FOUND
        with pytest.raises(ResultIntegrityViolation) as exc_info:
            assert_no_illegal_collapse(
                reported_state="CLEAN",
                actual_condition="SCAN_ERROR",
                context="Scanner crashed on corrupted AST",
            )
        assert "illegally collapsed" in str(exc_info.value).lower()
        assert "clean" in str(exc_info.value).lower()

        with pytest.raises(ResultIntegrityViolation):
            assert_no_illegal_collapse(
                reported_state="NOT_FOUND",
                actual_condition="ERROR",
                context="Parser crashed",
            )

    # 5. REGRESSION TEST: Anti-collapse invariant: NEVER collapse NOT_SCANNED into NOT_FOUND
    def test_regression_scanner_fail_closed(self):
        # Bounded traversal skipped files due to quota; reporting NOT_FOUND is strictly prohibited
        with pytest.raises(ResultIntegrityViolation) as exc_info:
            assert_no_illegal_collapse(
                reported_state="NOT_FOUND",
                actual_condition="NOT_SCANNED",
                context="Directory depth exceeded limit (skipped)",
            )
        assert "illegally collapsed" in str(exc_info.value).lower()
        assert "not_scanned" in str(exc_info.value).lower()
