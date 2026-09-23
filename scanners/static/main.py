import argparse
import sys
import json
from pathlib import Path

from scanners.static.discovery import FileDiscovery
from scanners.static.regex_rules import apply_regex_rules
from scanners.static.sanitization import redact_secrets
from scanners.static.results import StaticFinding
from scanners.cbom_mapping import code_finding_to_cbom, merge_cboms, serialize_cbom
from scanners.models import CodeCryptoFinding
from scanners.gating import VALID_FAIL_ON, evaluate_static_gate, static_finding_severity

from scanners.domain.contracts import ScanStatus
from scanners.domain.errors import (
    ParserFailureError,
    PermissionFailureError,
    ScannerFailureError,
    evaluate_scan_status,
)
from scanners.static.ast.adapters import get_default_adapter_registry


def main():
    parser = argparse.ArgumentParser(description="ECDAT Static Code Scanner (Phase 3.3)")
    parser.add_argument("target_dir", help="Directory to scan")
    parser.add_argument("-o", "--output", default="artifacts/static_cbom.json", help="Output CBOM JSON path")
    parser.add_argument(
        "--include-ext",
        default=".c,.h,.cpp,.hpp,.cc,.go,.js,.mjs,.cjs,.py,.pyw,.java,.kt,.kts,.ts,.tsx,.cs,.rs",
        help="Comma-separated list of extensions to include",
    )
    parser.add_argument(
        "--exclude-dir",
        default=".git,node_modules,vendor,dist,build,.venv,fixtures,artifacts,examples,coverage,tests,testing,rules,scanners,risk_engine,security_tests",
        help="Comma-separated list of directories to exclude",
    )
    parser.add_argument("--max-file-size-mb", type=int, default=5, help="Maximum file size to scan in MB")
    parser.add_argument("--max-files", type=int, default=10000, help="Maximum eligible files to scan (1-10000)")
    parser.add_argument("--max-depth", type=int, default=25, help="Maximum directory traversal depth (default: 25)")
    parser.add_argument(
        "--rules", default="rules/static_rules.json", help="Path to external rules JSON (Placeholder for future)"
    )
    parser.add_argument("--llm-verify", action="store_true", help="Verify ambiguous regex findings with LLM")
    parser.add_argument("--llm-provider", default="groq", help="LLM Provider to use (default: groq)")
    parser.add_argument("--output-sarif", default=None, help="Output SARIF JSON path")
    parser.add_argument(
        "--fail-on",
        choices=VALID_FAIL_ON,
        default="none",
        help="CI gate: none, critical, high, or mosca-risk (backend import evaluates Mosca)",
    )
    parser.add_argument(
        "--policy-profile",
        default=None,
        help="Policy label for pipeline consistency; use backend import for policy/Mosca evaluation",
    )

    args = parser.parse_args()

    if not 1 <= args.max_file_size_mb <= 100:
        parser.error("--max-file-size-mb must be between 1 and 100")
    if not 1 <= args.max_files <= 10000:
        parser.error("--max-files must be between 1 and 10000")
    if not 1 <= args.max_depth <= 100:
        parser.error("--max-depth must be between 1 and 100")

    include_exts = set(args.include_ext.split(","))
    exclude_dirs = set(args.exclude_dir.split(","))
    max_size_bytes = args.max_file_size_mb * 1024 * 1024

    discovery = FileDiscovery(
        args.target_dir,
        include_exts,
        exclude_dirs,
        max_size_bytes,
        max_files=args.max_files,
        max_depth=args.max_depth,
    )

    try:
        files_to_scan = discovery.discover_files()
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Discovered {len(files_to_scan)} files to scan.")
    print(f"Skipped files: {discovery.skipped_stats}")

    registry = get_default_adapter_registry()
    findings = []
    scan_errors = []

    for fpath in files_to_scan:
        try:
            with open(fpath, "rb") as f:
                source_code = f.read()
            content = source_code.decode("utf-8", errors="replace")
        except (PermissionError, OSError) as pe:
            discovery.skipped_stats["unreadable"] += 1
            scan_errors.append(PermissionFailureError(f"Cannot read file: {fpath}", {"file": str(fpath)}, fatal=False))
            continue

        ext = fpath.suffix.lower()
        ast_findings = []
        adapter = registry.get_by_extension(ext)
        if adapter:
            try:
                ast_findings = adapter.extract_findings(source_code, fpath, discovery.root_dir)
            except Exception as e:
                scan_errors.append(
                    ParserFailureError(f"AST parsing failed for {fpath}: {e}", {"file": str(fpath)}, fatal=False)
                )

        raw_matches = apply_regex_rules(content)
        regex_findings = []
        for match in raw_matches:
            sanitized_evidence = redact_secrets(match["evidence"])
            rel_path = str(fpath.relative_to(discovery.root_dir))

            finding = StaticFinding(
                file_path=rel_path,
                line_number=match["line_number"],
                rule_id=match["rule_id"],
                algorithm=match["algorithm"],
                evidence=sanitized_evidence,
                confidence=match["confidence"],
                finding_type=match["finding_type"],
                severity=match["severity"],
            )
            regex_findings.append(finding)

        # Deduplication: Key by (file_path, line_number)
        final_file_findings = {}

        # AST takes precedence
        for f in ast_findings:
            key = f"{f.file_path}:{f.line_number}"
            key_algo = f"{key}:{f.algorithm}"
            final_file_findings[key_algo] = f

        for f in regex_findings:
            key_algo = f"{f.file_path}:{f.line_number}:{f.algorithm}"
            if key_algo not in final_file_findings:
                # Basic superseding check (e.g. AST found specific function, regex found base algo name)
                final_file_findings[key_algo] = f

        # Secret-safe candidate detection
        from scanners.static.secret_detector import SecretSafeDetector

        _, secret_candidates = SecretSafeDetector.detect_and_redact(
            content, file_path=str(fpath.relative_to(discovery.root_dir))
        )
        secret_findings = SecretSafeDetector.create_static_findings(secret_candidates)
        for sf in secret_findings:
            key_algo = f"{sf.file_path}:{sf.line_number}:{sf.algorithm}"
            if key_algo not in final_file_findings:
                final_file_findings[key_algo] = sf

        # Cap findings per file to 500 to prevent memory blowup on generated-code explosions
        file_results = list(final_file_findings.values())[:500]
        findings.extend(file_results)

    print(f"Found {len(findings)} potential cryptographic usage sites.")

    if args.llm_verify:
        from scanners.static.llm_verifier import LLMVerifier
        from scanners.static.privacy_filter import sanitize_for_llm

        verifier = LLMVerifier(provider=args.llm_provider)

        if not verifier.can_verify():
            print(
                "Warning: --llm-verify passed but no API key or max requests reached. Skipping LLM verification.",
                file=sys.stderr,
            )
        else:
            print("Running optional LLM verification on ambiguous findings...")
            for finding in findings:
                if not verifier.can_verify():
                    break

                # We only verify ambiguous findings
                if finding.confidence in ["medium", "low"] or finding.finding_type == "crypto_api_call":
                    # Read the source snippet safely
                    try:
                        fpath = discovery.root_dir / finding.file_path
                        with open(fpath, "rb") as f:
                            source_code = f.read()
                        content = source_code.decode("utf-8", errors="replace")
                        snippet = sanitize_for_llm(content, finding.line_number)

                        llm_result = verifier.verify_finding(snippet, finding.algorithm, finding.rule_id)

                        if llm_result:
                            # Update finding based on LLM response
                            # Don't silently downgrade a high-confidence AST finding, but we only verify medium/low
                            finding.analysis_source = "llm_verified"
                            if "confidence" in llm_result:
                                finding.confidence = llm_result["confidence"]
                            if "needs_human_review" in llm_result:
                                finding.needs_human_review = llm_result["needs_human_review"]
                            if "reason" in llm_result:
                                finding.reason = llm_result["reason"]

                    except (PermissionError, OSError):
                        pass

    cboms = []

    for finding in findings:
        normalized_path = str(finding.file_path).replace("\\", "/")
        key_size_str = f":{finding.key_size}" if getattr(finding, "key_size", None) else ""
        ccf = CodeCryptoFinding(
            bom_ref=f"code:{normalized_path}:{finding.algorithm}{key_size_str}",
            file_path=normalized_path,
            language="Unknown",
            line=finding.line_number,
            algorithm=finding.algorithm,
            finding_type=finding.finding_type,
            confidence=finding.confidence,
            analysis_source=finding.analysis_source,
            needs_human_review=finding.needs_human_review,
            reason=finding.reason,
            fingerprint=getattr(finding, "fingerprint", None),
            secret_type=getattr(finding, "secret_type", None),
        )

        cboms.append(code_finding_to_cbom(ccf))

    out_dir = Path(args.output).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    if cboms:
        merged_bom = merge_cboms(cboms)
        json_output = serialize_cbom(merged_bom)
        Path(args.output).write_text(json_output, encoding="utf-8")
        print(f"Wrote CBOM to {args.output}")
    else:
        empty_json = '{\n  "bomFormat": "CycloneDX",\n  "specVersion": "1.6",\n  "components": []\n}\n'
        Path(args.output).write_text(empty_json, encoding="utf-8")
        print(f"Wrote empty CBOM to {args.output}")

    if args.output_sarif:
        from scanners.static.sarif import generate_sarif

        sarif_out = Path(args.output_sarif)
        sarif_out.parent.mkdir(parents=True, exist_ok=True)
        sarif_data = generate_sarif(findings)
        sarif_out.write_text(json.dumps(sarif_data, indent=2), encoding="utf-8")
        print(f"Wrote SARIF to {args.output_sarif}")

    should_fail, gate_matches = evaluate_static_gate(findings, args.fail_on)
    if args.fail_on == "mosca-risk":
        print(
            "Mosca gate deferred: static scans do not calculate Mosca status; run backend import with --fail-on mosca-risk."
        )
    if should_fail:
        print(
            f"{args.fail_on.capitalize()} findings detected! Failing pipeline. Artifacts were written before this gate.",
            file=sys.stderr,
        )
        for match in gate_matches:
            print(f"  - {match}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
