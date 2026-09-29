import time
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
def test_merge_performance(mock_registry, mock_regex):
    # Construct a synthetic file with 2000+ overlapping matches
    NUM_MATCHES = 2500
    
    ast_findings = []
    regex_findings = []
    
    # We create findings on the SAME line (line 10) for the SAME algorithm to force the merge logic
    for i in range(NUM_MATCHES):
        # AST finds MD5_Init
        ast_findings.append(StaticFinding(
            file_path="test_perf.c",
            line_number=10,
            rule_id=f"C_WEAK_HASH_MD5",
            algorithm="MD5",
            evidence="WRAPPER(&ctx);",
            confidence="high",
            finding_type="usage",
            severity="critical",
            api_symbol=f"MD5_Init_{i}",
            analysis_source="ast"
        ))
        
        # Regex finds matching or non-matching
        regex_findings.append({
            "line_number": 10,
            "rule_id": "R_MD5",
            "algorithm": "MD5",
            "evidence": "WRAPPER(&ctx);",
            "confidence": "high",
            "finding_type": "usage",
            "severity": "critical",
            "api_symbol": f"MD5_Regex_{i}"
        })
        
    mock_adapter = MagicMock()
    mock_adapter.extract_findings.return_value = ast_findings
    
    registry_instance = MagicMock()
    registry_instance.get_by_extension.return_value = mock_adapter
    mock_registry.return_value = registry_instance
    
    mock_regex.return_value = regex_findings
    
    test_file = Path("test_perf.c")
    test_file.write_text("WRAPPER(&ctx);\n" * 10, encoding="utf-8")
    
    try:
        start_time = time.time()
        findings, errors, telemetry = scan_single_file(test_file, Path("."), registry_instance)
        duration = time.time() - start_time
        
        assert duration < 2.0, f"Merge logic took too long! Duration: {duration:.4f}s"
        assert len(findings) > 0
    finally:
        if test_file.exists():
            test_file.unlink()
