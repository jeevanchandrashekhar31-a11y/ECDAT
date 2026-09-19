# ECDAT Architecture & Technical Specification (Phase 25.1)

## 1. Architecture Overview

### 1.1 Mission & Architectural Vision
The **Enterprise Cryptographic Discovery and Assessment Tool (ECDAT)** is a comprehensive, multi-modal cryptographic posture management and post-quantum readiness platform. ECDAT automates the discovery, classification, risk scoring, regulatory validation, and remediation of cryptographic assets across source code repositories, compiled binaries, container images, virtual filesystems, live network endpoints, and active OS kernel execution.

The platform provides organizations with an authoritative **Cryptographic Bill of Materials (CBOM)** compliant with CycloneDX 1.6 and SARIF 2.1.0 standards, calculating post-quantum migration urgency via **Mosca's Theorem** and enforcing deterministic security policies.

### 1.2 System Architecture Diagram
The architecture is structured into four logically isolated, horizontally scalable tiers:

```mermaid
graph TB
    subgraph Tier 1: Multi-Modal Discovery & Runtime Instrumentation
        STATIC[Static Code Scanner<br/>Tree-Sitter AST / Regex / Groq LLM]
        NET[Network Scanner<br/>TLS / Cipher Suites / X.509 / SSH]
        BIN[Binary & Container Scanner<br/>Syft Runner / ELF / Mach-O / PE]
        FS[Filesystem & Archive Scanner<br/>Tar / Zip / CPIO / ISO / S3]
        PCAP[PCAP Traffic Analyzer<br/>Passive Packet Cryptanalysis]
        EBPF[Isolated eBPF Runtime Agent<br/>Kernel Uprobes / OpenSSL / BoringSSL]
    end

    subgraph Tier 2: Ingestion, Control Plane & Security Middleware
        GATEWAY[API Gateway & Rate Limiter<br/>Express 5 / Helmet / CORS HTTPS]
        AUTH[Auth & Tenancy Middleware<br/>Constant-Time Auth / Context Derivation]
        VAL[Schema & Sanitization Engine<br/>CycloneDX 1.6 / Key Redaction / Anti-Pollution]
        PROD_GUARD[Production Config Guard<br/>Fail-Fast Startup Invariants]
    end

    subgraph Tier 3: Core Analytical & Governance Engines
        CORR[Correlation Engine<br/>Multi-Source Evidence Fusion]
        GRAPH[Cryptographic Graph Service<br/>Asset Relationships & Blast Radius]
        RISK[Deterministic Risk Engine<br/>Mosca Theorem & Multi-Factor Scoring]
        POLICY[Compliance Policy Engine<br/>NIST, BSI, PCI-DSS, CNSA 2.0, FIPS]
        REMED[Remediation & Patch Engine<br/>AST Rewriting / Staged Rollouts]
    end

    subgraph Tier 4: Presentation, SIEM Dispatch & Continuous Export
        UI[React 18 Dashboard<br/>Vite / Cytoscape Graph / Mosca Visualizer]
        SIEM[SIEM Event Dispatcher<br/>CEF / Syslog / Splunk HEC / Elasticsearch]
        EXPORT[Export Engine<br/>CycloneDX 1.6 / SPDX 2.3 / SARIF / PDF / CSV]
    end

    %% Flow connections
    STATIC -->|CycloneDX 1.6 CBOM| GATEWAY
    NET -->|CycloneDX 1.6 CBOM| GATEWAY
    BIN -->|CycloneDX 1.6 CBOM| GATEWAY
    FS -->|CycloneDX 1.6 CBOM| GATEWAY
    PCAP -->|CycloneDX 1.6 CBOM| GATEWAY
    EBPF -.->|mTLS Redacted Telemetry| GATEWAY

    GATEWAY --> AUTH
    AUTH --> VAL
    VAL --> PROD_GUARD
    PROD_GUARD --> CORR

    CORR --> GRAPH
    CORR --> RISK
    RISK --> POLICY
    POLICY --> REMED

    GRAPH --> UI
    RISK --> UI
    REMED --> UI
    POLICY --> SIEM
    CORR --> EXPORT
```

