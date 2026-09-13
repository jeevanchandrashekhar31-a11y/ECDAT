# ECDAT Baseline Security Report

## 1. Executive Summary & Toolchain Manifest

This baseline security audit documents the exact security posture of the ECDAT repository prior to architectural refactoring.

All security tools, exact versions, parameters, and findings are recorded below so future subphases can quantitatively measure risk reduction.

### Toolchain Execution Matrix

| Security Domain | Tool & Exact Version | Target Subsystem | Command / Invocation | Status / Findings |
|---|---|---|---|---|
| **Secret Scanning** | Static Regex Analyzer & ECDAT Redaction Rules | Whole repository (188 tracked files) | Multi-pattern regex scanning for PEM headers, API tokens, passwords | 12 candidate matches; **0 real leaked secrets** (all matches are synthetic unit test fixtures or `.env.example` fallbacks). |
| **Python SAST** | Ruff v0.16.6 (`flake8-bandit` / `S` series) | `scanners/` Python package | `python -m ruff check --select S scanners` | **2 Low/Medium findings** (S607 partial executable path for Syft, S603 subprocess check in `syft_runner.py`). |
| **Python Lint & Style** | Ruff v0.16.6 | `scanners/`, `tests/` | `python -m ruff check scanners tests` | **Clean** (0 errors). |
| **Python Formatting** | Ruff v0.16.6 Formatter | `scanners/`, `tests/` | `python -m ruff format --check scanners tests` | **Clean** (43 files verified formatted). |
| **Go SAST** | N/A | Entire repository | N/A | **N/A**: No Go source is compiled in ECDAT; Go files in `tests/fixtures/static/` are static test fixtures parsed by tree-sitter. |
| **Backend Dependencies** | npm v10.9.2 / `npm audit` | `backend/package-lock.json` | `npm --prefix backend audit --json` | **Clean**: 0 vulnerabilities across 243 dependencies (125 prod, 117 dev). |
| **Frontend Dependencies** | npm v10.9.2 / `npm audit` | `frontend/package-lock.json` | `npm --prefix frontend audit --json` | **4 Moderate Vulnerabilities** (`react-router` / `react-router-dom`: GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg; `vitest` / `@vitest/mocker`: GHSA-82fw-gwwq-j7x9). |
| **Cryptographic SAST** | ECDAT Static Scanner v1.0.0 | ECDAT repository (`.`) | `python -m scanners.static.main . --exclude-dir ... --output ... --output-sarif ...` | 85 assets / 85 findings (46 Critical, 8 High, 31 Info) resulting from cryptographic algorithm string literals in risk engine and reporting logic. |
| **Container & IaC Scanning** | Docker v29.4.2 static manifest audit | `backend/Dockerfile`, `docker/scanner.Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` | Static Dockerfile inspection | **2 Non-Compliances**: `scanner.Dockerfile` and `frontend/Dockerfile` lack non-root `USER` enforcement; `docker-compose.yml` contains hardcoded fallback passwords. |

---

## 2. Secret Scanning Baseline

A scan across all 188 tracked git assets evaluated against high-entropy literal rules, private key headers, and API token regexes identified 12 candidate instances:

| File | Line | Candidate Type | Forensic Verification | True Positive Risk? |
|---|---|---|---|---|
| `backend/.env.example` | 17 | Database URL with Password | Example documentation string `postgresql://postgres:postgres@localhost:5432/ecdat` | No (Template documentation) |
| `backend/src/config.js` | 93 | Database URL with Password | Default dev connection string fallback | No (Local dev fallback) |
| `backend/src/db/database.js` | 7 | Database URL with Password | Obsolete dead file fallback | Low (File is dead and unreferenced; scheduled for deletion in Subphase 2) |
| `backend/src/services/cbom_validation.js`| 19 | Private Key Header | Regex pattern used to detect and redact private keys | No (Security regex definition) |
| `backend/tests/api/auth.test.js` | 72 | API Key Literal | Synthetic test dummy token `"query-key-2"` | No (Unit test fixture) |
| `backend/tests/api/cbom_upload.test.js` | 204 | Private Key Header | Synthetic test key `...FAKE_SECRET_KEY...` used to verify private key redaction | No (Synthetic test key) |
| `backend/tests/risk_engine/cbom_annotator.test.js`| 194 | Private Key Header | Test assertion verifying that private key is NOT present | No (Test assertion) |
| `docker-compose.yml` | 31, 48 | Database URL / Secret Fallback | Fallback strings `${POSTGRES_PASSWORD:-change-this-local-postgres-password}` | Low (Local Docker Compose dev fallback) |
| `tests/test_security_units.py` | 15, 16, 28, 29 | Private Key & Password | Synthetic test dummy `"password=\"do-not-log-this\""`, `"SUPERSECRET"` used to verify redaction | No (Synthetic test fixture) |

