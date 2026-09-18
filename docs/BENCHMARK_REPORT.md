# @ecdat-synthetic-corpus
# ECDAT Empirical Performance & Reliability Benchmark Report (Phase 29 / P2)

## 1. Executive Summary & Verification Guarantees

> [!IMPORTANT]
> **Strict Empirical Measurement Standard**:
> Every benchmark number in this document is generated automatically from raw telemetry captured during
> live execution on `2026-09-18T17:06:57.965080+00:00`. Zero numbers are manually typed or synthetic projections.
> Source Raw Telemetry: [`latest_benchmark_run.json`](file:///C:/Users/Jeevan c/Documents/ECDAT/benchmarks/results/latest_benchmark_run.json)

### Key Measurement Results:
- **Audited Components**: **`4` Core Subsystems** (Static Scanner, CBOM Processor, Incremental Cache, Secret Engine)
- **Repetition Rigor**: **`5` Measured Repetitions per Benchmark** following **`1 unmeasured execution to prime caches and memory pools`**
- **Overall Failure Rate**: **`0.0%` Across All Repetitions**

---

## 2. Host Machine & Runtime Environment Specifications

### 2.1 Hardware Specification
- **Processor Model**: `Intel64 Family 6 Model 186 Stepping 3, GenuineIntel`
- **Architecture**: `AMD64`
- **Logical CPU Cores**: `12`
- **Total Physical RAM**: `15.69 GB`

### 2.2 Operating System & Platform
- **Operating System**: `Windows 11` (Build `10.0.26200`)
- **Platform String**: `Windows-11-10.0.26200-SP0`

### 2.3 Runtimes & Dependency Versions
- **Python Runtime**: `3.14.3 (3.14.3 (tags/v3.14.3:323c59a, Feb  3 2026, 16:04:56) [MSC v.1944 64 bit (AMD64)])`
- **Node.js Runtime**: `v24.11.1`

| Dependency Package | Audited Version | Ecosystem |
|---|---|---|
| `bandit` | `1.9.4` | PyPI |
| `cryptography` | `50.0.1` | PyPI |
| `cyclonedx-python-lib` | `11.12.0` | PyPI |
| `defusedxml` | `0.7.1` | PyPI |
| `jsonschema` | `4.25.1` | PyPI |
| `pydantic` | `2.13.5` | PyPI |
| `pytest` | `9.1.1` | PyPI |
| `ruff` | `0.16.6` | PyPI |
| `semgrep` | `1.177.0` | PyPI |

---

## 3. Benchmark Verification Matrix (Median, p95, p99, Throughput, Failure Rate)

| Benchmark ID | Subsystem Tested | Input Dataset | Repetitions | Median | p95 Latency | p99 Latency | Throughput | Failure Rate |
|---|---|---|---|---|---|---|---|---|
| **`BENCH-01-STATIC-SCANNER`** | Static Cryptographic Scanner Throughput & Latency | ECDAT Standard Benchmark Source Corpus | `5` | **`1.82803s`** | `1.845898s` | `1.849412s` | **`10,678.2 LOC/s (82.1 files/s)`** | **`0.0%`** |
| **`BENCH-02-CBOM-ENGINE`** | CycloneDX 1.6 CBOM Ingestion & Normalization Engine | CycloneDX 1.6 Standard Cryptographic Benchmark CBOM | `5` | **`1.96331s`** | `2.005754s` | `2.013463s` | **`509.3 components/s`** | **`0.0%`** |
| **`BENCH-03-INCREMENTAL-CACHE`** | Incremental Caching & 5-Dimensional Change Detection | ECDAT Standard Benchmark Source Corpus | `5` | **`0.18759s`** | `0.228206s` | `0.230481s` | **`12.2x latency reduction (187.6ms warm)`** | **`0.0%`** |
| **`BENCH-04-SECRET-SCANNER`** | Secret Safe Entropy & Pattern Scanning Engine | Secret Scanning Benchmark Corpus | `5` | **`0.02735s`** | `0.028362s` | `0.028376s` | **`3,656.3 files/s`** | **`0.0%`** |

---

## 4. Detailed Empirical Results by Subsystem

### BENCH-01-STATIC-SCANNER: Static Cryptographic Scanner Throughput & Latency
- **Benchmark Script**: [`benchmarks/run_benchmarks.py::benchmark_static_scanner`](file:///C:/Users/Jeevan c/Documents/ECDAT/benchmarks/run_benchmarks.py)
- **Warmup Policy**: `1 unmeasured execution to prime OS disk cache and AST structures`
- **Measured Repetitions**: `5`
- **Input Dataset**: `ECDAT Standard Benchmark Source Corpus` (`benchmarks\datasets\source_corpus`)
- **Dataset Size**: 19,520 items (572,840 bytes)

#### Latency Distribution & Throughput Metrics
- **Median Latency**: **`1.82803s`**
- **p95 Latency**: **`1.845898s`**
- **p99 Latency**: **`1.849412s`**
- **Empirical Throughput**: **`10,678.2 LOC/s (82.1 files/s)`**
- **Measured Failure Rate**: **`0.0%`** (`0` failures)

#### Raw Execution Times (Seconds)
```json
[
  1.80614,
  1.82033,
  1.82833,
  1.82803,
  1.85029
]
```

### BENCH-02-CBOM-ENGINE: CycloneDX 1.6 CBOM Ingestion & Normalization Engine
- **Benchmark Script**: [`benchmarks/run_benchmarks.py::benchmark_cbom_engine`](file:///C:/Users/Jeevan c/Documents/ECDAT/benchmarks/run_benchmarks.py)
- **Warmup Policy**: `1 unmeasured execution to prime CycloneDX model registries`
- **Measured Repetitions**: `5`
- **Input Dataset**: `CycloneDX 1.6 Standard Cryptographic Benchmark CBOM` (`benchmarks\datasets\cbom_benchmark_1000.json`)
- **Dataset Size**: 1,000 items (1,344,861 bytes)

#### Latency Distribution & Throughput Metrics
- **Median Latency**: **`1.96331s`**
- **p95 Latency**: **`2.005754s`**
- **p99 Latency**: **`2.013463s`**
- **Empirical Throughput**: **`509.3 components/s`**
- **Measured Failure Rate**: **`0.0%`** (`0` failures)

#### Raw Execution Times (Seconds)
```json
[
  2.01539,
  1.90253,
  1.96721,
  1.96331,
  1.89731
]
```

### BENCH-03-INCREMENTAL-CACHE: Incremental Caching & 5-Dimensional Change Detection
- **Benchmark Script**: [`benchmarks/run_benchmarks.py::benchmark_incremental_cache`](file:///C:/Users/Jeevan c/Documents/ECDAT/benchmarks/run_benchmarks.py)
- **Warmup Policy**: `Self-priming: First scan establishes clean cold cache baseline`
- **Measured Repetitions**: `5`
- **Input Dataset**: `ECDAT Standard Benchmark Source Corpus` (`benchmarks\datasets\source_corpus`)
- **Dataset Size**: 150 items (0 bytes)

#### Latency Distribution & Throughput Metrics
- **Median Latency**: **`0.18759s`**
- **p95 Latency**: **`0.228206s`**
- **p99 Latency**: **`0.230481s`**
- **Empirical Throughput**: **`12.2x latency reduction (187.6ms warm)`**
- **Measured Failure Rate**: **`0.0%`** (`0` failures)

#### Raw Execution Times (Seconds)
```json
[
  0.18759,
  0.18521,
  0.18697,
  0.21683,
  0.23105
]
```

### BENCH-04-SECRET-SCANNER: Secret Safe Entropy & Pattern Scanning Engine
- **Benchmark Script**: [`benchmarks/run_benchmarks.py::benchmark_secret_scanner`](file:///C:/Users/Jeevan c/Documents/ECDAT/benchmarks/run_benchmarks.py)
- **Warmup Policy**: `1 unmeasured execution to compile high-entropy regex engines`
- **Measured Repetitions**: `5`
- **Input Dataset**: `Secret Scanning Benchmark Corpus` (`benchmarks\datasets\secret_scan_corpus`)
- **Dataset Size**: 100 items (0 bytes)

#### Latency Distribution & Throughput Metrics
- **Median Latency**: **`0.02735s`**
- **p95 Latency**: **`0.028362s`**
- **p99 Latency**: **`0.028376s`**
- **Empirical Throughput**: **`3,656.3 files/s`**
- **Measured Failure Rate**: **`0.0%`** (`0` failures)

#### Raw Execution Times (Seconds)
```json
[
  0.02734,
  0.02716,
  0.02735,
  0.02838,
  0.02829
]
```

---

## 5. Instructions for Exact Reproduction

To reproduce these benchmarks on any machine and generate fresh unedited raw telemetry:
```bash
# 1. Initialize deterministic datasets (if not already present)
python benchmarks/datasets/dataset_generator.py

# 2. Execute the full empirical benchmark suite (5 repetitions + warmup)
python benchmarks/run_benchmarks.py
```

Raw results are automatically recorded in `benchmarks/results/` with cryptographic precision.