# ECDAT Pre-Remediation Forensic Inventory & Threat Surface

> **Auditor Stance**: Principal Security Engineer, Application Security Architect, Cloud Security Engineer, Cryptography Engineer.
> **Operational Charter**: Absolute Rules 1, 2, 3, and 4. Zero trust in claims, no fake tech, fail-closed everywhere, invariant security.

## 1. Executive Forensic Summary
- **Total Endpoints Cataloged**: `194`
- **System Domains Audited**: `30`
- **Critical Pre-Remediation Vulnerabilities Discovered**:
  1. **Fail-Open Auth Bypass** (`backend/src/middleware/auth.js`): `demoPipelinePaths` permits unauthenticated `POST /cbom/merge` and related endpoints.
  2. **Actor & Role Spoofing** (`backend/src/routes/policy.js`): `getActorFromReq()` blindly trusts `x-actor-role` and `x-actor-username` HTTP headers.
  3. **Unprotected Bulk Deletion** (`backend/src/routes/scans.js`): `DELETE /api/v1/scans` lacks RBAC role guards, allowing any token holder to wipe the inventory.
  4. **Arbitrary Collection Insertion** (`backend/src/routes/tenancy.js`): `POST /api/v1/tenancy/database/records` accepts arbitrary collections and payloads without role enforcement.
  5. **Exception Swallowing in Security Gate** (`scanners/vulnerability_release_gate.py`): Anti-tamper and override validation exceptions swallowed by `except Exception: pass`.
  6. **Overly Broad Secret Scanner Whitelist** (`scripts/release_gate.py`): Whitelists entire folders (`tests`, `docs`, `examples`) instead of specific mock key fixtures.
  7. **Runtime/eBPF Capability Misrepresentation**: In-memory event ingestion model and probe catalog represented as an active kernel eBPF tracer.

---

## 2. API Endpoint Forensic Inventory

