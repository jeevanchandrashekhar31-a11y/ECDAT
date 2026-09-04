# ECDAT Repository Inventory

This document provides a structured inventory of the ECDAT (Enterprise Cryptographic Discovery and Assessment Tool) codebase to serve as a precise reference before refactoring.

## 1. Full File Enumeration

- `.git/` (Hidden directory containing git repository data)
- `.gitignore` (Hidden file specifying untracked files)
- `__pycache__/` (Directory containing python bytecode caches)
- `bad_dir/` (Directory)
- `ECDAT_CBOM_SCHEMA_CONTRACT.md` (CycloneDX schema contract documentation)
- `README.md` (Project overview and architecture)
- `summary.md` (Markdown example of scan findings summary)
- `clean_and_tricky.c` (C source file for scanner testing)
- `vuln_examples.c` (C source file for scanner testing)
- `ecdat_network_scanner.py` (Network and TLS scanner script)
- `merge_and_classify.py` (Risk-engine script for classification)
- `static_scanner.py` (Static analysis script for C/C++ files)
- **JSON Output Examples/Artifacts**:
  - `bad_cbom.json`
  - `merged.json`
  - `merged_cbom.json`
  - `net_out.json`
  - `network_scan_cbom.json`
  - `out.json`
  - `static_out.json`
  - `static_scan_cbom.json`
  - `syft_output.json`
- **HTML Output Artifacts**:
  - `summary.html`

## 2. Code File Summaries

### `ecdat_network_scanner.py`
- **Purpose**: A network and protocol scanner that establishes raw TCP connections and TLS handshakes to live endpoints to inspect their cryptographic posture. It extracts certificate chains, negotiated TLS versions, and cipher suites, evaluating them for classical and quantum readiness.
- **Main Functions/Classes**: `to_iana_cipher_name`, `fetch_certificate_chain`, `classify_key`, `scan_target`.
- **External Dependencies**: Python standard library (`socket`, `ssl`, `subprocess`), `cryptography` library, `openssl` CLI (called via subprocess).
- **Inputs**: CLI arguments (target host/port combinations).
- **Outputs**: CycloneDX CBOM JSON format (stdout or file via `-o`).

### `static_scanner.py`
- **Purpose**: A regex-based static analysis tool designed to scan C/C++ source code for cryptographic asset usage. It specifically targets classically broken algorithms (MD5, SHA-1), weak RSA key generation, and hardcoded PEM private keys.
- **Main Functions/Classes**: `Finding` (dataclass), `strip_comments`, `scan_file`, `build_components`, `main`.
- **External Dependencies**: Python standard library (`re`, `pathlib`), `cyclonedx-python-lib`.
- **Inputs**: CLI arguments (target directory to recursively scan).
- **Outputs**: CycloneDX CBOM JSON format (file via `-o`).

### `merge_and_classify.py`
- **Purpose**: The core risk-engine that ingests CBOMs from network and static scanners, merges them into a single inventory, and classifies each finding by severity. It also computes the quantum risk gap using Mosca's Theorem (X + Y > Z) to identify assets vulnerable to Cryptographically Relevant Quantum Computers.
- **Main Functions/Classes**: `get_mosca_x`, `validate_finding`, `classify_finding`, `add_property`, `main`.
- **External Dependencies**: Python standard library (`json`, `argparse`, `pathlib`).
- **Inputs**: CLI arguments (network CBOM JSON file path, static CBOM JSON file path).
- **Outputs**: Merged CycloneDX CBOM JSON file (via `--out-json`) and a human-readable HTML summary file (via `--out-html`).

### `vuln_examples.c`
- **Purpose**: A synthetic C source test file intentionally containing deliberate cryptographic weaknesses to validate the static scanner. It includes legacy MD5/SHA-1 usage, weak RSA key generation, and hardcoded private key material.
- **Main Functions/Classes**: `hash_password_legacy`, `sign_legacy_data`, `make_weak_key`, `make_ec_key`, `make_dh_params`, etc.
- **External Dependencies**: OpenSSL headers (`<openssl/md5.h>`, `<openssl/sha.h>`, `<openssl/rsa.h>`, `<openssl/evp.h>`).
- **Inputs**: None (test file).
- **Outputs**: None.

### `clean_and_tricky.c`
- **Purpose**: A C source test file containing near-miss identifiers, comments with crypto keywords, and modern strong cryptographic API usage. It serves as a negative test case for the static scanner to ensure it doesn't flag safe usage or emit false positives.
- **Main Functions/Classes**: `MD5Checksum`, `compute_md5sum_wrapper`, `safe_key_setup`, `safe_hash`.
- **External Dependencies**: OpenSSL headers (`<openssl/evp.h>`, `<openssl/rsa.h>`).
- **Inputs**: None (test file).
- **Outputs**: None.

### `.gitignore`
- **Purpose**: Specifies intentionally untracked files that Git should ignore, such as python cache directories, generated JSON CBOMs, and HTML summaries.
- **Main Functions/Classes**: N/A
- **External Dependencies**: N/A
- **Inputs**: N/A
- **Outputs**: N/A

## 3. Key Logic Locations

- **Where CBOM JSON is constructed**:
  - `ecdat_network_scanner.py`: Manually constructs Python dictionaries matching the CycloneDX schema and serializes them using `json.dumps()` in the `scan_target` and `main` functions.
  - `static_scanner.py`: Constructs the CBOM using the official `cyclonedx-python-lib` model classes (e.g., `Bom`, `Component`, `CryptoProperties`) and outputs it using `JsonV1Dot6`.
  - `merge_and_classify.py`: Parses the raw JSON from both scanners, validates and deduplicates them based on `bom-ref`, and emits the final merged Python dictionary structure as JSON.
- **Where Mosca’s theorem is implemented**:
  - `merge_and_classify.py`: Located inside the `main` loop for each finding. It computes `(mosca_x + MOSCA_Y) > MOSCA_Z` where `mosca_x` is retrieved via the `get_mosca_x()` function (defaulting to 7, or 2/10 depending on asset context), `MOSCA_Y=3`, and `MOSCA_Z=10`.
- **Where TLS logic lives**:
  - `ecdat_network_scanner.py`: Located in the `scan_target()` function. It opens a raw `socket.create_connection` and wraps it using `ssl.create_default_context().wrap_socket()` to retrieve the `tls_sock.version()` and `tls_sock.cipher()`. It also uses `subprocess` to call `openssl s_client -showcerts` in `fetch_certificate_chain()` for deeper certificate chain inspection.
- **Where regex patterns for crypto detection live**:
  - `static_scanner.py`: Located at the top of the file as compiled regular expressions, including `MD5_RE`, `SHA1_RE`, `RSA_KEYGEN_RE`, `ECDH_KEYGEN_RE`, and `PEM_PRIVATE_KEY_RE`. There is also `_COMMENT_OR_LITERAL_RE` used to strip out comments and literals before scanning.
