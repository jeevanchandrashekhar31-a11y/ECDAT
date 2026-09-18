# Scanner Result Integrity & Provenance Architecture (Phase 24 - P1)

## 1. Executive Summary & Mandatory Classification Taxonomy

To prevent misleading security reporting, false sense of safety, and silent scan failures, ECDAT enforces a strict 6-state discovery outcome model across all scanners (static code, network probes, container/binary, and runtime telemetry):

```text
FOUND
NOT_FOUND
NOT_SCANNED
SCAN_ERROR
UNSUPPORTED
UNKNOWN
```

### Core Anti-Collapse Invariants
1. **NEVER collapse `NOT_SCANNED` into `NOT_FOUND`**:
   - If a file, repository, port, or target was skipped (e.g. excluded directory, oversized file limit, traversal depth limit, timeout, or offline isolation), it is **`NOT_SCANNED`**.
   - Reporting an unscanned component as `NOT_FOUND` creates a catastrophic false negative by implying the component was inspected and verified clean of vulnerabilities or cryptographic risks.
2. **NEVER collapse `ERROR` / `SCAN_ERROR` into `CLEAN`**:
   - If an engine crashes, throws an uncaught exception, times out, encounters permission denial, or fails to parse a file, it is **`SCAN_ERROR`**.
   - The scanner must fail closed, return a non-zero exit code (`CIExitCode.SCANNER_ERROR`), reject pipeline release gates, and clearly log the error. Under no circumstances may an error state be treated as "clean" or "zero vulnerabilities".
3. **NEVER collapse `UNSUPPORTED` into `NOT_FOUND`**:
   - File extensions, compiled architectures, or network protocols not supported by the scanner must be reported as **`UNSUPPORTED`**, with the disclaimer that unsupported formats cannot be verified clean.

---

## 2. The 6 Canonical Scanner States

| # | Result State | Definition & Trigger Conditions | Platform Action | Can Certify Clean? |
|---|---|---|---|---|
| 1 | **`FOUND`** | Target affirmatively inspected; one or more cryptographic components or vulnerabilities discovered. | Generates Finding record with full provenance. Registers in CBOM. | **NO** (Finding present) |
| 2 | **`NOT_FOUND`** | Target affirmatively inspected, fully parsed, and analyzed; zero findings detected. | Generates clean component record. | **YES** (Only if all items NOT_FOUND) |
| 3 | **`NOT_SCANNED`** | Target omitted, skipped by policy (exclude dirs, `.gitignore`), exceeding size/depth quotas, or skipped due to timeout. | Logs reason for skip. Disclaims completeness in summary. | **NO** (Never collapse to NOT_FOUND) |
| 4 | **`SCAN_ERROR`** | Parser failure, syntax error, permission denied, I/O timeout, subprocess crash, or uncaught exception. | Fails closed. Sets exit code $\neq 0$. Emits error record. | **NO** (Never collapse to CLEAN) |
| 5 | **`UNSUPPORTED`** | File extension, binary format, language, or protocol unrecognized or unsupported by engine. | Categorizes unsupported asset. Requests manual review or adapter. | **NO** (Never collapse to NOT_FOUND) |
| 6 | **`UNKNOWN`** | Indeterminate analysis, ambiguous heuristic, dynamic reflection (`eval`), or encrypted blob without key. | Flags asset with `needs_human_review: true`. | **NO** (Indeterminate) |

---

## 3. Finding Provenance Reproducibility Standard

Every discovered finding must carry sufficient provenance to reproduce **why** and **where** it was detected:

```json
{
  "location": "src/crypto/kex.py:54",
  "line_number": 54,
  "column_number": 12,
  "snippet": "kyber768.encapsulate(public_key)",
  "detection_method": "ast",
  "rule_id": "ECDAT-AST-MLKEM-001",
  "algorithm_or_asset": "ML-KEM-768",
  "confidence": "high",
  "tool_name": "ECDAT Static Scanner",
  "tool_version": "1.0.0",
  "timestamp": "2026-09-18T15:45:00.000Z",
  "reproducibility_context": {
    "ast_node_type": "Call",
    "callee_symbol": "kyber768.encapsulate",
    "standard": "NIST FIPS 203"
  }
}
```

### Mandatory Provenance Fields
- **`location`**: Auditable physical location (file path + line/column in code, or hostname:port in network).
- **`snippet`**: Sanitized code or protocol excerpt demonstrating the exact match (guaranteed free of cleartext private keys or credentials).
- **`detection_method`**: Concrete discovery mechanism (`ast`, `regex`, `runtime_hook`, `network_handshake`, `package_manifest`).
- **`rule_id`**: Canonical rule, signature, or pattern identifier that triggered detection.
- **`tool_name` & `tool_version`**: Identifying engine and version that produced the finding.
- **`confidence`**: Degree of certainty (`high`, `medium`, `low`).
- **`timestamp`**: ISO-8601 UTC timestamp of execution.

---

## 4. Overall Assessment Invariant Logic

The scanner result tracker calculates an overall assessment based on strict containment rules:

```
                               Items Scanned
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
         Any SCAN_ERROR > 0?                     Any FOUND > 0?
           ├── YES ──► SCAN_ERROR (Exit $\neq 0$)   ├── YES ──► FINDINGS_DETECTED
           └── NO                                  └── NO
                                                         │
                                        Any NOT_SCANNED / UNSUPPORTED / UNKNOWN > 0?
                                          ├── YES ──► PARTIAL_ASSESSMENT (With Disclaimer)
                                          └── NO
                                                         │
                                        100% NOT_FOUND and Total > 0?
                                          ├── YES ──► CLEAN (Certified Clean)
                                          └── NO  ──► EMPTY
```

### Mandatory Absence Disclaimer
Whenever `clean_certified == false` and findings are 0 (e.g. because items were skipped, unsupported, or errored), the report MUST display:
> *"Absence of findings on scanned targets is NOT proof that no cryptographic assets or vulnerabilities exist across unscanned, skipped, or unsupported components."*

---

## 5. Dual-Runtime Implementation & REST API

- **Python Core**: [result_integrity.py](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/common/result_integrity.py)
  - `ResultState` enum
  - `assert_no_illegal_collapse()`
  - `FindingProvenance` dataclass with `validate()`
  - `ResultIntegrityTracker`
- **Node.js Core**: [result_integrity.js](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/security/result_integrity.js)
  - `RESULT_STATES` object
  - `assertNoIllegalCollapse()`
  - `verifyFindingProvenance()`
  - `ResultIntegrityTracker`
- **REST Endpoints**: [security_hardening.js](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/security_hardening.js)
  - `GET /api/v1/security/scanners/result-states`: Returns canonical taxonomy and anti-collapse policies.
  - `POST /api/v1/security/scanners/validate-integrity`: Evaluates item outcome payloads, validates provenance, prevents illegal collapse, and computes overall verdict.
