# Object-Level Authorization Specification (BOLA & IDOR Defense)

## 1. Overview & Security Model

Role-based access control (RBAC) answers *what capabilities a caller possesses in the abstract*.
**Object-Level Authorization (OWASP API1:2023)** answers *whether the authenticated caller is authorized to view or mutate a specific resource instance in server-side state*.

Under the ECDAT Zero Trust architecture:
- **No endpoint relies solely on role checks.** An `admin` or `analyst` role alone NEVER permits accessing an object belonging to a foreign tenant or a private resource owned by another user.
- **Every object reference is resolved and verified against authoritative server-side state.**
- **Sequential integer ID enumeration and UUID tampering are strictly detected and rejected.**
- **For every denied access:**
  1. `HTTP 401 Unauthorized` (for unauthenticated calls) or `HTTP 403 Forbidden` (for cross-tenant violations, object ownership violations, or privilege escalation).
  2. **NO side effects** (zero database mutations, zero queue changes, zero secret rotations).
  3. **Structured cryptographic audit event** emitted and bridged to SIEM.

---

## 2. Canonical Target Identifiers Matrix

| Target Identifier | Resource Type | Authoritative Server-Side State | Ownership Model | Failure Code |
| :--- | :--- | :--- | :--- | :--- |
| **`userId`** | User Account & Profile | `LocalAuthManager.users` / DB `users` | Self or Tenant Admin in same tenant | `HORIZONTAL_TENANT_VIOLATION` / `OBJECT_AUTHORIZATION_FAILED` |
| **`tenantId`** | Tenant Isolation Boundary | `TenantContext.fromRequest` | Tenant match or Platform Admin | `TENANT_SPOOFING_VIOLATION` / `HORIZONTAL_TENANT_VIOLATION` |
| **`scanId`** | Cryptographic Discovery Scan | `inMemoryScansStore` / DB `scans` | Scoped to Tenant | `HORIZONTAL_TENANT_VIOLATION` |
| **`reportId`** | Executive / Tech / HTML Report | Reports Registry / Linked Scan | Scoped to Tenant | `HORIZONTAL_TENANT_VIOLATION` |
| **`cbomId`** | CycloneDX 1.6 CBOM Artifact | In-memory CBOMs / DB `cboms` | Scoped to Tenant | `HORIZONTAL_TENANT_VIOLATION` |
| **`assetId`** | Discovered Crypto Asset | Assets Registry / DB `assets` | Scoped to Tenant & Optional Owner | `HORIZONTAL_TENANT_VIOLATION` / `OBJECT_AUTHORIZATION_FAILED` |
| **`projectId`** | Application Workspace | Project Registry / Linked Scans | Scoped to Tenant | `HORIZONTAL_TENANT_VIOLATION` |
| **`jobId`** | Background Worker Task | `TenantScopedJobQueue.jobs` | Scoped to Tenant & Submitter | `HORIZONTAL_TENANT_VIOLATION` |
| **`secretId`** | Signing Key / API Secret | `SecretManager.keys` / Registry | Scoped to Tenant & Owner | `HORIZONTAL_TENANT_VIOLATION` / `OBJECT_AUTHORIZATION_FAILED` |
| **`integrationId`** | KMS / Ticketing Connector | `KmsDiscoveryService` / `TicketingService` | Scoped to Tenant | `HORIZONTAL_TENANT_VIOLATION` |

---

## 3. Defense Against Enumeration & Manipulation Attacks

### A. Sequential Integer ID Enumeration (IDOR)
- Attackers sequentially increment or probe resource IDs (`1, 2, 3...` or `scan-1 -> scan-2`).
- **Defense Mechanism**:
  1. If the resource does not exist in state: the engine immediately returns `HTTP 404 Not Found` without side effects.
  2. If the resource exists but belongs to a different tenant: returns `HTTP 403 Forbidden` (`code: "HORIZONTAL_TENANT_VIOLATION"`).
  3. If the resource exists in the same tenant but has an individual owner (`ownerId`): non-owner and non-admin callers receive `HTTP 403 Forbidden` (`code: "OBJECT_AUTHORIZATION_FAILED"`).

### B. UUID Tampering & Manipulation
- Attackers manipulate RFC 4122 v4 UUIDs by modifying hex digits, flipping bits, or substituting foreign tenant UUIDs.
- **Defense Mechanism**:
  1. All resource identifiers are strictly sanitized against null bytes (`\0`) and directory traversal sequences (`..`).
  2. Syntactically valid foreign UUIDs trigger immediate `HTTP 403 Forbidden` with a `TENANT_ISOLATION_VIOLATION` audit event.
  3. Forged non-existent UUIDs fail state resolution and return `HTTP 404 Not Found`.

---

## 4. Middleware & Verification Architecture

### Node.js Implementation:
- Located at [backend/src/security/object_authorization.js](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/src/security/object_authorization.js).
- Middleware factory: `requireObjectAuthorization(objectType, options)`
- Options:
  - `idParam`: Name of the request parameter to extract (default is matching `objectType`).
  - `requireOwnership`: Boolean requiring individual user ownership.
  - `allowTenantAdmin`: Boolean allowing tenant administrators to manage resources in their own tenant.
  - `hideCrossTenantExistence`: Boolean returning 404 instead of 403 for read-only existence masking.

### Python Scanner Implementation:
- Located at [scanners/identity/object_auth.py](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scanners/identity/object_auth.py).
- Function: `verify_object_authorization(caller, object_type, object_id, registry, audit_logger)`
- Enforces identical invariant checks for scanner orchestrator jobs, reports, and asset records.

---

## 5. Audit Logging Invariants

Every denied object-level authorization attempt records a structured event in the cryptographic audit ledger:
```json
{
  "category": "PERMISSION_CHANGE",
  "action": "TENANT_ISOLATION_VIOLATION",
  "status": "DENIED",
  "actor": {
    "id": "usr_alpha_1",
    "role": "analyst",
    "tenantId": "tenant-alpha"
  },
  "target": {
    "type": "jobId",
    "id": "55555555-5555-4555-8555-555555555555"
  },
  "details": {
    "code": "HORIZONTAL_TENANT_VIOLATION",
    "objectType": "jobId",
    "objectId": "55555555-5555-4555-8555-555555555555",
    "callerTenant": "tenant-alpha",
    "targetTenant": "tenant-beta",
    "reason": "Cross-tenant object access blocked: caller in 'tenant-alpha' cannot access 'tenant-beta' resource"
  }
}
```