### 1.3 The Four Architectural Tiers
1. **Tier 1: Multi-Modal Discovery & Runtime Instrumentation Tier**:
   - Autonomous, distributed scanning agents operating in CI/CD pipelines, container registries, build nodes, or host kernels.
   - Emits standardized, cryptographically sanitized artifacts (CycloneDX 1.6 CBOMs) without requiring persistent control plane access.
2. **Tier 2: Ingestion, Control Plane & Security Middleware Tier**:
   - Secure REST API (`backend/src/server.js`, `backend/src/app.js`) built on Express 5.
   - Enforces strict input validation, prototype pollution defense, payload size limits (10MB), double-submit CSRF tokens, constant-time API key verification, and secure-by-default production guards.
3. **Tier 3: Core Analytical & Governance Engines**:
   - **Correlation Engine**: Merges multi-source evidence (static code + binary symbols + runtime network handshakes).
   - **Crypto Graph Service**: Multi-tier dependency modeling and blast radius propagation.
   - **Deterministic Risk Engine**: Mathematical Mosca calculus, cryptographic agility evaluation, and rule-based algorithm lifecycle matching.
   - **Remediation Subsystem**: Context-aware code transformations, unified diff generation, and multi-stage approval workflows.
4. **Tier 4: Presentation, SIEM Dispatch & Continuous Export**:
   - Responsive, dark-mode React 18 single-page application (`frontend/`).
   - Enterprise SIEM integrations dispatching real-time security alerts over HTTPS/Syslog.
   - Full supply-chain provenance exports with Ed25519 digital signatures.

---

## 2. End-to-End Data Flow

The lifecycle of cryptographic discovery, analysis, and dispatch traverses seven deterministic stages:

```mermaid
sequenceDiagram
    autonumber
    participant Target as Target System (Code / Bin / Net / Kernel)
    participant Scanner as Discovery Scanner (Python)
    participant API as Ingestion API & Guards (Node.js)
    participant Storage as Encrypted Storage (Postgres 16)
    participant Engines as Risk & Policy Engines
    participant Graph as Crypto Graph Service
    participant Dispatch as SIEM / SSE / Web UI

    Target->>Scanner: Raw Inspection (AST parsing, socket probe, uprobes)
    Scanner->>Scanner: Sanitize Private Keys & Hash Tokens
    Scanner->>Scanner: Build CycloneDX 1.6 CBOM
    Scanner->>API: POST /api/v1/cboms (with API Key / mTLS)
    
    API->>API: Verify Auth & Double-Submit CSRF
    API->>API: Schema Validation & Prototype Pollution Defense
    API->>Storage: Store Encrypted CBOM (Field-Level AES-256)
    
    API->>Engines: Trigger Processing Pipeline
    Engines->>Engines: Match Rulesets (rules/algorithm_lifecycle.json)
    Engines->>Engines: Calculate Mosca Delta & Multi-Factor Risk
    Engines->>Engines: Evaluate Compliance Profiles (NIST / BSI / PCI / CNSA)
    
    Engines->>Graph: Ingest Entities (App -> Service -> Algo -> Data)
    Engines->>Storage: Persist Classified Findings & Explainability Trees
    
    Engines->>Dispatch: Push High/Critical Alerts to SIEM (CEF / Splunk)
    Storage->>Dispatch: Stream Real-time Updates via Server-Sent Events
    Dispatch->>Dispatch: Render Cytoscape Graph & Risk Cards in Web UI
```

### 2.1 Stage-by-Stage Breakdown
1. **Raw Discovery & In-Memory Sanitization**:
   - Scanners parse raw targets in memory.
   - Any private key block (`-----BEGIN PRIVATE KEY-----`) or high-entropy credential is immediately stripped by `scanners/static/sanitization.py` and replaced with an immutable SHA-256 fingerprint (`[REDACTED_SECRET SHA256:<hash>]`).
2. **Schema Ingestion & Transport Validation**:
   - Ingested via `POST /api/v1/cboms`.
   - `cbom_validation.js` checks JSON schema conformity, enforces a 10MB payload ceiling, and rejects malformed objects.
