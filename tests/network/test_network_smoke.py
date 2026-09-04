import pytest
from scanners.network.plugins.tls import TlsScanner
from scanners.network.target_validation import NormalizedTarget


def test_perform_scans_invalid_host():
    scanner = TlsScanner()
    target = NormalizedTarget("invalid.invalid", "invalid.invalid", 443, None)
    findings = scanner.scan([target], max_concurrency=1)

    assert len(findings) == 1
    assert findings[0].scan_status == "failed"
    assert "No resolved IP" in findings[0].error_reason