| METHOD | PATH | AUTH REQUIRED? | AUTHORIZATION REQUIRED? | ROLE REQUIRED? | TENANT REQUIRED? | INPUT VALIDATION | RATE LIMIT | CSRF REQUIREMENT | AUDIT LOG | RESOURCE OWNERSHIP | SECURITY CONSEQUENCE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v1/assets` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Remote repo cloning, network egress, git argument injection risk |
| `GET` | `/api/v1/assets/:assetId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/audit/events` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/audit/verify` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/audit/summary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/audit/export` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/audit/events` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/auth/oidc/login` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `POST` | `/api/v1/auth/oidc/callback` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/ldap/login` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/token/refresh` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/token/revoke` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/local/register` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/local/login` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | YES (Audit Ledger / DB) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/mfa/setup` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/mfa/enable` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/mfa/verify` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `GET` | `/api/v1/auth/csrf-token` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | ENFORCED (Cookie-to-Header Token Matching) | NO (Standard requestLogger only) | Global | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `POST` | `/api/v1/auth/cookie/login` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | ENFORCED (Cookie-to-Header Token Matching) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/logout` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | YES (Audit Ledger / DB) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/auth/logout-all` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `GET` | `/api/v1/auth/me` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `POST` | `/api/v1/auth/secrets/rotate` | **YES (Global apiKeyAuthMiddleware)** | YES | `None (Authenticated)` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Controlled: Requires privilege 'None (Authenticated)' |
| `GET` | `/api/v1/auth/rbac/catalog` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `GET` | `/api/v1/auth/rbac/my-permissions` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `POST` | `/api/v1/auth/rbac/check` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/auth/audit` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Session lifecycle mutation, token generation, or authentication verification |
| `POST` | `/api/v1/cboms` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/cbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/cboms/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/cbom/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `GET` | `/api/v1/cboms` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/cbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/cboms/:id` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/cbom/:id` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/certificates` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/certificates/summary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/certificates/anomalies` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/certificates/:fingerprint` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/certificates/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/ci/status` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/ci/scan` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/ci/gate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/ci/vulnerability-release-gate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/ci/sarif` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/ci/sarif/validate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/ci/feedback` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/ci/rules/:id/guidance` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/compliance/standards` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/compliance/standards/:standardId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/compliance/assess` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/compliance/evidence-bundle` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/dashboard/views` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/dashboard/graph` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/dashboard/summary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/findings` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Remote repo cloning, network egress, git argument injection risk |
| `GET` | `/api/v1/findings/:findingId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/graph` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/health` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/health` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/integrations/kms/connectors` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/integrations/kms/register` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/kms/test-connection` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/kms/discover` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/kms/to-cbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/kms/validate-policy` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/metrics` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/metrics` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/metrics/prometheus` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/metrics/prometheus` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/metrics/operational` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/metrics/operational` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/metrics/operational/:dimension` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/metrics/operational/:dimension` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/metrics/record` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/metrics/record` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/evaluate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/validate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/policy/rules` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/policy/versions` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/policy/draft` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/:version/submit` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/:version/approve` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/:version/reject` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/:version/activate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/rollback` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/test` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/policy/audit-log` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/policy/sign` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/policy/verify-signature` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/plan` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/plan/:findingId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/simulate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/generate-patch` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/verify-patch` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/apply-patch` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/propose` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/remediation/approvals` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/remediation/approvals/:approvalId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/remediation/approvals/:approvalId/review` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/:approvalId/approve` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/:approvalId/apply` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/:approvalId/verify` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/:approvalId/rollback` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/remediation/approvals/:approvalId/reject` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/reports/summary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/executive` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/executive/html` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/executive/export` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/technical` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/technical/html` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/technical/:findingId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/reports/integrity/verify` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/reports/integrity/status` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/cbom/:scanId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/:id/html` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | YES (Audit Ledger / DB) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/reports/:id/summary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/sbom/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sbom/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sboms/ingest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/sbom/validate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sbom/validate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sboms/validate` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/sbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/sboms` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/scan/static` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/scan/static` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/scan/network` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/scan/network` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/scan/binary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/api/v1/scan/binary` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Multer file size limit (100MB), memory buffer, extension check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Resource exhaustion, Zip-Slip, or archive bomb processing |
| `POST` | `/cbom/merge` | **FAIL-OPEN BYPASS (demoPipelinePaths allows unauthenticated execution)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | HIGH: Remote repo cloning, network egress, git argument injection risk |
| `POST` | `/api/v1/cbom/merge` | **FAIL-OPEN BYPASS (demoPipelinePaths allows unauthenticated execution)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | HIGH: Remote repo cloning, network egress, git argument injection risk |
| `POST` | `/cbom/quantum-risk` | **FAIL-OPEN BYPASS (demoPipelinePaths allows unauthenticated execution)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `POST` | `/api/v1/cbom/quantum-risk` | **FAIL-OPEN BYPASS (demoPipelinePaths allows unauthenticated execution)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | CRITICAL: Unauthenticated execution of resource-heavy cryptographic risk pipeline |
| `GET` | `/cbom/merged` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/cbom/merged` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/cbom/risk` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/cbom/risk` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/cbom/pqc-report` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/cbom/pqc-report` | **NO (Public endpoint)** | NO (Any valid token / API key) | `None` | NO (Public / Unscoped) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (Public Auth / Health) | NO (Standard requestLogger only) | Global | Low (Informational / Observability) |
| `GET` | `/api/v1/scans` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `DELETE` | `/api/v1/scans` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | CRITICAL: Irreversible destruction of cryptographic inventory/scans/policies |
| `GET` | `/api/v1/scans/:scanId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/scans/:scanId/errors` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/validate-url` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/validate-path` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/inspect-injection` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/protected-user-profile` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/security/tenants/:tenantId/assets/:assetId` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/validate-asset` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/security/data-classification` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/data-classification/classify` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/security/data-classification/domain/:domain` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/security/documented-secret-exceptions` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/validate-secret-storage` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/encrypt-at-rest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/decrypt-at-rest` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/security/transit-status` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/security/database/least-privilege-roles` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/security/database/audit-logs` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/security/database/retention-policy` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/database/prune` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/database/backups` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/security/database/backups` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/security/database/backups/:id/verify` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/security/database/test-query` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/siem/events` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/siem/forward` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/siem/config` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `PUT` | `/api/v1/siem/config` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/siem/schema` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/tenancy/me` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/tenancy/database/records` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/tenancy/database/records` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/tenancy/database/records/:id` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/tenancy/storage/upload` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/tenancy/storage/:key` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/tenancy/cache` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/tenancy/cache/:key` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/tenancy/jobs` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/tenancy/jobs` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/tenancy/queues/publish` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/tenancy/queues/consume` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `GET` | `/api/v1/tenancy/exports/sarif` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/tenancy/exports/cbom` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/tenancy/audit` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Inline parameter check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `GET` | `/api/v1/integrations/ticketing/connectors` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | Low (Informational / Observability) |
| `POST` | `/api/v1/integrations/ticketing/register` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/ticketing/preview` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/ticketing/create` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Schema / Validator function check | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/ticketing/test` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |
| `POST` | `/api/v1/integrations/ticketing/batch` | **YES (Global apiKeyAuthMiddleware)** | NO (Any valid token / API key) | `None` | YES (TenantContext fallback to default-tenant) | Unvalidated / Body Parser Limit only | YES (Global resourceExhaustionGuard only) | EXEMPT (API Key / Bearer Auth) | NO (Standard requestLogger only) | Tenant-Scoped | HIGH: Mutation of security state, policy, or findings without role check |

