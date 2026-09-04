from typing import List
from datetime import datetime, timezone
import logging
from sslyze import Scanner, ServerNetworkLocation, ServerScanRequest, ScanCommand, ScanCommandAttemptStatusEnum

from scanners.models import NetworkCryptoFinding
from scanners.network.cert_parser import parse_cert
from scanners.network.target_validation import NormalizedTarget

logger = logging.getLogger(__name__)


class TlsScanner:
    def scan(
        self, targets: List[NormalizedTarget], max_concurrency: int, timeout: int = 15
    ) -> List[NetworkCryptoFinding]:
        findings = []
        scan_requests = []
        target_map = {}

        for t in targets:
            finding = NetworkCryptoFinding(
                bom_ref=f"net:target/{t.hostname}:{t.port}",
                host=t.hostname,
                port=t.port,
                target_supplied=t.original_input,
                timestamp=datetime.now(timezone.utc).isoformat(),
                resolved_endpoint=f"{t.resolved_ip}:{t.port}" if t.resolved_ip else None,
            )

            if not t.resolved_ip:
                finding.scan_status = "failed"
                finding.error_reason = "No resolved IP available."
                findings.append(finding)
                continue

            location = ServerNetworkLocation(hostname=t.hostname, port=t.port, ip_address=t.resolved_ip)
            request = ServerScanRequest(
                server_location=location,
                scan_commands={
                    ScanCommand.CERTIFICATE_INFO,
                    ScanCommand.SSL_2_0_CIPHER_SUITES,
                    ScanCommand.SSL_3_0_CIPHER_SUITES,
                    ScanCommand.TLS_1_0_CIPHER_SUITES,
                    ScanCommand.TLS_1_1_CIPHER_SUITES,
                    ScanCommand.TLS_1_2_CIPHER_SUITES,
                    ScanCommand.TLS_1_3_CIPHER_SUITES,
                },
            )
            scan_requests.append(request)
            target_map[f"{t.hostname}:{t.port}"] = finding

        if not scan_requests:
            return findings

        scanner = Scanner(concurrent_server_scans_limit=max_concurrency)
        scanner.queue_scans(scan_requests)

        for server_scan_result in scanner.get_results():
            loc = server_scan_result.server_location
            finding = target_map[f"{loc.hostname}:{loc.port}"]

            if server_scan_result.connectivity_status.name == "ERROR":
                finding.scan_status = "failed"
                finding.error_reason = f"Connectivity error: {server_scan_result.connectivity_error_trace}"
                findings.append(finding)
                continue

            partial = False

            cert_info = getattr(server_scan_result.scan_result, "certificate_info", None)
            if cert_info and cert_info.status == ScanCommandAttemptStatusEnum.COMPLETED:
                for deployment in cert_info.result.certificate_deployments:
                    for cert in deployment.received_certificate_chain:
                        cert_dict = parse_cert(cert)
                        finding.cert_chain.append(cert_dict)

                        family = cert_dict["algo_family"]
                        size = cert_dict["key_size"]
                        if family and size:
                            finding.key_sizes[family] = size
                    break
            else:
                partial = True

            cipher_commands = [
                ("ssl_2_0_cipher_suites", "SSLv2"),
                ("ssl_3_0_cipher_suites", "SSLv3"),
                ("tls_1_0_cipher_suites", "TLSv1.0"),
                ("tls_1_1_cipher_suites", "TLSv1.1"),
                ("tls_1_2_cipher_suites", "TLSv1.2"),
                ("tls_1_3_cipher_suites", "TLSv1.3"),
            ]

            for attr_name, proto_name in cipher_commands:
                res = getattr(server_scan_result.scan_result, attr_name, None)
                if res and res.status == ScanCommandAttemptStatusEnum.COMPLETED:
                    accepted_ciphers = res.result.accepted_cipher_suites
                    if accepted_ciphers:
                        finding.tls_versions.append(proto_name)
                        for cipher in accepted_ciphers:
                            finding.cipher_suites.append(cipher.cipher_suite.name)
                elif res and res.status == ScanCommandAttemptStatusEnum.ERROR:
                    partial = True

            finding.scan_status = "partial" if partial else "success"
            findings.append(finding)

        return findings
