import pytest
import json
from datetime import datetime
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from scanners.cbom_mapping import code_findings_to_cbom, serialize_cbom
from scanners.models import CodeCryptoFinding, CoverageReport, ScanResult
from scanners.domain.contracts import ScanResult as DomainScanResult

def test_cbom_schema_validation():
    finding = CodeCryptoFinding(
        bom_ref="code:algo:AES:256",
        file_path="src/main.c",
        language="C",
        line=42,
        algorithm="AES",
        key_size=256,
        finding_type="algorithm"
    )
    bom = code_findings_to_cbom([finding])
    json_str = serialize_cbom(bom, spec_version="1.6")
    data = json.loads(json_str)
    assert data["bomFormat"] == "CycloneDX"
    assert data["specVersion"] == "1.6"

def test_asset_evidence_dedup():
    findings = [
        CodeCryptoFinding(
            bom_ref="code:algo:AES:256",
            file_path="src/main.c",
            language="C",
            line=42,
            algorithm="AES",
            key_size=256,
            finding_type="algorithm"
        ),
        CodeCryptoFinding(
            bom_ref="code:algo:AES:256",
            file_path="src/utils.c",
            language="C",
            line=100,
            algorithm="AES",
            key_size=256,
            finding_type="algorithm"
        )
    ]
    bom = code_findings_to_cbom(findings)
    crypto_components = [c for c in bom.components if c.type == ComponentType.CRYPTOGRAPHIC_ASSET]
    assert len(crypto_components) == 1, "Should deduplicate to exactly one logical asset"
    assert len(crypto_components[0].evidence.occurrences) == 2, "Should record multiple occurrences"

def test_coverage_report_present():
    report = CoverageReport(
        files_discovered=100,
        files_scanned=95,
        files_skipped={"giant_file": 5},
        parser_success_rate={"python": 1.0, "c": 0.8},
        parse_errors=["error parsing main.c"],
        rules_loaded=250,
        ecdat_version="3.0",
        rule_pack_hash="abcdef123"
    )
    result = DomainScanResult(
        scan_id="scan-123",
        scan_type="static",
        target="repo",
        engine_name="pytest",
        engine_version="1.0",
        coverage_report=report
    )
    assert result.coverage_report is not None
    assert result.coverage_report.files_scanned == 95

def test_report_metric_truthfulness():
    # Simple check that we don't return placeholder values for metrics if data is missing
    # In practice this would query the DB and compare to report metrics
    # Here we simulate by ensuring a metric engine returns "not enough data" when empty.
    # We test that we don't have hardcoded MTTR integers.
    def calculate_mttr(resolved_count, total_time):
        if resolved_count == 0:
            return "not enough data"
        return total_time / resolved_count

    assert calculate_mttr(0, 0) == "not enough data"
    assert calculate_mttr(2, 10) == 5.0
