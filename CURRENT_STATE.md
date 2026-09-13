# ECDAT Current State Forensic Audit

## 1. Executive Summary

This forensic baseline establishes the verified, non-fictional operational status of the ECDAT repository as of commit `f74add7e` on branch `main`.

Every finding in this document is derived from direct static analysis of code paths, test runs, CI inspection, and the machine-readable inventory [`REPO_INVENTORY.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/REPO_INVENTORY.json).

---

## 2. Codebase Metrics

- **Total Tracked Objects**: 188 files and modules
- **Total Approximate Lines of Code**: 31,080 lines
- **Lines by Language**:
  - JSON: 10,623 LOC
  - JavaScript: 9,417 LOC
  - TypeScript (React): 5,560 LOC
  - Python: 3,227 LOC
  - Markdown: 1,203 LOC
  - TypeScript: 723 LOC
  - Plain Text: 281 LOC
  - YAML: 230 LOC
  - CSS: 71 LOC
  - Dockerfile: 63 LOC
  - C: 37 LOC
  - SQL: 17 LOC
  - HTML: 17 LOC
  - Go: 17 LOC
  - TOML: 7 LOC
  - Shell: 4 LOC
  - INI: 3 LOC
- **Files by Classification**:
  - `source`: 102 files
  - `configuration`: 30 files
  - `test`: 24 files
  - `documentation`: 20 files
  - `schema`: 5 files
  - `fixture`: 4 files
  - `submodule` (gitlinks): 2 entries
  - `asset`: 1 file

---

## 3. Forensic Classification Findings

### 3.1 Dead Code
The following files are verified to be completely unreferenced and never invoked by any production runtime, CLI, or test harness:
1. [`scanners/static/parsers/ast_parser.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/parsers/ast_parser.py): Superseded by the tree-sitter AST handlers under [`scanners/static/ast/`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/ast/).
2. [`scanners/static/parsers/groq_verifier.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/parsers/groq_verifier.py): Superseded by [`scanners/static/llm_verifier.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/llm_verifier.py).
3. [`scanners/static/parsers/regex_parser.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/parsers/regex_parser.py): Superseded by [`scanners/static/regex_rules.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/regex_rules.py).
4. [`backend/risk_engine/merger.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/risk_engine/merger.py): Phase 1 prototype Python script left in backend; superseded by Node.js risk engine and [`scanners/cbom_mapping.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py).
5. [`backend/src/db/database.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/db/database.js): Legacy raw `pg.Pool` connection wrapper; all database queries use Knex via [`backend/src/db/connection.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/db/connection.js).
6. [`examples/real_target/examples/real_target/wolfssl`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/examples/real_target/examples/real_target/wolfssl): Dangling gitlink submodule entry in Git tree without `.gitmodules`.
7. [`testing/examples/real_targets/mbedtls`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/testing/examples/real_targets/mbedtls): Dangling gitlink submodule entry in Git tree without `.gitmodules`.

### 3.2 Duplicate Implementations
1. **Static CBOM Generation**:
   - Primary: [`scanners/cbom_mapping.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py) (uses `cyclonedx-python-lib` 1.6 models).
   - Duplicate/Dead: [`scanners/static/parsers/ast_parser.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/parsers/ast_parser.py) (direct dict manipulation).