---

## 3. Domain-by-Domain Forensic Audit

### 3.API_ROUTES
```json
{
  "total_routes_detected": 194,
  "security_consequences_breakdown": {
    "CRITICAL": 38,
    "HIGH": 75,
    "MEDIUM": 0,
    "LOW": 80,
    "CONTROLLED": 1
  }
}
```

### 3.ARCHIVE_EXTRACTION
```json
{
  "engine": "scanners/common/archive_guard.py",
  "protections": [
    "Zip Slip defense: Canonical path resolution (Path.resolve().relative_to(dest_dir))",
    "Tar Bomb defense: Extraction size cap (--max-size-mb 500) and max file count (--max-files 50000)",
    "Compression ratio defense: Maximum allowable compression ratio threshold",
    "Symlink traversal defense: Resolves symlinks and blocks targets outside destination root"
  ],
  "status": "HARDENED"
}
```

### 3.AUTHENTICATION
```json
{
  "mechanisms": [
    "API Key (X-API-Key or Authorization: Bearer/ApiKey)",
    "JWT Access Token (HS256 short-lived 15m)",
    "Session Cookie (ecdat_access_token, HttpOnly, SameSite=Strict, Secure)",
    "Local Username/Password (scrypt password hashing with unique salt)",
    "LDAP / Active Directory (ldapjs integration with TLS)",
    "OpenID Connect / OIDC (Authorization Code Flow with PKCE)"
  ],
  "strengths": [
    "Timing-safe string comparison using crypto.timingSafeEqual for API keys and password verification.",
    "Multi-credential support with clear precedence (Header > Cookie)."
  ],
  "vulnerabilities": [
    "FAIL-OPEN BYPASS in backend/src/middleware/auth.js: demoPipelinePaths list allows unauthenticated requests to /cbom/merge, /cbom/quantum-risk, etc.",
    "Actor spoofing in backend/src/routes/policy.js: getActorFromReq() trusts unverified x-actor-role and x-actor-username request headers."
  ]
}
```

### 3.AUTHORIZATION
```json
{
  "model": "Role-Based Access Control (RBAC) with domain permission mapping",
  "enforcement_points": [
    "backend/src/middleware/rbac.js",
    "backend/src/middleware/auth.js"
  ],
  "privilege_escalation_defenses": [
    "Vertical Privilege Escalation: checked via requirePermission()",
    "Horizontal Privilege Escalation: tenant-boundary checks in tenant_isolation.js"
  ],
  "vulnerabilities": [
    "Vast majority (180/194) of endpoints lack explicit requireRole/requirePermission checks, relying solely on generic API key presence."
  ]
}
```

### 3.BACKEND
```json
{
  "framework": "Express 4.21.2",
  "runtime": "Node.js 20 LTS (node:20-alpine in Docker)",
  "entrypoints": [
    "backend/src/server.js",
    "backend/src/app.js"
  ],
  "architecture_pattern": "Modular Router-Service-Repository pattern with express middleware pipeline",
  "findings": [
    "Express trust proxy is disabled by default; rate limiting on IP behind reverse proxies requires TRUST_PROXY=true configuration.",
    "Body parser limit MAX_JSON_SIZE defaults to 50mb, allowing potential memory consumption spikes under high concurrency.",
    "All write routes fall back to requiring ECDAT_API_KEY if configured, but read routes default to anonymous allow when REQUIRE_AUTH_FOR_READS=false."
  ]
}
```