3. **Tenant Context & Storage**:
   - Authoritative tenant ID is bound from authenticated security context (`tenant_isolation.js`).
   - Data is stored in PostgreSQL using Knex with parameterized queries and encrypted fields.
4. **Deterministic Analysis**:
   - Risk and policy engines evaluate findings without network calls or external dependencies, ensuring deterministic and verifiable results for identical input sets.
5. **Graph Correlation & Blast Radius Calculation**:
   - Cryptographic findings are mapped into a multi-tier dependency graph connecting software assets to underlying data sensitivity tiers.
6. **Dispatch & Notification**:
   - Real-time events broadcast to SIEM targets (Splunk, Elastic, Syslog) and browser clients via Server-Sent Events (`/api/v1/events/stream`).

---

## 3. Trust Boundaries & Threat Model

ECDAT defines five discrete trust boundaries to prevent privilege escalation, data leakage, and supply-chain tampering:

```mermaid
graph LR
    subgraph TB1 [Trust Boundary 1: Client to API Gateway]
        direction TB
        Browser[Web Browser / External User]
        API_GW[Express 5 API Gateway]
        Browser -->|Untrusted HTTPS Requests| API_GW
    end

    subgraph TB2 [Trust Boundary 2: Scanner to Target Repositories]
        direction TB
        UntrustedRepo[Untrusted Third-Party Code / Binaries]
        SandboxedScanner[Sandboxed Discovery Scanners]
        UntrustedRepo -->|Hostile Inputs / Malformed Files| SandboxedScanner
    end

    subgraph TB3 [Trust Boundary 3: Multi-Tenant Data Isolation]
        direction TB
        TenantA[Tenant A Security Principal]
        TenantB[Tenant B Security Principal]
        DataLayer[Isolated PostgreSQL Data Partition]
        TenantA -->|Authoritative Context| DataLayer
        TenantB -.->|Spoofed Request Forbidden| DataLayer
    end

    subgraph TB4 [Trust Boundary 4: Backend to Persistence Tier]
        direction TB
        BackendCore[Control Plane Backend]
        PostgresDB[(Hardened PostgreSQL 16 Cluster)]
        BackendCore -->|TLS 1.3 verify-full / Knex Queries| PostgresDB
    end

    subgraph TB5 [Trust Boundary 5: Kernel eBPF to Userspace]
        direction TB
        ObservedApp[Observed Application Container]
        KernelSpace[Host Linux Kernel / Uprobes]
        EBPF_Agent[Runtime eBPF Agent]
        ControlPlane[ECDAT Control Plane]
        ObservedApp -->|Monitored Execution| KernelSpace
        KernelSpace -->|Metadata-Only Ringbuffer| EBPF_Agent
        EBPF_Agent -->|mTLS Redacted Telemetry| ControlPlane
    end
```

### 3.1 Trust Boundary Matrix
| Boundary | Ingress Threat | Protective Controls | Residual Risk Mitigation |
| :--- | :--- | :--- | :--- |
| **TB1: Client $\rightarrow$ API Gateway** | Auth bypass, IDOR, XSS, CSRF, DoS, brute force | Constant-time API key verification, Helmet security headers, HTTPS-only CORS, double-submit cookie CSRF tokens, strict 10MB body limits | WAF integration, IP rate-limiting |
| **TB2: Target $\rightarrow$ Scanners** | Zip bombs, path traversal, parser memory corruption, command injection | Stream parsers, Syft subprocess sandboxing, canonical path normalization, non-root execution (`uid 10001`), timeouts | Read-only container root filesystems |
| **TB3: Tenant Isolation** | Cross-tenant data access, tenant ID spoofing | Authoritative security context derivation, client-supplied tenant ID rejection, row-level filtering, tenant-specific field encryption | Cryptographic separation via AES-256 keys |
| **TB4: Backend $\rightarrow$ Database** | SQL injection, man-in-the-middle, plaintext snooping | Parameterized Knex queries, TLS in transit (`DATABASE_SSL=true`, `sslmode=verify-full`), non-root `postgres` user | Dedicated database subnet, NetworkPolicies |
| **TB5: Kernel $\rightarrow$ Control Plane** | Host kernel exploit, eBPF agent compromise, memory snooping | Namespace segregation (`ecdat-runtime` vs `ecdat-control-plane`), bounded `CAP_BPF`+`CAP_PERFMON`, allowlisted probes only, metadata-only assertions | Control plane contains ZERO privileged pods |

