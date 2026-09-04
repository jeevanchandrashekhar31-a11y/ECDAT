"""Import the bundled non-sensitive demo CBOM into a running local backend."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

api_url = os.environ.get("ECDAT_API_URL", "http://backend:5000/api/v1/cboms")
api_key = os.environ.get("ECDAT_API_KEY", "change-this-local-api-key")

# Locate CBOM file
candidate_paths = [
    Path("/opt/ecdat/docker/demo_cbom.json"),
    Path(__file__).parent / "demo_cbom.json",
    Path("docker/demo_cbom.json"),
    Path("artifacts/merged_cbom.json")
]

cbom_file = None
for p in candidate_paths:
    if p.exists():
        cbom_file = p
        break

if not cbom_file:
    raise SystemExit(f"Error: Demo CBOM file not found in candidates: {[str(p) for p in candidate_paths]}")

print(f"Loading demo CBOM from: {cbom_file}...")
cbom_data = cbom_file.read_bytes()

# Retry connection to backend up to 15 times (30s)
max_attempts = 15
for attempt in range(1, max_attempts + 1):
    try:
        url = f"{api_url}?policy_profile=regulated_bfsi&scanner_type=combined&scan_label=Docker+Demo+Ingestion"
        request = urllib.request.Request(
            url,
            data=cbom_data,
            method="POST",
            headers={"Content-Type": "application/json", "X-API-Key": api_key},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
            scan_id = result.get("scan_id") or result.get("scan", {}).get("id", "unknown")
            print(f"✓ Successfully imported demo CBOM! Scan ID: {scan_id}")
            metrics = result.get("metrics") or {}
            print(f"  Total Assets: {metrics.get('total_assets', 'N/A')}, "
                  f"Total Findings: {metrics.get('total_findings', 'N/A')}, "
                  f"Quantum Risk Assets: {metrics.get('assets_at_quantum_risk', 'N/A')}")
            sys.exit(0)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"Server returned HTTP {err.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as ex:
        if attempt < max_attempts:
            print(f"Waiting for backend to be ready ({attempt}/{max_attempts})...")
            time.sleep(2)
        else:
            print(f"Demo import failed after {max_attempts} attempts: {ex}", file=sys.stderr)
            sys.exit(1)