### 3.BENCHMARKS
```json
{
  "synthetic_corpora": [
    "tests/fixtures/large_repos/100k_loc",
    "tests/fixtures/large_repos/500k_loc",
    "tests/fixtures/large_repos/1m_loc"
  ],
  "golden_corpus": "testing/corpora/golden_corpus (11 cryptographic test suites for ground truth recall & precision)",
  "records": "artifacts/benchmarks/benchmark_report.json"
}
```

### 3.CICD
```json
{
  "workflows": [
    ".github/workflows/ci.yml (Linting, static analysis, unit tests, coverage)",
    ".github/workflows/ecdat-scan.yml (Automated CBOM generation and database ingestion)",
    ".github/workflows/release-gate.yml (Full 6-gate release evaluation, SLSA provenance, cosign)"
  ],
  "supply_chain_security": [
    "SLSA Level 3 build provenance generated by scripts/generate_provenance.py",
    "Cosign-installer action with immutable commit SHA pin",
    "npm audit and pip-audit automated dependency scanning",
    "Ed25519 digital signing of SHA256SUMS and SHA512SUMS manifests"
  ]
}
```

### 3.CRYPTOGRAPHY
```json
{
  "classical_risk_catalog": "rules/algorithm_risk.json (MD5, SHA-1, DES, 3DES, RC4, RSA-1024, ECC-160)",
  "pqc_catalog": "rules/pqc_algorithm_catalog.json (NIST FIPS 203 ML-KEM, FIPS 204 ML-DSA, FIPS 205 SLH-DSA, Kyber, Dilithium, Falcon, SPHINCS+)",
  "quantum_risk_gap": "Mosca's Theorem Engine: X (Shelf life) + Y (Migration time) > Z (CRQC timeline)",
  "crypto_agility_engine": "scanners/crypto_agility.py (Hardcoded key detection, algorithm agility scoring 0-100)"
}
```

### 3.DATABASE_ACCESS
```json
{
  "query_builder": "Knex.js",
  "driver": "pg (PostgreSQL)",
  "least_privilege_roles": [
    "ecdat_app",
    "ecdat_migrator",
    "ecdat_readonly"
  ],
  "migrations": "backend/src/db/migrations (Versioned SQL migrations with schema validation)",
  "retention_policy": "backend/src/db/retention_policy.js (Configurable data purging for scans and audit logs)",
  "findings": [
    "Parameterized queries are used consistently in Knex; raw SQL queries are guarded by secure_query.js sanitization.",
    "Database connection skips gracefully in unit tests when PostgreSQL is offline, preventing test crashes in headless environments."
  ]
}
```

### 3.DOCKER
```json
{
  "dockerfiles": [
    "backend/Dockerfile (node:20-alpine, non-root ecdat user, dumb-init)",
    "frontend/Dockerfile (node:20-alpine build -> nginx:alpine-slim unprivileged)",
    "docker/scanner.Dockerfile (python:3.12-slim, non-root user, security scanner dependencies)"
  ],
  "compose": "docker-compose.yml (PostgreSQL 16, backend, frontend, scanner service with healthchecks)",
  "auditor": "scanners/container_hardening_auditor.py (Checks base images, root users, package manager caches)"
}
```

### 3.DOCUMENTATION
```json
{
  "canonical_docs": [
    "README.md",
    "SECURITY.md",
    "SUPPLY_CHAIN_SECURITY.md",
    "docs/ARCHITECTURE.md",
    "docs/THREAT_MODEL.md",
    "docs/API_DOCUMENTATION.md",
    "docs/ECDAT_CBOM_SCHEMA_CONTRACT.md",
    "docs/TARGET_STRUCTURE.md",
    "docs/FEATURE_PARITY_AUDIT.md",
    "docs/OPERATOR_RUNBOOKS.md"
  ],
  "findings": [
    "Documentation previously contained unverified claims of 10/10 parity and live kernel eBPF tracing; these must be aligned with actual implementation."
  ]
}
```

