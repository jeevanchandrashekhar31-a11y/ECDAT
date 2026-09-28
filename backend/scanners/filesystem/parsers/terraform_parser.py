import re
from typing import List
from ..config_models import ConfigFinding

def parse_terraform(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    # Very rudimentary regex-based block parsing since real HCL parsing is complex.
    # In a full implementation, python-hcl2 would be used.
    
    lines = content.splitlines()
    current_resource = None
    current_type = None
    
    for i, line in enumerate(lines):
        line_num = i + 1
        stripped = line.strip()
        
        res_match = re.match(r'resource\s+"([^"]+)"\s+"([^"]+)"', stripped)
        if res_match:
            current_type = res_match.group(1)
            current_resource = res_match.group(2)
            continue
            
        if current_type and current_resource:
            if stripped == "}":
                current_type = None
                current_resource = None
                continue
                
            if current_type == "azurerm_key_vault_key":
                # Look for key_type, key_size, curve
                attr_match = re.match(r'(key_type|key_size|curve)\s*=\s*"?([^"]+)"?', stripped)
                if attr_match:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=f"{current_type}.{current_resource}",
                        setting=attr_match.group(1),
                        declared_value=attr_match.group(2),
                        effective_value=attr_match.group(2),
                        value_source="declared",
                        evidence_tier="primary"
                    ))
            elif current_type == "aws_kms_key":
                attr_match = re.match(r'(customer_master_key_spec|key_usage)\s*=\s*"?([^"]+)"?', stripped)
                if attr_match:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=f"{current_type}.{current_resource}",
                        setting=attr_match.group(1),
                        declared_value=attr_match.group(2),
                        effective_value=attr_match.group(2),
                        value_source="declared",
                        evidence_tier="primary"
                    ))
            elif current_type == "google_kms_crypto_key":
                attr_match = re.match(r'(purpose)\s*=\s*"?([^"]+)"?', stripped)
                if attr_match:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=f"{current_type}.{current_resource}",
                        setting=attr_match.group(1),
                        declared_value=attr_match.group(2),
                        effective_value=attr_match.group(2),
                        value_source="declared",
                        evidence_tier="primary"
                    ))
                    
    return findings
