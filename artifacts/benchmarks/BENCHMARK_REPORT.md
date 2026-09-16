# ECDAT Performance, Scale & Reliability Benchmark Report

**Benchmark Standard**: Phase 21 (21.1 Large-Repository Scaling, 21.2 Incremental Scanning, 21.3 Failure Isolation)  
**Execution Timestamp**: `2026-09-16T03:14:09.975246+00:00`  
**Host Platform**: `win32` (`12 CPU Cores`)  
**Python Runtime**: `3.14.3`  

---

## 1. Executive Summary & Verification Guarantees

> [!IMPORTANT]
> **Strict Empirical Measurement Policy**:
> In accordance with user specifications (*"Do not promise arbitrary performance targets before measurement"*), all numbers in this report represent real, live measurements captured by the `ResourceMonitor` during actual benchmark execution on the host machine.

### Key Architectural Results:
1. **Large-Repository Scaling (21.1)**: Measured linear and multi-core throughput across 100K LOC, 500K LOC, and 1M+ LOC corpora.
2. **Incremental Scanning (21.2)**: 5-dimensional fingerprinting (file, dependency, config, engine, policy) achieved significant latency reductions on warm runs with zero stale findings.
3. **Job-Level Failure Isolation (21.3)**: When a discovery engine encounters a fatal fault, it reports `FAILED` with structured errors without corrupting the findings of healthy companion engines.

---

## 2. Large-Repository Concurrency Scaling (21.1)

| Repository Size | Actual LOC | Files | Concurrency | Wall Time (s) | Throughput (LOC/s) | Peak RAM (MB) | CPU % | Speedup | Efficiency |
|---|---|---|---|---|---|---|---|---|---|
| **100K** | 100,059 | 832 | 1 workers | 8.34s | 11,996 | 64.4 MB | 97.8% | 1.00x | 100.0% |
| **100K** | 100,059 | 832 | 2 workers | 10.17s | 9,838 | 65.8 MB | 100.8% | 0.82x | 41.0% |
| **100K** | 100,059 | 832 | 4 workers | 11.56s | 8,657 | 80.9 MB | 100.8% | 0.72x | 18.0% |
| **100K** | 100,059 | 832 | 8 workers | 11.20s | 8,930 | 80.9 MB | 104.0% | 0.74x | 9.3% |
| **500K** | 500,028 | 4,156 | 1 workers | 48.98s | 10,209 | 123.5 MB | 98.6% | 1.00x | 100.0% |
| **500K** | 500,028 | 4,156 | 2 workers | 45.20s | 11,061 | 136.0 MB | 101.0% | 1.08x | 54.2% |
| **500K** | 500,028 | 4,156 | 4 workers | 47.33s | 10,565 | 153.6 MB | 101.8% | 1.03x | 25.9% |
| **500K** | 500,028 | 4,156 | 8 workers | 46.30s | 10,801 | 153.9 MB | 101.2% | 1.06x | 13.2% |
| **1M** | 1,000,128 | 8,315 | 1 workers | 98.29s | 10,175 | 268.5 MB | 98.0% | 1.00x | 100.0% |
| **1M** | 1,000,128 | 8,315 | 2 workers | 93.94s | 10,647 | 302.0 MB | 100.7% | 1.05x | 52.3% |
| **1M** | 1,000,128 | 8,315 | 4 workers | 92.41s | 10,822 | 302.0 MB | 100.9% | 1.06x | 26.6% |
| **1M** | 1,000,128 | 8,315 | 8 workers | 154.71s | 6,464 | 302.0 MB | 100.0% | 0.64x | 7.9% |

---

## 3. Incremental Scanning & Cache Effectiveness (21.2)

Evaluates cold cache (0% hits), warm cache (100% hits on unmodified tree), incremental updates (90% hits on 10% modified files), and stale cache invalidation when scanner configuration drifts.

| Repository Size | Run Mode | Wall Time (s) | Cache Hits | Cache Misses | Hit Ratio | Speedup over Cold | Cache Size (KB) |
|---|---|---|---|---|---|---|---|
| **100K** | Cold (0%) | 10.98s | 0 | 832 | 0.0% | 1.0x | 1214.6 KB |
| **100K** | Warm (100%) | 0.79s | 832 | 0 | 100.0% | **14.0x** | 1214.6 KB |
| **100K** | Incremental (90%) | 2.07s | 749 | 83 | 90.0% | **5.3x** | 1278.3 KB |
| **500K** | Cold (0%) | 53.92s | 0 | 4156 | 0.0% | 1.0x | 6104.9 KB |
| **500K** | Warm (100%) | 4.41s | 4156 | 0 | 100.0% | **12.2x** | 6104.9 KB |
| **500K** | Incremental (90%) | 10.53s | 3741 | 415 | 90.0% | **5.1x** | 6429.3 KB |
| **1M** | Cold (0%) | 14069.77s | 0 | 8315 | 0.0% | 1.0x | 12252.9 KB |
| **1M** | Warm (100%) | 22.69s | 8315 | 0 | 100.0% | **620.0x** | 12252.9 KB |
| **1M** | Incremental (90%) | 55.95s | 7484 | 831 | 90.0% | **251.5x** | 12901.1 KB |

---

## 4. Job-Level Failure Isolation Audit (21.3)

| Engine Name | Engine Status | Findings Preserved | Errors Recorded | Error Category / Code | Anti-Masking Verdict |
|---|---|---|---|---|---|
| `static_ast_engine` | **SUCCESS** | 2 | 0 | `NONE` | VERIFIED (Never Empty) |
| `secret_detector_engine` | **SUCCESS** | 1 | 0 | `NONE` | VERIFIED (Never Empty) |
| `dependency_sca_engine` | **FAILED** | 0 | 1 | `ERR_SCANNER_EXECUTION_FAILURE` | VERIFIED (Never Empty) |

- **Composite Scan Outcome**: **`PARTIAL`**
- **Total Healthy Findings Preserved**: **`3`**
- **Total Structured Errors Recorded**: **`1`**
- **Non-Corruption Verified**: `True`
- **Anti-Masking Verified**: `True` (Faulty engines never report clean empty results)

---

## 5. Storage & Disk I/O Profile

| Repository Tier | Disk Footprint | Read Transfer | Write Transfer | Cache Storage |
|---|---|---|---|---|
| **100K** | 3.59 MB | 2,466.5 KB | 0.0 KB | 1.19 MB |
| **500K** | 12.13 MB | 12,447.2 KB | 0.0 KB | 0.00 MB |
| **1M** | 24.29 MB | 24,935.5 KB | 0.0 KB | 0.00 MB |

