import re
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

class ProxyType(str, Enum):
    NGINX = "NGINX"
    APACHE = "APACHE"
    HAPROXY = "HAPROXY"
    ENVOY = "ENVOY"

@dataclass
class ProxyTLSFinding:
    scope: str
    min_protocol: str
    ciphers: str
    line_number: int

class ProxyConfigParser:
    """
    Parses proxy config files taking scope and inheritance into account.
    """
    
    def parse_content(self, filename: str, content: str, proxy_type: ProxyType) -> List[ProxyTLSFinding]:
        if proxy_type == ProxyType.NGINX:
            return self._parse_nginx(content)
        elif proxy_type == ProxyType.APACHE:
            return self._parse_apache(content)
        return []
        
    def _parse_nginx(self, content: str) -> List[ProxyTLSFinding]:
        # Very basic block-aware parser for demonstration
        # In reality, this needs a true recursive descent parser or tree-sitter.
        findings = []
        global_protocols = None
        global_ciphers = None
        
        in_server = False
        current_server_name = ""
        current_server_listen = ""
        server_protocols = None
        server_ciphers = None
        
        lines = content.splitlines()
        for i, line in enumerate(lines):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
                
            if line.startswith("ssl_protocols ") and not in_server:
                global_protocols = line.replace("ssl_protocols ", "").replace(";", "").strip()
                
            if line.startswith("ssl_ciphers ") and not in_server:
                global_ciphers = line.replace("ssl_ciphers ", "").replace(";", "").strip()
                
            if line.startswith("server {"):
                in_server = True
                current_server_name = "unknown"
                current_server_listen = "unknown"
                server_protocols = None
                server_ciphers = None
                
            if in_server:
                if line.startswith("server_name "):
                    current_server_name = line.replace("server_name ", "").replace(";", "").strip()
                if line.startswith("listen "):
                    # e.g., listen 443 ssl;
                    listen_args = line.replace("listen ", "").replace(";", "").strip().split()
                    if listen_args:
                        current_server_listen = listen_args[0]
                if line.startswith("ssl_protocols "):
                    server_protocols = line.replace("ssl_protocols ", "").replace(";", "").strip()
                if line.startswith("ssl_ciphers "):
                    server_ciphers = line.replace("ssl_ciphers ", "").replace(";", "").strip()
                    
                if line == "}":
                    findings.append(ProxyTLSFinding(
                        scope=f"server {current_server_name}:{current_server_listen}",
                        min_protocol=server_protocols or global_protocols or "UNKNOWN",
                        ciphers=server_ciphers or global_ciphers or "UNKNOWN",
                        line_number=i+1
                    ))
                    in_server = False
                    
        return findings

    def _parse_apache(self, content: str) -> List[ProxyTLSFinding]:
        findings = []
        global_protocols = None
        global_ciphers = None
        
        in_vhost = False
        current_vhost = ""
        current_server_name = ""
        vhost_protocols = None
        vhost_ciphers = None
        
        lines = content.splitlines()
        for i, line in enumerate(lines):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
                
            if line.startswith("SSLProtocol ") and not in_vhost:
                global_protocols = self._resolve_apache_protocols(line.replace("SSLProtocol ", "").strip())
                
            if line.startswith("SSLCipherSuite ") and not in_vhost:
                global_ciphers = line.replace("SSLCipherSuite ", "").strip()
                
            if line.startswith("<VirtualHost "):
                in_vhost = True
                current_vhost = line.replace("<VirtualHost ", "").replace(">", "").strip()
                current_server_name = "unknown"
                vhost_protocols = None
                vhost_ciphers = None
                
            if in_vhost:
                if line.startswith("ServerName "):
                    current_server_name = line.replace("ServerName ", "").strip()
                if line.startswith("SSLProtocol "):
                    vhost_protocols = self._resolve_apache_protocols(line.replace("SSLProtocol ", "").strip())
                if line.startswith("SSLCipherSuite "):
                    vhost_ciphers = line.replace("SSLCipherSuite ", "").strip()
                    
                if line == "</VirtualHost>":
                    findings.append(ProxyTLSFinding(
                        scope=f"VirtualHost {current_server_name} ({current_vhost})",
                        min_protocol=vhost_protocols or global_protocols or "UNKNOWN",
                        ciphers=vhost_ciphers or global_ciphers or "UNKNOWN",
                        line_number=i+1
                    ))
                    in_vhost = False
                    
        return findings

    def _resolve_apache_protocols(self, directive: str) -> str:
        return directive
