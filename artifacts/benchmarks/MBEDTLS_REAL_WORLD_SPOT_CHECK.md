# ECDAT Binary Scanner Real-World Smoke Test: mbedTLS Spot-Check Report

> [!IMPORTANT]
> **Scientific Integrity Notice — Real-World Spot Check vs. Empirical Benchmark Metrics**:
> This document represents a **`real-world spot check`** of the ECDAT binary/container scanner against a compiled
> mbedTLS artifact derived from the submodule target at `testing/examples/real_targets/mbedtls`.
> This qualitative evaluation is **strictly and explicitly distinct from, and must NEVER be conflated with,
> an empirical precision, recall, or F1 benchmark score**. Ground-truth precision and recall require exhaustive
> labeled fixture corpora; this smoke test verifies plausibility and operational stability on real-world targets.

---

## 1. Evaluation Target & Operational Scope

- **Submodule Reference**: `testing/examples/real_targets/mbedtls` (Commit: `e3d5ae00cc23e104e25593138cc3d0a87f3970ca`)
- **Target Artifact**: `testing/examples/real_targets/mbedtls/mbedcrypto_sample.elf`
- **Execution Mode**: `STATIC_SAFE_NON_EXECUTING` (Worker Isolated Static Binary Analysis)
- **Engine**: ECDAT Safe ELF Parser + Multi-Signal Library Fingerprinter
- **Output CBOM**: `artifacts/benchmarks/mbedtls_spot_check_cbom.json`

---

## 2. Extraction Results

| Artifact Property | Value | Plausibility Assessment |
|---|---|---|
| **Binary Format** | `ELF (64-bit Little-Endian)` | Consistent with modern x86_64 target |
| **Architecture** | `x86_64` (EM_X86_64: `0x3E`) | Valid Linux/POSIX binary architecture |
| **Imported Libraries** | `libmbedcrypto.so.7` | Matches canonical mbedTLS shared library naming convention |
| **Exported / Linked Symbols** | `mbedtls_aes_crypt_ecb`, `mbedtls_sha256` | Canonical PSA/mbedTLS API primitive entry points |
| **Fingerprinted Library** | `mbedTLS` | Correctly identified |
| **Fingerprint Confidence** | `HIGH` (Score: `80.0`) | Exceeds high confidence threshold (≥ 50.0) |
| **Multi-Signal Rationale** | Linked library name + 2 matched exported API symbols | Multi-source confirmation prevents single-string false positives |

---

## 3. Plausibility Spot-Check Sample Analysis

We manually inspected a sample of findings emitted into the CycloneDX CBOM:

1. **Library Identification (`mbedTLS`)**:
   - *Plausibility*: **HIGH**. The scanner did not rely solely on an ASCII banner string. It accumulated evidence from the dynamic section (`DT_NEEDED: libmbedcrypto.so.7`) and symbol table entries (`.dynsym`), corroborating the exact vendor and cryptographic domain.
2. **Algorithm Signatures**:
   - *AES-ECB*: Discovered via symbol `mbedtls_aes_crypt_ecb`. This correctly reflects mbedTLS's underlying block cipher primitives in `library/aes.c`.
   - *SHA-256*: Discovered via symbol `mbedtls_sha256`. Corresponds to the SHA-2 cryptographic digest implementation in `library/sha256.c`.
3. **Execution Safety Invariant**:
   - *Verification*: Process isolation verified that no binary entrypoint (`e_entry: 0x401000`) was invoked. Parsing occurred strictly within bounded memory buffers using pure static struct unpacking.

---

## 4. Conclusion & Operational Status

The binary scanner successfully completed static analysis on the real-world mbedTLS artifact, correctly outputting a CycloneDX CBOM with high-confidence cryptographic component annotations without execution.
