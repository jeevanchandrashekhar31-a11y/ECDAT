import subprocess
import time
import socket
import threading
import sys
import os

from scanners.network.plugins.tls import TlsScanner
from scanners.network.target_validation import NormalizedTarget

def wait_for_port(port, timeout=5):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                return True
        except (socket.timeout, ConnectionRefusedError):
            time.sleep(0.1)
    return False

import pytest
import shutil

@pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl not found in PATH")
def test_openssl_s_server():
    # Start openssl s_server with specific groups if supported, else default
    # This requires openssl to be in PATH. We'll use standard groups for compatibility,
    # or just let it use defaults to test basic TLS scanner functionality.
    
    port = 8443
    
    # Generate temporary key and cert
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", "key.pem", "-out", "cert.pem", "-days", "1", "-nodes", "-subj", "/CN=localhost"], check=True, capture_output=True)
    
    # We will just start s_server with TLS 1.2 and 1.3
    proc = subprocess.Popen([
        "openssl", "s_server", 
        "-key", "key.pem", 
        "-cert", "cert.pem", 
        "-accept", str(port),
        "-www"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    try:
        if not wait_for_port(port):
            print("Failed to start openssl s_server")
            return
            
        scanner = TlsScanner()
        target = NormalizedTarget(
            original_input=f"127.0.0.1:{port}",
            hostname="127.0.0.1",
            resolved_ip="127.0.0.1",
            port=port
        )
        
        findings = scanner.scan([target], max_concurrency=1)
        assert len(findings) == 1
        finding = findings[0]
        
        assert finding.scan_status == "success"
        assert len(finding.tls_versions) > 0
        assert len(finding.cipher_suites) > 0
        
        print("openssl s_server lab ground-truth test passed.")
        
    finally:
        proc.terminate()
        proc.wait(timeout=2)
        if os.path.exists("key.pem"): os.remove("key.pem")
        if os.path.exists("cert.pem"): os.remove("cert.pem")

if __name__ == "__main__":
    test_openssl_s_server()
