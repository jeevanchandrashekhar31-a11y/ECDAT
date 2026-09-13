import argparse
import logging
import sys
from pathlib import Path

from scanners.binary_container.target_validation import validate_target
from scanners.binary_container.syft_runner import run_syft_scan
from scanners.binary_container.component_classifier import parse_cyclonedx_for_crypto
from scanners.cbom_mapping import binary_finding_to_cbom, merge_cboms, serialize_cbom

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def main():
    parser = argparse.ArgumentParser(description="ECDAT Binary/Container Scanner (Syft Wrapper)")
    parser.add_argument("target", help="Target path or image name (e.g., './target-dir', 'nginx:latest')")
    parser.add_argument(
        "--target-type",
        choices=["directory", "file", "archive", "image"],
        default="directory",
        help="The type of target to scan.",
    )
    parser.add_argument("-o", "--output", default="binary_cbom.json", help="Output CBOM JSON path")
    parser.add_argument("--catalog", default=None, help="Path to custom crypto library catalog JSON")
    parser.add_argument("--timeout", type=int, default=300, help="Syft execution timeout in seconds")
    args = parser.parse_args()

    if not 1 <= args.timeout <= 600:
        parser.error("--timeout must be between 1 and 600 seconds")

    # 1. Validate Target safely
    try:
        validate_target(args.target, args.target_type)
    except Exception as e:
        logging.error(f"Target Validation Error: {e}")
        sys.exit(1)

    # 1.5 For single file targets, inspect directly via safe static binary parser first
    if args.target_type == "file":
        target_path = Path(args.target)
        if target_path.is_file():
            try:
                from scanners.binary_container.parsers import analyze_binary, BinaryFormat
                from scanners.cbom_mapping import binary_metadata_to_cbom

                meta = analyze_binary(str(target_path), timeout_seconds=args.timeout)
                if meta.binary_format != BinaryFormat.UNKNOWN:
                    logging.info(
                        f"Detected {meta.binary_format.value} binary ({meta.architecture}). "
                        f"Extracting metadata safely without execution."
                    )
                    cbom = binary_metadata_to_cbom(meta, target_name=target_path.name)
                    json_output = serialize_cbom(cbom)
                    out_path = Path(args.output)
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_text(json_output, encoding="utf-8")
                    logging.info(
                        f"Static binary analysis complete. Found {len(meta.crypto_library_indicators)} "
                        f"crypto indicators. Wrote CBOM to {args.output}"
                    )
                    return
            except Exception as e:
                logging.warning(f"Static binary parser encountered error, falling back to Syft: {e}")

    # 1.6 For container image archives, analyze statically without executing entrypoints
    if args.target_type == "archive":
        target_path = Path(args.target)
        if target_path.is_file():
            try:
                from scanners.binary_container.container_analyzer import ContainerImageAnalyzer, container_report_to_cbom

                analyzer = ContainerImageAnalyzer()
                report = analyzer.analyze_image_archive(target_path, image_reference=target_path.name)
                cbom = container_report_to_cbom(report)
                json_output = serialize_cbom(cbom)
                out_path = Path(args.output)
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(json_output, encoding="utf-8")
                logging.info(
                    f"Container image static analysis complete. Found {len(report.crypto_libraries)} "
                    f"crypto libraries, {len(report.certificates)} certs. Wrote CBOM to {args.output}"
                )
                return
            except Exception as e:
                logging.warning(f"Direct container image archive parser fallback to Syft: {e}")

    # 2. Run Syft (returns CycloneDX JSON)
    syft_data = run_syft_scan(args.target, timeout_seconds=args.timeout)

    # 3. Classify components and extract crypto libs
    findings = parse_cyclonedx_for_crypto(args.target, syft_data, catalog_path=args.catalog)

    # 4. Map to CBOM
    cboms = []
    for f in findings:
        cboms.append(binary_finding_to_cbom(f))

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if cboms:
        merged_bom = merge_cboms(cboms)
        json_output = serialize_cbom(merged_bom)
        out_path.write_text(json_output, encoding="utf-8")
        logging.info(f"Found {len(findings)} cryptographic components. Wrote CBOM to {args.output}")
    else:
        empty_json = '{\n  "bomFormat": "CycloneDX",\n  "specVersion": "1.6",\n  "components": []\n}\n'
        out_path.write_text(empty_json, encoding="utf-8")
        logging.info("No cryptographic components found. Wrote empty CBOM.")


if __name__ == "__main__":
    main()
