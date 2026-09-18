# ECDAT Enterprise Authorization Matrix & RBAC Verification Architecture

## 1. Executive Summary & Architecture Overview

The Enterprise Cryptographic Discovery and Analysis Tool (ECDAT) enforces a **strict, fail-closed, multi-tier Role-Based Access Control (RBAC)** architecture coupled with **Horizontal Multi-Tenant Boundary Defense** and **Four-Eyes Dual-Control Governance**.

Access control is evaluated authoritative server-side across all incoming requests. Every request is classified, authenticated against cryptographic credentials (constant-time API key or short-lived signed JWT), and evaluated against declared capability permissions before any business logic executes.

---

## 2. Canonical Enterprise Roles

ECDAT models 7 distinct security principals across two operational scopes:

| Role Identifier | Canonical Role Name | Operational Scope | Description |
|:---|:---|:---|:---|
| `anonymous` | **Anonymous / Public** | Unauthenticated | Public health check endpoints (`/health`) and public authentication endpoints only. Zero access to tenant or sensitive data. |
| `viewer` | **Viewer** | Single-Tenant (Read-Only) | Read-only visibility into tenant assets, scans, CBOM, compliance reports, and findings. No mutations or scan triggers. |
| `analyst` | **Threat & Crypto Analyst** | Single-Tenant | Threat modeling, PQC migration risk analysis, triggering scans, triaging/suppressing findings, and proposing remediation patches. Cannot approve or apply patches. |
| `developer` | **Software Engineer / DevOps** | Single-Tenant | CI/CD pipeline triggers, CBOM generation, static and binary scanner execution, proposing patches. Cannot approve security policies or deploy to production. |
| `auditor` | **Compliance Officer / Auditor** | Single-Tenant (Read-Only) | Dedicated, strictly read-only access to tamper-resistant audit logs, compliance evidence bundles, and cryptographic chain verification. Zero mutating authority. |
| `admin` | **Security Administrator** | Single-Tenant (Privileged) | Security policy creation, four-eyes policy and remediation approvals, tenant user management, KMS synchronization. Cannot rotate platform master keys or access other tenants. |
| `platform_admin` | **Platform Administrator** | Multi-Tenant / Global | System infrastructure management, master secret rotation (e.g., JWT signing keys), cross-tenant administration, and global audit oversight. |

---

## 3. Authoritative Authorization Matrix

Derived directly from actual product capabilities, workflows, and API boundaries:

| Capability Identifier | Anonymous | Viewer | Analyst | Developer | Auditor | Admin (SecAdmin) | Platform Admin |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Read own data** (`read_own_data`) | NO (401) | YES | YES | YES | YES | YES | YES |
| **Read tenant data** (`read_tenant_data`) | NO (401) | scoped | scoped | scoped | scoped | scoped | YES (global) |
| **Trigger scans / Ingest CBOM** (`trigger_scans`) | NO (401) | NO (403) | YES | YES | NO (403) | YES | YES |
| **Triage / suppress findings** (`triage_findings`) | NO (401) | NO (403) | YES | YES | NO (403) | YES | YES |
| **Propose remediation** (`propose_remediation`) | NO (401) | NO (403) | YES | YES | NO (403) | YES | YES |
| **Approve / apply remediation** (`approve_remediation`) | NO (401) | NO (403) | NO (403) | NO (403) | NO (403) | YES | YES |
| **Manage security policies** (`manage_policies`) | NO (401) | NO (403) | NO (403) | NO (403) | NO (403) | YES | YES |
| **Read compliance & audit** (`read_compliance_audit`) | NO (401) | scoped | scoped | scoped | scoped (audit:verify) | scoped | YES (global) |
| **Manage users & roles** (`manage_users`) | NO (401) | NO (403) | NO (403) | NO (403) | NO (403) | scoped (tenant) | YES (global) |
| **Rotate master secrets** (`rotate_secrets`) | NO (401) | NO (403) | NO (403) | NO (403) | NO (403) | policy (KMS only) | YES |
| **Cross-tenant access** (`cross_tenant_access`) | NO (401) | NO (403) | NO (403) | NO (403) | NO (403) | NO (403) | YES |

### Legend:
- **`YES`**: Unrestricted authority across the platform or assigned tenant scope.
- **`NO`**: Strictly forbidden. Unauthenticated callers receive **HTTP 401 (`AUTHENTICATION_REQUIRED`)**. Authenticated callers receive **HTTP 403 (`INSUFFICIENT_PERMISSIONS`)**.
- **`scoped`**: Access permitted, but strictly confined within the boundaries of the caller's authoritative tenant context. Cross-tenant queries return **HTTP 403 (`HORIZONTAL_TENANT_VIOLATION`)**.
- **`policy`**: Governed by policy and dual-control rules (e.g., Security Admin may synchronize external KMS integrations, but cannot rotate platform master signing keys).

---

## 4. Invariants & Security Guarantees

### Invariant 1: Zero Side Effects on Denied Permissions
Whenever any permission or capability check is denied (HTTP 401 or 403):
- **No database mutations occur**: Zero rows inserted, updated, or deleted.
- **No background tasks or scans are triggered**: Job queues remain untouched.
- **No secrets or keys are rotated**: Key stores and active key IDs remain unmodified.
- **No configuration or policy changes take effect**: In-memory and persisted states are preserved.

