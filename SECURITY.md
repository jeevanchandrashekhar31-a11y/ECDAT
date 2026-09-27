# ECDAT Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `main` branch | ✅ Active |
| Tagged releases | ✅ For 90 days post-release |
| Older | ❌ No security updates |

---

## 🔒 Security Controls Summary

ECDAT is built security-first. The following controls are implemented and verified:

### Authentication & Authorization
- **JWT RS256** tokens with embedded `tenantId`, `userId`, `roles`
- **RBAC**: Admin / Reviewer / Developer / OrgViewer — enforced at API middleware layer
- **bcrypt** password hashing (work factor 12)
- **Demo mode** for evaluation — explicitly enabled via `AUTH_MODE=demo`

### Tenant Isolation
- Every DB query is scoped to `tenant_id` via parameterized Knex queries
- `SCAN_TENANT_FORBIDDEN` sentinel — cross-tenant access returns `404 Not Found` (not `403`) to prevent information leakage
- Platform Admin superuser bypasses tenant scoping (audit-logged)

### Input Security
- **SSRF Guard**: Blocks private CIDRs (10.x, 172.16-31.x, 192.168.x, 169.254.x), metadata endpoints (AWS, GCP, Azure), localhost, and DNS rebinding
- **Archive Bomb Protection**: Detects nested ZIPs, excessive decompression ratios before extraction
- **Git URL Sanitization**: Strips non-URL trailing text; blocks local filesystem paths (`file://`, `../`)
- **Actor-Role Spoofing Prevention**: Server derives roles from JWT; `X-Actor-Role` headers are ignored
- **SQL Injection**: All queries via parameterized Knex — no raw string interpolation

### Container Security
- Base images pinned to `@sha256` digest — reproducible, immutable builds
- `USER node` / `USER nginx` — no root processes
- `read_only: true` filesystem with explicit `tmpfs` mounts
- `cap_drop: ALL` — only `NET_BIND_SERVICE` re-added
- Custom seccomp profile — `SCMP_ACT_ERRNO` default action
- `no-new-privileges: true`
- `privileged: false`
- **Container Hardening Score: 100.0/100.0** (verified by automated auditor)

### Scan Process Security
- **Scan Abort**: Every scan registers in `activeScanSessions`; `POST /scan/abort` sends `SIGKILL` and cleans temp dirs
- **Concurrency Quotas**: Max concurrent scans per tenant enforced
- **Rate Limiting**: Per-route limits on scan submission, network scanning, API calls
- **Temp File Isolation**: Scan temp dirs written to OS temp (`os.tmpdir()/ecdat-scans`), never to source tree

### Secret Hygiene
- `.env`, `*.key`, `*.pem`, `.keys`, `*.p12`, `*.pfx` excluded from git and Docker build context
- No secrets in image layers (verified by container hardening auditor)
- `JWT_SECRET` must be externally injected — no defaults in production

---

## 🚨 Reporting a Vulnerability

**Please do NOT open a public GitHub Issue for security vulnerabilities.**

### Reporting Process
1. Email: `security@ecdat.dev` (or open a GitHub Security Advisory via the **Security** tab)
2. Include: Description, reproduction steps, affected version, and potential impact
3. Expected response: **48 hours** for acknowledgment, **14 days** for initial assessment

### Scope
**In scope:**
- Authentication bypasses
- Cross-tenant data leakage (IDOR)
- SSRF vulnerabilities
- SQL injection
- RCE via scan pipeline
- JWT validation bypass

**Out of scope:**
- Rate limiting bypass in demo mode
- Self-XSS
- Issues requiring physical access to the server
- Denial of service via resource exhaustion (report anyway — we want to know)

### Responsible Disclosure
We follow a **90-day disclosure timeline**. Security researchers who report valid vulnerabilities will be credited in our security changelog (with permission).

---

## 🔐 Cryptographic Algorithms in Use

| Use Case | Algorithm | Standard |
|---|---|---|
| Password hashing | bcrypt (cost 12) | OWASP recommended |
| Session tokens | JWT RS256 | RFC 7519 |
| Transport | TLS 1.3 (Nginx) | NIST SP 800-52r2 |
| API key hashing | SHA-256 | FIPS 180-4 |

> **Note**: ECDAT detects and assesses cryptographic usage in *other* codebases. It does not itself use any quantum-vulnerable algorithms (RSA < 2048, DES, RC4, MD5, SHA-1 for signatures) in its own infrastructure.