---

## 4. Deployment Architecture

ECDAT supports containerized deployments across Docker Compose and enterprise Kubernetes (via standalone manifests or Helm).

### 4.1 Production Container Hardening
All production containers conform to the following baseline:
- **Minimal Base Images**: Multi-stage builds utilizing `node:20-alpine` and `python:3.12-alpine`.
- **Non-Root Execution**:
  - Backend: `uid 1000:gid 1000` (`ecdat`)
  - Frontend: `uid 101:gid 101` (`nginx`)
  - Scanner: `uid 10001:gid 10001` (`scanner`)
- **Read-Only Root Filesystems**: Containers run with `readOnlyRootFilesystem: true`. Writable operations are restricted to transient, memory-backed `emptyDir` volumes (`/tmp`, `/var/run`).
- **Dropped Linux Capabilities**: `securityContext.capabilities.drop: ["ALL"]`. No privileged mode or host networking in the control plane.
- **Seccomp Profile**: Default enforcement of `seccompProfile.type: RuntimeDefault`.

### 4.2 Kubernetes Cluster Architecture (`deploy/k8s/` & `deploy/helm/ecdat/`)
The Kubernetes deployment enforces a strict dual-namespace isolation model:

```mermaid
graph TD
    subgraph Namespace: ecdat-control-plane (Pod Security: Restricted)
        INGRESS[NGINX Ingress Controller<br/>TLS Termination / Cert-Manager]
        FRONTEND[ecdat-frontend Deployment<br/>Replicas: 2 / Port 8080 / Non-Root]
        BACKEND[ecdat-backend Deployment<br/>Replicas: 3 / Port 5000 / Non-Root]
        POSTGRES[(ecdat-postgres StatefulSet<br/>Volume: 20Gi PVC / Non-Root)]
        SCANNER_JOB[ecdat-scanner CronJob<br/>Batch Periodic Discovery]
    end

    subgraph Namespace: ecdat-runtime (Pod Security: Privileged / Isolated)
        EBPF_DS[ecdat-ebpf-agent DaemonSet<br/>HostPID / CAP_BPF / Uprobes]
    end

    INGRESS -->|HTTPS| FRONTEND
    INGRESS -->|/api/v1 HTTPS| BACKEND
    FRONTEND -->|Internal ClusterIP| BACKEND
    BACKEND -->|TCP 5432 TLS| POSTGRES
    SCANNER_JOB -->|Internal Ingestion API| BACKEND
    EBPF_DS -.->|mTLS Redacted Telemetry Only| BACKEND
```

#### Kubernetes Hardening Features
1. **Dual-Namespace Model**: The control plane runs under the Kubernetes `restricted` Pod Security Standard. The privileged eBPF agent is isolated in `ecdat-runtime`.
2. **Micro-Segmented NetworkPolicies**:
   - Ingress and egress are set to `deny-all` by default across both namespaces.
   - Explicit whitelist allows Frontend $\rightarrow$ Backend (TCP 5000) and Backend $\rightarrow$ Postgres (TCP 5432).
   - Postgres allows ZERO outbound egress.
   - CoreDNS egress is restricted to UDP/TCP 53.
3. **RBAC Least Privilege**:
   - Dedicated ServiceAccounts (`ecdat-backend-sa`, `ecdat-frontend-sa`, `ecdat-scanner-sa`, `ecdat-ebpf-agent-sa`).
   - Zero wildcard (`*`) permissions in any Role or ClusterRole.
4. **Secret Management**:
   - Integration with External Secrets Operator (ESO) and HashiCorp Vault.
   - Projected volumes mounted with strict file permissions (`defaultMode: 0400`).

---

## 5. Discovery Architecture

ECDAT incorporates a multi-modal discovery architecture designed to discover cryptography across all software development and execution layers:

