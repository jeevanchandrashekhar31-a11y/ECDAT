import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

from scanners.static.results import StaticFinding
from scanners.static.scalable_scanner import scan_single_file

@patch('scanners.static.scalable_scanner.apply_regex_rules')
@patch('scanners.static.scalable_scanner.get_default_adapter_registry')
def test_regex_merge_symbol_aware(mock_registry, mock_regex):
    # Mock AST finding: MD5_Init on line 10
    ast_finding = StaticFinding(
        file_path="test.c",
        line_number=10,
        rule_id="C_WEAK_HASH_MD5",
        algorithm="MD5",
        evidence="WRAPPER(&ctx);",
        confidence="high",
        finding_type="usage",
        severity="critical",
        api_symbol="MD5_Init",
        analysis_source="ast"
    )
    
    mock_adapter = MagicMock()
    mock_adapter.extract_findings.return_value = [ast_finding]
    
    registry_instance = MagicMock()
    registry_instance.get_by_extension.return_value = mock_adapter
    mock_registry.return_value = registry_instance
    
    # Mock Regex finding: MD5_Final on line 10
    mock_regex.return_value = [{
        "line_number": 10,
        "rule_id": "R_MD5",
        "algorithm": "MD5",
        "evidence": "WRAPPER(&ctx); MD5_Final(out, &ctx);",
        "confidence": "high",
        "finding_type": "usage",
        "severity": "critical",
        "api_symbol": "MD5_Final_15"
    }]
    
    # Create dummy file
    test_file = Path("test.c")
    test_file.write_text("WRAPPER(&ctx); MD5_Final(out, &ctx);\n", encoding="utf-8")
    
    try:
        findings, errors, telemetry = scan_single_file(test_file, Path("."), registry_instance)
        
        # We expect BOTH findings to survive because they have different api_symbols
        assert len(findings) == 2, f"Expected 2 occurrences, got {len(findings)}: {[f.get('api_symbol') for f in findings]}"
        
        symbols = [f.get('api_symbol') for f in findings]
        assert "MD5_Init" in symbols
        assert "MD5_Final_15" in symbols
        
        # Now test that they merge if api_symbol matches (e.g. both find MD5_Init)
        mock_regex.return_value = [{
            "line_number": 10,
            "rule_id": "R_MD5",
            "algorithm": "MD5",
            "evidence": "WRAPPER(&ctx); MD5_Final(out, &ctx);",
            "confidence": "high",
            "finding_type": "usage",
            "severity": "critical",
            "api_symbol": "MD5_Init"
        }]
        findings, errors, telemetry = scan_single_file(test_file, Path("."), registry_instance)
        assert len(findings) == 1, "Expected 1 occurrence when symbols match"
        assert "regex" in findings[0]["analysis_source"]
        
    finally:
        if test_file.exists():
            test_file.unlink()
