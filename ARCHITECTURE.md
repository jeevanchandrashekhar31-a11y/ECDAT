# ECDAT Architecture Documentation

> **Last Updated**: September 2026 | **Version**: 1.0.0-prototype

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Backend Architecture](#backend-architecture)
3. [Frontend Architecture](#frontend-architecture)
4. [Scanner Engine Architecture](#scanner-engine-architecture)
5. [Data Model](#data-model)
6. [Security Architecture](#security-architecture)
7. [Deployment Architecture](#deployment-architecture)

---

## System Overview

ECDAT is a **multi-tenant, full-stack cryptographic posture management platform** built on:

```
Frontend:  React 18 + Vite + TypeScript + Tailwind CSS
Backend:   Node.js 20 + Express + Knex ORM
Database:  Neon PostgreSQL (serverless, multi-tenant row isolation)
Scanners:  Python 3.12 (static AST), SSLyze (TLS), Syft (binary/container)
Cache:     Redis (sessions + rate limiting)
Container: Docker Compose (hardened, seccomp, read-only FS)
```

### Design Principles
1. **Security-first**: Every layer has defense-in-depth controls
2. **Multi-tenant by default**: Tenant isolation is structural, not bolted on
3. **Async scan processing**: Scans run as child processes; results persist to Neon
4. **Standards compliance**: CycloneDX 1.6/1.7 CBOM, NIST PQC FIPS 203/204/205
5. **Observable**: Every scan, auth event, and access is audit-logged

---

## Backend Architecture

### Module Map

```
backend/src/
├── server.js                    # Express app bootstrap, global middleware
├── config.js                    # Environment configuration
├── routes/
│   ├── auth.js                  # Login, logout, token refresh, demo mode
│   ├── scanner_pipeline.js      # POST /scan/{static,network,binary} + /scan/abort
│   ├── cbom.js                  # GET /cbom - browse generated CBOMs
│   ├── findings.js              # GET /findings - filter, search, export
│   ├── scans.js                 # GET /scans - list, detail, status
│   ├── dashboard.js             # GET /dashboard/summary + /dashboard/views
│   ├── reports.js               # GET /reports - generate + download
│   ├── remediation.js           # POST /remediation/approvals/{id}/approve
│   ├── assets.js                # GET /assets - discovered asset inventory
│   ├── compliance.js            # GET /compliance - policy profile evaluation
│   ├── blast_radius.js          # GET /blast-radius - Mosca graph data
│   └── roadmap.js               # GET /roadmap - PQC migration timeline
├── services/
│   ├── cbom_ingestion.js        # Atomic bulk insert + SCAN_TENANT_FORBIDDEN sentinel
│   └── dashboard_views_service.js  # 13 enterprise dashboard view generators
├── middleware/
│   ├── auth.js                  # JWT validation + API key auth
│   ├── tenant_guard.js          # Cross-tenant access rejection (404 sentinel)
│   ├── rate_limiter.js          # Per-route rate limits
│   └── concurrency_quota.js     # Max concurrent scans per tenant
├── remediation/
│   └── approval_workflow.js     # Four-eyes PROPOSE→REVIEW→APPROVE→APPLY→VERIFY
├── risk_engine/
│   ├── index.js                 # Mosca's Theorem calculator
│   └── classifier.js            # Algorithm → SAFE/WATCH/AT_RISK/CRITICAL_URGENT
├── identity/
│   ├── token_service.js         # JWT issue + verify + refresh
│   ├── password_auth.js         # bcrypt login (in-memory/file store)
│   └── pg_password_auth.js      # bcrypt login (Neon PostgreSQL store)
├── security/
│   ├── archive_guard.js         # ZIP bomb detection + fixture exemption
│   ├── git_clone_guard.js       # URL sanitization + SSRF for git operations
│   └── network_scan_guard.js    # SSRF guard for network TLS scans
├── cache/
│   └── redis_client.js          # Redis connection (falls back to in-memory)
└── db/
    ├── connection.js             # Knex pool + isDbConnected() healthcheck
    └── migrations/               # Versioned Knex migration scripts
```

### Key Architectural Decisions

#### Active Scan Registry
Every scan that starts registers in `activeScanSessions` (a `Map<sessionId, { kill(), uploadDir }>`):
```javascript
registerScan(uploadSessionId, {
  uploadDir,
  kill: () => activeChildProcess?.kill('SIGKILL'),
});
```
`POST /scan/abort` uses this registry to terminate any running scan instantly.

#### SCAN_TENANT_FORBIDDEN Sentinel
`getScanById(scanId, tenantContext)` returns the special `SCAN_TENANT_FORBIDDEN` object (not `null`) when a scan exists but belongs to a different tenant. This allows routes to return `404` instead of `403` — preventing cross-tenant enumeration attacks.

#### Mosca Risk Scoring
```javascript
// D + T > Q → CRITICAL_URGENT
const morcaResult = {
  d: dataShelfLife,           // years data must stay secret
  t: migrationTimeEstimate,   // years to migrate (based on algo complexity)
  q: threatHorizon,           // configured Q-Day estimate (2030/2033/2035)
  isVulnerable: (d + t) > q,
  classification: d + t > q ? 'CRITICAL_URGENT' : d + t > q - 2 ? 'AT_RISK' : 'SAFE'
};
```

---

## Frontend Architecture

### Page Structure
```
frontend/src/
├── App.tsx                      # Router + auth guard
├── pages/
│   ├── Dashboard.tsx            # 13-view enterprise dashboard
│   ├── Findings.tsx             # Finding explorer with filtering
│   ├── AssetDetail.tsx          # Per-asset crypto inventory
│   ├── Remediation.tsx          # Approval workflow UI
│   ├── Reports.tsx              # Report generator
│   ├── Roadmap.tsx              # PQC migration timeline
│   ├── CryptoGraph.tsx          # D3 blast radius visualization
│   └── Login.tsx                # Auth + demo mode entry
├── components/
│   ├── CbomUploadModal.tsx      # Scan trigger modal + Stop Scan button
│   ├── EvidenceDrawer.tsx       # Finding evidence panel
│   ├── MetricCard.tsx           # Dashboard KPI cards
│   ├── MoscaTimeline.tsx        # Mosca's Theorem timeline chart
│   ├── Layout.tsx               # Navigation + sidebar
│   └── dashboard/               # 13 specialized dashboard view components
└── api/
    └── client.ts                # Typed API client with auth headers
```

### CbomUploadModal — Scan Control Flow
```
User submits → handleSubmit() creates AbortController
    → registerScan() called on server
    → Rotating progress messages every 4s
    → If user clicks Stop Scan:
        → abortController.abort() (kills fetch)
        → POST /scan/abort (kills server subprocess)
        → Temp dir cleaned
        → setLoading(false), show "Scan stopped by user"
    → If scan completes:
        → onSuccess(scan_id) called
        → Modal closes, dashboard refreshes
```

---

## Scanner Engine Architecture

### Python Static Scanner
```
scanners/static/
├── main.py              # Entry point, file discovery, language dispatch
├── sanitization.py      # Input sanitization for filenames + content
├── languages/
│   ├── python.py        # Python AST + ast module analysis
│   ├── java.py          # Java regex + import analysis
│   ├── go.py            # Go crypto/tls, crypto/rsa imports
│   ├── javascript.py    # Node.js crypto module, WebCrypto API
│   ├── typescript.py    # TypeScript + ts-morph call analysis
│   ├── c_cpp.py         # OpenSSL, mbedTLS, WolfSSL API calls
│   ├── rust.py          # ring, rustls, openssl crate detection
│   └── ruby.py          # OpenSSL::Cipher, Digest analysis
└── output.py            # CycloneDX 1.6 CBOM serializer
```

### Network Scanner
```
scanners/network/
├── main.py              # Entry point + target validation
├── target_validation.py # SSRF guard, private IP block, DNS validation
└── plugins/
    ├── tls.py           # SSLyze TLS scan + certificate analysis
    └── cipher_suite.py  # Weak cipher detection + grading
```

### Algorithm Risk Classification
```json
{
  "algorithm_risk": {
    "RSA": { "min_safe_key_bits": 4096, "quantum_vulnerable": true, "replacement": "ML-KEM" },
    "ECDSA": { "quantum_vulnerable": true, "replacement": "ML-DSA" },
    "AES-128-CBC": { "quantum_vulnerable": false, "grover_weakened": true },
    "ML-KEM": { "quantum_safe": true, "fips": "203" },
    "ML-DSA": { "quantum_safe": true, "fips": "204" }
  }
}
```

---

## Data Model

### Core Tables (Neon PostgreSQL)

```sql
-- scans: one row per discovery session
CREATE TABLE scans (
  id           TEXT PRIMARY KEY,       -- uploadSessionId
  tenant_id    TEXT NOT NULL,          -- row-level isolation
  scan_label   TEXT,
  target_name  TEXT,
  status       TEXT,
  policy_profile_id TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- findings: one row per discovered cryptographic usage
CREATE TABLE findings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id      TEXT REFERENCES scans(id),
  tenant_id    TEXT NOT NULL,
  algorithm    TEXT NOT NULL,
  key_size     INTEGER,
  mode         TEXT,
  file_path    TEXT,
  line_number  INTEGER,
  severity     TEXT,                   -- CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL
  mosca_status TEXT,                   -- CRITICAL_URGENT / AT_RISK / WATCH / SAFE
  pqc_ready    BOOLEAN,
  library      TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- remediations: four-eyes approval workflow
CREATE TABLE remediations (
  id           UUID PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  finding_id   UUID REFERENCES findings(id),
  state        TEXT,                   -- PROPOSED / REVIEWED / APPROVED / APPLIED / VERIFIED
  proposer     JSONB,                  -- { userId, role }
  reviewer     JSONB,
  approver     JSONB,
  patch_diff   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- audit_log: immutable event log
CREATE TABLE audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT,
  actor_id     TEXT,
  action       TEXT NOT NULL,
  resource     TEXT,
  details      JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

## Security Architecture

See [SECURITY.md](../SECURITY.md) for the full security policy.

### Defense-in-Depth Layers

```
Layer 1: Network      → TLS 1.3, HSTS, CORS whitelist
Layer 2: Auth         → JWT RS256, bcrypt, rate limiting
Layer 3: Authorization→ RBAC roles, tenant isolation, 404 sentinel
Layer 4: Input        → SSRF guard, archive guard, git URL sanitization
Layer 5: Process      → Subprocess isolation, SIGKILL abort, temp dir cleanup
Layer 6: Container    → read-only FS, cap_drop ALL, seccomp, non-root USER
Layer 7: Database     → Parameterized queries, row-level tenant scoping
Layer 8: Audit        → Every scan, auth, access logged to audit_log
```

---

## Deployment Architecture

### Docker Compose (Development/Demo)

```yaml
services:
  backend:
    image: ecdat-backend (node:alpine @sha256 pinned)
    security_opt: [no-new-privileges:true, seccomp:custom-profile]
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    read_only: true
    privileged: false
    pids_limit: 200
    
  frontend:
    image: ecdat-frontend (nginx:alpine @sha256 pinned)
    USER: nginx
    read_only: true
```

### Cloud Production (Recommended)
```
Internet
   │
   ▼
Vercel CDN ──── React SPA (static)
   │
   ▼ API calls
Railway / Cloud Run ──── Express Backend ──── Neon PostgreSQL
                              │
                              └──────────────── Redis (sessions)
```

### Scaling Strategy (Phase 2)
```
Load Balancer (AWS ALB / Nginx)
       │
  ┌────┴────┐
  │         │
Node.js   Node.js      ← Stateless API nodes (Redis sessions)
  │         │
  └────┬────┘
       │
  BullMQ Job Queue      ← Long-running scans
       │
  ┌────┴────┐
  │         │
Scan     Scan           ← Isolated Python scanner workers
Worker   Worker
```