```mermaid
graph TD
    TARGET[Enterprise Target Surface]
    
    TARGET -->|Source Code Repositories| STATIC_SCAN[Static Code Scanner]
    TARGET -->|Network Endpoints & Gateways| NET_SCAN[Network & Endpoint Scanner]
    TARGET -->|Container Images & Host Binaries| BIN_SCAN[Binary & Container Scanner]
    TARGET -->|Archives, Filesystems, Volumes| FS_SCAN[Filesystem & Archive Scanner]
    TARGET -->|Network Taps / PCAP Feeds| PCAP_SCAN[PCAP Passive Traffic Scanner]
    TARGET -->|Host Linux Kernel & Memory| EBPF_SCAN[eBPF Runtime Discovery Agent]

    subgraph Static Analysis Pipeline
        STATIC_SCAN --> AST[Tree-Sitter AST Parsers<br/>C, C++, Go, Java, JS, Python, Rust]
        STATIC_SCAN --> REGEX[Regex Fallback Pattern Engine]
        STATIC_SCAN --> LLM[Groq / LLM Verification Engine]
        STATIC_SCAN --> SECRETS[High-Entropy Secret Detector]
    end

    subgraph Normalization & Contract
        AST --> CANON[Canonical Cryptographic Object Model]
        REGEX --> CANON
        LLM --> CANON
        NET_SCAN --> CANON
        BIN_SCAN --> CANON
        FS_SCAN --> CANON
        PCAP_SCAN --> CANON
        EBPF_SCAN --> CANON
        CANON --> CBOM[CycloneDX 1.6 CBOM Output]
    end
```

### 5.1 Discovery Modalities
1. **Static Code Scanner (`scanners/static/`)**:
   - Utilizes Tree-Sitter AST parsers for fine-grained cryptographic call detection (e.g., OpenSSL EVP calls in C/C++, `crypto/` packages in Go, Java Cryptography Architecture (JCA), Node.js `crypto`, Python `cryptography`).
   - Fallback regular expressions (`regex_rules.py`) with pre-compiled pattern matching.
   - Automated LLM verification (`groq_verifier.py`) for disambiguating complex, dynamic wrapper APIs.
   - High-entropy secret and private key detection with instant redaction.
2. **Network & Endpoint Scanner (`scanners/network/`)**:
   - Performs TLS handshake negotiations across versions (SSLv2, SSLv3, TLS 1.0, 1.1, 1.2, 1.3).
   - Validates cipher suites, Elliptic Curve parameters, Diffie-Hellman group sizes, and ALPN protocols.
   - Analyzes X.509 certificate chains, expiration dates, Certificate Transparency (CT) logs, and signature algorithms.
   - SSH banner and key exchange (KEX) protocol inspection.
   - Enforces SSRF defense by blocking RFC1918 and loopback IP spaces by default.
3. **Binary & Container Scanner (`scanners/binary_container/`)**:
   - Integrates Syft subprocess execution to extract package inventories and container layers.
   - Inspects compiled ELF, PE, and Mach-O binaries for linked cryptographic libraries (OpenSSL, mbedTLS, libsodium, BouncyCastle) using `rules/crypto_library_catalog.json`.
4. **Filesystem & Archive Scanner (`scanners/filesystem/`)**:
   - Recursively inspects compressed archives (`.tar.gz`, `.zip`, `.cpio`, `.iso`).
   - Enforces decompression ratio ceilings and file count bounds to prevent zip-bomb / denial-of-service exploits.
5. **Passive PCAP Traffic Scanner (`scanners/network/pcap_scanner.py`)**:
   - Passively inspects network packet captures to discover cryptographic handshakes in transit without actively probing endpoints.
6. **Runtime Discovery (`scanners/runtime/`)**:
   - Kernel uprobes attached to standard cryptographic shared libraries (`libcrypto.so`, `libssl.so`, `libbssl.so`).

---

## 6. Cryptographic Graph Model

The **Crypto Graph Service** (`backend/src/services/crypto_graph_service.js`) constructs an interactive, multi-dimensional relationship graph that correlates cryptographic discoveries across physical, logical, and data layers.

