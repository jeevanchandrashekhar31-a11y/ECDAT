# ECDAT Golden Corpus Benchmark Report (Phase 22.3)

**Evaluation Standard**: Phase 22.3 Golden Corpus  
**Timestamp**: `2026-09-16T21:32:02.992804+00:00`  
**Total Corpus Files**: `25`  
**Total Expected Primitives**: `71`  

---

## 1. Executive Summary & Core Metrics

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Precision** | **88.6%** | ≥ 85.0% | ✅ PASS |
| **Recall** | **98.6%** | ≥ 80.0% | ✅ PASS |
| **F1 Score** | **93.3%** | ≥ 82.0% | ✅ PASS |
| **True Positives (TP)** | `70` | Maximize | Verified |
| **False Positives (FP)** | `9` | Minimize | Verified |
| **False Negatives (FN)** | `1` | Minimize | Verified |
| **True Negatives (TN)** | `3` | All Negative Files | 100% Clean |

---

## 2. Resource Utilization & Scan Performance

| Resource Metric | Empirical Measurement | Unit |
|---|---|---|
| **Scan Wall Time** | `0.1038s` | Seconds |
| **Peak Process Working Set (RAM)** | `41.17 MB` | Megabytes |
| **Scanning Throughput** | `240.9 files/s` | Files per Second |

---

## 3. Category Breakdown (11 Required Classes)

| Category | Files | Expected | TP | FP | FN | Precision | Recall | F1 Score |
|---|---|---|---|---|---|---|---|---|
| `01_secure_examples` | 3 | 11 | 11 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `02_weak_algorithms` | 3 | 16 | 16 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `03_weak_keys` | 2 | 5 | 5 | 2 | 0 | 71.4% | 100.0% | 83.3% |
| `04_tls_misconfigurations` | 2 | 5 | 5 | 2 | 0 | 71.4% | 100.0% | 83.3% |
| `05_certificate_problems` | 2 | 5 | 5 | 1 | 0 | 83.3% | 100.0% | 90.9% |
| `06_pqc_examples` | 2 | 7 | 7 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `07_hybrid_examples` | 2 | 5 | 5 | 2 | 0 | 71.4% | 100.0% | 83.3% |
| `08_wrapper_apis` | 2 | 5 | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `09_aliases` | 2 | 7 | 6 | 2 | 1 | 75.0% | 85.7% | 80.0% |
| `10_dynamic_algorithms` | 2 | 5 | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `11_negative_examples` | 3 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |

---

## 4. Empirical Guarantee Verification

- **Zero False Positives on Negative Examples**: Verified that non-cryptographic hash functions, variable names with substrings (`description`, `design`), and CSS/HTML colors trigger 0 findings.
- **Multi-Language Coverage**: Verified across Python, JavaScript, TypeScript, C, Go, and Java.
- **Measured Performance**: All memory and timing numbers were measured directly during the execution run using `ResourceMonitor`.
