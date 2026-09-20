# ECDAT Golden Corpus Empirical Benchmark Report (Phase 30 / P2)

> [!IMPORTANT]
> **Scientific Integrity Notice**:
> All metrics in this report represent **`golden corpus precision`** and **`golden corpus recall`** evaluated directly
> against curated, ground-truth benchmark fixtures. They must **NEVER** be extrapolated or reported as real-world
> precision or real-world recall on arbitrary, uncurated production codebases.

## 1. Executive Summary & Core Metrics

- **Corpus Standard**: `Phase 30 Golden Corpus`
- **Evaluation Timestamp**: `2026-09-20T13:56:46.585217+00:00`
- **Golden Corpus Size**: **`40` files** (109 ground truth expected primitives)
- **Total Evaluated Categories**: **`16` Standardized Classes**
- **Golden Corpus Precision**: **`98.2%`**
- **Golden Corpus Recall**: **`98.2%`**
- **Golden Corpus F1 Score**: **`98.2%`**
- **True Negatives Rate on Traps / Negative Examples**: **`100.0%` (0 False Positives)**

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Golden Corpus Precision** | **98.2%** | ≥ 85.0% | ✅ PASS |
| **Golden Corpus Recall** | **98.2%** | ≥ 80.0% | ✅ PASS |
| **Golden Corpus F1 Score** | **98.2%** | ≥ 82.0% | ✅ PASS |
| **True Positives (TP)** | `107` | Maximize | Verified |
| **False Positives (FP)** | `2` | Minimize | Verified |
| **False Negatives (FN)** | `2` | Minimize | Verified |
| **True Negatives (TN)** | `5` | All Negative Files | 100% Clean |

---

## 2. Resource Utilization & Scan Performance

| Resource Metric | Empirical Measurement | Unit |
|---|---|---|
| **Scan Wall Time** | `0.2171s` | Seconds |
| **Peak Process Working Set (RAM)** | `43.53 MB` | Megabytes |
| **Scanning Throughput** | `184.28 files/s` | Files per Second |

---

## 3. Category Breakdown (16 Standardized Classes)

| Category | Files | Expected | TP | FP | FN | Precision | Recall | F1 Score |
|---|---|---|---|---|---|---|---|---|
| `01_secure_examples` | 3 | 11 | 11 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `02_weak_algorithms` | 3 | 16 | 16 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `03_weak_keys` | 3 | 7 | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `04_tls_misconfigurations` | 3 | 6 | 6 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `05_certificate_problems` | 2 | 5 | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `06_pqc_examples` | 2 | 7 | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `07_hybrid_examples` | 3 | 8 | 8 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `08_wrapper_apis` | 2 | 5 | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `09_aliases` | 2 | 7 | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `10_dynamic_algorithms` | 2 | 5 | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `11_negative_examples` | 4 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `12_obfuscated_samples` | 2 | 7 | 6 | 1 | 1 | 85.7% | 85.7% | 85.7% |
| `13_nested_samples` | 2 | 6 | 6 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `14_multi_language_modern` | 3 | 9 | 9 | 1 | 0 | 90.0% | 100.0% | 94.7% |
| `15_pqc_extended` | 2 | 7 | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `16_false_positives_and_negatives` | 2 | 3 | 2 | 0 | 1 | 100.0% | 66.7% | 80.0% |

---

## 4. Empirical Guarantee Verification

- **Zero False Positives on Negative Examples & Traps**: Verified that non-cryptographic hash functions (`hash()`), variable names with substrings (`description`, `design`, `blowfish_taxa`), and CSS/HTML colors trigger strictly 0 findings.
- **Multi-Language Coverage**: Verified across Python, JavaScript, TypeScript, C, C++, Go, Java, Rust, and C#.
- **Post-Quantum Cryptography**: Verified across FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA), Falcon, and BouncyCastle PQC.
- **Measured Performance**: All memory and timing numbers were measured directly during the execution run using `ResourceMonitor`.

---

## 5. Known Limitations & Analysis Boundaries

Static analysis engines have inherent technical boundaries when evaluating cryptographic usage:

1. **Dynamic Dispatch & Runtime Reflection**: Cryptographic calls instantiated via dynamic reflection (e.g., `Class.forName()`, `getattr()`, or indirect string reconstruction) cannot be fully resolved at compile time without symbolic execution.
2. **Minification & Bytecode Packaging**: JavaScript bundles compressed with aggressive variable mangling or packed binaries require decompilation and de-obfuscation before AST traversal.
3. **Absence of Whole-Program Interprocedural Taint Flow**: Static AST discovery extracts syntactic symbol invocations. Determining whether sensitive data flows into a cipher requires deeper data-flow analysis or runtime hooks.
4. **Corpus vs Real-World Generalization**: High precision and recall on standardized test corpora prove that scanners correctly identify canonical API patterns. They do not guarantee identical recall on highly customized proprietary cryptographic wrappers.
