import yaml
from typing import List
from ..config_models import ConfigFinding

def parse_kubernetes(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    try:
        docs = list(yaml.safe_load_all(content))
    except Exception as e:
        return []
        
    for doc in docs:
        if not isinstance(doc, dict):
            continue
            
        kind = doc.get("kind")
        metadata = doc.get("metadata", {})
        name = metadata.get("name", "unknown")
        
        # Ingress
        if kind == "Ingress":
            spec = doc.get("spec", {})
            if "tls" in spec:
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=f"Ingress.{name}",
                    setting="tls",
                    declared_value="configured",
                    effective_value="configured",
                    value_source="declared",
                    evidence_tier="primary"
                ))
                
        # Istio DestinationRule
        if kind == "DestinationRule":
            spec = doc.get("spec", {})
            traffic_policy = spec.get("trafficPolicy", {})
            tls = traffic_policy.get("tls", {})
            if "mode" in tls:
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=f"DestinationRule.{name}",
                    setting="tls_mode",
                    declared_value=tls["mode"],
                    effective_value=tls["mode"],
                    value_source="declared",
                    evidence_tier="primary"
                ))

        # cert-manager Certificate
        if kind == "Certificate":
            spec = doc.get("spec", {})
            for key in ["privateKey", "algorithm", "size", "rotationPolicy"]:
                if key in spec:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=0,
                        line_end=0,
                        scope_id=f"Certificate.{name}",
                        setting=key,
                        declared_value=str(spec[key]),
                        effective_value=str(spec[key]),
                        value_source="declared",
                        evidence_tier="primary"
                    ))
                    
    return findings