### 6.1 Entity-Relationship Hierarchy
```mermaid
graph TD
    APP[Application: Customer Identity Portal]
    SVC[Service: Auth Token Provider]
    EP[Endpoint: https://api.ecdat.corp/auth]
    CERT[Certificate: Let's Encrypt Authority X3]
    PROTO[Protocol: TLS 1.2]
    ALGO1[Algorithm: RSA-1024]
    ALGO2[Algorithm: ECDSA P-256]
    ALGO3[Algorithm: MD5]
    DATA[Data Store: User Auth Credentials]

    APP -->|hosts| SVC
    SVC -->|exposes| EP
    EP -->|terminates_tls| PROTO
    PROTO -->|issued_to| CERT
    SVC -->|signs_jwt| ALGO1
    SVC -->|signs_jwt| ALGO2
    SVC -->|hashes_cache| ALGO3
    ALGO1 -->|authorizes| DATA
    ALGO2 -->|authorizes| DATA
```

### 6.2 Node Types & Edge Taxonomy
- **Node Types**:
  - `Application`: High-level business software system.
  - `Service`: Discrete microservice, daemon, or container component.
  - `Endpoint`: Network URI, IP, or port.
  - `CryptoAsset`: Algorithm, key, certificate, or cryptographic protocol.
  - `DataStore`: Database, cache, or file repository classified by data sensitivity.
- **Edge Taxonomy**:
  - `hosts`: Connects Application to Service.
  - `exposes_endpoint`: Connects Service to Endpoint.
  - `terminates_tls`: Connects Endpoint to Protocol.
  - `issued_to`: Connects Protocol to Certificate.
  - `uses_algorithm` / `signs_jwt` / `hashes_cache`: Connects Service to Algorithm.
  - `authorizes` / `protects`: Connects Algorithm to DataStore.
  - `has_finding`: Associates security findings with specific nodes or edges.

### 6.3 Blast Radius & Propagation Analysis
When an algorithm is identified as broken (e.g., `MD5`) or quantum-vulnerable (e.g., `RSA-1024`):
1. The graph engine performs **backward traversal** from the vulnerable node to identify all dependent services and parent applications.
2. The engine performs **forward traversal** to determine what downstream datastores or credentials depend on the compromised primitive.
3. The **Blast Radius Metric** is computed dynamically based on the sensitivity of protected data (e.g., `financial_records`, `pII`, `auth_credentials`) and service criticality.

---

## 7. Deterministic Risk Model

ECDAT evaluates cryptographic risk using a deterministic, rule-based mathematical model designed to avoid non-reproducible or subjective scoring.

### 7.1 Mosca's Theorem Calculus
Mosca's Theorem assesses the urgency of quantum risk based on the time required to migrate vs the timeline to a cryptanalytically relevant quantum computer:

$$\text{Risk Triggered If: } T_{shelf} + T_{migrate} > T_{collapse}$$

Where:
- $T_{shelf}$ (**Data Shelf-Life**): The number of years the protected data must remain confidential.
- $T_{migrate}$ (**Migration Time**): The estimated time required to migrate infrastructure to post-quantum standards.
- $T_{collapse}$ (**Quantum Collapse Year**): The projected arrival year of a quantum computer capable of breaking Shor's algorithm (default baseline: **2033**).

$$\text{Mosca Delta } (\Delta M) = (T_{current} + T_{shelf} + T_{migrate}) - T_{collapse}$$

- If $\Delta M > 0$: **Quantum Deficit!** The data is immediately vulnerable to **Store Now, Decrypt Later (SNDL)** attacks.
- If $\Delta M \le 0$: Migration timeline is safe, but requires planned execution before the margin closes.

### 7.2 Multi-Factor Risk Score Matrix
Individual finding risk scores are calculated using a weighted composite formula:

$$\text{Risk Score} = w_A \cdot S_{algo} + w_E \cdot S_{exposure} + w_C \cdot S_{criticality} + w_M \cdot S_{mosca}$$

