import argparse
import sys
from pathlib import Path
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Tuple

from scanners.network.plugins import get_scanner
from scanners.network.target_validation import normalize_target, NormalizedTarget
from scanners.network.authorization import (
    TargetScope,
    TargetScopeAuthorizer,
    AuditLogger,
    ScopeAuthorizationError,
)
from scanners.network.security import (
    DNSRebindingGuard,
    RateLimiter,
    DeploymentPolicy,
    SecurityControlError,
    SSRFProtectionError,
    DNSRebindingError,
)
from scanners.network.cert_inventory import CertificateInventory
from scanners.cbom_mapping import network_finding_to_cbom, merge_cboms, serialize_cbom
from scanners.models import NetworkCryptoFinding

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def main():
    parser = argparse.ArgumentParser(description="ECDAT Network Scanner (Authorized Scope Only)")
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

    # Scope authorization & Security controls
    parser.add_argument("--scope-config", type=str, help="Path to JSON file defining authorized TargetScope")
    parser.add_argument("--authorized-by", type=str, help="Identity authorizing the scan")
    parser.add_argument("--allowed-hosts", type=str, help="Comma-separated authorized hostnames or patterns")
    parser.add_argument("--allowed-subnets", type=str, help="Comma-separated authorized CIDR subnets")
    parser.add_argument("--audit-log", default="network_scan_audit.jsonl", help="Audit log file path")
    parser.add_argument("--rate-limit-host", type=float, default=5.0, help="Max requests per second per host")
    parser.add_argument("--rate-limit-global", type=float, default=25.0, help="Max global requests per second")

    # Certificate intelligence & inventory export
    parser.add_argument("--export-cert-inventory", type=str, help="Path to export JSON certificate inventory")
    parser.add_argument("--environment", default="production", help="Deployment environment (production, staging, dev)")
    parser.add_argument("--owner", help="Owner / team for discovered certificates")

    args = parser.parse_args()

    if not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60 seconds")
    if not 1 <= args.max_concurrency <= 20:
        parser.error("--max-concurrency must be between 1 and 20")

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.allow_private_targets:
        logging.warning("SAFETY WARNING: Private target scanning is enabled. Proceed with caution.")

    # 1. Scope & Authorization Setup
    audit_logger = AuditLogger(audit_file_path=args.audit_log)
    scope: Optional[TargetScope] = None

    if args.scope_config:
        try:
            scope = TargetScope.from_file(args.scope_config)
        except Exception as e:
            parser.error(f"Failed to load scope configuration from {args.scope_config}: {e}")
    elif args.allowed_hosts or args.allowed_subnets:
        allowed_hosts = (
            set(h.strip() for h in args.allowed_hosts.split(",") if h.strip()) if args.allowed_hosts else set()
        )
        allowed_subnets = (
            [s.strip() for s in args.allowed_subnets.split(",") if s.strip()] if args.allowed_subnets else []
        )
        scope = TargetScope(
            authorized_by=args.authorized_by or "security-admin",
            allowed_hostnames=allowed_hosts,
            allowed_subnets=allowed_subnets,
            allowed_ports={args.port, 443, 8443, 22, 636, 993, 995, 465},
            allow_private_ips=args.allow_private_targets,
            purpose="CLI authorized network scan",
        )
    elif args.authorized_by:
        allowed_hosts = set()
        for t in args.targets:
            try:
                h, _ = normalize_target(t, args.port)
                allowed_hosts.add(h)
            except Exception:
                pass
        scope = TargetScope(
            authorized_by=args.authorized_by,
            allowed_hostnames=allowed_hosts,
            allowed_ports={args.port, 443, 8443, 22, 636, 993, 995, 465},
            allow_private_ips=args.allow_private_targets,
            purpose=f"Explicit scan authorization by {args.authorized_by}",
        )

    authorizer = TargetScopeAuthorizer(default_scope=scope, audit_logger=audit_logger)

    # 2. Security Controls & Rate Limiter
    policy = DeploymentPolicy(
        allow_private_networks=args.allow_private_targets,
        max_concurrency=args.max_concurrency,
        default_timeout_seconds=args.timeout,
        max_rate_per_host_rps=args.rate_limit_host,
        max_global_rps=args.rate_limit_global,
    )
    rate_limiter = RateLimiter(
        host_rate_rps=policy.max_rate_per_host_rps, global_rate_rps=policy.max_global_rps
    )

    normalized_targets: List[NormalizedTarget] = []
    target_meta: Dict[str, Tuple[Optional[str], Optional[str]]] = {}
    findings: List[NetworkCryptoFinding] = []

    # 3. Target Validation, Resolution, SSRF/Rebinding Guard & Authorization
    for t in args.targets:
        target_hostname = t
        target_port = args.port
        try:
            target_hostname, target_port = normalize_target(t, default_port=args.port)

            # Early authorization check (avoids DNS queries for unauthorized targets)
            if not scope or (scope.allowed_hostnames and not scope.allowed_subnets):
                authorizer.authorize(target_supplied=t, hostname=target_hostname, port=target_port, record_audit=False)


            pinned_ip, _ = DNSRebindingGuard.resolve_and_pin(
                hostname=target_hostname,
                port=target_port,
                allow_private=policy.allow_private_networks,
            )

            authorized, reason, audit_id = authorizer.authorize(
                target_supplied=t,
                hostname=target_hostname,
                port=target_port,
                resolved_ip=pinned_ip,
            )

            if not rate_limiter.acquire(pinned_ip, timeout=5.0):
                raise SecurityControlError(f"Rate limit exceeded for host '{pinned_ip}'.")

            nt = NormalizedTarget(
                original_input=t,
                hostname=target_hostname,
                port=target_port,
                resolved_ip=pinned_ip,
            )
            normalized_targets.append(nt)
            target_meta[f"{target_hostname}:{target_port}"] = (scope.scope_id if scope else None, audit_id)

        except ScopeAuthorizationError as e:
            f = NetworkCryptoFinding(
                bom_ref=f"net:target/{t}",
                host=target_hostname,
                port=target_port,
                target_supplied=t,
                timestamp=datetime.now(timezone.utc).isoformat(),
                scan_status="failed",
                error_reason=f"Authorization rejected: {e}",
                authorization_id=scope.scope_id if scope else None,
            )
            findings.append(f)
        except SecurityControlError as e:
            rec = audit_logger.record(
                target_supplied=t,
                hostname=target_hostname,
                port=target_port,
                resolved_ip=None,
                authorized=False,
                scope=scope,
                reason=f"Security control violation: {e}",
                security_flags=["SECURITY_CONTROL_VIOLATION"],
            )
            f = NetworkCryptoFinding(
                bom_ref=f"net:target/{t}",
                host=target_hostname,
                port=target_port,
                target_supplied=t,
                timestamp=datetime.now(timezone.utc).isoformat(),
                scan_status="failed",
                error_reason=str(e),
                authorization_id=scope.scope_id if scope else None,
                audit_id=rec.audit_id,
            )
            findings.append(f)
        except Exception as e:
            f = NetworkCryptoFinding(
                bom_ref=f"net:target/{t}",
                host=target_hostname,
                port=target_port,
                target_supplied=t,
                timestamp=datetime.now(timezone.utc).isoformat(),
                scan_status="failed",
                error_reason=str(e),
                authorization_id=scope.scope_id if scope else None,
            )
            findings.append(f)


    # 4. Invoke Scanner Plugin
    scanner = get_scanner(args.protocol)
    if normalized_targets:
        plugin_findings = scanner.scan(
            normalized_targets, max_concurrency=args.max_concurrency, timeout=args.timeout
        )
        for pf in plugin_findings:
            scope_id, audit_id = target_meta.get(f"{pf.host}:{pf.port}", (None, None))
            pf.authorization_id = scope_id
            pf.audit_id = audit_id
        findings.extend(plugin_findings)

    # 5. Generate CBOM output
    cert_inv = CertificateInventory()
    cboms = []
    success_count = 0

    for finding in findings:
        if finding.scan_status in ("success", "partial"):
            if finding.cert_chain:
                cert_inv.ingest_from_network_finding(
                    finding=finding,
                    owner=args.owner,
                    environment=args.environment,
                )
            if not args.include_chain:
                finding.cert_chain = finding.cert_chain[:1]
            bom = network_finding_to_cbom(finding)
            cboms.append(bom)
            success_count += 1
        else:
            logging.error(f"Scan failed for {finding.target_supplied}: {finding.error_reason}")

    if args.export_cert_inventory:
        cert_inv.save_to_file(args.export_cert_inventory)
        logging.info(f"Saved certificate inventory to {args.export_cert_inventory}.")

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

