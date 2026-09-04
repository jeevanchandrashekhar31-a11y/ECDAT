# ECDAT Binary & Container Scanner

The binary and container scanner (Phase 4) leverages a safe Python wrapper around `syft` to discover installed cryptographic libraries in binaries, local directories, archives, and container images.

## Architecture

1. **Target Validation (`target_validation.py`)**: Ensures that all inputs strictly adhere to allowed paths and image name regexes to prevent any risk of shell injection or local file inclusion.
2. **Syft Runner (`syft_runner.py`)**: Safely orchestrates the `syft` process using `subprocess.run(shell=False)`. It enforces timeouts and bounds the output buffer to prevent DoS (Denial of Service) via memory exhaustion. If Syft is unavailable, it gracefully fails with an actionable install message rather than crashing the pipeline.
3. **Component Classifier (`component_classifier.py`)**:
   - Driven by a version-controlled catalog: [`rules/crypto_library_catalog.json`](../rules/crypto_library_catalog.json).
   - Identifies canonical cryptographic libraries (OpenSSL, LibreSSL, BoringSSL, mbedTLS, wolfSSL, libsodium, Botan, Java JCA / Bouncy Castle, Go Crypto, libgcrypt, NSS, etc.) by analyzing package names, aliases, and PURLs.
   - Extracts component identity including PURL, CPE, and detected artifact/file location paths.
   - Distinctly labels findings with `evidence_type = "package_inventory"` and `confidence = "medium"`, accompanied by the rationale `"Library presence does not prove active crypto usage."`
   - Tracks known PQC / hybrid algorithm capabilities.
4. **CBOM Mapping (`scanners/cbom_mapping.py` & `main.py`)**: Maps classified components into ECDAT `BinaryContainerFinding` models and serializes them into CycloneDX 1.6 CBOM with full metadata properties.

## Usage

```bash
# Scan a local directory
python -m scanners.binary_container.main ./my-dir

# Scan a local archive with custom output
python -m scanners.binary_container.main ./my-app.tar.gz --target-type archive -o artifacts/binary_cbom.json

# Scan a container image
python -m scanners.binary_container.main nginx:latest --target-type image -o artifacts/container_cbom.json

# Use custom crypto library catalog
python -m scanners.binary_container.main ./my-dir --catalog path/to/custom_catalog.json
```

## Security Posture
- All CLI inputs bypass the system shell (`shell=False`).
- Extremely strict path validation.
- Output buffer capping to avoid memory exhaustion from bloated scan outputs.
- The wrapper never executes the target binary (purely inventory and static package analysis).
