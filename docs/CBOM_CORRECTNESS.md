# Cryptographic Bill of Materials (CBOM) Correctness & Schema Conformance

## 1. Executive Summary & Specification Version Statement

ECDAT implements rigorous, dual-version standard compliance for Cryptographic Bills of Materials (CBOM):

- **Production Baseline Contract**: **CycloneDX 1.6**
  - All standard scanners, enterprise pipeline exports, backend transactional databases, and release gates declare and enforce **CycloneDX 1.6** (`"bomFormat": "CycloneDX"`, `"specVersion": "1.6"`).
  - The official production contract is codified in [ECDAT_CBOM_SCHEMA_CONTRACT.md](file:///c:/Users/Jeevan%20c/Documents/ECDAT/docs/ECDAT_CBOM_SCHEMA_CONTRACT.md).
  - The canonical production sample is [FINAL_CBOM_SAMPLE.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/examples/FINAL_CBOM_SAMPLE.json), strictly declaring `specVersion: "1.6"`.
- **Advanced Supported Capability**: **CycloneDX 1.7**
  - The CBOM engine natively supports CycloneDX 1.7 generation, serialization, and ingestion via [cbom_mapping.py](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py) and [cbom_io.py](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_io.py).
  - Proved with an authentic, generated, and schema-validated 1.7 artifact: [FINAL_CBOM_17_SAMPLE.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/examples/FINAL_CBOM_17_SAMPLE.json) and [ecdat_cbom_cyclonedx_1.7.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/cbom/ecdat_cbom_cyclonedx_1.7.json).
  - Validated against official schema via `cyclonedx.validation.json.JsonValidator(SchemaVersion.V1_7)`.
- **Strict Labeling Invariant**:
  - **Never call a 1.6 sample a 1.7 CBOM**.
  - 1.6 artifacts are exclusively labeled and schema-validated as CycloneDX 1.6.
  - 1.7 artifacts are exclusively labeled and schema-validated as CycloneDX 1.7.

---

## 2. 7 Dimensions of CBOM Correctness Verification

### Dimension 1: Conformance to Declared CycloneDX Version
Both CycloneDX 1.6 and 1.7 artifacts declare accurate `$schema`, `bomFormat`, and `specVersion` fields:
- **CycloneDX 1.6**:
  ```json
  {
    "$schema": "https://cyclonedx.org/schema/bom-1.6.schema.json",
    "bomFormat": "CycloneDX",
    "specVersion": "1.6"
  }
  ```
- **CycloneDX 1.7**:
  ```json
  {
    "$schema": "http://cyclonedx.org/schema/bom-1.7.schema.json",
    "bomFormat": "CycloneDX",
    "specVersion": "1.7"
  }
  ```

### Dimension 2: Valid Official Schema Compliance
- **Validation Engine**: Evaluated directly against official CycloneDX JSON Schemas via `cyclonedx-python-lib` (`JsonValidator(SchemaVersion.V1_6)` and `JsonValidator(SchemaVersion.V1_7)`).
- **Enum Conformance**:
  - `executionEnvironment`: Restricted strictly to valid schema enums (`['software-plain-ram', 'software-encrypted-ram', 'software-tee', 'hardware', 'other', 'unknown']`).
  - `implementationPlatform`: Conforms to `['generic', 'x86_32', 'x86_64', 'armv7-a', 'armv7-m', 'armv8-a', 'armv8-m', 'armv9-a', 'armv9-m', 's390x', 'ppc64', 'ppc64le', 'other', 'unknown']`.
  - `cryptoFunctions`: Validated against `['generate', 'keygen', 'encrypt', 'decrypt', 'digest', 'tag', 'keyderive', 'sign', 'verify', 'encapsulate', 'decapsulate', 'other', 'unknown']`.
  - `algorithmFamily`: In CycloneDX 1.7, mapped exclusively to official enums defined in `cryptography-defs.schema.json` (`AES`, `ML-KEM`, `ML-DSA`, `RSA`, `SHA-2`, etc.). Omitted in 1.6 where forbidden by `additionalProperties: false`.

### Dimension 3: Accurate Cryptographic Components
Every cryptographic finding is mapped to its precise CycloneDX `cryptoProperties` asset type:
- **`algorithm`**: `algorithmProperties` specifying `primitive`, `parameterSetIdentifier`, `curve`, `executionEnvironment`, `cryptoFunctions`, and `nistQuantumSecurityLevel` (0–5).
- **`protocol`**: `protocolProperties` modeling `type` (`tls`, `ssh`, `ipsec`), `version` (`1.3`, `1.2`), and structured `cipherSuites` array.
- **`certificate`**: `certificateProperties` modeling X.509 metadata (`subjectName`, `issuerName`, `notValidBefore`, `notValidAfter`, `certificateFormat`).
- **`related-crypto-material`**: `relatedCryptoMaterialProperties` representing key and credential references (`type: "secret-key"`, `size: 256`, KMS ARN locator).

### Dimension 4: Distinguishing Observed Facts from Inferred Data
To maintain audit veracity, concrete observations are strictly separated from analytical inferences:

| Data Type | Field Location | Description | Examples |
|---|---|---|---|
| **Observed Fact** | `evidence.occurrences` | Physical location verified by scanner | `src/crypto/kex.py:54`, `api.payments.bank.corp:443` |
| **Observed Fact** | `ecdat:reachabilityLevel` | Execution reachability verified by analysis | `RUNTIME_CONFIRMED`, `AST_ACCESSIBLE`, `DYNAMIC_LOADED` |
| **Observed Fact** | `ecdat:detectionMethod` | Concrete discovery mechanism | `runtime_hook`, `ast`, `network_handshake`, `regex` |
| **Observed Fact** | `parameterSetIdentifier` | Direct parameter extracted from code/handshake | `256`, `768`, `2048` |
| **Inferred Data** | `ecdat:quantumClassification` | Cryptographic hardness analysis | `quantum-resistant`, `quantum-vulnerable`, `hybrid`, `unknown` |
| **Inferred Data** | `nistQuantumSecurityLevel` | Standard mapping to NIST PQC categories | `0` (classical), `1`, `3`, `5` |
| **Inferred Data** | `ecdat:inferenceConfidence` | Statistical / AST heuristic confidence | `1.00`, `0.95`, `0.80` |
| **Inferred Data** | `ecdat:hndlResilient` | Assessment of Harvest-Now-Decrypt-Later risk | `true`, `false` |

### Dimension 5: Provenance and Traceability
Every generated CBOM embeds full provenance:
- **Tool Attribution**: `metadata.tools.components` specifies `ECDAT Cryptographic Discovery and Analysis Tool` (version `1.0.0`).
- **Target Context**: `metadata.component` specifies the root subject application, repository, or service.
- **Execution Timestamp**: `metadata.timestamp` records the ISO-8601 UTC timestamp of discovery.
- **Author Attribution**: Identifies ECDAT Platform Engineering.
- **Supply-Chain Manifest**: Catalogs SHA-256 and SHA-512 checksums in release manifests signed with Ed25519.

### Dimension 6: Avoid Fabricated Metadata & Zero Secrets Invariant
- **No Synthetic Placeholders**: Zero placeholder strings (`TODO`, `DUMMY_KEY`, `PLACEHOLDER_HASH`, `FAKE_LICENSE`).
- **Real Locations**: Every component occurrence refers to an auditable file path or network socket.
- **Strict Zero Secrets Guarantee**: Zero raw private key material, PEM blocks (`-----BEGIN PRIVATE KEY-----`), or cleartext secrets are ever serialized into CBOM documents. Only fingerprints, key identifiers, and KMS ARNs are permitted.

### Dimension 7: Determinism
- **Canonical BOM-Ref Formatting**: All component identifiers follow the deterministic scheme:
  ```text
  <source>:<assetType>/<slug>@<locator>
  ```
  Examples: `code:algo/aes-256@src/cipher.py:42`, `net:protocol/tls1.3@api.corp:443`.
- **Deterministic Dependency Graph**: The application root dependency links deterministically to all discovered child crypto-assets.
- **Repeatable Serialization**: Scanning identical sources produces deterministic, byte-reproducible CBOMs under identical parameters.

---

## 3. Reference Artifacts

- **CycloneDX 1.6 Production Reference**:
  - File: [FINAL_CBOM_SAMPLE.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/examples/FINAL_CBOM_SAMPLE.json)
  - Spec Version: `1.6`
  - Components: 7 assets (TLS 1.3, ML-KEM-768, ML-DSA-65, RSA-2048, AES-256-GCM, SHA-256, X.509 Certificate)
  - Schema Status: **VALID (0 errors)**
- **CycloneDX 1.7 Advanced Reference**:
  - File: [FINAL_CBOM_17_SAMPLE.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/examples/FINAL_CBOM_17_SAMPLE.json)
  - Release Copy: [ecdat_cbom_cyclonedx_1.7.json](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/cbom/ecdat_cbom_cyclonedx_1.7.json)
  - Spec Version: `1.7`
  - Components: 7 assets (ML-KEM-768, ML-DSA-65, AES-256-GCM, RSA-2048, TLS 1.3, X.509 Certificate, Envelope KEK)
  - Schema Status: **VALID (0 errors)**
