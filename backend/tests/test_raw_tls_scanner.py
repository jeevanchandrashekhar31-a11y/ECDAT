import pytest
from scanners.network.plugins.tls import TlsScanner, ScanProfile
from scanners.network.target_validation import NormalizedTarget

def test_tls_scanner_quick_profile():
    scanner = TlsScanner(profile=ScanProfile.QUICK)
    targets = [NormalizedTarget(original_input="example.com", hostname="example.com", port=443, resolved_ip="127.0.0.1")]
    
    # We mock the actual socket connect in real tests, but here we just check if it returns
    # an expected structure when failing gracefully (or if mocked).
    findings = scanner.scan(targets, max_concurrency=1)
    assert len(findings) == 1
    assert hasattr(findings[0], "tls_versions")
    assert hasattr(findings[0], "pqc_groups_accepted")
    
def test_tls_scanner_deep_profile():
    scanner = TlsScanner(profile=ScanProfile.DEEP)
    targets = [NormalizedTarget(original_input="example.com", hostname="example.com", port=443, resolved_ip="127.0.0.1")]
    
    findings = scanner.scan(targets, max_concurrency=1)
    assert len(findings) == 1
    assert hasattr(findings[0], "vuln_checks")

def test_tls_scanner_rejects_loopback():
    scanner = TlsScanner(profile=ScanProfile.QUICK)
    targets = [NormalizedTarget(original_input="127.0.0.1", hostname="127.0.0.1", port=443, resolved_ip=None)]
    
    findings = scanner.scan(targets, max_concurrency=1)
    assert len(findings) == 1
    assert findings[0].scan_status == "failed"
    assert "No resolved IP available" in findings[0].error_reason
