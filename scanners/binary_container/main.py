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
