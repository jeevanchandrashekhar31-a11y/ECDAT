from types import SimpleNamespace
from unittest.mock import patch

from scanners.network.plugins.tls import TlsScanner
from scanners.network.target_validation import NormalizedTarget


def test_tls_scanner_uses_mocked_sslyze_and_pinned_resolved_ip():
    target = NormalizedTarget("example.test", "example.test", 443, "93.184.216.34")
    cipher_result = SimpleNamespace(
        status="completed",
        result=SimpleNamespace(
            accepted_cipher_suites=[SimpleNamespace(cipher_suite=SimpleNamespace(name="TLS_AES_128_GCM_SHA256"))]
        ),
    )
    scan_result = SimpleNamespace(
        certificate_info=None,
        ssl_2_0_cipher_suites=None,
        ssl_3_0_cipher_suites=None,
        tls_1_0_cipher_suites=None,
        tls_1_1_cipher_suites=None,
        tls_1_2_cipher_suites=None,
        tls_1_3_cipher_suites=cipher_result,
    )
    server_result = SimpleNamespace(
        server_location=SimpleNamespace(hostname="example.test", port=443),
        connectivity_status=SimpleNamespace(name="COMPLETED"),
        scan_result=scan_result,
    )

    class FakeScanner:
        def __init__(self, concurrent_server_scans_limit):
            assert concurrent_server_scans_limit == 1

        def queue_scans(self, requests):
            assert len(requests) == 1

        def get_results(self):
            return [server_result]

    fake_location = lambda hostname, port, ip_address: SimpleNamespace(
        hostname=hostname, port=port, ip_address=ip_address
    )
    fake_request = lambda server_location, scan_commands: SimpleNamespace(
        server_location=server_location, scan_commands=scan_commands
    )
    fake_status = SimpleNamespace(COMPLETED="completed", ERROR="error")

    with (
        patch("scanners.network.plugins.tls.Scanner", FakeScanner),
        patch("scanners.network.plugins.tls.ServerNetworkLocation", fake_location),
        patch("scanners.network.plugins.tls.ServerScanRequest", fake_request),
        patch("scanners.network.plugins.tls.ScanCommandAttemptStatusEnum", fake_status),
    ):
        findings = TlsScanner().scan([target], max_concurrency=1, timeout=1)

    assert findings[0].scan_status == "partial"
    assert findings[0].resolved_endpoint == "93.184.216.34:443"
    assert findings[0].tls_versions == ["TLSv1.3"]
    assert findings[0].cipher_suites == ["TLS_AES_128_GCM_SHA256"]
