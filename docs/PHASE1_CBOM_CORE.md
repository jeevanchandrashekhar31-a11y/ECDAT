# Phase 1: CBOM Core Refactoring

## Internal Finding Models
We standardized how cryptographic findings are represented across scanners by introducing Pydantic models in `scanners/models.py`:
- `NetworkCryptoFinding`: Tracks TLS versions, cipher suites, certificate chains, and key sizes.
- `CodeCryptoFinding`: Tracks algorithm usage (e.g. MD5, RSA key generation) and hardcoded keys with line numbers.
- `BinaryContainerFinding`: (Stub) Tracks compiled library cryptographic metadata.

## CBOM Mapping
To ensure that all generated CBOMs are valid CycloneDX 1.6 structures, we utilize the official `cyclonedx-python-lib` SDK in `backend/risk_engine/cbom_mapping.py`. 
- Scanners pass their internal Pydantic finding models to mapping functions like `network_finding_to_cbom` and `code_finding_to_cbom`.
- The mapper constructs CycloneDX `Bom` objects, `Component` entities, and translates cryptographic specifics (like protocols and key sizes) into proper CycloneDX 1.6 `cryptoProperties`.
- Missing fields from the SDK (such as `algorithmFamily` support) are handled intelligently during the JSON serialization phase to preserve strict schema compliance.

## Scanners

### Network Scanner (`scanners/network/main.py`)
- Takes a host and port.
- Conducts a custom socket TLS handshake to determine cipher suites and fetches the certificate chain via `openssl`.
- Converts the result into `NetworkCryptoFinding` objects.
- Outputs `network_cbom.json`.

### Static Scanner (`scanners/static/main.py`)
- Scans C/C++ source directories.
- Utilizes regular expressions (moved to `scanners/static/regex_rules.py`) to detect hardcoded keys and insecure cryptographic operations.
- Converts the results into `CodeCryptoFinding` objects.
- Outputs `static_cbom.json`.

## Risk Engine / Merger (`backend/risk_engine/merger.py`)
- For Phase 1, the risk engine's primary job is simply to aggregate scanner outputs.
- It accepts a list of CBOM JSON files and merges their `components` and `dependencies` securely, ensuring `bom-ref` uniqueness.
- The output is a unified `merged_cbom.json`.
