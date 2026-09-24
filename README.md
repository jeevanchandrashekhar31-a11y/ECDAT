# ECDAT — Enterprise Cryptographic Discovery and Assessment Tool

ECDAT is a security platform designed to discover cryptographic assets across source code, network services, and container artifacts. It generates standards-compliant CycloneDX 1.6 and 1.7 Cryptographic Bill of Materials (CBOM) documents, assesses classical cryptographic weaknesses, and calculates post-quantum migration urgency using Mosca's Theorem.

---

## What ECDAT Does

1. **Multi-Language Static Code Discovery**:
   - Inspects Python, JavaScript, TypeScript, C, C++, Go, Java, Rust, and C# source code using Abstract Syntax Tree (AST) adapters and regex pattern heuristics.
   - Identifies deprecated ciphers (DES, 3DES, RC4, Blowfish), broken hash functions (MD5, SHA-1), insufficient asymmetric key lengths (RSA < 2048, DH < 2048), and insecure TLS protocol options.
   - Detects hardcoded secrets, credentials, and private keys via `SecretSafeDetector`, automatically redacting secret values before evidence storage.

2. **CycloneDX 1.6 & 1.7 CBOM Generation**:
   - Maps discovered cryptographic primitives directly into standard CycloneDX CBOM schemas (`cryptoProperties` object).
   - Catalogs algorithms, certificates, protocols, cipher suites, and cryptographic assets.

3. **Post-Quantum Cryptography (PQC) Risk Assessment**:
   - Evaluates algorithms against quantum threats using Mosca's Theorem ($X + Y > Z$), where:
     - $X$ = Data retention requirement / secrecy lifetime.
     - $Y$ = System migration and re-engineering timeline.
     - $Z$ = Estimated time until a Cryptographically Relevant Quantum Computer (CRQC).
   - Identifies transitions needed to NIST PQC standards (FIPS 203 ML-KEM, FIPS 204 ML-DSA, FIPS 205 SLH-DSA).

4. **Remediation Planning with Role Separation**:
   - Generates automated code migration proposals with unified diff previews.
   - Enforces separation of duties: Analysts can propose plans, while Administrators review and approve/apply them.
   - Enforces path-confinement safety checks to prevent directory traversal.

5. **Policy-as-Code & Fail-Closed CI Gates**:
   - Evaluates cryptographic findings against customizable policy profiles (e.g., `regulated_bfsi`).
   - Produces OASIS SARIF v2.1.0 reports for CI/CD pipelines with deterministic exit codes.

---

## Quick Start

### Prerequisites
- **Python**: 3.12+
- **Node.js**: 20+
- **PostgreSQL**: 16+ (required for multi-user backend and dashboard persistence)

### Installation
```bash
# 1. Install Python dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt

# 2. Install backend dependencies
npm install --prefix backend

# 3. Install frontend dependencies
npm install --prefix frontend
```

### Run Standalone Static Scanner
To generate a CycloneDX CBOM and SARIF report for a local codebase without running the web service:
```bash
python -m scanners.static.main . \
  --output artifacts/ci/static_cbom.json \
  --output-sarif artifacts/ci/static_results.sarif \
  --policy-profile regulated_bfsi \
  --fail-on critical
```

### Run the Web Platform (Demo Mode)
To launch the full web interface with pre-authenticated demo access:
```bash
# Terminal 1: Prepare database schema and start backend
npm run prepare-db --prefix backend
AUTH_MODE=demo npm start --prefix backend

# Terminal 2: Start frontend development server
npm run dev --prefix frontend
```
Open `http://localhost:5173` in your browser.

---

## The SIH Demo Path (5–8 Minute Walkthrough)

The working judge demonstration follows this path:

1. **Enter Demo**: On `/login`, click the **"Enter Demo Mode"** button to establish an authenticated session for the demo tenant.
2. **Dashboard**: Navigate to `/dashboard` to view high-level metrics (Discovered Assets, Severity Distribution, Quantum Vulnerability Gap).
3. **Start Scan**: Navigate to `/scans`, select the repository target, choose policy profile `regulated_bfsi`, and trigger the scan.
4. **Findings**: Navigate to `/findings` to inspect identified cryptographic findings, rule identifiers, code locations, and redacted evidence.
5. **CBOM View**: Navigate to `/cbom` to browse the generated CycloneDX 1.6/1.7 Cryptographic Bill of Materials hierarchy.
6. **PQC & Blast Radius Assessment**: Navigate to `/graph` (Crypto Graph) to simulate the Post-Quantum Blast Radius impact (using Mosca's Theorem). Click "Simulate Blast Radius" in the side panel.
7. **Semantic LLM Discovery (Live Re-run)**: Go back to `/findings`. Look for a finding with the **AI Unverified** tag and click "Details". Notice the "Result from cached analysis" label. Click **"Re-run live"** to demonstrate the live LLM semantic discovery engine bypassing the cache in real-time.
8. **Remediation**: Navigate to `/remediation` to review automated migration diffs and observe role separation (Analyst proposes; Administrator approves).
9. **Verification**: Verify that the applied remediation resolves the finding and clears the policy gate.

For step-by-step instructions, see [docs/DEMO_GUIDE.md](file:///c:/Users/Jeevan%20c/Documents/ECDAT/docs/DEMO_GUIDE.md).

---

## Empirical Verification & Benchmark Metrics

All numbers below were measured in verification runs in this environment:

### Static Scanner Golden Corpus Evaluation
- **Benchmark Corpus**: 40 curated benchmark files containing 109 ground-truth cryptographic primitives across 16 standardized categories.
- **Golden Corpus Precision**: **`98.2%`**
- **Golden Corpus Recall**: **`98.2%`**
- **Golden Corpus F1 Score**: **`98.2%`**
- **False Positive Rate on Traps / Negative Examples**: **`0.0%`** (0 false positives on non-crypto traps)

*Detailed metrics recorded in `artifacts/benchmarks/GOLDEN_CORPUS_REPORT.md`.*

### Automated Test Suite
- Running `python -m pytest -q` executed 1063 tests across unit, integration, and security suites:
  - **`1052 passed`**
  - **`11 failed`** (related to pre-generated security evidence manifest paths and environment preconditions)

---

## Known Limitations

ECDAT maintains an explicit, transparent record of what is **not** implemented:

1. **eBPF kernel attachment is not implemented (architecture and probe source only)**:
   - `bpf/crypto_observer.bpf.c` and `scanners/runtime/ebpf_collector.py` provide reference architecture only. No live kernel probes attach to kernel sockets or capture real-time crypto calls.
2. **OIDC/LDAP SSO and full MFA UI are not built**:
   - Enterprise identity protocols (OIDC, SAML, LDAP) are not implemented. Authentication uses local bcrypt passwords, signed JWTs, and Demo Mode. Backend TOTP primitives exist, but no user-facing MFA setup UI is available.
3. **Network and binary scanner accuracy have been spot-checked, not measured with the same rigor as the static scanner's golden corpus**:
   - Formal statistical precision and recall benchmarks exist only for the static source code scanner.
4. **LLM Semantic Scanning**:
   - LLM analysis is actively cached for demo purposes to avoid network/API rate-limit issues. Live re-runs can be triggered directly from the UI.
5. **Database migrations are script-based**:
   - Schema creation uses `prepare_db.js` rather than versioned migration tooling.

For the complete, unvarnished disclosure of all technical boundaries, see [docs/SECURITY_LIMITATIONS.md](file:///c:/Users/Jeevan%20c/Documents/ECDAT/docs/SECURITY_LIMITATIONS.md).
For security controls and threat model, see [SECURITY.md](file:///c:/Users/Jeevan%20c/Documents/ECDAT/SECURITY.md).