### 3.EBPF_RUNTIME_SECURITY
```json
{
  "status": "SPECIFICATION / DATA MODEL ONLY (Rule 2 Compliance Mandatory)",
  "real_components": [
    "rules/runtime_probes_catalog.json (Catalog of 40+ crypto library function symbols)",
    "scanners/runtime/engine.py: KernelCapabilityChecker (Checks /sys/fs/bpf, Linux OS, root/CAP_BPF)",
    "scanners/runtime/engine.py: assert_metadata_only (Sanitizer stripping private keys/plaintext from events)",
    "scanners/runtime/security_boundary.py: Resource monitoring & memory limit enforcement"
  ],
  "missing_components": [
    "NO compiled C/eBPF bytecode programs (.o or .bpf.c) in repository.",
    "NO live libbpf / BCC loader attaching uprobes to running processes.",
    "NO real-time kernel ring-buffer event stream consumer."
  ],
  "verdict": "Architecture must honestly document runtime discovery as a data model and probe catalog, NOT an active in-kernel eBPF agent."
}
```

### 3.FRONTEND
```json
{
  "framework": "React 18.3.1 + TypeScript 5.5 + Vite 5.4",
  "css_framework": "TailwindCSS 3.4",
  "routing": "react-router-dom 6.26",
  "state_management": "React Context + TanStack Query / Axios API Client",
  "token_storage": "Dual mode: Supports HTTP-Only session cookies with CSRF defense, or LocalStorage / Memory Bearer tokens in API client.",
  "findings": [
    "frontend/src/api/client.ts falls back to storing API key in localStorage if cookie authentication is not present.",
    "Crypto graph canvas renders SVG directly with React JSX sanitization; no dangerouslySetInnerHTML calls detected in main pages."
  ]
}
```

### 3.GIT_OPERATIONS
```json
{
  "function": "runGitClone in backend/src/routes/scanner_pipeline.js",
  "command": "git clone --depth 1 [-b <branch>] <url> <targetDir>",
  "protections": [
    "spawn() called with shell: false (prevents shell command chaining via semicolons/backticks)",
    "URL scheme whitelist: must start with https://, http://, or git@",
    "Timeout cap: 60,000 ms with SIGKILL termination"
  ],
  "vulnerabilities": [
    "Potential Git argument injection if user provides repoUrl beginning with '--upload-pack=' or options; URL validation requires regex anchoring."
  ]
}
```

### 3.INTEGRATIONS
```json
{
  "kms": {
    "connectors": [
      "AWS KMS (boto3)",
      "Azure Key Vault (azure-keyvault-keys)",
      "Google Cloud KMS (google-cloud-kms)",
      "HashiCorp Vault Transit (hvac)"
    ],
    "router": "backend/src/routes/kms.js"
  },
  "siem": {
    "connectors": [
      "Splunk HEC",
      "Elasticsearch Bulk Indexing",
      "Syslog RFC 5424"
    ],
    "router": "backend/src/routes/siem.js"
  },
  "ticketing": {
    "connectors": [
      "Jira REST API v3",
      "ServiceNow Table API",
      "GitHub Issues REST API"
    ],
    "router": "backend/src/routes/ticketing.js"
  }
}
```

### 3.KUBERNETES
```json
{
  "helm_chart": "deploy/helm/ecdat/",
  "manifests": "deploy/k8s/ (10 YAML manifests)",
  "security_contexts": [
    "runAsNonRoot: true (UID 10001)",
    "readOnlyRootFilesystem: true with tmpfs /tmp",
    "allowPrivilegeEscalation: false",
    "capabilities.drop: ['ALL']"
  ],
  "network_policies": "Deny-all ingress/egress default with explicit namespace egress rules",
  "auditor": "scanners/k8s_hardening_auditor.py (Evaluates manifests against CIS Kubernetes Benchmark)"
}
```

### 3.LOGGING
```json
{
  "engine": "backend/src/middleware/security.js & backend/src/audit/audit_service.js",
  "format": "Structured JSON with ISO timestamps, correlation ID, method, path, status, latency",
  "sanitization": "Redacts Authorization headers, passwords, secrets, and private keys before output",
  "audit_ledger": "Cryptographic tamper-evident hash chaining for audit events"
}
```

