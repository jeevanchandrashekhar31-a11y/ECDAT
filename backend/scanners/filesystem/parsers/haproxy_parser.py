import re
from typing import List, Optional
from ..config_models import ConfigFinding

def parse_haproxy(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    current_scope = "global"
    scope_defaults = {
        "ssl-default-bind-options": {"value": None, "line": -1},
        "ssl-default-bind-ciphers": {"value": None, "line": -1},
        "ssl-default-bind-ciphersuites": {"value": None, "line": -1}
    }
    global_defaults = {
        "ssl-default-bind-options": {"value": None, "line": -1},
        "ssl-default-bind-ciphers": {"value": None, "line": -1},
        "ssl-default-bind-ciphersuites": {"value": None, "line": -1}
    }
    
    lines = content.splitlines()
    for i, line in enumerate(lines):
        line_num = i + 1
        stripped = line.strip()
        
        # Handle comments
        if not stripped or stripped.startswith("#"):
            continue
            
        # Scope changes
        if stripped.startswith("global"):
            current_scope = "global"
        elif stripped.startswith("defaults"):
            current_scope = "defaults"
        elif stripped.startswith(("frontend ", "backend ", "listen ")):
            current_scope = stripped.split()[1] if len(stripped.split()) > 1 else stripped.split()[0]
            # Inherit from defaults
            scope_defaults = {
                "ssl-default-bind-options": dict(global_defaults["ssl-default-bind-options"]),
                "ssl-default-bind-ciphers": dict(global_defaults["ssl-default-bind-ciphers"]),
                "ssl-default-bind-ciphersuites": dict(global_defaults["ssl-default-bind-ciphersuites"])
            }
            
        # Global/Default settings
        if current_scope in ("global", "defaults"):
            match = re.match(r"ssl-default-bind-(options|ciphers|ciphersuites)\s+(.+)", stripped)
            if match:
                setting = f"ssl-default-bind-{match.group(1)}"
                val = match.group(2)
                global_defaults[setting] = {"value": val, "line": line_num}
                findings.append(ConfigFinding(
                    file=file_path,
                    line_start=line_num,
                    line_end=line_num,
                    scope_id=current_scope,
                    setting=setting,
                    declared_value=val,
                    effective_value=val,
                    value_source="declared",
                    evidence_tier="primary"
                ))
                
        # Bind lines (frontend/listen)
        if stripped.startswith("bind "):
            parts = stripped.split()
            if "ssl" in parts:
                # Look for inline overrides
                options = []
                ciphers = None
                ciphersuites = None
                
                j = 0
                while j < len(parts):
                    if parts[j] == "ciphers" and j + 1 < len(parts):
                        ciphers = parts[j+1]
                        j += 1
                    elif parts[j] == "ciphersuites" and j + 1 < len(parts):
                        ciphersuites = parts[j+1]
                        j += 1
                    elif parts[j] in ("no-sslv3", "no-tlsv10", "no-tlsv11", "no-tlsv12", "force-tlsv12", "force-tlsv13"):
                        options.append(parts[j])
                    j += 1
                
                # Ciphers
                if ciphers:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_ciphers",
                        declared_value=ciphers,
                        effective_value=ciphers,
                        value_source="declared",
                        evidence_tier="primary"
                    ))
                elif scope_defaults["ssl-default-bind-ciphers"]["value"]:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_ciphers",
                        declared_value=None,
                        effective_value=scope_defaults["ssl-default-bind-ciphers"]["value"],
                        value_source="inherited",
                        evidence_tier="secondary"
                    ))
                else:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_ciphers",
                        declared_value=None,
                        effective_value="haproxy_default", # Unknown exact HAProxy version default
                        value_source="inferred_default",
                        evidence_tier="tertiary"
                    ))
                    
                # Options / Min protocol
                if options:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_options",
                        declared_value=" ".join(options),
                        effective_value=" ".join(options),
                        value_source="declared",
                        evidence_tier="primary"
                    ))
                elif scope_defaults["ssl-default-bind-options"]["value"]:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_options",
                        declared_value=None,
                        effective_value=scope_defaults["ssl-default-bind-options"]["value"],
                        value_source="inherited",
                        evidence_tier="secondary"
                    ))
                else:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting="bind_options",
                        declared_value=None,
                        effective_value="haproxy_default",
                        value_source="inferred_default",
                        evidence_tier="tertiary"
                    ))

    return findings
