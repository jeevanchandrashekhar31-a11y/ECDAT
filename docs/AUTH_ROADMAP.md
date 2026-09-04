# ECDAT Authentication & Authorization Roadmap

This document outlines ECDAT's evolutionary authentication and authorization architecture, progressing from the Phase 6.5 MVP implementation to enterprise-grade Role-Based Access Control (RBAC) and OpenID Connect (OIDC) identity federation.

---

## 1. Current State: Phase 6.5 MVP (API-Key Authentication)

### Architecture
- **Environment Variable**: `ECDAT_API_KEY` defines the administrative key for demo and CLI integration.
- **Enforcement Boundary**:
  - Write routes (`POST`, `PUT`, `PATCH`, `DELETE`) mandatorily require authentication.
  - Read routes (`GET /api/v1/assets`, `GET /api/v1/findings`, `GET /api/v1/dashboard/summary`) remain open for reporting/dashboards by default, but can be strictly gated via `REQUIRE_AUTH_FOR_READS=true`.
  - Health check (`/health`, `/api/v1/health`) is unauthenticated for container orchestrator liveness probes.
- **Timing Attack Mitigation**: Key validation is performed in constant time via `crypto.timingSafeEqual`.
- **Zero Key Leakage**:
  - Request logging strips `X-API-Key`, `Authorization` headers, and `apiKey` query parameters.
  - Error handlers never echo secret material in HTTP response bodies or stack traces.

```text
Incoming Request
       │
       ▼
[Helmet & CORS Allowlist]
       │
       ▼
[Request Sanitizer & Logger] (Redacts X-API-Key / Authorization)
       │
       ▼
[API Key Auth Middleware] ─── Missing Key ──────► 401 Unauthorized
       │                  ─── Invalid Key ──────► 403 Forbidden
       ▼ (Valid Key or Public Read)
[Target Route Controller]
```

---

## 2. Phase A: Scoped Machine-to-Machine & Service Tokens

### Objectives
Transition from a single static key to scoped, revocable API tokens for scanner services, CI/CD runners, and automated integrations.

### Planned Schema
```sql
CREATE TABLE api_keys (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL, -- Argon2id / SHA-256 with salt
    key_prefix VARCHAR(10) NOT NULL, -- e.g. "ecdat_live_..."
    scopes JSONB NOT NULL,          -- ["cbom:write", "scans:read", "reports:read"]
    created_by VARCHAR(100),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
```

### Scopes Hierarchy
- `cbom:ingest`: Ingestion of scanner CBOM files only.
- `scans:read`: Read-only access to scan summaries and error logs.
- `assets:read`: Read-only access to cryptographic inventory and findings.
- `policies:manage`: Create and update policy profiles and rulesets.
- `admin:*`: Unrestricted superuser permissions.

---

## 3. Phase B: Role-Based Access Control (RBAC)

### Objectives
Define user identities and coarse-grained permissions matching enterprise organizational structures.

### Standard Roles

| Role | Permissions | Use Case |
|---|---|---|
| **Security Admin** | Full Read & Write, Policy Configuration, Key Revocation | Enterprise Security Engineers managing crypto policies and PQC roadmaps. |
| **Compliance Auditor** | Read-Only Access to CBOMs, Reports, Risk Assessments, and Mosca Margins | Internal/external auditors assessing post-quantum regulatory compliance. |
| **DevOps / CI/CD Service** | `cbom:ingest`, `scans:read` (status only) | GitHub Actions, GitLab CI pipelines running static/network discovery. |
| **Viewer** | Read-Only Dashboard Metrics & Aggregate Counts (No raw code snippets) | Executive stakeholders tracking organizational PQC migration progress. |

---

## 4. Phase C: Enterprise OIDC & SSO Federation

### Objectives
Integrate seamlessly into enterprise Single Sign-On (SSO) systems without managing local user credentials.

### Target Identity Providers (IdP)
- **Keycloak** (Self-hosted open source)
- **Okta** / **Auth0**
- **Microsoft Entra ID** (Azure AD)
- **Google Workspace** / Cloud Identity

### Flow & Verification
1. **Standard JWT Tokens**: Clients authenticate with their IdP and submit standard OpenID Connect Bearer JWT tokens.
2. **JWKS Verification**: ECDAT verifies signatures dynamically using the IdP's JSON Web Key Set endpoint (`/.well-known/jwks.json`).
3. **Claims Mapping**: IdP group memberships (e.g. `sg-crypto-auditors`) automatically map to ECDAT RBAC roles.
4. **Tenant Isolation**: Multi-tenant deployments derive `project_id` and tenant boundaries from JWT claims, enforcing PostgreSQL Row-Level Security (RLS).

---

## 5. Summary of Architectural Decisions

- **Why Not Full RBAC/OIDC in MVP?** Avoid premature complexity and operational friction while establishing core scanner pipelines and PostgreSQL persistence.
- **Constant-Time Comparison**: Essential from day one to block remote timing side-channel attacks against API keys.
- **Header Priority**: Header-based authentication (`X-API-Key`, `Authorization: Bearer`) prevents secret leakage in server access logs and browser histories.