### 3.MFA
```json
{
  "engine": "backend/src/identity/mfa_totp.js",
  "algorithm": "RFC 6238 TOTP (SHA-1, 6 digits, 30s step)",
  "features": [
    "Secret generation (base32)",
    "otpauth:// URI generation for Google Authenticator/Authy",
    "Verification with +/- 1 time-step window",
    "10 single-use hashed recovery backup codes"
  ],
  "status": "OPERATIONAL"
}
```

### 3.MIDDLEWARE
```json
{
  "pipeline_order": [
    "tlsEnforcementMiddleware",
    "helmetMiddleware",
    "corsMiddleware",
    "requestIdMiddleware",
    "metricsMiddleware",
    "requestLoggerMiddleware",
    "excessiveDataExposureFilter",
    "express.json",
    "express.urlencoded",
    "injectionProtectionMiddleware",
    "resourceExhaustionGuard",
    "csrfProtectionMiddleware",
    "apiKeyAuthMiddleware",
    "tenantIsolationMiddleware",
    "notFoundHandler",
    "errorHandler"
  ],
  "findings": [
    "CSRF protection is active globally but exempts requests using X-API-Key or Authorization Bearer tokens.",
    "injectionProtectionMiddleware performs regex inspection on query parameters and body keys for SQLi and NoSQLi patterns."
  ]
}
```

### 3.MONITORING
```json
{
  "engine": "backend/src/metrics/index.js (prom-client)",
  "endpoint": "/metrics and /api/v1/metrics",
  "metrics_collected": [
    "http_request_duration_seconds (Histogram)",
    "http_requests_total (Counter)",
    "scans_processed_total (Counter)",
    "findings_detected_total (Counter by severity)",
    "quantum_vulnerability_gauge (Gauge)"
  ]
}
```

### 3.NETWORK_SCANNING
```json
{
  "engine": "scanners/network/main.py and scanners/network/tls_scanner.py",
  "protections": [
    "Target authorization filter: IP range whitelist/blacklist",
    "SSRF defense: Blocks loopback (127.0.0.1, ::1) and link-local (169.254.169.254) unless explicitly authorized",
    "Connection timeout: 10s per handshake to prevent hanging sockets"
  ]
}
```

### 3.RBAC
```json
{
  "roles": [
    "platform administrator",
    "security administrator",
    "analyst",
    "developer",
    "auditor",
    "viewer"
  ],
  "catalog_path": "rules/compliance_catalog.json & backend/src/middleware/rbac.js",
  "role_hierarchy": "platform administrator > security administrator > analyst > developer > auditor > viewer",
  "findings": [
    "DELETE /api/v1/scans has NO requireRole check; any authenticated user with viewer permissions can wipe all scan data.",
    "POST /api/v1/tenancy/database/records has NO role check; any user can write records to arbitrary database collections."
  ]
}
```

### 3.SBOM_CBOM
```json
{
  "cbom_spec": "CycloneDX 1.6 Cryptographic Bill of Materials (CBOM)",
  "sbom_spec": "CycloneDX 1.6 & SPDX 2.3",
  "schemas": "rules/schemas/ (CycloneDX 1.6 CBOM schema validation)",
  "diff_engine": "scanners/cbom_diff.py (Semantic comparison of crypto assets, algorithms, and key sizes across scans)",
  "pqc_model": "CryptoProperties extension: oid, algorithm, curve, keySize, quantumSecurityLevel (NIST Levels 1-5)"
}
```

### 3.SCANNERS
```json
{
  "static_scanner": {
    "languages": [
      "Python",
      "C/C++",
      "Java",
      "JavaScript/TypeScript",
      "Go",
      "Rust",
      "C#"
    ],
    "parsers": [
      "AST Parser (Tree-Sitter / python ast)",
      "Regex Rules Fallback",
      "Groq AI Verifier (optional)"
    ],
    "status": "OPERATIONAL"
  },
  "network_scanner": {
    "engine": "SSLyze + Python raw SSL socket wrapper",
    "capabilities": [
      "TLS 1.0-1.3 detection",
      "Cipher suite evaluation",
      "X.509 certificate chain extraction",
      "PQC KEM handshake evaluation"
    ],
    "status": "OPERATIONAL"
  },
  "binary_container_scanner": {
    "engine": "ELF/PE/Mach-O binary string/import parser + Anchore Syft runner",
    "capabilities": [
      "ELF dynamic symbol extraction",
      "PE export directory parsing",
      "Mach-O load command parsing",
      "Container image filesystem layer unpacking"
    ],
    "status": "OPERATIONAL"
  },
  "filesystem_scanner": {
    "capabilities": [
      "Recursive directory traversal",
      "Containment verification",
      "Symlink loop detection",
      "Binary vs text file classification"
    ],
    "status": "OPERATIONAL"
  }
}
```

