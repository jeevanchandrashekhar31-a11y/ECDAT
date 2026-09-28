import yaml
from typing import List
from ..config_models import ConfigFinding

def parse_envoy(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    try:
        data = yaml.safe_load(content)
    except Exception as e:
        return []
        
    if not isinstance(data, dict):
        return []

    # Envoy config structure: static_resources -> listeners -> filter_chains -> transport_socket -> typed_config -> tls_params
    
    def extract_tls_params(tls_context: dict, scope: str):
        if 'tls_params' in tls_context:
            params = tls_context['tls_params']
            
            if 'tls_minimum_protocol_version' in params:
                val = params['tls_minimum_protocol_version']
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=scope,
                    setting="tls_minimum_protocol_version",
                    declared_value=val,
                    effective_value=val,
                    value_source="declared",
                    evidence_tier="primary"
                ))
            else:
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=scope,
                    setting="tls_minimum_protocol_version",
                    declared_value=None,
                    effective_value="TLSv1_2", # Envoy default
                    value_source="inferred_default",
                    evidence_tier="secondary"
                ))
                
            if 'cipher_suites' in params:
                val = params['cipher_suites']
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=scope,
                    setting="cipher_suites",
                    declared_value=",".join(val) if isinstance(val, list) else str(val),
                    effective_value=",".join(val) if isinstance(val, list) else str(val),
                    value_source="declared",
                    evidence_tier="primary"
                ))
                
            if 'ecdh_curves' in params:
                val = params['ecdh_curves']
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id=scope,
                    setting="ecdh_curves",
                    declared_value=",".join(val) if isinstance(val, list) else str(val),
                    effective_value=",".join(val) if isinstance(val, list) else str(val),
                    value_source="declared",
                    evidence_tier="primary"
                ))

    # Static resources
    if 'static_resources' in data:
        resources = data['static_resources']
        if 'listeners' in resources:
            for listener in resources['listeners']:
                listener_name = listener.get('name', 'unknown_listener')
                for filter_chain in listener.get('filter_chains', []):
                    if 'transport_socket' in filter_chain:
                        ts = filter_chain['transport_socket']
                        if ts.get('name') == 'envoy.transport_sockets.tls':
                            typed_config = ts.get('typed_config', {})
                            common_tls_context = typed_config.get('common_tls_context', {})
                            extract_tls_params(common_tls_context, f"listener_{listener_name}")

    return findings
