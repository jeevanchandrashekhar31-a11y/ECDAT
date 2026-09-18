# ECDAT Security Testing Architecture & Regression Framework

> **Specification & Assurance Standard**  
> **Classification**: P1 — Enterprise Security Architecture  
> **Status**: APPROVED & VERIFIED  
> **Coverage**: 25 Mandatory Vulnerability Regression Categories  
> **Release Gate**: Integrated into Gate 3 (Critical Security & Cryptographic Regression Tests)

---

## 1. Executive Overview

The **ECDAT Security Testing Architecture** establishes an unbreakable, defense-in-depth automated testing framework that guarantees every security vulnerability fixed across the platform remains permanently closed.

Under the **ECDAT 5-Point Security Closure Standard**, no security flaw may ever be resolved without:
1. **Root Cause Analysis**: Precise technical identification of the vulnerability and CWE mapping.
2. **Defensive Fix**: Architectural mitigation in production source code.
3. **Permanent Automated Regression Test**: Regression tests in both Python and Node.js executing in automated CI/CD pipelines.
4. **Threat Model Update**: Documentation of STRIDE classification and residual risk impact.
5. **Release Note / Security Advisory**: Formal entry in security tracking registers.

---

## 2. The 25 Mandatory Test Categories Matrix

Every one of the 25 required categories is enforced across dual automated test suites:
- **Python Engine**: [`tests/test_security_regression_architecture.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/tests/test_security_regression_architecture.py)
- **Node.js Engine**: [`backend/tests/security/security_regression_architecture.test.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/tests/security/security_regression_architecture.test.js)

