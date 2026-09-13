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

## Static Binary Parser Architecture (Phase 4.1)

In addition to package-level SBOM inspection via Syft, ECDAT provides a native, pure-Python static binary parser architecture (`scanners/binary_container/parsers/`) for **ELF**, **PE**, and **Mach-O** executables and shared libraries.

### Core Security Invariants
- **NEVER Execute the Target Binary**: The parser performs purely static structural byte parsing using standard library `struct`. No `subprocess`, dynamic linker invocation, or execution is ever attempted. Verified via monkeypatched subprocess tests.
- **Worker Process Isolation**: Binary parsing jobs run inside an isolated subprocess via `ProcessPoolExecutor` (`worker_pool.py`) bounded by strict execution timeouts (default 10s). Malformed inputs, parser crashes, or memory bombs in untrusted binaries cannot crash or compromise the parent scanner.
- **Bounded Resource Limits**: String scanning and byte reads are strictly bounded by `ParserOptions` (`max_bytes_to_scan = 10MB`, `max_strings = 5000`, `min_string_length = 4`).

### Supported Formats & Extracted Metadata
1. **ELF (Executable and Linkable Format)** (`elf_parser.py`):
   - 32-bit and 64-bit binaries.
   - Little-Endian and Big-Endian architectures (x86, x86_64, ARM, ARM64, MIPS, RISC-V, PowerPC, s390x).
   - Section headers (virtual address, raw size, Shannon entropy per section).
   - Dynamic entries (`DT_NEEDED` imported shared libraries).
   - Symbol tables (`.dynsym` and `.symtab` symbols, binding, visibility).
2. **PE (Portable Executable)** (`pe_parser.py`):
   - PE32 and PE32+ (x86, x64, ARM64).
   - Section headers (VirtualAddress, SizeOfRawData, Shannon entropy).
   - Import Directory Descriptors, Import Lookup Tables (ILT), and thunk symbols.
   - Authenticode signatures (`WIN_CERTIFICATE` directory, ASN.1 DER X.509 certificates and fingerprints).
3. **Mach-O (Mach Object)** (`macho_parser.py`):
   - 32-bit and 64-bit Mach-O binaries.
   - FAT Universal multi-architecture binaries (`0xCAFEBABE` container slices).
   - Load commands (`LC_SEGMENT`, `LC_SEGMENT_64`, `LC_LOAD_DYLIB`, `LC_SYMTAB`, `LC_CODE_SIGNATURE`).
   - Dynamic library dependencies and imported/exported symbols.

### Cryptographic Indicators & Bounded Scanning
- **Shared Libraries**: Detects dependencies on OpenSSL (`libcrypto`, `libssl`), BoringSSL, LibreSSL, mbedTLS, wolfSSL, libsodium, Botan, Windows CNG (`bcrypt.dll`, `ncrypt.dll`), Apple CommonCrypto, etc.
- **Crypto Symbol Analysis**: Matches symbols against cryptographic families (EVP, AES, RSA, ECDSA, Ed25519, SHA256, HMAC, TLS).
- **String Scanning**: Regex scans for PEM headers, TLS protocol indicators, classical cipher algorithms, and Post-Quantum Cryptography (PQC) schemes (Kyber, Dilithium, Falcon, SPHINCS+).
- **CBOM Mapping**: Generates CycloneDX 1.6 CBOM with `binary_metadata_to_cbom()` mapping all indicators, architectures, hashes, sections, and certificates.

## Container Image Analyzer (Phase 4.3)

ECDAT provides a dedicated static container image analyzer (`container_analyzer.py` and `security_guards.py`) that operates on container image archives and rootfs directories without executing application entrypoints.

### Static Inspection Scope
1. **Never Execute Application Entrypoints**: `ENTRYPOINT` and `CMD` are captured purely as passive metadata attributes in the configuration. The analyzer never spawns, runs, or links container binaries.
2. **Layer Inspection**: Unpacks OCI/Docker image manifests (`manifest.json`), tracking per-layer diff IDs (`sha256:`), uncompressed sizes, file counts, and cryptographic changes introduced across layers.
3. **Package Inventory**: Extracts OS package metadata from `/var/lib/dpkg/status` (Debian/Ubuntu) and `/lib/apk/db/installed` (Alpine), marking cryptographic relevance.
4. **Shared Libraries**: Scans `/lib`, `/usr/lib`, `/usr/local/lib` for dynamic libraries (`.so*`, `.dylib`) and executes multi-signal library fingerprinting.
5. **Configuration & Application Metadata**: Extracts container architecture, OS, working directory, user, labels, and exposed ports.
6. **Certificate Discovery**: Scans `/etc/ssl/certs`, `/etc/pki`, and CA certificate directories for X.509 certificates, parsing subjects, issuers, and SHA-256 fingerprints.
7. **Crypto-Library Fingerprinting**: Applies `LibraryFingerprinter` (Phase 4.2) across container layers.
8. **CBOM Mapping**: Serializes findings into CycloneDX 1.6 CBOM with container components, layer dependencies, package dependencies, and certificate assets.

### Comprehensive Security Guards
- **Registry SSRF Prevention**:
  - Validates registry hostnames and IP addresses against private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `localhost`), link-local (`169.254.0.0/16`), and cloud instance metadata services (`169.254.169.254`, `metadata.google.internal`).
  - Rejects URL schemes (`http://`, `file://`, `gopher://`) and embedded credentials (`user:pass@registry`).
- **Credential Leakage Prevention**:
  - Automatically sanitizes and redacts passwords, tokens, API keys, and private keys in container environment variables (`[REDACTED_SECRET]`, `[REDACTED_PRIVATE_KEY]`).
  - Strict invariant: raw secret values are never written to logs, reports, or CBOMs.
- **Untrusted Registry Access Control**:
  - Supports configurable registry allowlists (`DEFAULT_TRUSTED_REGISTRIES` e.g. Docker Hub, GHCR, Quay, GCR, MCR, ECR).
- **Oversized Layers & Decompression Bomb Prevention**:
  - `SafeArchiveExtractor` enforces layer size limits (default 1GB), total image limits (default 5GB), and file count limits (50,000 files).
  - Enforces strict decompression expansion ratio thresholds (100:1) to stop zip/tar quines and decompression bombs.
  - Path traversal (TarSlip) protection validates that every member's target path remains strictly within the extraction root.

## Usage

```bash
# Scan a local directory or container image (package-level inventory)
python -m scanners.binary_container.main ./my-dir
python -m scanners.binary_container.main nginx:latest --target-type image -o artifacts/container_cbom.json

# Directly scan a container image tarball without executing entrypoints
python -m scanners.binary_container.main ./saved_image.tar --target-type archive -o artifacts/container_cbom.json

# Directly scan an ELF/PE/Mach-O binary with safe static metadata extraction
python -m scanners.binary_container.main ./bin/my-service --target-type file -o artifacts/binary_cbom.json

# Programmatic container analysis
from scanners.binary_container.container_analyzer import ContainerImageAnalyzer, container_report_to_cbom
analyzer = ContainerImageAnalyzer()
report = analyzer.analyze_image_archive(Path("./my_app_image.tar"), image_reference="docker.io/my-org/my-app:latest")
cbom = container_report_to_cbom(report)
```

## Security Posture
- All CLI inputs bypass the system shell (`shell=False`).
- Extremely strict path validation.
- Output buffer capping to avoid memory exhaustion from bloated scan outputs.
- Worker process isolation with timeouts prevents hangs on adversarial binaries.
- The parser never compiles or executes target binaries.
- The container analyzer never executes container entrypoints, CMD, or scripts.