| Factor | Weight | Evaluation Criteria |
| :--- | :--- | :--- |
| **Algorithm Lifecycle ($S_{algo}$)** | 35% | Broken (MD5, DES) = 100; Deprecated (SHA-1, 3DES) = 80; Quantum-Vulnerable (RSA-2048, ECC-256) = 60; Quantum-Safe (ML-KEM, ML-DSA) = 0 |
| **Network Exposure ($S_{exposure}$)** | 25% | Public Internet = 100; External Partner DMZ = 70; Internal Network = 40; Air-Gapped / Isolated = 10 |
| **Business Criticality ($S_{criticality}$)** | 20% | Tier 0 Core = 100; Tier 1 High = 75; Tier 2 Medium = 50; Tier 3 Low = 25 |
| **Mosca Urgency ($S_{mosca}$)** | 20% | $\Delta M > 5 \text{ years}$ = 100; $\Delta M > 0 \text{ years}$ = 80; $\Delta M > -3 \text{ years}$ = 50; $\Delta M \le -3 \text{ years}$ = 10 |

### 7.3 Deterministic Explainability Trees
Every risk score generates a transparent JSON explainability tree (`backend/src/risk_engine/explainability.js`) containing:
- Specific rule triggered from `rules/algorithm_lifecycle.json`.
- Mathematical derivation of the score.
- Exact regulatory non-compliance citations.
- Structured justification for prioritization.

---

## 8. Compliance Policy Model

Security compliance is managed through configurable policy profiles (`rules/policy_profiles.json`) matching organizational and regulatory standards:

```mermaid
graph TD
    ASSET[Discovered Cryptographic Asset] --> ENGINE[Policy Engine]
    
    subgraph Regulatory Profiles
        PROFILE1[public_internet]
        PROFILE2[internal_enterprise]
        PROFILE3[financial_pci]
        PROFILE4[critical_infrastructure]
        PROFILE5[defense_cnsa]
        PROFILE6[legacy_constrained]
    end
    
    ENGINE --> PROFILE1
    ENGINE --> PROFILE2
    ENGINE --> PROFILE3
    ENGINE --> PROFILE4
    ENGINE --> PROFILE5
    ENGINE --> PROFILE6
    
    ENGINE --> VERDICT{Policy Evaluation}
    VERDICT -->|Passes Policy| ACCEPT[Compliant Finding]
    VERDICT -->|Violates Threshold| BLOCK[CI/CD Release Blocker / Security Alert]
```

### 8.1 Supported Regulatory Profiles
1. **`public_internet`**: Baseline profile for open Internet endpoints. Enforces TLS $\ge$ 1.2, RSA $\ge$ 2048, disallows self-signed certificates, requires CT logs, and mandates PQC migration by 2033.
2. **`internal_enterprise`**: Balanced profile for internal microservices. Permits trusted internal PKI while maintaining strict cryptographic baselines.
3. **`financial_pci`**: Implements **PCI-DSS v4.0** requirements. Completely prohibits early TLS/SSL, mandates strong encryption for Cardholder Data Environments (CDE), and enforces annual key rotation.
4. **`critical_infrastructure`**: High-security operational technology standard based on **BSI TR-02102** and **NIST SP 800-131A**. Requires RSA $\ge$ 3072 and ECC $\ge$ 256.
5. **`defense_cnsa`**: Implements US National Security Agency **CNSA 2.0** mandates. Requires immediate hybrid and post-quantum adoption (ML-KEM-768/1024, ML-DSA-65/87, LMS, XMSS).

---

## 9. Remediation Architecture

ECDAT features an automated remediation subsystem (`backend/src/remediation/`) designed to transition codebases from legacy algorithms to modern and post-quantum cryptography safely:

```mermaid
graph TD
    FINDING[Vulnerable Finding: RSA-1024 / MD5] --> PLANNER[Migration Planner]
    
    subgraph Remediation Pipeline
        PLANNER --> CANDIDATES[Identify Replacement Candidates<br/>e.g. RSA-1024 -> ML-KEM-768 / RSA-3072]
        PLANNER --> DEP_MAP[Map Dependencies & Affected Services]
        PLANNER --> EFFORT[Estimate Effort & Complexity]
        PLANNER --> PATCH[AST-Preserving Patch Generator]
    end
    
    PATCH --> DIFF[Generate Unified Patch Diff]
    DIFF --> DRY_RUN[Safe Dry-Run Simulation]
    DRY_RUN --> TEST[Run Automated Unit / Regression Tests]
    
    TEST -->|Tests Pass| APPROVAL[Multi-Stage Approval Workflow]
    APPROVAL -->|Approved & Signed| PR[Automated Git Pull Request]
    APPROVAL -->|Rejected / Exception| AUDIT[Tamper-Evident Risk Acceptance Log]
```