| # | Test Category | CWE / OWASP | Primary Threat Scenario | Defensive Mechanism | Automated Test Implementation |
|---|---|---|---|---|---|
| **01** | `authentication` | CWE-287, CWE-208 | Timing attacks on credential comparison; null/empty password bypasses; weak salt generation. | Constant-time comparison (`hmac.compare_digest`, `crypto.timingSafeEqual`), CSPRNG salt generation (`secrets.token_bytes(16)`), strict length & complexity validators. | `TestCategory01Authentication` / `Category 01: Authentication` |
| **02** | `authorization` | CWE-285, CWE-862 | Unauthenticated access to private assets; unprivileged roles invoking destructive endpoints. | Caller context verification, endpoint authorization gates returning HTTP 401/403 with structured audit logging. | `TestCategory02Authorization` / `Category 02: Authorization` |
| **03** | `RBAC` | CWE-269, CWE-272 | Vertical privilege escalation (viewer granting admin role to self or others); unauthorized role tampering. | Canonical role hierarchy (`platform admin` > `secops` > `developer` > `auditor` > `viewer`), immutable role definitions, strict role modification guards. | `TestCategory03RBAC` / `Category 03: RBAC` |
| **04** | `tenant isolation` | CWE-639, CWE-200 | Tenant A reading, updating, or discovering cryptographic findings and assets belonging to Tenant B. | Mandatory tenant context parameterization across database queries and scanner pipelines; `HORIZONTAL_TENANT_VIOLATION` detection. | `TestCategory04TenantIsolation` / `Category 04: Tenant Isolation` |
| **05** | `IDOR/BOLA` | CWE-639, OWASP API1 | Insecure Direct Object References; sequential ID guessing or UUID tampering to access unauthorized objects. | Authoritative server-side state verification across 10 object types (`USER`, `TENANT`, `SCAN`, `REPORT`, `CBOM`, `ASSET`, `PROJECT`, `JOB`, `SECRET`, `INTEGRATION`). | `TestCategory05IDORBOLA` / `Category 05: IDOR/BOLA` |
| **06** | `MFA` | CWE-288, CWE-308 | Bypassing step-up MFA challenge using only stage-1 password credentials; TOTP brute forcing. | Multi-stage authentication state machine; TOTP verification with constant-time equality and attempt rate limiting. | `TestCategory06MFA` / `Category 06: MFA` |
| **07** | `session management` | CWE-613, CWE-384 | Session hijacking via stale sessions; tokens remaining valid after global password reset or logout. | User revocation epochs (`revokeAllUserSessions`); global logout invalidates all tokens issued prior to timestamp. | `TestCategory07SessionManagement` / `Category 07: Session Management` |
| **08** | `token management` | CWE-327, CWE-347 | JWT `alg: "none"` algorithm confusion; replay of revoked tokens or stolen refresh tokens. | Strict algorithm pinning (`HS256`, `RS256`), immediate token blacklisting (`revokeToken`), Refresh Token Rotation (RTR). | `TestCategory08TokenManagement` / `Category 08: Token Management` |
| **09** | `CSRF where applicable` | CWE-352 | Cross-site forged requests triggering state-modifying actions via browser sessions. | Double-submit anti-CSRF token verification; token mismatch or omission immediately triggers HTTP 403 Forbidden. | `TestCategory09CSRF` / `Category 09: CSRF` |
| **10** | `SSRF` | CWE-918, OWASP API7 | Network scanning or webhook triggers targeting internal infrastructure, cloud metadata, or loopback. | Strict IP/hostname blocklist (RFC1918, `169.254.169.254`, loopback `127.0.0.1`/`::1`, `metadata.google.internal`), anti-DNS rebinding. | `TestCategory10SSRF` / `Category 10: SSRF` |
| **11** | `command injection` | CWE-78 | Shell metacharacter injection (`;&|$\`><\n\r`) in Git repository paths or container execution commands. | Argument sanitization, shell metacharacter rejection, direct executable array execution prohibiting `shell=True`. | `TestCategory11CommandInjection` / `Category 11: Command Injection` |
| **12** | `SQL injection` | CWE-89 | Tautologies (`' OR '1'='1`) or stacked queries manipulating backend database queries. | Strict query parameterization via Knex query builders and prepared statements; zero raw string concatenation. | `TestCategory12SQLInjection` / `Category 12: SQL Injection` |
| **13** | `path traversal` | CWE-22, CWE-23 | Directory escape sequences (`../`, `..\`, null bytes `%00`, Windows ADS `::$DATA`) escaping root directories. | Canonical path resolution (`os.path.realpath`, `path.resolve`), target directory containment validation. | `TestCategory13PathTraversal` / `Category 13: Path Traversal` |
| **14** | `Zip Slip` | CWE-22, CWE-29 | Archive entries containing traversal paths writing files outside extraction directories. | `ArchiveSecurityGuard` and `validateCanonicalPathContainment` verifying that every member extracts strictly inside target root. | `TestCategory14ZipSlip` / `Category 14: Zip Slip` |
| **15** | `archive bombs` | CWE-409 | Decompression bombs (e.g. 1000:1 expansion ratio) consuming unbounded disk and memory. | Expansion ratio caps (max 100:1), total extraction byte limits (max 100MB), per-entry size limits, entry count caps. | `TestCategory15ArchiveBombs` / `Category 15: Archive Bombs` |
| **16** | `secret leakage` | CWE-312, CWE-209 | Accidental leakage of canary tokens, API keys, or private key PEMs in crash diagnostics and error traces. | Deep string/object regex scrubbing (`redact_secrets`, `scrubString`, `scrubSensitiveFields`) replacing secrets with `[REDACTED_SECRET]`. | `TestCategory16SecretLeakage` / `Category 16: Secret Leakage` |
| **17** | `XXE where applicable` | CWE-611, CWE-776 | XML External Entity resolution (local file inclusion) and recursive entity expansion (Billion Laughs bomb). | Pre-parse rejection of `<!DOCTYPE` and `<!ENTITY` declarations; safe DOM construction with external entity resolution disabled. | `TestCategory17XXE` / `Category 17: XXE` |
| **18** | `prototype pollution` | CWE-1321 | Object prototype modification via `__proto__` or `constructor.prototype` in untrusted JSON payloads. | Deep merge filtering stripping prototype-polluting keys; verifying base types (`Object.prototype`, `dict`) remain unpolluted. | `TestCategory18PrototypePollution` / `Category 18: Prototype Pollution` |
| **19** | `dependency vulnerabilities` | CWE-1395, CWE-937 | Unaddressed critical or high-severity CVEs/GHSAs in third-party supply chain packages. | `VulnerabilityReleaseGateEngine` enforcing unconditional release blocking for CRITICAL CVEs and strict risk acceptance for HIGH CVEs. | `TestCategory19DependencyVulnerabilities` / `Category 19: Dependency Vulnerabilities` |
| **20** | `DoS/resource exhaustion` | CWE-400, CWE-1333 | Algorithmic complexity exhaustion (ReDoS); unbounded concurrency or queue saturation. | Regex line truncation (`MAX_LINE_LENGTH = 4096`), `ResourceQuotaGovernor` enforcing per-tenant and system concurrency limits. | `TestCategory20DoSResourceExhaustion` / `Category 20: DoS / Resource Exhaustion` |
| **21** | `logging leakage` | CWE-532 | Cleartext credential storage in structured audit logs, traces, or stdout. | Structured audit event logger with automated recursive redaction across passwords, MFA secrets, private keys, and API tokens. | `TestCategory21LoggingLeakage` / `Category 21: Logging Leakage` |
| **22** | `container security` | CWE-250, CIS Docker | Containers executing as root UID 0, writable root filesystems, or privileged capability escalation. | `ContainerHardeningAuditor` verifying non-root user (`USER node` / `USER 10001`), read-only rootfs, no-privileged mode. | `TestCategory22ContainerSecurity` / `Category 22: Container Security` |
| **23** | `Kubernetes security` | CIS K8s Benchmark | Pods with Linux capabilities, host path mounts, host networking, or missing securityContext. | `KubernetesHardeningAuditor` verifying `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, and `capabilities: drop: ["ALL"]`. | `TestCategory23KubernetesSecurity` / `Category 23: Kubernetes Security` |
| **24** | `CBOM validation` | CWE-20, CycloneDX | Ingestion of malformed, fabricated, or schema-invalid Cryptographic Bill of Materials documents. | Official CycloneDX 1.6 and 1.7 JSON schema validators; rejection of non-JSON, non-CycloneDX, or forged cryptographic components. | `TestCategory24CBOMValidation` / `Category 24: CBOM Validation` |
| **25** | `scanner fail-closed behavior`| CWE-390, CWE-703 | Scanner crashing or encountering an error and silently reporting "CLEAN" (exit 0). | Anti-collapse engine (`assert_no_illegal_collapse`); `SCAN_ERROR` or `NOT_SCANNED` can NEVER collapse to `CLEAN`; non-zero exit codes. | `TestCategory25ScannerFailClosedBehavior` / `Category 25: Scanner Fail-Closed Behavior` |

---

## 3. Anti-Collapse and Fail-Closed Invariant Guarantees

A central tenet of the ECDAT scanning architecture is that **absence of findings is never evidence of security**:

```text
    ┌─────────────────────────────────────────────────────────┐
    │              6-STATE SCANNER TAXONOMY                   │
    ├─────────────┬───────────────────────────────────────────┤
    │ FOUND       │ Cryptographic asset or flaw affirmatively │
    │             │ identified with verifiable provenance.    │
    ├─────────────┼───────────────────────────────────────────┤
    │ NOT_FOUND   │ Inspected target verified clean.          │
    ├─────────────┼───────────────────────────────────────────┤
    │ NOT_SCANNED │ Target skipped, omitted, or uninspected.  │
    ├─────────────┼───────────────────────────────────────────┤
    │ SCAN_ERROR  │ Parser crash, timeout, or I/O failure.    │
    ├─────────────┼───────────────────────────────────────────┤
    │ UNSUPPORTED │ Format/protocol recognized but unsupported│
    ├─────────────┼───────────────────────────────────────────┤
    │ UNKNOWN     │ Indeterminate or ambiguous state.         │
    └─────────────┴───────────────────────────────────────────┘
```

### Strict Anti-Collapse Rules:
1. **NEVER collapse `NOT_SCANNED` into `NOT_FOUND`**: If a file was skipped due to quota, size, or pattern matching, it must be reported as `NOT_SCANNED`.
2. **NEVER collapse `SCAN_ERROR` into `CLEAN`**: If an exception occurs, the scanner must exit with non-zero code (exit 2) and fail the pipeline closed.
3. **NEVER collapse `UNSUPPORTED` into `NOT_FOUND`**: Components that cannot be inspected must be transparently reported as `UNSUPPORTED`.

---

## 4. Execution & Pipeline Verification Commands

To execute the permanent regression architecture across both engines:

```bash
# Execute Python 25-category regression suite
python -m pytest tests/test_security_regression_architecture.py -v

# Execute Node.js 25-category regression suite
npm test --prefix backend -- tests/security/security_regression_architecture.test.js

# Execute comprehensive zero-trust supply-chain release gate (all 6 gates)
python scripts/release_gate.py
```
