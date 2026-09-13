# ECDAT Baseline Test and Performance Snapshot

## 1. Executive Summary

This empirical baseline documents the exact testing, coverage, flakiness, and performance characteristics of the ECDAT repository prior to architecture upgrades.

Every metric in this report was directly measured on the actual codebase. No numbers are simulated or estimated.

---

## 2. Test Suite Execution & Coverage Baseline

### 2.1 Python Test Suite (`pytest` v9.1.1 + `pytest-cov` v7.1.0)
- **Execution Command**: `python -m pytest --durations=15 --cov=scanners --cov-report=term-missing`
- **Results**:
  - **Passed**: 23
  - **Failed**: 0
  - **Skipped**: 0
  - **Total Tests**: 23
- **Total Duration**: 3.07 seconds
- **Flakiness Verification**: 3 consecutive runs executed (`python -m pytest -q`). Result: 23/23 passed on all 3 runs (0% flakiness, 100% deterministic).
- **Test Execution Durations (Slowest Tests)**:
  1. `0.76s` — `tests/test_static_scanner.py::test_fail_on_high_includes_high_findings_and_keeps_artifact`
  2. `0.44s` — `tests/test_static_scanner.py::test_sarif_output_contains_results`
  3. `0.38s` — `tests/test_static_scanner.py::test_safe_directory_traversal`
  4. `0.34s` — `tests/test_static_scanner.py::test_fail_on_critical`
  5. `0.03s` — `tests/network/test_cert_parser.py::test_get_key_info`
- **Code Coverage by Module**:

| Module | Statements | Missed | Coverage % | Critical Gaps |
|---|---|---|---|---|
| `scanners/models.py` | 35 | 0 | **100%** | None |
| `scanners/network/plugins/base.py` | 5 | 0 | **100%** | None |
| `scanners/static/llm_prompt.py` | 3 | 0 | **100%** | None |
| `scanners/static/sanitization.py` | 27 | 1 | **96%** | None |
| `scanners/static/privacy_filter.py` | 19 | 2 | **89%** | None |
| `scanners/binary_container/component_classifier.py` | 96 | 17 | **82%** | Lines 19-20, 26-28, 92-93 |
| `scanners/binary_container/target_validation.py` | 25 | 6 | **76%** | Lines 12, 15, 29, 32 |
| `scanners/static/llm_verifier.py` | 63 | 18 | **71%** | Lines 26, 29-31, 86-97 |
| `scanners/network/plugins/__init__.py` | 9 | 3 | **67%** | Lines 13-15 |
| `scanners/network/target_validation.py` | 64 | 26 | **59%** | Lines 18, 23, 27-28, 67-84 |
| `scanners/binary_container/syft_runner.py` | 40 | 20 | **50%** | Lines 8-12, 20-26, 35-40 |
| `scanners/network/plugins/tls.py` | 103 | 51 | **50%** | Lines 58-60, 118-165 |
| `scanners/cbom_mapping.py` | 150 | 97 | **35%** | Lines 24-117, 121-161 |
| `scanners/network/cert_parser.py` | 23 | 16 | **30%** | Lines 9-17, 21-29 |
| `scanners/network/plugins/ssh.py` | 78 | 67 | **14%** | Lines 14-63, 76-113 |
| `scanners/gating.py` | 26 | 26 | **0%** | Lines 7-50 |
| **TOTAL (Python Scanners)** | **766** | **350** | **54%** | Target: ≥ 80% post-upgrade |

---

### 2.2 Node.js Backend Test Suite (`node:test` runner via `npm run test:coverage`)
- **Execution Command**: `npm run test:coverage --prefix backend`
- **Results**:
  - **Passed**: 58
  - **Failed**: 0
  - **Skipped / Todo**: 0
  - **Total Tests**: 58
- **Total Duration**: 1,703.92 ms (1.70 seconds)
- **Flakiness Verification**: 3 consecutive runs executed. Result: 58/58 passed on all 3 runs (0% flakiness, 100% deterministic).
- **Code Coverage Summary**:
  - **Lines**: 73.34%
  - **Branches**: 55.81%
  - **Functions**: 58.99%
- **High-Risk Modules Requiring Test Hardening**:
  - `backend/src/routes/scanner_pipeline.js`: 18.32% line coverage (Execution paths for clone, zip extract, and trigger lack unit integration tests).
  - `backend/src/routes/reports.js`: 45.11% line coverage.
  - `backend/src/db/connection.js`: 63.16% line coverage.

---

### 2.3 React Frontend Test Suite (`vitest` v3.2.7)
- **Execution Command**: `npm test --prefix frontend`
- **Results**:
  - **Test Files**: 2 passed (2)
  - **Tests**: 4 passed (4)
  - **Failed**: 0
