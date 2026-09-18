# Resource Governance and Denial-of-Service Defense Architecture

## Overview

The ECDAT Resource Governance subsystem (Phase 20 / P1) enforces strict server-side rate limits, concurrency controls, payload size boundaries, and resource quotas across the entire application and scanning lifecycle.

This architecture prevents denial-of-service (DoS), computational exhaustion, memory exhaustion, zip bombs, slowloris scanning, and brute-force harvesting attacks on security-sensitive endpoints.

---

## 1. Rate Limiting on Security-Sensitive Operations

Rate limiting is enforced at the route boundary partitioned by tenant ID, client IP, user context, and operation. Exceeding limits returns `HTTP 429 Too Many Requests` with standard rate limit headers.

| Operation | Window | Limit | Target Endpoints | Attack Vector Defended |
| :--- | :--- | :--- | :--- | :--- |
| **Registration** | 60s | 5 req | `/api/v1/auth/register`, `/local/register` | Mass account farming, privilege escalation fuzzing |
| **Login** | 60s | 10 req | `/api/v1/auth/local/login`, `/cookie/login`, `/ldap/login`, `/oidc/callback` | Credential stuffing, brute-force dictionary attacks |
| **MFA** | 60s | 10 req | `/api/v1/auth/mfa/verify`, `/setup`, `/enable`, `/reset` | TOTP code enumeration, backup code exhaustion |
| **Password Reset** | 60s | 5 req | `/api/v1/auth/password-reset/request`, `/confirm`, `/forgot-password`, `/reset-password` | Reset token flooding, user inbox harassment |
| **Token Operations** | 60s | 20 req | `/api/v1/auth/token/refresh`, `/revoke`, `/logout`, `/logout-all` | RTR amplification, session store flooding |
| **Scan Submission** | 60s | 10 req | `/scan/static`, `/scan/binary` | Scanner pipeline queue flooding, CPU exhaustion |
| **Network Scan** | 60s | 5 req | `/scan/network` | Distributed network probing abuse, socket exhaustion |
| **Git Scan** | 60s | 5 req | `/scan/static` (Git URL clone mode) | External repository cloning bandwidth & disk abuse |
| **Archive Upload** | 60s | 10 req | `/api/v1/cboms`, `/scan/static` (ZIP), `/scan/binary` (ZIP) | Storage exhaustion, archive decompression bombs |
| **CBOM Generation** | 60s | 15 req | `/api/v1/cbom/ingest`, `/cbom/merge` | Complex graph correlation & CycloneDX merge DoS |
| **Report Generation** | 60s | 15 req | `/api/v1/reports/summary`, `/executive`, `/technical` | Heavy PDF/HTML rendering and DOM generation exhaustion |
| **Integration Calls** | 60s | 20 req | `/api/v1/integrations/kms/*`, `/ticketing/*`, `/siem/forward` | Upstream KMS/SIEM API quota exhaustion and rate abuse |

### Standard Response Headers

Every rate-limited endpoint returns IETF-compliant rate limit telemetry:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 42
Retry-After: 42

{
  "error": "TooManyRequests",
  "code": "RATE_LIMIT_EXCEEDED",
  "operation": "scan_submission",
  "message": "Scan submission rate limit exceeded.",
  "retryAfterSeconds": 42,
  "requestId": "req_6718d042-4f32-4e4b"
}
```

---

## 2. Resource Quotas and Boundary Enforcement

Resource quotas are strictly tracked and enforced in both Node.js API services and Python scanner processes.

```text
Incoming Request
      ↓
[Request Size Limiter]  --> If Content-Length > 10MB  ==> HTTP 413 Payload Too Large
      ↓
[Tenant Rate Limiter]   --> If req > quota/min        ==> HTTP 429 Too Many Requests
      ↓
[Concurrency Governor]  --> If tenant scans > 3 or
                            system scans > 10         ==> HTTP 429 Concurrency Limit Exceeded
      ↓
[Queue Depth Governor]  --> If queued jobs > 50       ==> HTTP 429 / 503 Queue Depth Exceeded
      ↓
[Execution Governor]    --> Scan execution timeout    ==> ScanTimeoutError (abort & release)
                        --> Memory quota pre/post     ==> MemoryQuotaExceededError
```

### Quota Specifications

| Quota | Threshold | Enforcement Layer | Action on Violation |
| :--- | :--- | :--- | :--- |
| **Request Size Limit** | 10 MB | Express Early Middleware (`app.js`) | `HTTP 413 Payload Too Large` before body parsing |
| **Upload Size Limit** | 10 MB (up to 50MB configured) | Multer & Archive Guard (`validateFile`) | `HTTP 413` / `HTTP 400 Invalid File Size` |
| **Scan Timeout** | 300 seconds (5 mins) | `executeGovernedScan` / `run_governed_scan` | Interrupted via `AbortController` / thread timeout |
| **CPU Quota** | 85.0% | `ResourceQuotaGovernor.check_cpu_quota` | Throws `CpuQuotaExceededError` |
| **Memory Quota** | 1024 MB | `process.memoryUsage().rss` & Python governor | Throws `MemoryQuotaExceededError` & triggers GC |
| **Disk Quota** | 1024 MB | `ResourceQuotaGovernor.check_disk_quota` | Throws `DiskQuotaExceededError` & cleans scratch |
| **Concurrency (Tenant)** | 3 concurrent scans | `ConcurrencyGovernor` | `HTTP 429` (`CONCURRENCY_LIMIT_EXCEEDED`) |
| **Concurrency (System)** | 10 concurrent scans | `ConcurrencyGovernor` | `HTTP 429` (`CONCURRENCY_LIMIT_EXCEEDED`) |
| **Queue Depth (Tenant)** | 50 pending jobs | `TenantScopedJobQueue.enqueue()` | `HTTP 429` (`QUEUE_DEPTH_EXCEEDED`) |
| **Queue Depth (System)** | 200 pending jobs | `TenantScopedJobQueue.enqueue()` | `HTTP 429` (`QUEUE_DEPTH_EXCEEDED`) |

---

## 3. Denial-of-Service Prevention for Expensive Scanning

Scanning malicious or intentionally convoluted directory structures can exhaust scanner file handles, memory, and traversal threads. ECDAT implements proactive complexity analysis before running static or archive analyzers.

### Complexity Thresholds

1. **Directory Nesting Depth**: Maximum depth of 25 subdirectories. Deeper hierarchies throw `ExpensiveScanComplexityError` to prevent stack overflow or circular symlink traversal.
2. **Repository File Count**: Maximum of 50,000 files per scan target. Excess files abort processing before AST parsing starts.
3. **Decompression Expansion Ratio**: Maximum 100:1 ratio with 100MB uncompressed limit enforced by `ArchiveSecurityGuard`.
4. **Guaranteed Slot Cleanup**: `executeGovernedScan` and `concurrencyQuotaMiddleware` release allocated slots in a `finally` block or on response `close`/`finish` events, guaranteeing no slot leaks during failures or client disconnects.
