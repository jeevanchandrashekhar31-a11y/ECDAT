import os
import json
import re
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

@dataclass
class CloudInfraFinding:
    scope: str
    policy_name: str
    resolved_min_protocol: str
    line_number: int

class CloudInfraParser:
    def __init__(self, rules_path: Optional[str] = None):
        if not rules_path:
            rules_path = os.path.join(
                os.path.dirname(__file__), "..", "..", "..", "..", "rules", "cloud_tls_policies.json"
            )
        self.rules_path = os.path.abspath(rules_path)
        self.policies = {}
        self._load_policies()
        
    def _load_policies(self):
        if os.path.exists(self.rules_path):
            with open(self.rules_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.policies = data.get("policies", {})
                
    def parse_content(self, filename: str, content: str) -> List[CloudInfraFinding]:
        findings = []
        
        # Super basic regex block extraction for terraform
        tf_block_regex = re.compile(r'resource\s+"([^"]+)"\s+"([^"]+)"\s+{([^}]+)}', re.MULTILINE)
        
        for match in tf_block_regex.finditer(content):
            res_type = match.group(1)
            res_name = match.group(2)
            block_body = match.group(3)
            
            # check for ssl_policy
            policy_match = re.search(r'ssl_policy\s*=\s*"([^"]+)"', block_body)
            if policy_match:
                policy_name = policy_match.group(1)
                resolved_min = "UNKNOWN"
                if policy_name in self.policies:
                    resolved_min = self.policies[policy_name].get("min_protocol", "UNKNOWN")
                    
                line_no = content[:match.start()].count("\n") + 1
                
                findings.append(CloudInfraFinding(
                    scope=f"{res_type}.{res_name}",
                    policy_name=policy_name,
                    resolved_min_protocol=resolved_min,
                    line_number=line_no
                ))
                
        return findings
