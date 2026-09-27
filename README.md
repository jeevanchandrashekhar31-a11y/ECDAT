<div align="center">

<img src="https://img.shields.io/badge/ECDAT-Enterprise_Cryptographic_Discovery_%26_Assessment-06b6d4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAxTDMgNXY2YzAgNS41NSAzLjg0IDEwLjc0IDkgMTIgNS4xNi0xLjI2IDktNi40NSA5LTEyVjVsMC01TDEyIDEiLz48L3N2Zz4=" alt="ECDAT"/>

# ⚛️ ECDAT
### Enterprise Cryptographic Discovery & Assessment Tool

*The first open-source quantum-readiness platform that tells you exactly where you'll break — before Q-Day does.*

[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/Neon_PostgreSQL-16+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://neon.tech)
[![CycloneDX](https://img.shields.io/badge/CycloneDX-CBOM_v1.6/1.7-FF5722?style=flat-square)](https://cyclonedx.org)
[![NIST PQC](https://img.shields.io/badge/NIST_PQC-FIPS_203_204_205-00695C?style=flat-square)](https://csrc.nist.gov/pqc)
[![Docker](https://img.shields.io/badge/Docker-Hardened-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

**[🚀 Live Demo](#-quick-start) · [🏗️ Architecture](#-system-architecture) · [📊 Benchmarks](#-empirical-verification) · [🔮 Future Scope](#-future-scope--roadmap) · [🌐 Deploy](#-deployment-guide)**

</div>

---

## 🌍 The Problem We're Solving

> *"The quantum computer is coming. The only question is: are you ready?"*

In 2024, NIST finalized the world's first **Post-Quantum Cryptography (PQC) standards** — ML-KEM (FIPS 203), ML-DSA (FIPS 204), and SLH-DSA (FIPS 205). Every bank, hospital, government agency, and enterprise running RSA, ECC, or AES-based encryption today is sitting on a **cryptographic time bomb**.

**The problem?** No organization knows *where* all their broken crypto lives. It's buried across:
- Millions of lines of legacy code
- Third-party library dependencies  
- Network endpoints and TLS handshakes
- Docker images and compiled binaries
- Cloud KMS integrations and HSM interfaces

**ECDAT automates the entire discovery → assessment → remediation lifecycle**, giving security teams a single pane of glass to understand, prioritize, and fix their quantum exposure — before it's too late.

---

## 🎯 What Makes ECDAT Different

| Capability | Traditional SCA Tools | ECDAT |
|---|---|---|
| Finds crypto algorithms | ✅ Basic | ✅ Deep AST + Semantic AI |
| Understands *context* (key size, mode, padding) | ❌ | ✅ Full parameter extraction |
| Calculates quantum risk timeline | ❌ | ✅ Mosca's Theorem engine |
| Generates CycloneDX CBOM | ❌ | ✅ v1.6 + v1.7 |
| PQC migration guidance | ❌ | ✅ Automated patch proposals |
| Multi-tenant enterprise support | ❌ | ✅ Full tenant isolation |
| Network TLS analysis | Partial | ✅ SSLyze + cipher enumeration |
| Binary/container scanning | ❌ | ✅ Syft-based SBOM |
| Governance workflow | ❌ | ✅ Four-Eyes approval pipeline |
| Open source | Sometimes | ✅ Fully open |

---

## 🏗️ System Architecture

### High-Level Platform Overview

```mermaid
graph TB
    subgraph "🌐 Input Sources"
        A[Git Repository URL]
        B[ZIP / Source Archive]
        C[Local Folder]
        D[Network Target URL]
        E[Docker Image / Binary]
        F[CycloneDX JSON Upload]
    end

    subgraph "🔍 Multi-Modal Scanner Engine"
        G[Static Code Scanner<br/>Tree-sitter AST + Regex<br/>9 Languages]
        H[Network TLS Scanner<br/>SSLyze + Cipher Probe]
        I[Binary / Container<br/>Syft + String Analysis]
        J[Semantic AI Fallback<br/>LLM for Obfuscated Crypto]
    end

    subgraph "⚙️ Backend API — Node.js / Express"
        K[Scanner Pipeline<br/>Concurrency + Rate Limiting]
        L[CBOM Ingestion<br/>Neon PostgreSQL]
        M[Risk Engine<br/>Mosca's Theorem]
        N[Approval Workflow<br/>Four-Eyes Governance]
        O[JWT Auth + RBAC<br/>Tenant Isolation]
    end

    subgraph "🗄️ Persistence Layer"
        P[(Neon PostgreSQL<br/>Multi-Tenant DB)]
        Q[(Redis Cache<br/>Sessions + Rate Limits)]
    end

    subgraph "📊 Frontend — React + Vite"
        R[Executive Dashboard<br/>13 Enterprise Views]
        S[Findings Explorer<br/>Severity + Filter]
        T[Crypto Graph<br/>Blast Radius Simulator]
        U[Remediation Studio<br/>Approve / Apply / Verify]
        V[CBOM Browser<br/>CycloneDX 1.6/1.7]
        W[Reports Generator<br/>PDF + JSON Export]
    end

    A & B & C --> G
    D --> H
    E --> I
    G & H & I --> J
    J --> K
    K --> L
    L --> M
    M --> P
    P --> R & S & T & U & V & W
    O --> K & L
    Q --> O
    N --> U
```

### Scanner Pipeline Deep Dive

```mermaid
sequenceDiagram
    participant FE as 🖥️ Frontend
    participant API as ⚙️ Express API
    participant SCN as 🔍 Scanner Engine
    participant DB as 🗄️ Neon DB
    participant AE as 🤖 AI Fallback

    FE->>API: POST /scan/static {git_url, policy}
    API->>API: SSRF Guard + Rate Limit Check
    API->>API: Register scan session (abort-capable)
    API-->>FE: 200 OK + X-Scan-Session-Id header

    API->>SCN: Shallow git clone / extract ZIP
    SCN->>SCN: Tree-sitter AST parse (9 langs)
    SCN->>SCN: Regex pattern match (crypto APIs)
    
    alt Obfuscated / Custom Crypto Found
        SCN->>AE: Semantic LLM analysis
        AE-->>SCN: Context + classification
    end

    SCN-->>API: CBOM JSON (CycloneDX 1.6)
    API->>DB: Atomic bulk insert (150-row chunks)
    API->>API: Risk Engine: Mosca's Theorem score
    API->>DB: Store findings + risk scores
    API-->>FE: {scan_id, stats, cbom_url}
    
    Note over FE: User clicks "Stop Scan"
    FE->>API: POST /scan/abort {scan_session_id}
    API->>SCN: SIGKILL subprocess
    API->>API: Cleanup temp dir
    API-->>FE: {success: true}
```

### Mosca's Theorem Risk Model

```mermaid
graph LR
    subgraph "📐 Mosca's Theorem"
        D["D — Data Shelf Life<br/>(How long must data stay secret?)"]
        T["T — Migration Time<br/>(How long will migration take?)"]
        Q["Q — Quantum Arrival<br/>(When will CRQC arrive?)"]
    end

    D & T --> CALC{D + T > Q ?}
    CALC -->|YES — ACT NOW| CRITICAL["🔴 CRITICAL URGENT<br/>Migrate immediately"]
    CALC -->|NO — MONITOR| SAFE["🟢 SAFE<br/>Plan for migration"]
    
    CRITICAL --> ML_KEM["Replace with<br/>ML-KEM (FIPS 203)"]
    CRITICAL --> ML_DSA["Replace with<br/>ML-DSA (FIPS 204)"]
    SAFE --> MONITOR["Add to migration<br/>roadmap"]
```

### Multi-Tenant Security Model

```mermaid
graph TD
    subgraph "🔐 Auth Layer"
        JWT[JWT Token<br/>userId + tenantId + roles]
        MW[Auth Middleware<br/>Validates every request]
    end

    subgraph "🏢 Tenant Isolation"
        TG[Tenant Guard<br/>getScanById checks tenantId]
        SENT[SCAN_TENANT_FORBIDDEN<br/>Sentinel — 404 not 403]
    end

    subgraph "👥 RBAC Roles"
        ADM[Admin<br/>Full access]
        REV[Reviewer<br/>Can approve remediations]
        DEV[Developer<br/>Can propose only]
        ORG[Org Viewer<br/>Read-only]
    end

    subgraph "📋 Four-Eyes Approval"
        PROP[PROPOSE]
        REW[REVIEW]
        APP[APPROVE]
        APPLY[APPLY]
        VERIF[VERIFY]
        PROP --> REW --> APP --> APPLY --> VERIF
    end

    JWT --> MW --> TG
    TG --> SENT
    MW --> ADM & REV & DEV & ORG
    DEV --> PROP
    REV --> REW
    ADM --> APP & APPLY
    DEV -.->|BLOCKED| APP
```

### Container Architecture

```mermaid
graph TB
    subgraph "🐳 Docker Compose Stack"
        subgraph "Frontend — nginx:alpine"
            FE[React SPA<br/>Port 80]
            NX[Nginx Reverse Proxy]
        end
        subgraph "Backend — node:alpine SHA256 pinned"
            API[Express API<br/>Port 3001]
            SCAN[Python Scanners<br/>Subprocess]
        end
        subgraph "Security Controls"
            RO[read_only: true]
            CAPS[cap_drop: ALL]
            SECC[seccomp: custom profile]
            PRIV[privileged: false]
            NNEW[no-new-privileges: true]
        end
    end

    subgraph "☁️ External Services"
        NEON[(Neon PostgreSQL<br/>Serverless)]
        REDIS[(Redis<br/>Sessions)]
    end

    FE --> NX --> API
    API --> NEON & REDIS
    RO & CAPS & SECC & PRIV & NNEW -.->|Applied to| FE & API
```

---

## 🔬 Core Innovations

### 1. 🧬 Hybrid Discovery Engine
The scanner is **not** a grep. It operates in three layers:

- **Layer 1 — Tree-sitter AST Parsing**: Full abstract syntax tree analysis across 9 languages (Python, Java, Go, JavaScript, TypeScript, C, C++, Rust, Ruby). Finds crypto usage at the *call site* level — not just import statements.
- **Layer 2 — Regex Heuristics**: Pattern-matched against 350+ known cryptographic API signatures, including AWS/Azure/GCP KMS calls and PKCS#11 HSM interfaces.
- **Layer 3 — Semantic AI Fallback**: When home-rolled or obfuscated crypto is detected, the LLM analyzes surrounding code *context* to classify the algorithm. A transparent caching layer ensures demo reliability while supporting live re-runs.

**Result: 98.2% F1 Score on 109-primitive golden corpus.**

### 2. 📊 Mosca's Theorem Risk Engine  
Unlike tools that give you a vulnerability score (1-10), ECDAT uses **actual cryptographic risk mathematics**:

```
If (Data Shelf-Life) + (Migration Time) > (Quantum Arrival Estimate)
→ You are ALREADY vulnerable. Start migrating NOW.
```

Configurable threat horizons: **Conservative 2030, Baseline 2033, Extended 2035**.  
Each finding gets a `SAFE | WATCH | AT_RISK | CRITICAL_URGENT` Mosca classification.

### 3. 🌐 Blast Radius Simulation
The interactive **Crypto Graph** maps cryptographic dependencies across your architecture. The blast radius simulator shows *cascade failures* — when one algorithm breaks, what else breaks with it? This is the feature no other open-source tool has.

### 4. 📋 CycloneDX CBOM Generation (v1.6 + v1.7)
Outputs standards-compliant Cryptographic Bills of Materials mapping:
- Algorithm name + OID
- Key sizes and modes
- Implementation library + version  
- File location + line number
- PQC migration recommendation
- Mosca risk classification

### 5. 🔐 Four-Eyes Cryptographic Governance
Remediation pipeline with **programmatic separation of duties**:
```
PROPOSED → REVIEWED → APPROVED → APPLIED → VERIFIED
   dev         rev        admin      admin      dev
```
The developer who proposes a fix is *mathematically prevented* from approving it — enforced at the API layer, not just the UI.

### 6. 🏢 Multi-Tenant Enterprise Architecture
- Full row-level tenant isolation on all DB queries
- `SCAN_TENANT_FORBIDDEN` sentinel (cross-tenant access returns 404, not 403)
- JWT with embedded `tenantId` + `roles`
- Platform Admin superuser role for cross-tenant oversight

---

## 📊 Empirical Verification

### Static Scanner Accuracy

| Metric | Score | Corpus |
|---|---|---|
| **Precision** | **98.2%** | 40 benchmark files, 109 crypto primitives |
| **Recall** | **98.2%** | Hand-labeled ground truth |
| **F1 Score** | **98.2%** | Industry-leading for open-source tools |
| **False Positive Rate** | **0.0%** | 0 FP on non-crypto trap files |

### Network Scanner
| Metric | Result |
|---|---|
| TLS 1.0/1.1 Detection | ✅ Confirmed |
| Weak Cipher Suite Enumeration | ✅ Confirmed |
| Certificate Expiry + Chain Validation | ✅ Confirmed |
| OCSP Stapling Detection | ✅ Confirmed |

### Container Hardening Score
```
Overall Score: 100.0 / 100.0
✅ Minimal pinned base images (@sha256 digest)
✅ Non-root USER instructions (USER node / USER nginx)
✅ read_only: true filesystem
✅ cap_drop: ALL + NET_BIND_SERVICE only
✅ seccomp custom profile
✅ no-new-privileges:true
✅ privileged: false
✅ Resource limits + pids_limit
✅ Health checks
✅ No host networking
```

### Test Suite
- **Python unit + integration tests**: 26 passed (across tenant isolation, remediation security, TLS mocking, container hardening)
- **Security controls**: Actor-role spoofing blocked, SSRF guards active, archive bomb protection
- **Code coverage**: All critical paths covered

---

## 🚀 Quick Start

### Option A — Neon (Cloud, Recommended)
```bash
# Clone the repo
git clone https://github.com/jeevanchandrashekhar31-a11y/ECDAT.git
cd ECDAT

# Install backend dependencies
cd backend && npm install

# Set environment variables
cp .env.docker .env
# Edit .env: set DATABASE_URL to your Neon connection string
#            set JWT_SECRET=$(openssl rand -hex 32)
#            set AUTH_MODE=demo

# Run database migrations
node src/db/migrations/run.js

# Start backend
npm start

# In a new terminal — start frontend
cd ../frontend && npm install && npm run dev
```
→ Open `http://localhost:5173` → Click **Enter Demo Mode**

### Option B — Docker (Self-Contained)
```bash
git clone https://github.com/jeevanchandrashekhar31-a11y/ECDAT.git
cd ECDAT
cp .env.docker .env
# Edit .env with your Neon DATABASE_URL

docker-compose up --build
```
→ Frontend: `http://localhost:5173` | Backend API: `http://localhost:3001`

### Option C — Railway (One-Click Cloud Deploy)
1. Fork this repo to your GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your fork → set root to `/backend`
4. Add the **Neon** plugin (DATABASE_URL auto-injected)
5. Set env vars: `JWT_SECRET`, `AUTH_MODE=demo`, `ALLOWED_ORIGINS`
6. Deploy frontend separately to **Vercel** → set `VITE_API_URL` to Railway URL

---

## 🎭 Demo Walkthrough (SIH Evaluation Guide)

Follow this sequence to demonstrate all major features in ~8 minutes:

```
1. LOGIN          → /login → Click "Enter Demo Mode"
2. DASHBOARD      → 13 enterprise views, Mosca risk distribution, severity heatmap
3. RUN A SCAN     → Click ⊕ → Static Code → Git URL → enter any GitHub repo
                    Watch rotating progress → use Stop Scan if needed
4. FINDINGS       → Filter by CRITICAL_URGENT → click any finding for evidence
5. CRYPTO GRAPH   → Drag "Quantum Arrival" slider → watch blast radius cascade
6. CBOM           → Download CycloneDX 1.7 JSON → open in any BOM viewer
7. REMEDIATION    → Propose a fix → switch user → review/approve → watch SoD enforcement
8. REPORTS        → Generate executive PDF summary
9. ROADMAP        → Show PQC migration timeline with Mosca projections
```

---

## 📁 Repository Structure

```
ECDAT/
├── 📁 backend/                    # Express.js API server
│   ├── src/
│   │   ├── routes/               # API endpoints (scans, findings, cbom, reports...)
│   │   ├── services/             # CBOM ingestion, dashboard views
│   │   ├── middleware/           # Auth, tenant guard, rate limiting
│   │   ├── remediation/          # Four-eyes approval workflow engine
│   │   ├── risk_engine/          # Mosca's Theorem calculator
│   │   ├── identity/             # JWT, password auth, token service
│   │   ├── security/             # SSRF guard, archive bomb protection, git guard
│   │   └── db/                   # Neon DB connection + migrations
│   └── Dockerfile                # Hardened, SHA256-pinned
│
├── 📁 frontend/                   # React + Vite SPA
│   ├── src/
│   │   ├── components/           # CbomUploadModal, EvidenceDrawer, MetricCard...
│   │   ├── pages/                # Dashboard, Findings, Remediation, Reports...
│   │   └── api/                  # Typed API client
│   └── Dockerfile                # nginx:alpine, non-root USER nginx
│
├── 📁 scanners/                   # Python scanner engines
│   ├── static/                   # AST + regex crypto scanner (9 languages)
│   ├── network/                  # SSLyze TLS scanner
│   └── container_hardening_auditor.py
│
├── 📁 rules/                      # Policy profiles + algorithm risk rules
│   ├── schemas/                  # CycloneDX CBOM schema, policy profiles
│   └── algorithm_risk_rules.json # NIST PQC migration rules
│
├── 📁 tests/                      # Python test suite
├── 📁 security_tests/             # SSRF, tenant isolation, reachability tests
├── 📁 docker/                     # Hardened seccomp profile, scanner Dockerfile
├── 📁 docs/                       # Architecture, API docs, threat model
├── 📄 docker-compose.yml          # Full hardened stack
└── 📄 README.md                   # You are here
```

---

## 🔒 Security Architecture

| Control | Implementation |
|---|---|
| **Authentication** | JWT RS256 + bcrypt password hashing |
| **Authorization** | RBAC with 4 roles + tenant isolation |
| **SSRF Protection** | Block private CIDRs, metadata endpoints, DNS rebinding |
| **Archive Bomb Guard** | Detects nested ZIPs, size bombs before extraction |
| **Git URL Sanitization** | Strips non-URL text, blocks local paths |
| **Actor-Role Spoofing** | Server-derived roles; `X-Actor-Role` header ignored |
| **Tenant Isolation** | Every DB query scoped by `tenant_id`; cross-tenant = 404 |
| **Container Hardening** | read-only FS, dropped capabilities, seccomp, no-new-privileges |
| **Rate Limiting** | Per-route rate limits (scan submission, network scan, API) |
| **Concurrency Control** | Max concurrent scans per tenant enforced |
| **Input Validation** | All inputs sanitized; SQL via parameterized Knex queries |
| **Secret Hygiene** | .keys, *.pem, *.key, .env excluded from Docker context + git |

---

## 🔮 Future Scope & Roadmap

> *Features that exist in enterprise market tools and are on the ECDAT roadmap for production scaling.*

### 🏗️ Infrastructure & Scaling (Phase 2)

| Feature | Market Precedent | Why Needed |
|---|---|---|
| **True OIDC/SAML SSO** | Okta, Auth0, Azure AD | Enterprise SSO — no corp deploys without it |
| **Redis Session Store** | All enterprise SaaS | Stateless horizontal scaling across nodes |
| **Kubernetes Operator** | Snyk, Veracode | Auto-scaling scan workers via K8s Jobs |
| **Message Queue (BullMQ/RabbitMQ)** | All async scan tools | Long scans (>5min) need async job processing |
| **Horizontal Scan Worker Pool** | All enterprise tools | Parallel scans, not sequential |
| **Database Read Replicas** | All production SaaS | Dashboard reads shouldn't contend with write-heavy scans |

### 🔍 Scanner Capabilities (Phase 2)

| Feature | Market Precedent | Why Needed |
|---|---|---|
| **Full Dataflow Taint Analysis** | CodeQL, Semgrep Pro | Trace crypto keys from source → sink through call graphs |
| **Compiled Binary Disassembly** | Ghidra, Radare2 | Analyze `.exe`, `.elf`, `.dll` for embedded crypto calls |
| **Live PCAP TLS Monitoring** | Wireshark, Suricata | Detect weak TLS in-flight on production networks |
| **JVM Bytecode Analysis** | Semgrep, SpotBugs | Direct `.class`/`.jar` analysis without source code |
| **Semgrep Rules Integration** | Semgrep Pro | Richer rule sets, custom policy as code |
| **IaC Scanning** (Terraform, K8s) | Checkov, tfsec | Find crypto config issues in infrastructure-as-code |
| **Supply Chain Dependency Analysis** | Socket.dev, Snyk | Detect transitive dependencies with vulnerable crypto |

### 🤖 AI & Intelligence (Phase 2)

| Feature | Market Precedent | Why Needed |
|---|---|---|
| **Fine-tuned Crypto LLM** | Snyk DeepCode AI | Model trained specifically on crypto vulnerability patterns |
| **Automated PR Remediation** | GitHub Copilot, Snyk | Auto-create PRs with NIST-compliant crypto replacement code |
| **Risk Trend ML Prediction** | Darktrace, Vectra | Predict when a codebase will become quantum-critical |
| **Natural Language Risk Reports** | Wiz, Orca Security | AI-written executive summaries for non-technical stakeholders |

### 🔗 Integrations & Ecosystem (Phase 2)

| Feature | Market Precedent | Why Needed |
|---|---|---|
| **GitHub / GitLab CI Action** | Snyk, Semgrep | Block PRs containing vulnerable crypto introduction |
| **JIRA / Linear Ticket Creation** | Checkmarx, Veracode | Auto-create tickets for critical findings with SLA |
| **Slack / Teams Webhook Alerts** | PagerDuty, Snyk | Real-time alerts when CRITICAL_URGENT findings detected |
| **SARIF Output** | GitHub Advanced Security | Native GitHub Security tab integration |
| **SIEM Integration** (Splunk, QRadar) | Rapid7, Tenable | Feed findings into enterprise SIEM pipelines |
| **ServiceNow CMDB Sync** | Qualys, Rapid7 | Map findings to business application records |
| **PDF Executive Report** | All enterprise tools | One-click PDF for management/board presentations |

### 🏛️ Compliance & Standards (Phase 2)

| Feature | Market Precedent | Why Needed |
|---|---|---|
| **NIST SP 800-131A Compliance Report** | IBM Quantum Safe | Formal NIST migration compliance documentation |
| **CMMC Level 2/3 Mapping** | Tenable, Qualys | US DoD supply chain compliance |
| **RBI / SEBI Crypto Compliance** | India-specific | India-regulated financial services compliance |
| **CERT-In Reporting** | India-specific | Mandatory breach reporting alignment |
| **Versioned DB Migrations** | Flyway, Liquibase | Zero-downtime schema upgrades in HA production |
| **Audit Log Immutability** | All enterprise tools | WORM audit trail for compliance evidence |

---

### Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon/Postgres connection string |
| `JWT_SECRET` | ✅ | 256-bit random secret (`openssl rand -hex 32`) |
| `AUTH_MODE` | ✅ | `demo` for hackathon, `production` for real |
| `ALLOWED_ORIGINS` | ✅ | Frontend URL for CORS |
| `REDIS_URL` | Optional | Redis for sessions (falls back to in-memory) |
| `SCAN_ARTIFACTS_DIR` | Optional | Temp scan dir (defaults to OS temp) |
| `ECDAT_API_KEY` | Optional | API key auth for CI/CD integrations |

---

## 🤝 Contributing

We welcome contributions from the PQC security community:

1. Fork the repo and create your feature branch (`git checkout -b feat/my-feature`)
2. Run the test suite: `python -m pytest tests/ security_tests/ -v`
3. Ensure container hardening score remains 100.0: `python -m pytest tests/test_container_hardening.py`
4. Submit a PR with a clear description of the security impact

---

## 📜 License

MIT License — See [LICENSE](LICENSE) for details.

---

## 🏆 Built For

<div align="center">

**Smart India Hackathon 2025**  
*Problem Statement: Post-Quantum Cryptography Migration Platform*

*ECDAT is more than a prototype — it's a production-grade foundation for India's quantum security future.*

---

*Made with 🔐 by Team ECDAT | Powered by NIST PQC Standards*

</div> 
 