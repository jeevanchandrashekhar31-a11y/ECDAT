import json
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

from scanners.network.target_validation import NormalizedTarget
from scanners.models import NetworkCryptoFinding
import subprocess
import sys


def test_cli_unauthorized_target_rejected(tmp_path):
    audit_file = tmp_path / "audit.jsonl"
    cbom_file = tmp_path / "cbom.json"

    # Run without scope or authorization
    res = subprocess.run(
        [
            sys.executable,
            "-m",
            "scanners.network.main",
            "unauthorized.example.com",
            "--audit-log",
            str(audit_file),
            "-o",
            str(cbom_file),
        ],
        capture_output=True,
        text=True,
    )

    # CLI completes execution, but target is rejected
    assert audit_file.exists()
    audit_records = [json.loads(line) for line in audit_file.read_text().splitlines() if line.strip()]
    assert len(audit_records) >= 1
    assert audit_records[0]["authorized"] is False
    assert "No target authorization scope provided" in audit_records[0]["reason"]
    # No CBOM generated because all targets were unauthorized / failed
    assert not cbom_file.exists()


def test_cli_authorized_target_with_allowed_hosts(tmp_path):
    audit_file = tmp_path / "audit_auth.jsonl"
    cbom_file = tmp_path / "cbom_auth.json"

    mock_finding = NetworkCryptoFinding(
        bom_ref="net:target/service.corp.internal:443",
        host="service.corp.internal",
        port=443,
        tls_versions=["TLSv1.3"],
        cipher_suites=["TLS_AES_128_GCM_SHA256"],
        scan_status="success",
        cert_chain=[
            {
                "subjectName": "CN=service.corp.internal",
                "issuerName": "CN=service.corp.internal",
                "notValidBefore": "2026-01-01T00:00:00+00:00",
                "notValidAfter": "2027-01-01T00:00:00+00:00",
                "isExpired": False,
                "isSelfSigned": True,
                "algo_family": "RSA",
                "key_size": 2048,
                "signature_algorithm": "sha256WithRSAEncryption",
            }
        ],
    )

    with (
        patch("scanners.network.security.DNSRebindingGuard.resolve_and_pin") as mock_dns,
        patch("scanners.network.plugins.get_scanner") as mock_get_scanner,
    ):
        mock_dns.return_value = ("93.184.216.34", ["93.184.216.34"])
        mock_scanner = MagicMock()
        mock_scanner.scan.return_value = [mock_finding]
        mock_get_scanner.return_value = mock_scanner

        from scanners.network.main import main
        import sys

        test_args = [
            "prog",
            "service.corp.internal",
            "--allowed-hosts",
            "service.corp.internal",
            "--authorized-by",
            "admin@corp.internal",
            "--audit-log",
            str(audit_file),
            "-o",
            str(cbom_file),
        ]
        with patch.object(sys, "argv", test_args):
            main()

        assert audit_file.exists()
        audit_records = [json.loads(line) for line in audit_file.read_text().splitlines() if line.strip()]
        assert len(audit_records) == 1
        assert audit_records[0]["authorized"] is True
        assert audit_records[0]["authorized_by"] == "admin@corp.internal"

        assert cbom_file.exists()
        cbom_data = json.loads(cbom_file.read_text())
        assert cbom_data["bomFormat"] == "CycloneDX"


def test_cli_authorized_target_with_scope_file(tmp_path):
    scope_file = tmp_path / "scope.json"
    audit_file = tmp_path / "audit_scope.jsonl"
    cbom_file = tmp_path / "cbom_scope.json"

    scope_data = {
        "scope_id": "scope-file-test",
        "authorized_by": "compliance-officer",
        "allowed_hostnames": ["*.partner.com"],
        "allowed_ports": [443, 8443],
    }
    scope_file.write_text(json.dumps(scope_data))

    mock_finding = NetworkCryptoFinding(
        bom_ref="net:target/api.partner.com:443",
        host="api.partner.com",
        port=443,
        tls_versions=["TLSv1.2"],
        cipher_suites=["ECDHE-RSA-AES256-GCM-SHA384"],
        scan_status="success",
    )

    with (
        patch("scanners.network.security.DNSRebindingGuard.resolve_and_pin") as mock_dns,
        patch("scanners.network.plugins.get_scanner") as mock_get_scanner,
    ):
        mock_dns.return_value = ("93.184.216.34", ["93.184.216.34"])
        mock_scanner = MagicMock()
        mock_scanner.scan.return_value = [mock_finding]
        mock_get_scanner.return_value = mock_scanner

        from scanners.network.main import main
        import sys

        test_args = [
            "prog",
            "api.partner.com",
            "--scope-config",
            str(scope_file),
            "--audit-log",
            str(audit_file),
            "-o",
            str(cbom_file),
        ]
        with patch.object(sys, "argv", test_args):
            main()

        assert audit_file.exists()
        audit_records = [json.loads(line) for line in audit_file.read_text().splitlines() if line.strip()]
        assert len(audit_records) == 1
        assert audit_records[0]["authorized"] is True
        assert audit_records[0]["scope_id"] == "scope-file-test"
        assert audit_records[0]["authorized_by"] == "compliance-officer"

        assert cbom_file.exists()