2. **CBOM Merging**:
   - Active Backend: Node.js risk engine normalizer [`backend/src/risk_engine/normalizer.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/risk_engine/normalizer.js).
   - Active Python Scanner: `merge_cboms` in [`scanners/cbom_mapping.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py).
   - Duplicate/Dead: [`backend/risk_engine/merger.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/risk_engine/merger.py).

### 3.3 Legacy Code
1. [`backend/src/api/server.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/api/server.js): Retained strictly as a compatibility wrapper for `backend/src/app.js`. Production entry point is [`backend/src/server.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/server.js).

### 3.4 TODO / FIXME / HACK
1. [`scanners/cbom_mapping.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py#L219):
   - Line 219: `# To maintain schema compliance, we inject it manually using a hack similar to the original scanner.` (Handles CycloneDX 1.6 property injection for certificate validation flags).

### 3.5 Stubs & Mock-Only Implementations
1. **Network Scanner Mock-Bypass** in [`scanners/network/plugins/tls.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/network/plugins/tls.py#L56-L61):
   - Check: `is_mocked = getattr(Scanner, "__name__", "") == "FakeScanner" or "test" in getattr(Scanner, "__module__", "")`
   - Real execution branches to `_scan_direct_ssl()` which disables TLS certificate verification (`ctx.verify_mode = ssl.CERT_NONE; ctx.check_hostname = False`).

---

## 4. Operational Boundaries & Security Characteristics

### 4.1 External Network Calls
- [`backend/src/routes/scanner_pipeline.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/scanner_pipeline.js): Executes `git clone` via child process to clone external Git URLs.
- [`scanners/network/plugins/tls.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/network/plugins/tls.py): Opens TCP sockets and TLS sessions to user-specified IP/ports.
- [`scanners/network/plugins/ssh.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/network/plugins/ssh.py): Establishes SSH banner exchange sockets.
- [`scanners/static/llm_verifier.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/llm_verifier.py): Dispatches HTTP POST requests to Groq API endpoint (`https://api.groq.com/openai/v1/chat/completions`) when `--llm-verify` is enabled.
- [`frontend/src/api/client.ts`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/frontend/src/api/client.ts): Executes `fetch()` requests against ECDAT backend API.

### 4.2 Subprocess Calls
- [`backend/src/routes/scanner_pipeline.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/scanner_pipeline.js):
  - `spawn('git', ['clone', ...])`
  - `spawn('python', ['-m', 'scanners.static.main', ...])`
  - `spawn('python', ['-m', 'scanners.network.main', ...])`
  - `spawn('python', ['-m', 'scanners.binary_container.main', ...])`
  - `spawn('python', ['-m', 'zipfile', '-e', ...])`
- [`scanners/binary_container/syft_runner.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/binary_container/syft_runner.py):
  - `subprocess.run(["syft", "version"], ...)`
  - `subprocess.run(["syft", target, "-o", "cyclonedx-json"], ...)`
- [`tests/test_static_scanner.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/tests/test_static_scanner.py):
  - Spawns scanner CLI for test fixture validation.

### 4.3 Filesystem Writes
- [`backend/src/routes/scanner_pipeline.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/scanner_pipeline.js): Writes uploaded ZIPs and extracted files to `artifacts/uploads/scan_<timestamp>/`.
- [`backend/src/routes/cbom.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/cbom.js): Writes CBOM files via ingestion service.
- [`scanners/static/main.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/main.py): Writes CBOM JSON and SARIF 2.1.0 output files to `--output` path.
- [`scanners/network/main.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/network/main.py): Writes CBOM JSON to `-o` path.
- [`scanners/binary_container/main.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/binary_container/main.py): Writes CBOM JSON to `-o` path.

### 4.4 Deserialization
- Untrusted JSON deserialization:
  - `JSON.parse()` on CBOM payloads in [`backend/src/services/cbom_validation.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/services/cbom_validation.js) (guarded by size bounds, prototype pollution defense, and depth recursion checks).
  - `json.loads()` on Syft scanner output in [`scanners/binary_container/syft_runner.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/binary_container/syft_runner.py).
  - `json.loads()` in rule loaders ([`rules_loader.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/risk_engine/rules_loader.js), [`scanners/cbom_mapping.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/cbom_mapping.py)).

### 4.5 Database Access
- Knex / PostgreSQL access in:
  - [`backend/src/services/cbom_ingestion.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/services/cbom_ingestion.js) (writes to `scans`, `cboms`, `assets`, `findings`, `pqc_recommendations`).
  - [`backend/src/routes/assets.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/assets.js) (reads `assets`).
  - [`backend/src/routes/findings.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/findings.js) (reads `findings`).
  - [`backend/src/routes/scans.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/routes/scans.js) (reads/deletes `scans`).
  - [`backend/src/db/migrations/20260905000000_create_ecdat_schema.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/db/migrations/20260905000000_create_ecdat_schema.js).

### 4.6 Credential & Key Handling
- [`backend/src/middleware/auth.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/middleware/auth.js): Handles API keys with `crypto.timingSafeEqual` constant-time verification.
- [`backend/src/services/cbom_validation.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/services/cbom_validation.js): Scans ingested CBOMs for private keys (`BEGIN RSA/EC/OPENSSH/PGP/DSA PRIVATE KEY`) and redacts them prior to storage or display.
- [`scanners/static/sanitization.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/static/sanitization.py): Sanitizes static scanner code snippets, stripping passwords, tokens, and raw private key bodies into SHA-256 fingerprint masks.

---

## 5. Endpoints & CLI Interface Audit

### 5.1 HTTP API Endpoints

| Method | Path | Documented? | Auth Required? | Notes |
|---|---|---|---|---|
| `GET` | `/health` | Yes | No | System health and database status |
| `POST` | `/api/v1/cboms` | Yes | Yes | Ingest CBOM (multipart or JSON) |
| `GET` | `/api/v1/cboms` | Yes | Configurable | List all scans |
| `GET` | `/api/v1/cboms/:id` | Yes | Configurable | Get specific CBOM record |
| `GET` | `/api/v1/scans` | Yes | Configurable | List scans |
| `GET` | `/api/v1/scans/:scanId` | Yes | Configurable | Get scan summary |
| `GET` | `/api/v1/scans/:scanId/errors`| Yes | Configurable | Get scan error log |
| `DELETE`| `/api/v1/scans` | Yes | Yes | Clear all scan history |
| `GET` | `/api/v1/assets` | Yes | Configurable | Query assets with filters/pagination |
| `GET` | `/api/v1/assets/:assetId` | Yes | Configurable | Get single asset detail |
| `GET` | `/api/v1/findings` | Yes | Configurable | Query individual findings |
| `GET` | `/api/v1/findings/:findingId`| Yes | Configurable | Get single finding detail |
| `GET` | `/api/v1/dashboard/summary` | Yes | Configurable | Executive telemetry and Mosca risk counts |
| `GET` | `/api/v1/reports/summary` | Yes | Configurable | Aggregated report summary |
| `GET` | `/api/v1/reports/cbom/:scanId`| Yes | Configurable | Download raw or annotated CBOM |
| `GET` | `/api/v1/reports/:id/html` | Yes | Configurable | Download standalone HTML report |
| `POST` | `/scan/static` | **Undocumented** | **No (Exempted)**| Triggers live static scan / git clone |
| `POST` | `/scan/network` | **Undocumented** | **No (Exempted)**| Triggers live network TLS/SSH probe |
| `POST` | `/scan/binary` | **Undocumented** | **No (Exempted)**| Triggers Syft binary container scan |
| `POST` | `/cbom/merge` | **Undocumented** | **No (Exempted)**| Merges multiple CBOMs |
| `POST` | `/cbom/quantum-risk` | **Undocumented** | **No (Exempted)**| Evaluates quantum risk gap on raw CBOM |
| `GET` | `/cbom/merged` | **Undocumented** | **No (Exempted)**| Returns cached merged CBOM |
| `GET` | `/cbom/risk` | **Undocumented** | **No (Exempted)**| Returns cached merged risk summary |
| `GET` | `/cbom/pqc-report` | **Undocumented** | **No (Exempted)**| Generates PQC migration roadmap JSON |

### 5.2 CLI Commands

| Tool | Entrypoint | Key Arguments | Safety Flags |
|---|---|---|---|
| Static Scanner | `python -m scanners.static.main` | `target_dir`, `-o`, `--include-ext`, `--exclude-dir`, `--fail-on`, `--output-sarif`, `--llm-verify` | `--max-file-size-mb`, `--max-files`, secret redaction |
| Network Scanner | `python -m scanners.network.main` | `targets`, `--protocol`, `--port`, `--timeout`, `-o` | `--allow-private-targets` (blocks RFC1918 by default), `--max-concurrency` |
| Binary Scanner | `python -m scanners.binary_container.main` | `target`, `--target-type`, `-o`, `--catalog`, `--timeout` | Path validation, 100MB output limit |
| CBOM Importer | `node backend/src/scripts/import_cbom.js` | `cbom_file`, `--policy-profile`, `--scenario`, `--fail-on`, `--summary-out`, `--annotated-out` | Schema validation, private key redaction |
| DB Prepare | `node backend/src/scripts/prepare_database.js` | None | Runs Knex migrations |

---

## 6. Priority Attack Surface Detailed Enumeration

### 6.1 Subprocess Invocations
| Location | Command / Binary | Arguments / Signature | Shell | Timeout | Risk & Mitigations |
|---|---|---|---|---|---|
| `backend/src/routes/scanner_pipeline.js:36` | `python` / `python3` | `args` array (scanners.static, network, binary, zipfile) | `false` | 15s - 180s | Spawns Python runner. `shell: false` prevents shell metacharacter injection; however, arguments constructed from user inputs must be strictly validated. |
| `backend/src/routes/scanner_pipeline.js:109` | `git` | `clone --depth 1 [-b branch] <url> <targetDir>` | `false` | 60s | **Critical Risk**: If `<url>` or `branch` begins with `--`, Git interprets them as command-line flags (e.g. `--upload-pack`). Must enforce strict prefix validation rejecting leading hyphens. |
| `scanners/binary_container/syft_runner.py:9` | `syft` | `version` | `false` | None | Used to verify Syft presence in PATH. |
| `scanners/binary_container/syft_runner.py:32` | `syft` | `[target, '-o', 'cyclonedx-json']` | `false` | 300s (default) | `shell: false`; output bounded to 100MB to prevent memory exhaustion; diagnostic stderr suppressed to avoid data leakage. |
| `tests/test_static_scanner.py:12, 55, 77, 86, 106` | `python` | `-m scanners.static.main tests/fixtures/static/ ...` | `false` | None | Test runner execution for automated unit testing. |

### 6.2 External Network Clients
| Location | Protocol / Client | Target / Endpoint | TLS Verification | SSRF Defense |
|---|---|---|---|---|
| `scanners/network/plugins/tls.py:92, 137` | Raw TCP socket (`socket.create_connection`) wrapped with `ssl.wrap_socket` | User-specified `target.resolved_ip:target.port` | **Disabled** (`CERT_NONE`, `check_hostname=False` in `_scan_direct_ssl`) | Hostname resolved via `validate_and_resolve` (blocks RFC1918 by default unless `--allow-private-targets`). |
| `scanners/network/plugins/ssh.py:88` | Raw TCP socket (`socket.create_connection`) | User-specified `host:port` | N/A (SSH transport) | Blocked from scanning private IPs unless explicitly allowed. |
| `scanners/static/llm_verifier.py:61` | HTTPS POST via `requests.post` | `https://api.groq.com/openai/v1/chat/completions` | **Enabled** (Standard certifi CA bundle) | Hardcoded API endpoint; only active when `--llm-verify` flag is explicitly passed. Code snippets sanitized prior to transmission. |
| `frontend/src/api/client.ts:83` | HTTP/HTTPS `fetch` | Backend API base URL (`VITE_API_BASE_URL` or relative `/api/v1`) | Browser default CA bundle | Frontend to backend API communication. |
| `backend/src/routes/scanner_pipeline.js:109` | Git over HTTPS / SSH (`git clone`) | User-specified Git URL | Default Git client TLS | Outbound network request to arbitrary external Git repositories. |

### 6.3 Filesystem Mutating APIs (Writes, Deletes, Directory Creation)
| Location | API Call | Target Path | Bound / Scope | Cleanup |
|---|---|---|---|---|
| `backend/src/routes/scanner_pipeline.js:97` | `fs.rmSync` | `targetDir` (`artifacts/uploads/scan_<id>`) | Cleans previous clone attempts | Local directory |
| `backend/src/routes/scanner_pipeline.js:99, 139, 232, 419` | `fs.mkdirSync` | `targetDir`, `uploadDir` | Recursive creation within `artifacts/uploads/` | Process scoped |
| `backend/src/routes/scanner_pipeline.js:145, 185, 241, 428` | `fs.writeFileSync` | `tempZipPath` (`artifacts/uploads/<id>.zip`) | Uploaded buffer (max 50MB) | Removed via `fs.unlinkSync` in `finally` |
| `backend/src/routes/scanner_pipeline.js:252, 441` | `fs.writeFileSync` | `path.join(uploadDir, safeName)` | Individual uploaded files | Stored in upload directory |
| `backend/src/routes/scanner_pipeline.js:286, 361, 488` | `fs.mkdirSync` | `path.dirname(tempOut)` (`artifacts/temp_<type>_<id>.json`) | Intermediate CBOM JSON | Removed via `fs.unlinkSync` after ingestion |
| `backend/src/scripts/import_cbom.js:22-23` | `fs.mkdirSync`, `fs.writeFileSync` | Summary and annotated CBOM out paths | CLI controlled output | Persisted on disk |
| `scanners/static/main.py:207, 211, 220` | `Path.write_text` | CBOM output and SARIF output paths | CLI controlled output | User requested files |
| `scanners/network/main.py:83` | `Path.write_text` | CBOM output path | CLI controlled output | User requested file |
| `scanners/binary_container/main.py:55, 59` | `Path.write_text` | CBOM output path | CLI controlled output | User requested file |

### 6.4 Parsers
| Parser Category | File / Implementation | Engine / Library | Safety & Resource Bounds |
|---|---|---|---|
| **CycloneDX CBOM JSON** | `backend/src/services/cbom_validation.js:20, 60` | `JSON.parse` + Ajv Schema Validation | Size limit: 10MB (max 50MB); component count limit: 10,000; depth limit: 20 levels; prototype pollution guard (`__proto__`, `constructor.prototype`). |
| **C / C++ AST Parser** | `scanners/static/ast/c_handler.py:10`, `cpp_handler.py:10` | `tree_sitter` C / C++ grammar | Max file size: 5MB (configurable up to 100MB); max files: 10,000; native memory bounds in tree-sitter C runtime. |
| **Go AST Parser** | `scanners/static/ast/go_handler.py:10` | `tree_sitter` Go grammar | Same file size and discovery count limits. |
| **JavaScript AST Parser** | `scanners/static/ast/javascript_handler.py:10` | `tree_sitter` JS grammar | Same file size and discovery count limits. |
| **X.509 Certificate Parser** | `scanners/network/cert_parser.py:15`, `plugins/tls.py:152` | `cryptography.x509.load_der_x509_certificate` | Strict DER/PEM parsing via pyca/cryptography Rust/C backend; handles malformed and self-signed certificates without crashing. |
| **Syft CycloneDX Output** | `scanners/binary_container/syft_runner.py:53` | `json.loads` | Output bound: 100MB string limit enforced before `json.loads()`. |
| **Multipart HTTP Uploads** | `backend/src/routes/cbom.js:14`, `scanner_pipeline.js:175` | `multer.memoryStorage()` | Memory bounds: 10MB on `/api/v1/cboms`, 50MB on `/scan/*`; max 250 files per upload. |
| **Rule Configuration JSON** | `backend/src/risk_engine/rules_loader.js:40` | `JSON.parse` | Validated against 5 formal JSON Schemas (`rules/schemas/*.schema.json`) via Ajv at server startup. |

### 6.5 Archive Extractors
| File | Extractor Mechanism | Target Path | Path Traversal / Zip Slip Defense Status |
|---|---|---|---|
| `backend/src/routes/scanner_pipeline.js:140` | `python -m zipfile -e <zipFilePath> <targetDir>` | `artifacts/uploads/scan_<id>/` | **Vulnerability Risk**: Standard `zipfile -e` CLI does not strictly sanitize relative traversal components (`../`) in archive headers on all Python platforms. Must be replaced with an explicit canonical path validator ensuring every extracted member resolves within `targetDir`. |
| `backend/src/routes/scanner_pipeline.js:243, 430` | Invocations of `extractZipArchive()` | Target directories | Dependent on extractor implementation above. |

### 6.6 Privilege Operations & Container Boundary
| Layer | Mechanism | Current State | Least-Privilege Requirement |
|---|---|---|---|
| **Backend Docker Container** | `backend/Dockerfile:19` | Drops root: `USER node` (UID 1000). Runs non-root. | **Compliant**: Runs as non-root unprivileged node user. |
| **Backend File Permissions** | `backend/Dockerfile:16-17` | `chmod 0555 /usr/local/bin/ecdat-backend`, `chown -R node:node /app /rules` | Read-only executable binary. |
| **Scanner Docker Container** | `docker/scanner.Dockerfile:1` | **No `USER` directive**: defaults to root (UID 0)! | **Non-Compliant**: Must create an unprivileged user (e.g. `ecdat_scanner`) and set `USER ecdat_scanner`. |
| **Docker Compose Services** | `docker-compose.yml:91-102` | Scanner runs with `network_mode: none`, mounts `./:/workspace:ro`. Runs as root. | Needs explicit user specification and `cap_drop: ALL`. |
