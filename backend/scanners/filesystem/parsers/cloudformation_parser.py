import json
import yaml
from typing import List, Dict, Any
from ..config_models import ConfigFinding

def parse_cloudformation(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    try:
        data = json.loads(content)
    except Exception:
        try:
            data = yaml.safe_load(content)
        except Exception:
            return []
            
    if not isinstance(data, dict):
        return []
        
    resources = data.get("Resources", {})
    for logical_id, resource in resources.items():
        res_type = resource.get("Type")
        props = resource.get("Properties", {})
        
        if res_type == "AWS::ElasticLoadBalancingV2::Listener":
            if "SslPolicy" in props:
                val = props["SslPolicy"]
                if isinstance(val, dict):
                    # It's an intrinsic like Ref or Fn::Sub
                    val_str = str(val)
                else:
                    val_str = str(val)
                    
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=logical_id,
                    setting="SslPolicy",
                    declared_value=val_str,
                    effective_value=val_str,
                    value_source="declared",
                    evidence_tier="primary"
                ))
        elif res_type == "AWS::KMS::Key":
            if "KeySpec" in props:
                val = props["KeySpec"]
                val_str = str(val) if isinstance(val, dict) else str(val)
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=logical_id,
                    setting="KeySpec",
                    declared_value=val_str,
                    effective_value=val_str,
                    value_source="declared",
                    evidence_tier="primary"
                ))

    return findings
