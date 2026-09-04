import argparse
import sys
from pathlib import Path
import logging
from datetime import datetime, timezone

from scanners.network.plugins import get_scanner
from scanners.network.target_validation import validate_and_resolve
from scanners.cbom_mapping import network_finding_to_cbom, merge_cboms, serialize_cbom
from scanners.models import NetworkCryptoFinding

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def main():
    parser = argparse.ArgumentParser(description="ECDAT Network Scanner")
    parser.add_argument("targets", nargs="+", help="Target host(s), e.g., badssl.com https://host:8443")
    parser.add_argument("--protocol", choices=["tls", "ssh"], default="tls", help="Protocol scanner plugin to use")
    parser.add_argument("--port", type=int, default=443, help="Default port if none provided")
    parser.add_argument("--timeout", type=int, default=15, help="Timeout in seconds")
    parser.add_argument("--max-concurrency", type=int, default=5, help="Max concurrent scans")
    parser.add_argument("--sni", type=str, help="Custom SNI hostname")
    parser.add_argument("--allow-private-targets", action="store_true", help="Allow scanning private/RFC1918 IPs")
    parser.add_argument("--include-chain", action="store_true", help="Include full cert chain in output")
    parser.add_argument("--output-format", choices=["cyclonedx-json"], default="cyclonedx-json")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("-o", "--output", default="network_cbom.json", help="Output JSON path")
    args = parser.parse_args()

    if not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if not 1 <= args.max_concurrency <= 20:
        parser.error("--max-concurrency must be between 1 and 20")

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.allow_private_targets:
        logging.warning("SAFETY WARNING: Private target scanning is enabled. Proceed with caution.")

    concurrency = args.max_concurrency

    # 1. Target Validation
    normalized_targets = []
    findings = []
    for t in args.targets:
        try:
            nt = validate_and_resolve(t, allow_private=args.allow_private_targets, default_port=args.port)
            normalized_targets.append(nt)
        except ValueError as e:
            f = NetworkCryptoFinding(
                bom_ref=f"net:target/{t}",
                host=t,
                port=args.port,
                target_supplied=t,
                timestamp=datetime.now(timezone.utc).isoformat(),
                scan_status="failed",
                error_reason=str(e),
            )
            findings.append(f)

    # 2. Invoke Scanner Plugin
    scanner = get_scanner(args.protocol)
    if normalized_targets:
        plugin_findings = scanner.scan(normalized_targets, max_concurrency=concurrency, timeout=args.timeout)
        findings.extend(plugin_findings)

    cboms = []
    success_count = 0
    for finding in findings:
        if finding.scan_status in ("success", "partial"):
            if not args.include_chain:
                finding.cert_chain = finding.cert_chain[:1]
            bom = network_finding_to_cbom(finding)
            cboms.append(bom)
            success_count += 1
        else:
            logging.error(f"Scan failed for {finding.target_supplied}: {finding.error_reason}")

    if cboms:
        merged_bom = merge_cboms(cboms)
        json_output = serialize_cbom(merged_bom)
        Path(args.output).write_text(json_output, encoding="utf-8")
        logging.info(
            f"Scanned {len(args.targets)} targets. {success_count} successful/partial. Wrote CBOM to {args.output}."
        )
    else:
        logging.info("No successful scans completed.")


if __name__ == "__main__":
    main()
