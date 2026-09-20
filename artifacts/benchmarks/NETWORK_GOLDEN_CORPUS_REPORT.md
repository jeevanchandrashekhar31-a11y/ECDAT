# ECDAT Network & TLS Scanner Empirical Benchmark Report (Phase 30 / P2)

> [!IMPORTANT]
> **Scientific Integrity Notice**:
> All metrics in this report represent **`network golden corpus precision`** and **`network golden corpus recall`** evaluated directly
> against curated, ground-truth badssl.com endpoints. They must **NEVER** be extrapolated or reported as arbitrary
> real-world precision or recall across uncurated production environments.

## 1. Executive Summary & Core Metrics

- **Corpus Standard**: `Phase 30 Network Golden Corpus`
- **Evaluation Timestamp**: `2026-09-20T13:59:06.402129+00:00`
- **Golden Corpus Size**: **`9` endpoints** (6 ground truth expected anomalies)
- **Total Evaluated Categories**: **`6` Standardized Classes**
- **Network Golden Corpus Precision**: **`100.0%`**
- **Network Golden Corpus Recall**: **`100.0%`**
- **Network Golden Corpus F1 Score**: **`100.0%`**
- **True Negatives Rate on Clean Endpoints**: **`100.0%` (3 of 3 Clean Endpoints with 0 False Positives)**

| Metric | Measured Value | Standard Target | Status |
|---|---|---|---|
| **Network Golden Corpus Precision** | **100.0%** | ≥ 85.0% | ✅ PASS |
| **Network Golden Corpus Recall** | **100.0%** | ≥ 80.0% | ✅ PASS |
| **Network Golden Corpus F1 Score** | **100.0%** | ≥ 82.0% | ✅ PASS |
| **True Positives (TP)** | `6` | Maximize | Verified |
| **False Positives (FP)** | `0` | Minimize | Verified |
| **False Negatives (FN)** | `0` | Minimize | Verified |
| **True Negatives (TN)** | `3` | All Clean Endpoints | 100% Clean |

---

## 2. Resource Utilization & Scan Performance

| Resource Metric | Empirical Measurement | Unit |
|---|---|---|
| **Scan Wall Time** | `7.157s` | Seconds |
| **Peak Process Working Set (RAM)** | `53.61 MB` | Megabytes |
| **Scanning Throughput** | `1.26 endpoints/s` | Endpoints per Second |

---

## 3. Category Breakdown (Standardized Network Classes)

| Category | Endpoints | Expected | TP | FP | FN | Precision | Recall | F1 Score |
|---|---|---|---|---|---|---|---|---|
| `01_certificate_expiration` | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `02_hostname_mismatch` | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `03_self_signed_certificate` | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `04_weak_ciphers` | 2 | 2 | 2 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `05_revoked_certificate` | 1 | 1 | 1 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| `06_clean_endpoints` | 3 | 0 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% |

---

## 4. Empirical Guarantee Verification

- **Zero False Positives on Clean Endpoints**: Verified that standard TLS 1.2+ endpoints with valid SHA-256 certificates and matching hostnames trigger strictly 0 false positive anomalies.
- **Multi-Domain Protocol Coverage**: Tested expired certificates, multi-level wildcard hostname mismatches, untrusted self-signed roots, weak/null cipher suites, and certificate revocations.
- **Automated Report Generation**: This document was generated directly from the live network scanner evaluation run, never typed by hand.

---

## 5. Known Boundaries & Network Scoping

1. **Public CA & OCSP Response Latency**: Live verification of revoked certificates relies on CA OCSP responder availability and client OCSP stapling cache state.
2. **Egress Firewall & Middlebox TLS Inspection**: Corporate outbound proxies terminating TLS will present corporate proxy certificates instead of upstream server certificates.
3. **Local Platform Cipher Suite Constraints**: Underlying OS TLS libraries (such as OpenSSL or Windows Schannel) may abort handshakes early when server requires deprecated ciphers.
