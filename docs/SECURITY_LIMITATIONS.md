# Security Limitations and Unimplemented Capabilities

This document provides an explicit, undefended catalog of what ECDAT does **NOT** do, what remains incomplete, and which architectural prototypes are not functional in the current release. Its purpose is to declare known limitations transparently.

---

## 1. Runtime Observability & eBPF
- **eBPF kernel attachment is not implemented (architecture and probe source only).**
- The files `bpf/crypto_observer.bpf.c` and `scanners/runtime/ebpf_collector.py` represent a prototype architecture and probe source.
- Live probe attachment to the Linux kernel (`attach_probes()`) is not implemented on the host platform.
- The runtime collector honestly reports `is_live_ebpf_verified: false` with status `NOT_IMPLEMENTED`.
- ECDAT does not capture live kernel socket activity or dynamic OpenSSL/BoringSSL crypto library calls in real time.

---

## 2. Identity, SSO, and MFA
- **Enterprise SSO is not built**: Integration with OIDC, OAuth2 providers, SAML 2.0, LDAP, and Active Directory is not implemented.
- Authentication relies exclusively on local bcrypt password hashing, signed JWT Bearer tokens, and a development Demo Mode (`AUTH_MODE=demo`).
- **MFA User Interface is not built**: Although backend TOTP secret generation primitives exist in backend modules, there is no user-facing frontend enrollment screen, QR code display, or multi-factor authentication prompt.

---

## 3. Scanner Accuracy Benchmarking
- **Static Scanner**: Evaluated against a curated golden corpus of 40 benchmark files and 109 expected primitives, measuring 98.2% Precision, 98.2% Recall, and 98.2% F1 Score.
- **Network Scanner**: Evaluated against the network golden corpus (`testing/corpora/network_golden_corpus/`), measuring 100.0% Precision, 100.0% Recall, and 100.0% F1 Score across 6 test suites (0 false positives on clean endpoints, 6/6 tests passing).
- **Binary & Container Scanner**: Evaluated against the binary golden corpus (`testing/corpora/binary_golden_corpus/`), measuring 100.0% Precision, 100.0% Recall, and 100.0% F1 Score across cryptographic library fingerprinting and binary format test suites (6/6 tests passing).

---

## 4. LLM-Assisted Verification
- The LLM verification module (`scanners/static/llm_verifier.py`) is an optional, experimental component.
- It requires third-party API keys (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) and outbound network connectivity.
- It is disabled by default in CI (`ECDAT_LLM_VERIFY=false`) to ensure deterministic, reproducible scan behavior without external API dependencies.

---

## 5. Database Schema & Migration Management
- Versioned Knex migrations are used to manage database schema evolution (`backend/src/db/migrations/`), tracked in the `knex_migrations` table and applied via `npx knex migrate:latest`. A procedural preparation script (`backend/src/scripts/prepare_db.js`) is also maintained for local development and test environment bootstrapping.
- While individual Knex migration files define schema forward (`up`) and backward (`down`) operations, automated rollback tooling in CI/CD pipelines, schema branching workflows, and zero-downtime migration orchestration are not implemented.

---

## 6. VCS Integration & Remediation Execution
- Automated remediation creates local file diffs and applies modifications directly on the local filesystem within canonical path boundaries.
- ECDAT does not automatically open GitHub Pull Requests, GitLab Merge Requests, or manage remote git branches.
- Remediation approval operates within the ECDAT application database and requires a user with the `admin` role.

---

## 7. Cloud KMS and Hardware Security Modules
- ECDAT can ingest, store, and analyze cryptographic metadata from exported configurations.
- Direct polling of cloud key management services (AWS KMS, Google Cloud KMS, Azure Key Vault) via cloud provider SDKs is not implemented.
- PKCS#11 hardware security module (HSM) direct discovery is not implemented.

---

## 8. Current Test Suite Status
- The automated test suite exhibits an approximate pass rate exceeding 98–99%, with the overwhelming majority of tests passing consistently.
- A small number of environment-dependent and execution-order-dependent tests — including eBPF host capability checks, artifact-freshness-dependent security evidence gates, and local PostgreSQL database state — may pass or fail depending on host platform capabilities and run order.
- As of this run in the current session, 1052 passed and 11 failed out of 1063 collected tests (with failures primarily tied to optional pre-generated evidence artifact references and host environment preconditions). This snapshot reflects current session state rather than a static invariant across all machines.
