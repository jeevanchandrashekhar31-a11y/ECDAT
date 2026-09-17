# ECDAT Dependency Inventory

This document provides a comprehensive, ecosystem-wide catalog of direct and transitive dependencies across Python, Node.js Backend, React Frontend, Go, and Native/System layers.

---

## 1. Python Ecosystem

### 1.1 Root Package Configuration
- **Manifest**: [`requirements.txt`](requirements.txt)
- **Linter Config**: [`pyproject.toml`](pyproject.toml) (targets Python 3.12, ruff line length 120)
- **Lockfile Status**: **MISSING** (No `poetry.lock`, `Pipfile.lock`, or `requirements.lock` exists).

### 1.2 Direct Dependencies (`requirements.txt`)

| Package | Declared Version Constraint | Installed Active Version | Purpose / Subsystem | Direct / Transitive |
|---|---|---|---|---|
| `cyclonedx-python-lib` | `>=7.0.0` (Unpinned) | `11.12.0` | CBOM generation, component modeling, CycloneDX 1.6 serialization | Direct |
| `pydantic` | `>=2.0.0` (Unpinned) | `2.13.5` | Data models and finding validation (`scanners/models.py`) | Direct |
| `jsonschema` | `>=4.0.0` (Unpinned) | `4.26.0` | CBOM contract verification (`scanners/cbom_mapping.py`) | Direct |
| `cryptography` | `>=41.0.0` (Unpinned) | `46.0.7` | X.509 certificate decoding, ASN.1 structure parsing | Direct |
| `sslyze` | `>=6.0.0` (Unpinned) | `6.3.1` | Deep TLS protocol, cipher suite, and certificate scanning | Direct |
| `pytest` | Unconstrained (Unpinned) | `9.1.1` | Unit and integration test runner | Direct (Dev) |
| `pytest-cov` | `>=5.0.0` (Unpinned) | `7.1.0` | Test code coverage reporter | Direct (Dev) |
| `ruff` | `>=0.9.0` (Unpinned) | `0.16.6` | Static analysis linter and code formatter | Direct (Dev) |
| `tree-sitter` | `>=0.21.3` (Unpinned) | `0.26.0` | Native AST parsing runtime for static code analysis | Direct |
| `tree-sitter-c` | `>=0.21.4` (Unpinned) | `0.24.2` | Tree-sitter C language grammar grammar library | Direct |
| `tree-sitter-cpp` | `>=0.22.0` (Unpinned) | `0.23.4` | Tree-sitter C++ language grammar library | Direct |
| `tree-sitter-go` | `>=0.21.2` (Unpinned) | `0.25.0` | Tree-sitter Go language grammar library | Direct |
| `tree-sitter-javascript` | `>=0.21.2` (Unpinned) | `0.25.0` | Tree-sitter JavaScript language grammar library | Direct |
| `groq` | `>=0.9.0` (Unpinned) | `1.7.0` | Groq cloud SDK for optional LLM finding verification | Direct |
| `requests` | Unconstrained (Unpinned) | `2.32.5` | HTTP client for LLM API calls in `llm_verifier.py` | Direct |

### 1.3 Key Transitive Python Packages
- `nassl` (`5.4.0`): Low-level OpenSSL wrapper utilized by `sslyze` for raw TLS probing.
- `tls_parser` (`2.0.2`): TLS record layer parser used by `sslyze`.
- `pydantic_core` (`2.46.5`): Rust-backed validation core for Pydantic v2.
- `py-serializable` (`2.1.0`): Serialization layer for `cyclonedx-python-lib`.
- `cffi` (`2.1.1`): C foreign function interface for cryptography and nassl.
- `urllib3` (`2.5.0`): HTTP connection pooling for `requests`.
- `referencing` (`0.37.0`), `jsonschema-specifications` (`2025.9.1`): JSON Schema reference resolution.

---

## 2. Node.js Backend Ecosystem

### 2.1 Manifests & Lockfiles
- **Manifest**: [`backend/package.json`](backend/package.json)
- **Lockfile**: [`backend/package-lock.json`](backend/package-lock.json) (Lockfile version 3, npm 10+ compliant)
- **Dependency Counts**: 125 production dependencies, 117 dev dependencies (243 total in tree)

### 2.2 Production Dependencies (`backend/package.json`)

