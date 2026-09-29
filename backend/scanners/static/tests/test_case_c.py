import os
import sys
from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.models import CodeCryptoFinding
from scanners.cbom_mapping import code_findings_to_cbom

def test_case_c_dedup():
    content = b"""
#include <openssl/md5.h>

void test() {
    MD5_CTX ctx;
    MD5_Init(&ctx); MD5_Update(&ctx, "test", 4);
}
"""

    registry = get_default_adapter_registry()
    adapter = registry.get_by_extension('.c')
    ast_findings = adapter.extract_findings(content, Path('case_c_test.c'), Path('.'))

    final_file_findings = {}
    for f in ast_findings:
        key_algo = f"{f.file_path}:{f.line_number}:{f.algorithm}:{getattr(f, 'api_symbol', getattr(f, 'rule_id', None))}"
        if key_algo not in final_file_findings:
            final_file_findings[key_algo] = f

    ccf_findings = []
    for finding in final_file_findings.values():
        ccf = CodeCryptoFinding(
            bom_ref=f"code:algo:{finding.algorithm}",
            file_path=finding.file_path,
            language="Unknown",
            line=finding.line_number,
            algorithm=finding.algorithm,
            finding_type=finding.finding_type,
            confidence=finding.confidence,
            rule_id=getattr(finding, "rule_id", None),
            api_symbol=getattr(finding, "api_symbol", None),
        )
        ccf_findings.append(ccf)

    cbom = code_findings_to_cbom(ccf_findings)

    count = 0
    contexts = set()
    for comp in cbom.components:
        if comp.evidence and comp.evidence.occurrences:
            count += len(comp.evidence.occurrences)
            for occ in comp.evidence.occurrences:
                contexts.add(getattr(occ, 'additional_context', None))

    assert count == 2, f"Expected 2 occurrences, got {count}"
    assert "MD5_Init" in contexts
    assert "MD5_Update" in contexts
