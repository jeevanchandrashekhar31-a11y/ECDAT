import os
from typing import List, Callable, Dict, Any

from .config_models import ConfigFinding
from .parsers.haproxy_parser import parse_haproxy
from .parsers.sshd_parser import parse_sshd_config
from .parsers.envoy_parser import parse_envoy
from .parsers.openssl_parser import parse_openssl_cnf
from .parsers.java_security_parser import parse_java_security
from .parsers.terraform_parser import parse_terraform
from .parsers.kubernetes_parser import parse_kubernetes
from .parsers.cloudformation_parser import parse_cloudformation
from .parsers.dockerfile_parser import parse_dockerfile

class ConfigRegistry:
    def __init__(self):
        self.parsers: List[Dict[str, Any]] = [
            {
                "name": "HAProxy",
                "filename_patterns": ["haproxy.cfg", "*.cfg"],
                "content_sniffer": lambda c: "global" in c and "bind" in c and "ssl" in c,
                "parser": parse_haproxy
            },
            {
                "name": "SSHD",
                "filename_patterns": ["sshd_config"],
                "content_sniffer": lambda c: "Match" in c or "PermitRootLogin" in c or "KexAlgorithms" in c,
                "parser": parse_sshd_config
            },
            # Stubs for others that will be implemented
            {
                "name": "Envoy",
                "filename_patterns": ["envoy.yaml", "*.yaml"],
                "content_sniffer": lambda c: "static_resources" in c and "listeners" in c,
                "parser": parse_envoy
            },
            {
                "name": "OpenSSL",
                "filename_patterns": ["openssl.cnf"],
                "content_sniffer": lambda c: "[system_default_sect]" in c or "CipherString" in c,
                "parser": parse_openssl_cnf
            },
            {
                "name": "JavaSecurity",
                "filename_patterns": ["java.security"],
                "content_sniffer": lambda c: "jdk.tls.disabledAlgorithms" in c,
                "parser": parse_java_security
            },
            {
                "name": "Terraform",
                "filename_patterns": ["*.tf"],
                "content_sniffer": lambda c: "resource " in c and ("azurerm" in c or "aws" in c or "google" in c),
                "parser": parse_terraform
            },
            {
                "name": "Kubernetes",
                "filename_patterns": ["*.yaml", "*.yml"],
                "content_sniffer": lambda c: "kind: Ingress" in c or "kind: DestinationRule" in c or "kind: Certificate" in c,
                "parser": parse_kubernetes
            },
            {
                "name": "CloudFormation",
                "filename_patterns": ["*.json", "*.yaml", "*.yml"],
                "content_sniffer": lambda c: "AWSTemplateFormatVersion" in c or "AWS::ElasticLoadBalancingV2::Listener" in c,
                "parser": parse_cloudformation
            },
            {
                "name": "Dockerfile/Compose",
                "filename_patterns": ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
                "content_sniffer": lambda c: "FROM " in c or "services:" in c,
                "parser": parse_dockerfile
            }
        ]
        self.parser_stats = {}
        for p in self.parsers:
            self.parser_stats[p["name"]] = {"attempted": 0, "success": 0}

    def stub_parser(self, file_path: str, content: str) -> List[ConfigFinding]:
        return []

    def route_and_parse(self, file_path: str, content: str) -> List[ConfigFinding]:
        filename = os.path.basename(file_path).lower()
        
        matched_parser = None
        matched_parser_name = None
        
        # 1. Match by filename (exact or simple glob)
        for p in self.parsers:
            for pattern in p["filename_patterns"]:
                if pattern.startswith("*.") and filename.endswith(pattern[1:]):
                    if p["content_sniffer"](content):
                        matched_parser = p["parser"]
                        matched_parser_name = p["name"]
                        break
                elif filename == pattern.lower():
                    matched_parser = p["parser"]
                    matched_parser_name = p["name"]
                    break
            if matched_parser:
                break
                
        # 2. Match by sniffing
        if not matched_parser:
            for p in self.parsers:
                if p["content_sniffer"](content):
                    matched_parser = p["parser"]
                    matched_parser_name = p["name"]
                    break
                    
        if matched_parser:
            self.parser_stats[matched_parser_name]["attempted"] += 1
            try:
                findings = matched_parser(file_path, content)
                self.parser_stats[matched_parser_name]["success"] += 1
                return findings
            except Exception as e:
                # Return unparsed config finding
                return [ConfigFinding(
                    file=file_path,
                    line_start=0,
                    line_end=0,
                    scope_id="global",
                    setting="parse_error",
                    declared_value=None,
                    effective_value=str(e),
                    value_source="inferred_default",
                    evidence_tier="info"
                )]
                
        return []
