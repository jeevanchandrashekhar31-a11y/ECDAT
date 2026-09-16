"""
Automated Pytest Suite for Phase 23.2: Adversarial Scanner Assessment

Validates that ECDAT scanners withstand hostile scan inputs across 15 scenarios,
testing:
- attack input
- affected component
- impact
- mitigation
- regression test
"""

import json
import jsonschema
from pathlib import Path
import pytest
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scanners.redteam.adversarial_scanner_assessment import AdversarialScannerAssessmentEngine


@pytest.fixture
def assessment_engine():
    return AdversarialScannerAssessmentEngine()


class TestAdversarialScannerAssessment:
    """Automated testing asserting ECDAT defenses hold against hostile scan inputs."""

    def test_catalog_schema_compliance(self):
        """Verifies that rules/adversarial_scanner_catalog.json satisfies its schema."""
        catalog_path = REPO_ROOT / "rules" / "adversarial_scanner_catalog.json"
        schema_path = REPO_ROOT / "rules" / "schemas" / "adversarial_scanner_catalog.schema.json"

        assert catalog_path.exists(), "adversarial_scanner_catalog.json missing"
        assert schema_path.exists(), "adversarial_scanner_catalog.schema.json missing"

        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog_data = json.load(f)
        with open(schema_path, "r", encoding="utf-8") as f:
            schema_data = json.load(f)

        jsonschema.validate(instance=catalog_data, schema=schema_data)
        assert len(catalog_data["scenarios"]) == 15

    def test_adv_scan_001_zip_slip_traversal_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_001()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-22"
        assert r.affected_component["component_name"] == "ArchiveSecurityGuard"

    def test_adv_scan_002_decompression_bomb_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_002()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-409"
        assert r.impact["severity"] == "high"

    def test_adv_scan_003_billion_laughs_xml_bomb_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_003()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-611"
        assert "defusedxml" in r.mitigation["defensive_strategy"]

    def test_adv_scan_004_redos_backtracking_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_004()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-1333"
        assert r.execution_time_ms < 100.0

    def test_adv_scan_005_deep_json_recursion_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_005()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-674"

    def test_adv_scan_006_private_key_trap_in_cert_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_006()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-312"

    def test_adv_scan_007_truncated_asn1_cert_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_007()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-1287"

    def test_adv_scan_008_deep_pcap_encapsulation_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_008()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-674"

    def test_adv_scan_009_generated_code_explosion_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_009()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-400"
        assert r.execution_time_ms < 500.0

    def test_adv_scan_010_symlink_loops_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_010()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-59"

    def test_adv_scan_011_corrupted_binary_header_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_011()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-1287"

    def test_adv_scan_012_circular_dependency_graph_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_012()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-835"

    def test_adv_scan_013_canary_secret_bait_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_013()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-209"

    def test_adv_scan_014_broken_syntax_patch_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_014()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-710"

    def test_adv_scan_015_silent_crash_conflation_defended(self, assessment_engine):
        r = assessment_engine.evaluate_adv_scan_015()
        assert r.status == "DEFENDED"
        assert r.cwe_id == "CWE-392"

    def test_full_orchestration_100_percent_robust(self, assessment_engine):
        """Runs the complete suite and asserts all 15 scenarios are defended."""
        results = assessment_engine.run_all_scenarios()
        assert len(results) == 15
        assert all(r.status == "DEFENDED" for r in results)