### 9.1 Core Remediation Modules
1. **Migration Planner (`migration_planner.js`)**:
   - Analyzes the root cause of risk.
   - Selects NIST-standardized replacement candidates (e.g., replacing `RSA-1024` with `ML-KEM-768` or `RSA-3072`).
   - Defines a three-phase staged rollout:
     - *Phase 1 (Dual-Use / Hybrid)*: Introduce quantum-safe hybrid key exchange (`X25519 + ML-KEM-768`).
     - *Phase 2 (Deprecation)*: Emit telemetry warnings for legacy algorithm usage.
     - *Phase 3 (Strict Enforcement)*: Hard disable legacy cipher suites.
2. **Patch Generator (`patch_generator.js`)**:
   - Generates unified diffs (`patch_diff`) directly from Tree-Sitter AST nodes.
   - Preserves code indentation, styling, and unrelated comments.
3. **Approval Workflow (`approval_workflow.js`)**:
   - Implements multi-stage role-based approval gates (SecOps, App Owner, CISO).
   - If an immediate fix is impossible, creates formal, time-bounded **Cryptographic Risk Exceptions** protected with cryptographic signatures.

---

## 10. eBPF Security Boundary & Isolation

The runtime eBPF agent operates under strict security boundaries (`scanners/runtime/security_boundary.py`) to observe live cryptographic behavior without compromising host kernel integrity:

```mermaid
graph TD
    subgraph Host Kernel Space
        APP_PROC[Monitored Process: OpenSSL / BoringSSL]
        UPROBE[Kernel Uprobe Hook: SSL_read / SSL_write / EVP_*]
        RINGBUF[Fixed-Capacity In-Kernel Ring Buffer: 16MB]
        
        APP_PROC -->|Dynamic Function Call| UPROBE
        UPROBE -->|Metadata Only| RINGBUF
    end

    subgraph Namespace: ecdat-runtime (Isolated Agent Pod)
        AGENT[RuntimeSecurityAgent Python Daemon]
        WATCHDOG[Heartbeat Watchdog & Rate Limiter]
        VALIDATOR[assert_metadata_only Validator]
        
        RINGBUF -->|Drop-on-Overflow Read| AGENT
        AGENT --> WATCHDOG
        AGENT --> VALIDATOR
    end

    subgraph Namespace: ecdat-control-plane (Zero Privileges)
        CONTROL[ECDAT Control Plane Backend]
        VALIDATOR -->|mTLS Strict JSON Stream| CONTROL
    end
```

### 10.1 Key Security Invariants
1. **Strict Separation of Privileges**:
   - The ECDAT control plane (Node.js backend, web UI, databases) **NEVER** runs with kernel or eBPF privileges.
   - The runtime agent is isolated in a separate Kubernetes namespace (`ecdat-runtime`).
2. **Non-Intrusive, Read-Only Probes**:
   - eBPF uprobes hook exclusively into user-space shared libraries (`libcrypto.so`, `libssl.so`, `libbssl.so`).
   - Probes operate strictly in **read-only telemetry mode**; they cannot modify registers, alter memory, or drop packets.
3. **Metadata-Only Invariant (`assert_metadata_only`)**:
   - The agent strictly prohibits the extraction of data payloads, cryptographic keys, secret seeds, or cleartext messages.
   - Emitted events capture strictly operational telemetry:
     - `PID`, `UID`, `Process Name`, `Library Version`, `Cipher Suite ID`, `TLS Version`, `Key Size`.
4. **Kernel Resource Guardrails**:
   - Ring buffer is locked to a fixed 16MB maximum memory footprint.
   - Event rate limit strictly enforced at **5,000 events/second**. If saturated, the agent drops events cleanly to prevent kernel CPU starvation.
   - Agent memory overhead capped at **64MB**.
5. **Guaranteed Clean Detach**:
   - Signal handlers (`SIGINT`, `SIGTERM`) guarantee that all uprobes are detached and kernel ring buffers freed upon process shutdown, leaving zero dangling kernel hooks.