| Package | Declared Version | Resolved Lockfile Version | Purpose / Subsystem |
|---|---|---|---|
| `express` | `^5.2.1` | `5.2.1` | Core HTTP REST API framework (Express 5.x) |
| `knex` | `^3.3.0` | `3.3.0` | SQL query builder and schema migration runner |
| `pg` | `^8.23.0` | `8.23.0` | PostgreSQL client and connection pooling driver |
| `ajv` | `^8.20.0` | `8.20.0` | High-performance JSON Schema validator (Draft 7 / 2020-12) |
| `helmet` | `^8.3.0` | `8.3.0` | HTTP security response header middleware |
| `cors` | `^2.8.6` | `2.8.6` | Cross-Origin Resource Sharing control |
| `multer` | `^2.3.0` | `2.3.0` | In-memory multipart/form-data parser for CBOM uploads |
| `dotenv` | `^17.4.2` | `17.4.2` | Environment variable loader from `.env` |

### 2.3 Development Dependencies (`backend/package.json`)
- `eslint` (`^9.39.5` / `9.39.5`): Static code linter (ESLint v9 Flat Config).
- `@eslint/js` (`^9.39.5` / `9.39.5`): ESLint recommended JavaScript rules.
- `nodemon` (`^3.1.14` / `3.1.14`): Development auto-reloading daemon.
- `prettier` (`^3.9.6` / `3.9.6`): Deterministic code formatter.

---

## 3. React Frontend Ecosystem

### 3.1 Manifests & Lockfiles
- **Manifest**: [`frontend/package.json`](frontend/package.json)
- **Lockfile**: [`frontend/package-lock.json`](frontend/package-lock.json) (Lockfile version 3)
- **Dependency Counts**: 47 production dependencies, 371 dev dependencies (419 total in tree)

### 3.2 Production Dependencies (`frontend/package.json`)

| Package | Declared Version | Resolved Lockfile Version | Purpose / Subsystem |
|---|---|---|---|
| `react` | `^18.3.1` | `18.3.1` | Core UI component engine |
| `react-dom` | `^18.3.1` | `18.3.1` | React DOM renderer |
| `react-router-dom` | `^6.28.1` | `6.28.1` | Client-side routing (`Dashboard`, `Assets`, `Reports`, `Roadmap`) |
| `recharts` | `^2.15.1` | `2.15.1` | Data visualization charts (Risk posture, timeline calculus) |
| `lucide-react` | `^0.475.0` | `0.475.0` | Standardized SVG UI icon library |

### 3.3 Development Dependencies (`frontend/package.json`)
- `vite` (`^6.1.0` / `6.4.3`): Next-generation ES module bundler and dev server.
- `vitest` (`^3.2.7` / `3.2.7`): Fast unit testing framework.
- `typescript` (`^5.7.3` / `5.7.3`): Static type system.
- `tailwindcss` (`^3.4.17` / `3.4.17`): Utility-first styling framework.
- `@testing-library/react` (`^16.3.3` / `16.3.3`), `@testing-library/jest-dom` (`^6.9.1`): Component testing harness.
- `jsdom` (`^26.1.0` / `26.1.0`): Headless DOM emulator for Vitest.
- `eslint` (`^9.39.5` / `9.39.5`), `typescript-eslint` (`^8.69.0` / `8.69.0`): TypeScript linting.

---

## 4. Go Ecosystem
- **Manifest**: `go.mod`
- **Lockfile**: `go.sum`
- **Status**: **NONE PRESENT**. The ECDAT repository does not compile Go code; it analyzes Go source code statically via `tree-sitter-go`.

---

## 5. Native, eBPF & System Toolchain Dependencies

| Component | Dependency Type | Target Subsystem | Requirement & Constraint |
|---|---|---|---|
| `syft` CLI | External Native Executable | `scanners/binary_container/` | Anchore Syft binary must be on PATH. If missing, fails gracefully with actionable guidance. |
| `git` CLI | Host System Executable | `backend/src/routes/scanner_pipeline.js` | Invoked via `spawn('git', ['clone', ...])` for remote repo scanning. |
| OpenSSL C Headers / Dynamic Libs | Native Shared Library | `scanners/network/` (`nassl`), `tests/fixtures/` | Dynamic runtime linkage via `nassl` and `cryptography` CFFI. |
| C / C++ Toolchain (`gcc`, `clang`, `msvc`) | Native Build Environment | `tree-sitter` native grammar extensions | Required during `pip install` when pre-compiled wheels are unavailable. |
| PostgreSQL Engine | Relational Database Service | `backend/src/db/` | PostgreSQL 16 server (containerized via `postgres:16-alpine` in `docker-compose.yml`). |
| eBPF / BCC / libbpf | Kernel Tracing Toolchain | **None Present** | Zero eBPF programs or kernel runtime dependencies exist in the repository. |
