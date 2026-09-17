# ECDAT Dependency Risk & Vulnerability Analysis

## 1. Executive Summary

This risk assessment evaluates all direct, transitive, native, and toolchain dependencies in ECDAT.

No blind dependency upgrades are performed. All findings below detail the security exposure, blast radius, dangerous capabilities, compatibility constraints, and actionable remediation roadmaps.

---

## 2. Identified Vulnerabilities Matrix

| Package | Ecosystem | Installed Version | Advisory / CVE | Severity | Exploitability & Blast Radius in ECDAT | Compatibility Constraint & Guidance |
|---|---|---|---|---|---|---|
| `react-router` (transitive via `react-router-dom`) | Frontend (Production) | `6.28.1` | GHSA-wrjc-x8rr-h8h6 (CVE-2025-68470 bypass)<br>Open redirect via backslash in `<Link>` / `useNavigate` | Moderate | **Low in ECDAT**: ECDAT navigation routes are statically declared (`/`, `/assets`, `/roadmap`, `/reports`). Query string `?scanId=` is strictly read into component state and never passed into `useNavigate` or `<a>` hrefs directly. | `react-router-dom` v7 is a major breaking upgrade requiring route configuration refactoring. Keep pinned at 6.28.1; sanitize any user-controlled route transitions. |
| `react-router` (transitive via `react-router-dom`) | Frontend (Production) | `6.28.1` | GHSA-337j-9hxr-rhxg<br>Arbitrary constructor injection via `deserializeErrors()` in SSR hydration | Moderate | **Zero in ECDAT**: ECDAT is a purely static Client-Side Rendered (CSR) Single Page Application built with Vite; no SSR hydration is used. | Fixed in v7. No immediate risk to CSR client. |
| `@vitest/mocker` (transitive via `vitest`) | Frontend (Development) | `3.2.7` | GHSA-82fw-gwwq-j7x9 (CWE-22)<br>Path traversal / arbitrary file read via redirect mock | Moderate | **Zero in Production**: Dev/test dependency only. `vitest` is executed exclusively during local developer testing and CI test runner; not present in production runtime Docker container. | Upgrade to Vitest v4/v5 when feasible during planned dev tooling upgrades. |
| `backend/` Dependencies | Node.js (Production) | All lockfile resolved | `npm audit` report: 0 vulnerabilities | **Clean** | 0 vulnerabilities detected across 125 production packages and 117 dev packages. | Continue enforcing `npm audit` in CI pipeline. |

---

## 3. Unpinned Dependencies & Supply Chain Integrity

### 3.1 Python Ecosystem Lack of Lockfile
- **Exposure**: [`requirements.txt`](requirements.txt) specifies unbounded open ranges:
  - `cyclonedx-python-lib>=7.0.0`
  - `pydantic>=2.0.0`
  - `jsonschema>=4.0.0`
  - `cryptography>=41.0.0`
  - `sslyze>=6.0.0`
  - `pytest`
  - `requests`
- **Supply Chain Risk**:
  - `pip install -r requirements.txt` resolves the latest upstream package at build time.
  - A breaking upstream change or malicious supply chain takeover in any dependency will immediately break CI or introduce compromised code without triggering a Git diff.
- **Remediation Constraint**: Generate a pinned lockfile (`requirements.lock` or `pip-compile` output) pinning exact cryptographic hashes (`--generate-hashes`) for CI and production Docker builds.

### 3.2 Node.js Backend & Frontend Lockfile Compliance
- **Compliance**: Both [`backend/package-lock.json`](backend/package-lock.json) and [`frontend/package-lock.json`](frontend/package-lock.json) are committed with SHA-512 subresource integrity (`integrity: sha512-...`) hashes.
- **Gate**: CI uses `npm ci` / `npm install --no-audit` with deterministic lockfile enforcement.

---

## 4. Excessive & Unnecessary Dependencies

### 4.1 Cloud SDK in Offline Static Scanner (`groq`)
- **Package**: `groq>=0.9.0` (installed `1.7.0`)
- **Analysis**:
  - The static scanner is advertised as an offline, deterministic AST and regex discovery engine.
  - While optional LLM verification is guarded behind `--llm-verify`, importing and depending on the `groq` SDK pulls in HTTP client dependencies (`httpx`, `httpcore`, `anyio`, `sniffio`) into the core static scanner profile.
- **Risk**:
  - Broadens the scanner attack surface and memory footprint.
  - In air-gapped or regulated enterprise environments (e.g. BFSI / Defense), cloud AI SDKs can trigger compliance flags.
- **Remediation**: Make `groq` an optional extra (e.g. `pip install .[llm]`) rather than a mandatory requirement in base `requirements.txt`.

### 4.2 Obsolete Database Modules
- **File**: [`backend/src/db/database.js`](backend/src/db/database.js)
- **Analysis**: Imports `pg.Pool` with hardcoded local credentials `postgres://postgres:postgres@localhost:5432/ecdat`. This module is never imported; Knex via [`backend/src/db/connection.js`](backend/src/db/connection.js) manages the entire DB lifecycle.
- **Remediation**: Remove dead file to eliminate dual-connection configuration confusion.

---

## 5. Dependencies with Dangerous Parsing & Execution Capabilities

| Dependency | Execution Mechanism | Dangerous Capability | ECDAT Inherent Defense |
|---|---|---|---|
| `tree-sitter` (and language grammars) | Native C compiled extensions (`.pyd` / `.so`) | Native memory allocation, recursive grammar parsing, pointer traversal in C runtime. | Memory safety in tree-sitter C runtime; file size limited to 5 MB per file; maximum 10,000 files per run. |
| `nassl` / `sslyze` | CFFI compiled OpenSSL bindings | Low-level C TLS handshake manipulation, memory management in legacy SSLv2/SSLv3 branches. | Runs in separate process space; bounded network timeouts. |
| `multer` | Node.js stream busboy parser | Streaming multipart file uploads, temporary file allocation. | Strictly configured for in-memory buffers (`multer.memoryStorage()`) with hard byte caps (10 MB / 50 MB); never streams to arbitrary disk paths without validation. |
| `syft` CLI | Subprocess execution of external binary | Container image extraction, tarball decompression, package manifest parsing. | Executed with `shell: false`, output bounded to 100 MB, timeout capped to 300s, path inputs sanitized via regex. |
| `ajv` | Node.js dynamic code generation | JSON Schema compilation via `eval()` or Function constructor. | Validates schema integrity; schemas are locally trusted files (`rules/schemas/`). |

---

## 6. Upstream Abandonment & Maintenance Assessment

| Dependency | Repository / Maintainer | Last Release Date | Maintenance Posture |
|---|---|---|---|
| `cyclonedx-python-lib` | OWASP / CycloneDX Foundation | Active (2025/2026) | **Healthy / Actively Maintained** |
| `cryptography` | PyCA (Python Cryptographic Authority) | Active (2026) | **Healthy / Highly Maintained** |
| `sslyze` | Alban Diquet / Alya Labs | Active (2025/2026) | **Healthy / Maintained** |
| `knex` | Knex.js Team | Active (2025/2026) | **Healthy / Maintained** |
| `express` | Express.js / OpenJS Foundation | Active (5.x release) | **Healthy / Core Standard** |
| `tree-sitter` | Tree-sitter / GitHub | Active (2025/2026) | **Healthy / High Adoption** |

No abandoned or deprecated dependencies are currently active in the core dependency graph.
