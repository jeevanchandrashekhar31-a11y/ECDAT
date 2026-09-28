import re
from typing import List
from ..config_models import ConfigFinding

def parse_sshd_config(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    current_scope = "global"
    
    # sshd_config defaults
    sshd_defaults = {
        "Ciphers": "chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com",
        "MACs": "umac-64-etm@openssh.com,umac-128-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,hmac-sha1-etm@openssh.com,umac-64@openssh.com,umac-128@openssh.com,hmac-sha2-256,hmac-sha2-512,hmac-sha1",
        "KexAlgorithms": "curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,diffie-hellman-group-exchange-sha256,diffie-hellman-group14-sha256",
        "HostKeyAlgorithms": "ecdsa-sha2-nistp256-cert-v01@openssh.com,ecdsa-sha2-nistp384-cert-v01@openssh.com,ecdsa-sha2-nistp521-cert-v01@openssh.com,ssh-ed25519-cert-v01@openssh.com,rsa-sha2-512-cert-v01@openssh.com,rsa-sha2-256-cert-v01@openssh.com,ssh-rsa-cert-v01@openssh.com,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,ssh-ed25519,rsa-sha2-512,rsa-sha2-256,ssh-rsa"
    }
    
    global_settings = {}
    
    lines = content.splitlines()
    for i, line in enumerate(lines):
        line_num = i + 1
        stripped = line.strip()
        
        if not stripped or stripped.startswith("#"):
            continue
            
        if stripped.lower().startswith("match "):
            current_scope = stripped
            continue
            
        parts = re.split(r'\s+|=', stripped, maxsplit=1)
        if len(parts) == 2:
            key, val = parts[0], parts[1]
            if key in ["Ciphers", "MACs", "KexAlgorithms", "HostKeyAlgorithms", "PubkeyAcceptedKeyTypes", "PubkeyAcceptedAlgorithms"]:
                
                # Check for + or - modifiers in sshd
                is_modifier = val.startswith("+") or val.startswith("-") or val.startswith("^")
                effective_val = val
                
                if current_scope == "global":
                    global_settings[key] = val
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting=key,
                        declared_value=val,
                        effective_value=effective_val,
                        value_source="declared",
                        evidence_tier="primary"
                    ))
                else:
                    # In a match block, if it's a modifier, it modifies the global setting (if defined) or the default
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=line_num,
                        line_end=line_num,
                        scope_id=current_scope,
                        setting=key,
                        declared_value=val,
                        effective_value=effective_val,
                        value_source="declared",
                        evidence_tier="primary"
                    ))

    # Add inferred defaults for global scope if missing
    for key, default_val in sshd_defaults.items():
        if key not in global_settings:
            findings.append(ConfigFinding(
                file=file_path,
                line_start=0,
                line_end=0,
                scope_id="global",
                setting=key,
                declared_value=None,
                effective_value=default_val,
                value_source="inferred_default",
                evidence_tier="tertiary"
            ))

    return findings
