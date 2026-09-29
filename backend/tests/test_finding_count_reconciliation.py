import pytest
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from scanners.cbom_mapping import merge_cboms

def test_finding_count_reconciliation():
    """
    Tests finding count reconciliation against a known ground truth:
    - 5 distinct MD5 calls on 5 different lines (expect 5 occurrences)
    - 1 line where both an AST rule and the regex fallback both fire on the identical call (expect 1 occurrence, not 2)
    - 1 contrived line with 2 distinct api calls (expect 2 occurrences, not 1)
    """
    
    bom1 = Bom()
    comp_md5_1 = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="MD5", bom_ref="crypto-md5")
    comp_md5_1.evidence = ComponentEvidence(occurrences=[
        # 5 distinct MD5 calls on 5 different lines
        Occurrence(location="file.py", line=10, additional_context="MD5_Init"),
        Occurrence(location="file.py", line=12, additional_context="MD5_Init"),
        Occurrence(location="file.py", line=14, additional_context="MD5_Init"),
        Occurrence(location="file.py", line=16, additional_context="MD5_Init"),
        Occurrence(location="file.py", line=18, additional_context="MD5_Init"),
        
        # 1 line where both AST and Regex fired (these will have same line and same location, but same rule_id due to source fix merging them)
        # Note: in scalable_scanner.py, AST and Regex identical hits are merged into ONE finding before cbom_mapping.
        # But if they somehow reach cbom_mapping as separate identical findings across chunks, they should be merged:
        Occurrence(location="file.py", line=20, additional_context="MD5_Init"),
        
        # 1 contrived line with 2 DISTINCT api calls
        Occurrence(location="file.py", line=22, additional_context="MD5_Init"),
        Occurrence(location="file.py", line=22, additional_context="MD5_Update"),
    ])
    bom1.components.add(comp_md5_1)
    
    bom2 = Bom()
    comp_md5_2 = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="MD5", bom_ref="crypto-md5")
    comp_md5_2.evidence = ComponentEvidence(occurrences=[
        # Cross-BOM duplicate (e.g. from different workers reporting the same file chunk overlap)
        Occurrence(location="file.py", line=10, additional_context="MD5_Init"),
        # The AST + Regex overlap that escaped local scanner dedup for some reason
        Occurrence(location="file.py", line=20, additional_context="MD5_Init"),
    ])
    bom2.components.add(comp_md5_2)
    
    merged_bom = merge_cboms([bom1, bom2])
    
    merged_comp = list(merged_bom.components)[0]
    total_occurrences_after_merge = len(merged_comp.evidence.occurrences)
    
    # Ground truth math:
    # 5 calls on distinct lines (lines 10,12,14,16,18) -> 5
    # 2 identical calls on line 20 -> deduplicated to 1 -> 1
    # 2 distinct calls on line 22 (MD5_Init, MD5_Update) -> kept distinct due to api_symbol -> 2
    # Cross-bom overlap on line 10 -> deduplicated to existing -> 0 added
    # Total expected: 5 + 1 + 2 = 8
    
    assert total_occurrences_after_merge == 8, f"Expected 8 occurrences, got {total_occurrences_after_merge}"
