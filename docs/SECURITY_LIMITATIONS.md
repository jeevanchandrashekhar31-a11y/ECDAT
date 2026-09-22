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
- **Network Scanner**: Accuracy has been spot-checked on curated endpoints (e.g., BadSSL test fixtures) but has not been measured against a statistically comprehensive golden corpus.
- **Binary & Container Scanner**: Parsing has been spot-checked against specific ELF, Mach-O, and PE test fixtures; it has not undergone formal golden corpus precision/recall evaluation.

---

## 4. LLM-Assisted Verification
- The LLM verification module (`scanners/static/llm_verifier.py`) is an optional, experimental component.
- It requires third-party API keys (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) and outbound network connectivity.
- It is disabled by default in CI (`ECDAT_LLM_VERIFY=false`) to ensure deterministic, reproducible scan behavior without external API dependencies.

---

## 5. Database Schema & Migration Management
- Database tables are initialized using a procedural SQL initialization script (`backend/src/scripts/prepare_db.js`).
- ECDAT does not use a managed, versioned migration framework (such as Flyway, Liquibase, Knex migrations, or Alembic).
- Automated rollbacks, schema branching, and zero-downtime schema migrations are not supported.

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
- Running `python -m pytest -q` in the current verification session resulted in **1052 passed, 11 failed** out of 1063 collected tests.
- The 11 failing test cases correspond to optional pre-generated security evidence manifest paths and environment configuration checks, rather than core cryptographic detection logic.
