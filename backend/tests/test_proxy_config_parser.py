import pytest
from scanners.static.parsers.proxy_config_parser import ProxyConfigParser, ProxyType

def test_nginx_parsing():
    parser = ProxyConfigParser()
    nginx_conf = """
http {
    ssl_protocols TLSv1.1 TLSv1.2;
    
    server {
        listen 443 ssl;
        server_name example.com;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
    }
    
    server {
        listen 8443 ssl;
        server_name legacy.com;
        # Inherits TLSv1.1 from http block!
    }
}
"""
    findings = parser.parse_content("nginx.conf", nginx_conf, ProxyType.NGINX)
    
    assert len(findings) == 2
    
    # example.com server
    f1 = next(f for f in findings if f.scope == "server example.com:443")
    assert f1.min_protocol == "TLSv1.2"
    assert f1.ciphers == "HIGH:!aNULL:!MD5"
    
    # legacy.com server
    f2 = next(f for f in findings if f.scope == "server legacy.com:8443")
    assert f2.min_protocol == "TLSv1.1" # Inherited from http block

def test_apache_parsing():
    parser = ProxyConfigParser()
    apache_conf = """
SSLProtocol all -SSLv3
SSLCipherSuite HIGH:MEDIUM:!MD5:!RC4

<VirtualHost *:443>
    ServerName www.example.com
    SSLProtocol -all +TLSv1.3
</VirtualHost>

<VirtualHost *:8443>
    ServerName api.example.com
</VirtualHost>
"""
    findings = parser.parse_content("apache2.conf", apache_conf, ProxyType.APACHE)
    
    assert len(findings) == 2
    f1 = next(f for f in findings if "www.example.com" in f.scope)
    assert f1.min_protocol == "TLSv1.3"
    
    f2 = next(f for f in findings if "api.example.com" in f.scope)
    assert f2.min_protocol == "TLSv1.0" # all -SSLv3 means TLSv1.0+ in standard apache docs unless explicitly configured. We'll map "all -SSLv3" to TLSv1.0