### 3.SECRETS
```json
{
  "detector": "scanners/static/secret_detector.py & scripts/release_gate.py",
  "patterns": [
    "AWS Access Keys",
    "GitHub PATs",
    "Slack Tokens",
    "Private Key PEM Blocks",
    "OpenAI Keys",
    "High-Entropy Strings"
  ],
  "entropy_algorithm": "Shannon entropy calculation (threshold 4.5 bits/char)",
  "vulnerabilities": [
    "SECRET_WHITELIST_PATHS in scripts/release_gate.py broadly skips entire directories ('tests', 'docs', 'examples') instead of specific fixture filenames."
  ]
}
```

### 3.TENANT_ISOLATION
```json
{
  "engine": "backend/src/tenancy/tenant_isolation.js",
  "layers": [
    "API Layer",
    "Database Layer",
    "Storage Layer",
    "Job Queue",
    "Cache",
    "Queues",
    "Exports",
    "Audit Logs"
  ],
  "findings": [
    "TenantContext.fromRequest(req) defaults tenantId to 'default-tenant' when X-Tenant-ID header or JWT claim is absent.",
    "Client-supplied X-Tenant-ID headers are accepted unless isPlatformAdmin is strictly checked, allowing horizontal tenant probing if JWT does not lock tenant ID."
  ]
}
```

### 3.TESTS
```json
{
  "python_tests": "tests/ (Unit, integration, hostile repo regression, scale benchmarks)",
  "backend_tests": "backend/tests/ (Jest API and unit test suites)",
  "frontend_tests": "frontend/src/ (Vitest component and page tests)",
  "adversarial_tests": "tests/redteam/ (20 CWE exploit scenarios including zip bombs, timing leaks, symlink loops, privilege escalation)",
  "coverage": "Enforced via pytest-cov with minimum branch coverage thresholds"
}
```

### 3.TOKEN_MANAGEMENT
```json
{
  "engine": "backend/src/identity/token_service.js",
  "access_token_ttl": "15 minutes",
  "refresh_token_ttl": "7 days",
  "revocation": "In-memory and DB-backed revocation token blacklist with TTL cleanup",
  "features": [
    "Single token revocation (/auth/token/revoke)",
    "All-sessions logout (/auth/logout-all)",
    "Token rotation on refresh"
  ]
}
```

### 3.UPLOADS
```json
{
  "handler": "Multer in backend/src/routes/scanner_pipeline.js",
  "storage": "MemoryStorage (bounded buffer)",
  "size_limit": "100 MB per file, max 250 files per archive/request",
  "temp_directory": "artifacts/uploads/scan_<timestamp>/",
  "findings": [
    "Upload files are written to temporary disk folders for scanning.",
    "Pre-cleanup audit identified 5 orphaned upload scan directories in artifacts/uploads/ which were purged in the previous phase."
  ]
}
```

### 3.VULNERABILITY_SCANNING
```json
{
  "engine": "scanners/vulnerability_release_gate.py",
  "policy": "rules/vulnerability_release_policy.json",
  "anti_tamper": "rules/vulnerability_risk_acceptance.json with SHA-256 and cryptographic justification validation",
  "severity_tiers": {
    "CRITICAL": "Release Blocker (0 tolerance)",
    "HIGH": "Conditional Blocker (Requires signed risk acceptance)",
    "MEDIUM": "Tracked Remediation (60 day SLA)",
    "LOW": "Tracked Improvement (180 day SLA)"
  },
  "vulnerabilities": [
    "Broad 'except Exception: pass' blocks in _load_policy() and _load_severity_overrides() swallow tamper validation errors, violating Rule 3."
  ]
}
```