**Conclusion**: Zero production private keys, production tokens, or cloud credentials exist in git tracking.

---

## 3. Python SAST Baseline (`flake8-bandit` via Ruff)

Running `python -m ruff check --select S scanners` yielded **2 findings** in production code:

1. **S607 (Low)**: Starting a process with a partial executable path
   - **Location**: [`scanners/binary_container/syft_runner.py:9`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/binary_container/syft_runner.py#L9)
   - **Code**: `subprocess.run(["syft", "version"], ...)`
   - **Risk**: Relies on system `PATH` resolution rather than an absolute binary path.
   - **Remediation**: Use `shutil.which("syft")` to resolve the full executable path before spawning.

2. **S603 (Medium)**: Subprocess call checking for execution of untrusted input
   - **Location**: [`scanners/binary_container/syft_runner.py:32`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/binary_container/syft_runner.py#L32)
   - **Code**: `result = subprocess.run(cmd, shell=False, capture_output=True, ...)`
   - **Risk**: If `target` is not rigorously sanitized, arguments could be manipulated.
   - **Current Mitigation**: `target_validation.validate_target()` applies regex constraints before reaching `run_syft_scan()`.

---

## 4. Frontend & Backend Dependency Vulnerability Baseline

### 4.1 Node.js Backend (`backend/package-lock.json`)
- **Audit Command**: `npm --prefix backend audit --json`
- **Result**:
  - Critical: 0
  - High: 0
  - Moderate: 0
  - Low: 0
  - **Total**: 0 vulnerabilities across 243 installed packages.

### 4.2 React Frontend (`frontend/package-lock.json`)
- **Audit Command**: `npm --prefix frontend audit --json`
- **Result**:
  - Total: 4 Moderate vulnerabilities:
    1. `react-router` / `react-router-dom` (`6.28.1`): GHSA-wrjc-x8rr-h8h6 (Open redirect via backslash in `<Link>` and `useNavigate`).
    2. `react-router` / `react-router-dom` (`6.28.1`): GHSA-337j-9hxr-rhxg (Arbitrary Constructor Injection via `deserializeErrors()` in SSR hydration).
    3. `vitest` / `@vitest/mocker` (`3.2.7`): GHSA-82fw-gwwq-j7x9 (Path Traversal / Arbitrary File Read via `@vitest/mocker` redirect mock).
- **Forensic Assessment**:
  - GHSA-337j-9hxr-rhxg has zero exploitability in ECDAT because ECDAT is a client-side Single Page Application without server-side rendering (SSR) hydration.
  - GHSA-82fw-gwwq-j7x9 is strictly in the developer test harness (`vitest`) and is excluded from the production frontend Nginx container.
  - GHSA-wrjc-x8rr-h8h6 requires a major SemVer upgrade to React Router v7 (`7.18.3`), which involves breaking changes to the routing API and is deferred to a dedicated UI architecture refactoring subphase.

---

## 5. Cryptographic Self-Scan Baseline (ECDAT Static Scanner)

Running ECDAT's own static CBOM and SARIF scanner on the repository source tree:
- **Command**: `python -m scanners.static.main . --exclude-dir .git,node_modules,vendor,dist,build,.venv,artifacts,examples,testing --output artifacts/baseline_static_cbom.json --output-sarif artifacts/baseline_static_results.sarif --policy-profile regulated_bfsi --fail-on none`
- **Discovered Files**: 58 files scanned in 1.4 seconds.
- **Identified Assets**: 85 cryptographic usage sites.
- **Severity Breakdown**:
  - Critical: 46
  - High: 8
  - Medium: 0
  - Low: 0
  - Informational: 31
- **Quantum Risk Count**: 0 assets at quantum threat horizon.
- **Root Cause Analysis**:
  - The Critical findings are triggered by algorithm names (e.g. `"DES"`, `"MD5"`, `"SHA-1"`) appearing as string literals inside the risk engine's own rule matchers and HTML report generators ([`html_reporter.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/risk_engine/html_reporter.js), [`recommendations.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/risk_engine/recommendations.js), [`classifier.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/risk_engine/classifier.js)).
  - The static scanner's AST handlers correctly identify that the application code itself does not use weak crypto for its own operations, but regex fallbacks flag string literals in rulesets.

---

## 6. Container & IaC Security Baseline

### 6.1 `backend/Dockerfile`
- Base: `node:20-alpine`
- Least Privilege: **COMPLIANT** (`USER node`, UID 1000).
- File Permissions: `chmod 0555 /usr/local/bin/ecdat-backend`, `chown -R node:node /app /rules`.
- Exposed Ports: 5000.

### 6.2 `docker/scanner.Dockerfile`
- Base: `python:3.12-slim`
- Least Privilege: **NON-COMPLIANT** (No `USER` directive specified; runs by default as `root` UID 0).
- Action Required: Add an unprivileged user (`RUN useradd -u 10001 ecdat && USER ecdat`).

### 6.3 `frontend/Dockerfile`
- Builder: `node:20-alpine` (multi-stage build)
- Server: `nginx:alpine`
- Least Privilege: **NON-COMPLIANT** (Standard Nginx image runs master process as root on port 80).
- Action Required: Migrate to `nginxinc/nginx-unprivileged:alpine` or configure non-root port 8080 with unprivileged UID.

### 6.4 `docker-compose.yml` (IaC Baseline)
- Database: `postgres:16-alpine` on isolated `internal: true` bridge network.
- Secrets: Fallback passwords (`change-this-local-postgres-password`) present in environment interpolation.
- Scanner Profile: Mounts host root filesystem (`./:/workspace:ro`). Container lacks `cap_drop: ALL` and `read_only: true`.

### 6.5 CI Workflow Manifest (`.github/workflows/ecdat-scan.yml`)
- Permissions: **COMPLIANT** (`permissions: contents: read` explicitly restricted at top level).
- Credentials: Zero secrets/tokens passed; `ECDAT_LLM_VERIFY: "false"` enforced.
- Static Analysis Check: Runs forbidden check `rg -n "shell=True" scanners` to prevent shell injection.

### 6.6 Kubernetes Manifests
- **Status**: No Kubernetes manifests (`k8s/`, `helm/`, or deployment specs) currently exist in git tracking.
- **Action Required**: Subphase 5 will create production-ready, hardened Kubernetes manifests enforcing `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, unprivileged UID/GID, drop all capabilities, and explicit NetworkPolicies.

---

## 7. Baseline Security Scorecard

| Category | Baseline Metric | Target Metric (Post-Upgrade) |
|---|---|---|
| Secret Leaks | 0 True Positives | 0 True Positives |
| Python SAST Warnings | 2 Warnings (S607, S603) | 0 Warnings |
| Backend Vulnerabilities | 0 Vulnerabilities | 0 Vulnerabilities |
| Frontend Vulnerabilities | 4 Moderate Vulnerabilities | 0 Vulnerabilities (or documented SSR exclusions) |
| Container Non-Root Compliance | 1 of 3 compliant | 3 of 3 compliant (100% non-root) |
| Unauthenticated Execution Routes | 8 routes (`/scan/*`, `/cbom/*`) | 0 routes (100% gated with API key & rate limits) |
| TLS Scanner Verification | Bypassed in `_scan_direct_ssl` | Enforced / Strict verification separation |
| Archive Extraction Safety | Unchecked `zipfile -e` | Safe canonical path validation |
