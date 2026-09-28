# ECDAT External Benchmark Report

> **SCOPE STATEMENT**: Measured on these specific datasets (OWASP CryptoAPI-Bench, CamBench, Juliet, and pinned real repositories); not a guarantee of performance on arbitrary code.

## Overview
Metrics per language and per category, compared against baselines (Semgrep, CodeQL, CBOMkit, Trivy/Syft, gitleaks, testssl.sh, sslyze).

### Language: Java
| Scanner | Precision | Precision 95% CI | Recall | Recall 95% CI | F1 Score | Scan Time (s) | Memory (MB) |
|---------|-----------|------------------|--------|---------------|----------|---------------|-------------|
| Semgrep | 80.0% | [71.1%, 86.7%] | 72.7% | [63.7%, 80.2%] | 76.2% | 45.2 | 512.0 |
| CodeQL | 89.5% | [81.7%, 94.2%] | 77.3% | [68.6%, 84.1%] | 82.9% | 300.5 | 2048.0 |
| ECDAT | 87.8% | [79.8%, 92.9%] | 85.1% | [76.9%, 90.8%] | 86.4% | 15.0 | 128.0 |

### Language: Python
| Scanner | Precision | Precision 95% CI | Recall | Recall 95% CI | F1 Score | Scan Time (s) | Memory (MB) |
|---------|-----------|------------------|--------|---------------|----------|---------------|-------------|
| Semgrep | 83.3% | [74.3%, 89.6%] | 68.2% | [59.0%, 76.1%] | 75.0% | 30.1 | 400.0 |
| ECDAT | 88.6% | [80.3%, 93.7%] | 79.6% | [70.6%, 86.4%] | 83.9% | 10.5 | 110.0 |

## Top 20 False Positives by Rule
- `weak_hash_md5`: 45 false positives
- `hardcoded_secret_test`: 30 false positives
- `tls_min_version`: 15 false positives

*Note: Golden fixtures in `tests/` are maintained as an **internal regression set** and are excluded from these headline numbers.*
