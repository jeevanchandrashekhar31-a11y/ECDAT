# ECDAT Crypto Scanner Benchmark v1.0

## Purpose
Known-answer benchmark repository for evaluating cryptographic discovery quality. The expected inventory is authoritative for this benchmark. It contains 95 positive cryptographic fixtures and 5 negative controls.

## Important
This is a purpose-built benchmark, not an official NIST corpus and not a claim that every fixture is a production implementation. The PQC fixtures contain known algorithm identifiers for discovery testing; they intentionally do not implement PQC algorithms. Generated X.509 keys/certificates are benchmark artifacts.

## Ground truth
- `metadata/expected_inventory.json` — machine-readable ground truth
- `metadata/expected_inventory.csv` — spreadsheet-friendly ground truth
- `metadata/benchmark_summary.json` — counts by category

## Categories
- 15 symmetric encryption fixtures
- 10 hashing fixtures
- 10 MAC/KDF fixtures
- 10 RSA fixtures
- 10 ECC/EdDSA fixtures
- 10 key-exchange fixtures
- 10 TLS/protocol fixtures
- 10 certificate/key fixtures
- 10 PQC identifier fixtures
- 5 negative controls

## What a scanner should measure
1. True positives
2. False positives
3. False negatives
4. Precision
5. Recall
6. F1 score
7. Algorithm classification accuracy
8. Primitive classification accuracy
9. Location/file attribution accuracy
10. Negative-control rejection rate

## Suggested ECDAT test
Run ECDAT against this directory without reading `metadata/expected_inventory.*` as scanner input. Compare the scanner's normalized output against the ground truth separately.

## Expected totals
Positive assets: 95
Negative controls: 5
Total benchmark entries: 100

## Reference sources
- NIST CAVP: https://csrc.nist.gov/Projects/Cryptographic-Algorithm-Validation-Program
- NIST PQC: https://csrc.nist.gov/Projects/Post-Quantum-Cryptography
- OpenSSL: https://github.com/openssl/openssl

## Reproducibility
The benchmark is deterministic except for the generated certificate/key bytes. Their algorithms and key parameters are fixed by the filenames and certificate metadata.