### Invariant 2: Cryptographic Audit Logging on Every Denial
Every denied authorization attempt generates an immutable, tamper-resistant audit event recorded via [`defaultAuditService`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/audit/audit_service.js):
- **Action Categories**:
  - `AUTHORIZATION_FAILURE`: Unauthenticated requests to protected endpoints (status `DENIED`).
  - `PERMISSION_DENIED`: Vertical privilege escalation attempts (status `DENIED`).
  - `TENANT_ISOLATION_VIOLATION`: Horizontal privilege escalation / cross-tenant IDOR attempts (status `DENIED`).
  - `OBJECT_OWNERSHIP_VIOLATION`: Cross-user object tampering attempts (status `DENIED`).
- **SIEM Bridge**: Automatically translated into standardized SIEM security events (`buildSiemSecurityEvent`) with high severity (`HIGH`) and cryptographic HMAC signing.

### Invariant 3: Separation of Duties & Four-Eyes Governance
- **Proposer !== Approver**: An engineer who proposes a cryptographic remediation patch or policy draft is strictly blocked by the state machine from approving their own proposal (`Four-Eyes Governance Violation`).
- **Auditor Read-Only Guarantee**: Auditors have zero mutating permissions. Even if an auditor attempts to trigger a scan or modify a finding, the request is rejected with HTTP 403.
- **Platform Admin Boundary**: Security administrators cannot create Platform Administrator accounts or elevate their own tenant scope to other organizations.

---

## 5. API Endpoint Mapping

| HTTP Endpoint | Declared Permission | Allowed Roles | Enforced Defenses |
|:---|:---|:---|:---|
| `GET /api/v1/assets` | `assets:read` | Viewer, Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Tenant-scoped isolation |
| `POST /api/v1/assets` | `assets:write` | Analyst, Dev, SecAdmin, PlatAdmin | Tenant-scoped mutation guard |
| `DELETE /api/v1/assets/:id` | `assets:delete` | SecAdmin, PlatAdmin | Tenant-scoped deletion guard |
| `GET /api/v1/cboms` | `cbom:read` | Viewer, Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Tenant-scoped read |
| `POST /api/v1/cboms` | `cbom:generate` | Analyst, Dev, SecAdmin, PlatAdmin | Memory & rate limits |
| `GET /api/v1/scans` | `scans:read` | Viewer, Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Tenant isolation |
| `POST /api/v1/scans` | `scans:trigger` | Analyst, Dev, SecAdmin, PlatAdmin | Rate limiting, SSRF guard |
| `DELETE /api/v1/scans/:id` | `scans:delete` | SecAdmin, PlatAdmin | Role guard |
| `GET /api/v1/findings` | `findings:read` | Viewer, Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Tenant-scoped filter |
| `POST /api/v1/findings/:id/suppress` | `findings:suppress` | Analyst, Dev, SecAdmin, PlatAdmin | Audit trail recorded |
| `GET /api/v1/policy` | `policy:read` | Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Tenant-scoped policy |
| `POST /api/v1/policy` | `policy:create` | SecAdmin, PlatAdmin | Schema validation, VPE defense |
| `POST /api/v1/policy/approve` | `policy:approve` | SecAdmin, PlatAdmin | Four-eyes governance |
| `POST /api/v1/remediation/plan` | `remediation:propose` | Analyst, Dev, SecAdmin, PlatAdmin | Safety lifecycle check |
| `POST /api/v1/remediation/approve` | `remediation:approve` | SecAdmin, PlatAdmin | Four-eyes approval workflow |
| `POST /api/v1/remediation/apply` | `remediation:apply` | SecAdmin, PlatAdmin | Pre-apply safety checks |
| `GET /api/v1/compliance` | `compliance:read` | Viewer, Analyst, Dev, Auditor, SecAdmin, PlatAdmin | Anti-deception guard |
| `GET /api/v1/auth/audit` | `audit:read` | Auditor, SecAdmin, PlatAdmin | Tamper-chain verification |
| `POST /api/v1/auth/secrets/rotate` | `secrets:rotate` | PlatAdmin | Master secret protection |
| `POST /api/v1/auth/admin/users` | `users:manage` | SecAdmin (tenant), PlatAdmin (global) | VPE & HPE prevention |
| `GET /api/v1/auth/rbac/matrix` | None (Public Auth) | All | Public matrix inspection |

---

## 6. Automated Verification Framework

Automated test suites in both Node.js and Python systematically verify every permission cell:
1. **Node.js Suite**: [`backend/tests/security/rbac_matrix.test.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/tests/security/rbac_matrix.test.js)
   - Evaluates all 7 roles x 11 capabilities (77 test cells).
   - Validates HTTP 401/403 status codes on all denied cells.
   - Validates that no side effects occur on denied calls.
   - Validates cryptographic audit events emitted to `defaultAuditService`.
2. **Python Suite**: [`tests/test_rbac_authorization.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/tests/test_rbac_authorization.py)
   - Evaluates matrix normalization, vertical privilege defense, horizontal multi-tenant defense, and audit logging.
