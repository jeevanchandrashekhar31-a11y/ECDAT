# Security Policy & Architecture Verification

This document outlines the security architecture, threat model, defensive controls, and verification guarantees implemented in ECDAT. Every defensive claim in this policy is directly backed by an automated regression test in the codebase.

---

## 1. Threat Model

ECDAT is designed to discover and analyze cryptographic assets while maintaining strict boundaries against common attack vectors:
- **Untrusted Source Code**: Repositories scanned by ECDAT may contain malicious file structures (e.g., zip-slip archives, symlink loops, or deeply nested directories) intended to crash the scanner or achieve path traversal.
- **Malicious Network Endpoints**: Targets supplied to network scanners may attempt Server-Side Request Forgery (SSRF) against internal cloud metadata services or private subnets.
- **Tenant Data Isolation**: In multi-tenant deployments, tenant users must never be able to view, modify, or scan assets belonging to other tenants.
- **Privilege Escalation**: Authenticated users with analyst or auditor roles must not be able to execute administrative actions or self-approve remediation proposals.
- **Secret & Credential Leakage**: Hardcoded API keys or private keys found in scanned source code must never be written to unredacted logs, reports, or CBOM artifacts.

**Verification Test**:
- Fail-closed security architecture verification: `security_tests/test_auth_fail_closed_control.py`

---

## 2. Authentication & Session Security

- **Token-Derived Identity**: User identity, role, and tenant context are derived strictly from cryptographically verified JWT tokens (`Authorization: Bearer <token>`). Client-supplied body or query parameters cannot override token identity.
- **Session Revocation Integrity**: Users can only revoke their own tokens and sessions. Cross-user token revocation or unauthorized global logout attempts return HTTP 403 Forbidden.
- **Public Registration Downgrade**: Public registration endpoints strictly assign the lowest-privilege role (`analyst`) and sanitize incoming request bodies. Any attempt to supply `role: "admin"`, `isAdmin: true`, or custom `tenantId` is ignored and neutralized.

**Verification Tests**:
- Authentication lifecycle and token verification: `backend/tests/api/auth.test.js`
- User token revocation isolation: `backend/tests/api/token_revocation_authorization.test.js`
- Account logout authorization boundaries: `backend/tests/api/logout_all_authorization.test.js`
- Public registration role downgrade enforcement: `security_tests/test_authentication_control.py`
- Session ownership and token hijacking defense: `security_tests/test_session_management_control.py`

---

## 3. Authorization & Role Separation (RBAC)

- **Role Hierarchy**: ECDAT enforces four distinct roles: `analyst`, `auditor`, `admin`, and `platform_admin`.
- **Separation of Duties**: Remediation workflows require separation of duties. Users with the `analyst` role can generate and propose remediation plans, but only users with the `admin` role can approve or apply them.
- **Self-Approval Prevention**: The author of a remediation plan cannot approve their own plan, even if they possess administrative credentials.

**Verification Tests**:
- Role-based access control enforcement: `tests/test_rbac_authorization.py`
- Horizontal and vertical privilege escalation controls: `security_tests/test_authorization_control.py`
- Remediation approval role separation: `backend/tests/security/remediation_role_authorization.test.js`

---

## 4. Multi-Tenant Isolation & IDOR Protection

- **Tenant Scoping**: All database queries are explicitly scoped using `tenant_id` filters.
- **Insecure Direct Object Reference (IDOR) Defense**: Accessing an asset, finding, scan report, CBOM, or audit log belonging to another tenant returns HTTP 403 Forbidden or HTTP 404 Not Found.
- **Cross-Tenant Overrides Blocked**: Normal tenant users cannot supply `tenantId` query parameters or JSON body fields to operate outside their assigned tenant boundary.

**Verification Tests**:
- Multi-tenancy database and API isolation matrix: `tests/test_multi_tenancy_isolation.py`
- Cross-tenant IDOR attack rejection: `security_tests/test_tenant_isolation_control.py`
- Tenant privilege elevation prevention: `security_tests/test_tenant_no_elevation_control.py`
- Two-tenant resource boundary verification: `backend/tests/security/two_tenant_isolation.test.js`

---

## 5. Secrets Handling & Zero Secret Leakage

- **Safe Secret Detection**: The `SecretSafeDetector` engine identifies sensitive material (AWS keys, private keys, JWT secrets, generic API tokens) using entropy heuristics and pattern matching.
- **Zero Raw Secret Exposure**: Discovered secret byte values are redacted immediately upon detection. Only cryptographic fingerprints (SHA-256 digests) and non-secret syntax context are preserved in memory, logs, CBOMs, and SARIF exports.
- **Synthetic Test Corpus Separation**: Test fixtures containing dummy keys are isolated under `tests/fixtures/synthetic_secrets/` and classified separately from actual leaked credentials.

**Verification Tests**:
- Secret redaction and memory protection: `tests/test_secret_safe_crypto.py`
- Repository secret scanning and redaction audit: `tests/test_secret_scanning_audit.py`
- Prevention of secret leakage into output reports: `security_tests/test_secret_leakage_control.py`
- Domain-level secret safety verification: `backend/tests/domain/secret_safety.test.js`

---

## 6. Server-Side Request Forgery (SSRF) Defenses

- **Target Validation**: All network scanning targets are resolved and validated against an IP blocklist before opening network sockets.
- **Disallowed IP Ranges**:
  - Loopback addresses (`127.0.0.0/8`, `localhost`, `::1`).
  - RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Link-local and cloud metadata addresses (`169.254.0.0/16`, `169.254.169.254`).
- **Scheme Enforcement**: Network connections are strictly restricted to TLS handshakes on designated ports.

**Verification Tests**:
- SSRF target blocking and payload validation: `security_tests/test_ssrf_control.py`
- Network scan API endpoint SSRF protections: `backend/tests/api/ssrf_network_scan_security.test.js`

---

## 7. Remediation Path-Confinement

- **Directory Traversal Defense**: The remediation engine verifies that all modified target files reside strictly within the intended repository root directory.
- **Canonical Path Resolution**: Relative path navigation sequences (`../`), null-byte injection, and symlink targets outside the project boundary are rejected with path-traversal errors.
- **Dry-Run and Diff Review**: Remediation proposals produce unified diff previews before any disk write operation is executed.

**Verification Tests**:
- Remediation path traversal prevention: `security_tests/test_path_traversal_control.py`
- Remediation actor integrity and boundary checks: `security_tests/test_remediation_actor_integrity_control.py`
- File modification security and safe application: `backend/tests/remediation/remediation_planner.test.js`

---

## 8. Reporting a Vulnerability

If you discover a security vulnerability in ECDAT:
1. Do not open a public issue containing exploit code, private keys, or sensitive logs.
2. Submit a private advisory report to the repository security maintainers.
3. Include reproduction steps, affected component versions, and technical impact assessment.
