import pytest
from scanners.network.plugins.ssh import SshScanner
from scanners.network.target_validation import NormalizedTarget
from scanners.models import NetworkCryptoFinding

def test_ssh_pqc_handling(monkeypatch):
    scanner = SshScanner()
    target = NormalizedTarget(
        original_input="127.0.0.1:22",
        hostname="127.0.0.1",
        resolved_ip="127.0.0.1",
        port=22
    )

    def mock_get_ssh_capabilities(host, port, timeout=5):
        return "SSH-2.0-OpenSSH_9.3p1", {
            "kex": ["sntrup761x25519-sha512@openssh.com", "curve25519-sha256"],
            "host_key": ["ssh-ed25519"],
            "encryption": ["aes256-gcm@openssh.com"],
            "mac": ["hmac-sha2-512-etm@openssh.com"],
            "compression": ["none"]
        }

    monkeypatch.setattr("scanners.network.plugins.ssh.get_ssh_capabilities", mock_get_ssh_capabilities)
    
    findings = scanner.scan([target], max_concurrency=1)
    
    assert len(findings) == 1
    finding = findings[0]
    
    assert finding.scan_status == "success"
    # Even though curve25519 is present, sntrup761x25519 is present, so we report BOTH
    # actually, since curve25519 is present, it's still shor_vulnerable_key_exchange 
    # BUT pqc_groups_accepted should have sntrup.
    assert "sntrup761x25519-sha512@openssh.com" in finding.pqc_groups_accepted
    assert "shor_vulnerable_key_exchange" in finding.quantum_vulnerabilities

def test_ssh_pqc_only(monkeypatch):
    scanner = SshScanner()
    target = NormalizedTarget(
        original_input="127.0.0.1:22",
        hostname="127.0.0.1",
        resolved_ip="127.0.0.1",
        port=22
    )

    def mock_get_ssh_capabilities(host, port, timeout=5):
        return "SSH-2.0-OpenSSH_9.3p1", {
            "kex": ["mlkem768x25519-sha256"],
            "host_key": ["ssh-ed25519"],
            "encryption": ["aes256-gcm@openssh.com"],
            "mac": ["hmac-sha2-512-etm@openssh.com"],
            "compression": ["none"]
        }

    monkeypatch.setattr("scanners.network.plugins.ssh.get_ssh_capabilities", mock_get_ssh_capabilities)
    
    findings = scanner.scan([target], max_concurrency=1)
    
    assert len(findings) == 1
    finding = findings[0]
    
    assert finding.scan_status == "success"
    assert "mlkem768x25519-sha256" in finding.pqc_groups_accepted
    assert "shor_vulnerable_key_exchange" not in finding.quantum_vulnerabilities
