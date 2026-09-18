# Input Validation & External Data Sanitization Architecture (Phase 19 / P1)

## Executive Summary

ECDAT enforces an unyielding, defense-in-depth external input validation architecture across both the Node.js backend API and Python scanner components. External inputs are treated as untrusted by default: **frontend validation is never trusted**, all constraints are evaluated authoritatively on the server, and any violation produces an immediate `HTTP 400 Bad Request` or raises a fail-closed validation exception.

Unknown fields are strictly rejected on security-sensitive endpoints to prevent mass-assignment vulnerabilities, privilege escalation, and configuration tampering.

---

## The 12 Mandatory Input Validation Pillars

| Pillar | Implementation Technique | Constraints Enforced | Rejection Behavior |
| :--- | :--- | :--- | :--- |
| **1. Strict Schemas** | Ajv strict compilation & Python `validate_strict_schema` | `additionalProperties: false` on sensitive payloads | `400 Bad Request` (`VALIDATION_ERROR`) |
| **2. Type Validation** | Strict type comparison without coercion | Strings must be `typeof === 'string'`, numbers `isFinite()`, booleans strictly typed | `400 Bad Request` (`TypeValidationError`) |
| **3. Length Limits** | `validateLength` / `validate_length` | Explicit `minLength` and `maxLength` (e.g., username 3–64, identifier 1–256) | `400 Bad Request` (`BoundsValidationError`) |
| **4. Enum Validation** | `validateEnum` / `validate_enum` | Closed sets for `ALLOWED_ROLES`, `ALLOWED_SEVERITIES`, `ALLOWED_ASSET_TYPES`, `ALLOWED_KMS_PROVIDERS`, `ALLOWED_TICKETING_TYPES`, `ALLOWED_EXPORT_FORMATS` | `400 Bad Request` (`InputValidationError`) |
| **5. URL Validation** | `validateUrl` / `validate_url` | HTTP/HTTPS only; max 2048 chars; reject `javascript:`, `data:`, `file:`, `ftp:`; SSRF & cloud metadata blocklist | `400 Bad Request` (`SSRFViolation`) |
| **6. Hostname Validation** | `validateHostname` / `validate_hostname` | RFC 1123 label bounds (1–63 chars, alphanumeric + hyphen); no control characters/null bytes; internal hostname blocklist | `400 Bad Request` (`InputValidationError`) |
| **7. IP Validation** | `validateIpAddress` / `validate_ip_address` | IPv4 & IPv6 syntax parsing; blocks private, loopback, link-local, multicast, and reserved ranges when `allowPrivate=false` | `400 Bad Request` (`InputValidationError`) |
| **8. File Validation** | `validateFile` / `validate_file` | Filename traversal rejection (`..`, `\0`, `/`, `\`); extension allowlist (`.json`, `.cdx.json`, `.cbom.json`, `.spdx.json`); size bounds (default 10 MB) | `400 Bad Request` (`INVALID_FILE_UPLOAD`) |
| **9. MIME Validation** | `validateFile` / `validate_file` | Explicit MIME whitelist (`application/json`, `application/vnd.cyclonedx+json`, `text/plain`); executable/dangerous MIME rejection (`application/x-msdownload`, `application/x-sh`, `text/html`) | `400 Bad Request` (`INVALID_FILE_UPLOAD`) |
| **10. Content Validation** | `validateCbomContent` / `validate_cbom_content` | Verifies JSON parsing; enforces object/array root; scans for and rejects embedded raw private keys (`-----BEGIN ... PRIVATE KEY-----`) | `400 Bad Request` (`INVALID_CBOM_CONTENT`) |
| **11. Numeric Bounds** | `validateNumericBounds` / `validate_numeric_bounds` | Non-NaN, finite values; integer-only verification where required; min/max boundaries | `400 Bad Request` (`BoundsValidationError`) |
| **12. Pagination Bounds** | `paginationBoundsMiddleware` / `validate_pagination` | `page >= 1`; `1 <= pageSize/limit <= 100`; `offset >= 0`; prevents memory exhaustion via unbounded queries | `400 Bad Request` (`PAGINATION_OUT_OF_BOUNDS`) |

---

## Canonical Enums & Allowlists

### Roles
- `viewer`, `analyst`, `developer`, `auditor`, `admin`, `security admin`, `security administrator`, `platform_admin`, `platform administrator`, `secops`

### Severities
- `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFORMATIONAL`

### Asset Types
- `service`, `database`, `endpoint`, `library`, `hardware`, `application`, `component`, `microservice`

### KMS Providers
- `aws_kms`, `gcp_kms`, `azure_keyvault`, `hashicorp_vault`, `pkcs11_hsm`

### Ticketing Types
- `jira`, `servicenow`, `github`, `github_issues`, `gitlab`, `gitlab_issues`, `webhook`, `generic_webhook`

### Export Formats
- `json`, `cef`, `syslog`, `sarif`, `cyclonedx`, `spdx`

### Prohibited & Dangerous MIMEs
- `application/x-msdownload` (.exe, .dll)
- `application/x-sh` (.sh)
- `application/x-bat` (.bat)
- `text/html` (Stored XSS defense)
- `application/javascript` (Stored XSS defense)
- `text/javascript` (Stored XSS defense)
- `application/octet-stream` (Executable payloads)

---

## Component Integration Reference

### 1. CBOM Ingestion (`backend/src/routes/cbom.js`)
- **Multipart Uploads**: Validated with `validateFile()` (filename traversal rejection, extension whitelist, MIME filtering) and `validateCbomContent()` (JSON syntax validation and private key leakage prevention).
- **String Parameters**: `scanLabel`, `projectName`, `scannerType`, `policyProfile` validated for maximum length (128–256 chars).
- **Listing Scans**: Protected with `paginationBoundsMiddleware()` enforcing bounded query parameters.

### 2. Identity & Secret Management (`backend/src/routes/auth.js`)
- **Public Registration**: Type and length limits on `username` (3–64 chars), `password` (1–128 chars, evaluated against NIST SP 800-63B policy), and `email` (5–254 chars).
- **Administrative User Creation**: Strict string type and length validation.
- **Secret Rotation**: Protected with `validateSchemaStrict(SCHEMAS.SECRET_ROTATION)` rejecting unknown fields (`additionalProperties: false`) and constraining `keyType` to canonical cryptographic key types.

### 3. KMS & HSM Connectors (`backend/src/routes/kms.js`)
- **Registration**: Enforces `validateLength()` on connector name, `validateEnum()` against `ALLOWED_KMS_PROVIDERS`, and SSRF validation on endpoint URLs.

### 4. Ticketing Connectors (`backend/src/routes/ticketing.js`)
- **Registration**: Enforces `validateLength()` on connector name, `validateEnum()` against `ALLOWED_TICKETING_TYPES`, and SSRF validation on webhook/instance URLs.

### 5. Audit & SIEM (`backend/src/routes/audit.js`, `backend/src/routes/siem.js`)
- **Pagination**: Enforced via `paginationBoundsMiddleware()` preventing resource exhaustion.
- **Formats & Severity**: Strict enum validation on export formats (`json`, `cef`, `syslog`) and severities.

### 6. Python Scanners (`scanners/common/input_validation.py`)
- Mirrors all 12 input validation capabilities for background jobs, CI pipelines, and scanner plugins.

---

## Verification & Test Results

All 13 validation suites passed with 100% success:

```text
✔ Phase 19.1 — Strict Schemas & Unknown Field Rejection (2.3184ms)
✔ Phase 19.2 — Type Validation (Strict Types, No Type Juggling) (1.1293ms)
✔ Phase 19.3 — Length Limits (0.1483ms)
✔ Phase 19.4 — Enum Validation (0.144ms)
✔ Phase 19.5 — URL Validation & SSRF Defense (2.6498ms)
✔ Phase 19.6 — Hostname Validation (0.2401ms)
✔ Phase 19.7 — IP Validation (1.0779ms)
✔ Phase 19.8 — File Validation & Path Traversal Rejection (0.2618ms)
✔ Phase 19.9 — MIME Validation (0.1251ms)
✔ Phase 19.10 — Content Validation (JSON Structure & Private Key Detection) (0.2604ms)
✔ Phase 19.11 — Numeric Bounds (0.1253ms)
✔ Phase 19.12 — Pagination Bounds (0.1115ms)
✔ Phase 19.13 — Live Routes Enforce Server-Side Validation (Never Trust Frontend) (57.2822ms)
```

- **Node.js Test Suite**: 706 / 706 passed (39 test suites clean).
- **Python Test Suite**: 789 / 789 passed (100% pass).
