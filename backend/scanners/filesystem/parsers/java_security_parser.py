import re
from typing import List
from ..config_models import ConfigFinding

def parse_java_security(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    target_keys = ["jdk.tls.disabledAlgorithms", "jdk.certpath.disabledAlgorithms"]
    
    # Handle multi-line continuations with backslash
    lines = content.splitlines()
    logical_lines = []
    current_line = ""
    start_num = 0
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
            
        if not current_line:
            start_num = i + 1
            
        if stripped.endswith("\\"):
            current_line += stripped[:-1] + " "
        else:
            current_line += stripped
            logical_lines.append((start_num, i + 1, current_line))
            current_line = ""
            
    for start, end, line in logical_lines:
        parts = line.split("=", 1)
        if len(parts) == 2:
            key = parts[0].strip()
            val = parts[1].strip()
            
            if key in target_keys:
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=start,
                    line_end=end,
                    scope_id="global",
                    setting=key,
                    declared_value=val,
                    effective_value=val,
                    value_source="declared",
                    evidence_tier="primary"
                ))
                
    return findings