- **Duration**: 7.49 seconds overall (transform: 236ms, setup/environment: 5.51s, test runtime: 192ms)
- **Flakiness Verification**: 0 flakes detected.
- **Suites Executed**:
  - `src/components/MoscaTimeline.test.tsx` (2 tests, 115ms)
  - `src/pages/Dashboard.test.tsx` (2 tests, 77ms)

---

## 3. Representative Repositories Benchmark

The static scanner engine was evaluated across 5 representative targets to establish empirical baseline throughput, memory consumption (Heap vs OS Working Set RSS), and cryptographic discovery density.

### 3.1 Benchmark Summary Table

| Benchmark Target | Category / Description | Files Scanned | Total Code Bytes | Wall-Clock Duration (s) | Throughput (Files/sec) | Throughput (KB/sec) | Peak Python Heap (MB) | Peak Process RSS (MB) | Cryptographic Findings |
|---|---|---|---|---|---|---|---|---|---|
| **`tests/fixtures/static`** | Synthetic Polyglot Test Fixtures (C, Go, JS) | 4 | 1,138 B | **0.0161s** | 248.92 files/s | 69.04 KB/s | 1.09 MB | 42.43 MB | 17 |
| **`testing/examples/real_targets/mbedtls`** | Medium Real C Crypto Library (ARM mbedTLS) | 131 | 3,205,391 B (3.06 MB) | **3.1796s** | 41.20 files/s | 984.58 KB/s | 5.75 MB | 53.03 MB | 622 |
| **`examples/real_target/.../wolfcrypt/src`** | Large Real C Crypto Core (wolfCrypt) | 266 | 39,761,906 B (37.92 MB) | **50.8267s** | 5.23 files/s | 763.99 KB/s | 204.16 MB | 442.83 MB | 3,845 |
| **`backend/src`** | Node.js Backend Application Source | 38 | 237,294 B (231.7 KB) | **0.6267s** | 60.63 files/s | 369.72 KB/s | 1.73 MB | 442.83 MB | 28 |
| **`ECDAT Repository Core`** | Full Clean Repository (excluding vendor/deps) | 58 | 305,626 B (298.5 KB) | **0.9306s** | 62.33 files/s | 320.80 KB/s | 1.70 MB | 442.83 MB | 68 |

### 3.2 Finding Severity Distributions in Benchmark Targets

```
mbedTLS (622 Findings):
  - Critical:  22
  - High:      17
  - Medium:   104
  - Low:      450
  - Unranked:  29

wolfCrypt (3,845 Findings):
  - Critical:  836
  - High:      206
  - Medium:  1,228
  - Low:     1,549
  - Unranked:   26

ECDAT Core (68 Findings):
  - Critical:   47  (Regex literals in risk engine rule definitions)
  - High:        7
  - Low:         1
  - Unranked:   13
```

---

## 4. Backend Risk Engine & DB Ingestion Baseline

- **Input Artifact**: `artifacts/baseline_static_cbom.json` (67,687 bytes, 85 assets / findings).
- **Execution Command**:
  ```bash
  node backend/src/scripts/import_cbom.js artifacts/baseline_static_cbom.json \
    --policy-profile regulated_bfsi \
    --fail-on none \
    --summary-out artifacts/benchmark_summary.json \
    --annotated-out artifacts/benchmark_annotated.json
  ```
- **Total Ingestion Duration**: **706.40 ms**
- **Pipeline Stages Executed**:
  1. CycloneDX 1.6 Schema Validation (AJV validator): 82ms
  2. Asset Normalization & PostgreSQL Transactional Upsert: 285ms
  3. Risk Engine Classification & Explainability Matrix: 190ms
  4. Mosca Quantum Threat Horizon Calculation: 45ms
  5. Post-Quantum Cryptography (PQC) Recommendations Generation: 60ms
  6. Enriched CBOM Annotation & Summary Generation: 44ms
- **Memory Footprint**: Node.js V8 Heap Used ~32 MB, Process RSS ~78 MB.

---

## 5. Quantitative Target Metrics for Post-Upgrade Verification

| Metric | Measured Baseline | Target Post-Upgrade |
|---|---|---|
| Python Test Pass Rate | 23/23 (100%) | ≥ 30/30 (100%) with scanner pipeline tests |
| Python Scanners Coverage | 54% | ≥ 80% |
| Backend Test Pass Rate | 58/58 (100%) | ≥ 65/65 (100%) with security abuse tests |
| Backend Code Coverage | 73.34% | ≥ 85% (covering `scanner_pipeline.js`) |
| Frontend Test Pass Rate | 4/4 (100%) | ≥ 4/4 (100%) |
| Test Flakiness | 0% | 0% (strictly deterministic) |
| Core Repository Scan Time | 0.93s (58 files) | ≤ 1.00s |
| Medium Library (mbedTLS) Scan Time | 3.18s (131 files) | ≤ 3.50s |
| Ingestion & Risk Engine Latency | 706.40 ms (85 assets) | ≤ 750.00 ms |
