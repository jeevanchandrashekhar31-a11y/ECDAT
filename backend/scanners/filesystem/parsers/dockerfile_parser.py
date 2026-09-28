import yaml
import re
from typing import List
from ..config_models import ConfigFinding

def parse_dockerfile(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    if file_path.endswith("Dockerfile") or "FROM " in content:
        # Very simple check for secrets/crypto in env vars
        lines = content.splitlines()
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("ENV "):
                if "SECRET" in stripped or "KEY" in stripped or "PASSWORD" in stripped:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=i+1,
                        line_end=i+1,
                        scope_id="global",
                        setting="ENV_SECRET",
                        declared_value="<redacted>",
                        effective_value="<redacted>",
                        value_source="declared",
                        evidence_tier="primary"
                    ))
    else:
        # Assume docker-compose
        try:
            data = yaml.safe_load(content)
        except Exception:
            return []
            
        if not isinstance(data, dict):
            return []
            
        services = data.get("services", {})
        for svc_name, svc_conf in services.items():
            if not isinstance(svc_conf, dict):
                continue
                
            env = svc_conf.get("environment", {})
            if isinstance(env, dict):
                for k, v in env.items():
                    if "SECRET" in k or "KEY" in k or "PASSWORD" in k:
                        findings.append(ConfigFinding(
                            file=file_path,
                            line_start=0,
                            line_end=0,
                            scope_id=svc_name,
                            setting=k,
                            declared_value="<redacted>",
                            effective_value="<redacted>",
                            value_source="declared",
                            evidence_tier="primary"
                        ))
    return findings
