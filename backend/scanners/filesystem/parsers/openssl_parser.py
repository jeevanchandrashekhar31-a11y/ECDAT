import re
import configparser
from typing import List
from ..config_models import ConfigFinding

def parse_openssl_cnf(file_path: str, content: str) -> List[ConfigFinding]:
    findings = []
    
    config = configparser.ConfigParser(strict=False, interpolation=None)
    try:
        config.read_string(content)
    except Exception as e:
        return []

    # Map variables to search for
    target_keys = ["MinProtocol", "CipherString", "Ciphersuites", "Groups"]
    
    # Typically found in system_default_sect or similar
    for section in config.sections():
        for key in target_keys:
            if config.has_option(section, key) or config.has_option(section, key.lower()):
                val = config.get(section, key, fallback=config.get(section, key.lower(), fallback=None))
                if val:
                    findings.append(ConfigFinding(
                        file=file_path,
                        line_start=0,
                        line_end=0,
                        scope_id=section,
                        setting=key,
                        declared_value=val,
                        effective_value=val,
                        value_source="declared",
                        evidence_tier="primary"
                    ))

    return findings
