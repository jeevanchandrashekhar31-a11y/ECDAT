/**
 * Server-Side Role-Based Access Control (RBAC) & Privilege Hardening — Phase 15.3
 *
 * Implements:
 * - 6 Canonical Enterprise Roles:
 *   1. platform administrator
 *   2. security administrator
 *   3. analyst
 *   4. developer
 *   5. auditor
 *   6. viewer
 * - Granular, domain-driven permissions model
 * - Explicit endpoint permission declarations for all API endpoints
 * - Vertical Privilege Escalation (VPE) defense
 * - Horizontal Privilege Escalation (HPE) / Multi-Tenant Boundary defense
 */

const ROLES = Object.freeze({
  PLATFORM_ADMIN: "platform administrator",
  SECURITY_ADMIN: "security administrator",
  ANALYST: "analyst",
  DEVELOPER: "developer",
  AUDITOR: "auditor",
  VIEWER: "viewer",
});

/**
 * Enterprise Capabilities derived directly from ECDAT product requirements.
 */
const CAPABILITIES = Object.freeze({
  READ_OWN_DATA: "read_own_data",
  READ_TENANT_DATA: "read_tenant_data",
  TRIGGER_SCANS: "trigger_scans",
  TRIAGE_FINDINGS: "triage_findings",
  PROPOSE_REMEDIATION: "propose_remediation",
  APPROVE_REMEDIATION: "approve_remediation",
  MANAGE_POLICIES: "manage_policies",
  READ_COMPLIANCE_AUDIT: "read_compliance_audit",
  MANAGE_USERS: "manage_users",
  ROTATE_SECRETS: "rotate_secrets",
  CROSS_TENANT_ACCESS: "cross_tenant_access",
});

/**
 * Canonical Authorization Matrix:
 * Maps each product capability to allowed access levels across all 7 enterprise roles:
 * - Anonymous
 * - Viewer
 * - Analyst
 * - Developer
 * - Auditor
 * - Admin (Security Administrator)
 * - Platform Admin (Superuser)
 *
 * Permission values:
 * - 'YES': Unrestricted access
 * - 'NO': Access denied (HTTP 401 for anonymous, HTTP 403 for authenticated)
 * - 'scoped': Permitted strictly within user's assigned tenant
 * - 'policy': Governed by cryptographic policy/dual-control rules
 */
const AUTHORIZATION_MATRIX = Object.freeze({
  [CAPABILITIES.READ_OWN_DATA]: {
    anonymous: "NO",
    viewer: "YES",
    analyst: "YES",
    developer: "YES",
    auditor: "YES",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.READ_TENANT_DATA]: {
    anonymous: "NO",
    viewer: "scoped",
    analyst: "scoped",
    developer: "scoped",
    auditor: "scoped",
    admin: "scoped",
    platform_admin: "YES",
  },
  [CAPABILITIES.TRIGGER_SCANS]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "YES",
    developer: "YES",
    auditor: "NO",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.TRIAGE_FINDINGS]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "YES",
    developer: "YES",
    auditor: "NO",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.PROPOSE_REMEDIATION]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "YES",
    developer: "YES",
    auditor: "NO",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.APPROVE_REMEDIATION]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "NO",
    developer: "NO",
    auditor: "NO",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.MANAGE_POLICIES]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "NO",
    developer: "NO",
    auditor: "NO",
    admin: "YES",
    platform_admin: "YES",
  },
  [CAPABILITIES.READ_COMPLIANCE_AUDIT]: {
    anonymous: "NO",
    viewer: "scoped",
    analyst: "scoped",
    developer: "scoped",
    auditor: "scoped",
    admin: "scoped",
    platform_admin: "YES",
  },
  [CAPABILITIES.MANAGE_USERS]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "NO",
    developer: "NO",
    auditor: "NO",
    admin: "scoped",
    platform_admin: "YES",
  },
  [CAPABILITIES.ROTATE_SECRETS]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "NO",
    developer: "NO",
    auditor: "NO",
    admin: "policy",
    platform_admin: "YES",
  },
  [CAPABILITIES.CROSS_TENANT_ACCESS]: {
    anonymous: "NO",
    viewer: "NO",
    analyst: "NO",
    developer: "NO",
    auditor: "NO",
    admin: "NO",
    platform_admin: "YES",
  },
});

/**
 * Emits a structured audit event to defaultAuditService upon permission denial.
 */
function emitRbacAuditEvent({ action, status = "DENIED", actor, tenantId, target, details }) {
  try {
    const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
    defaultAuditService
      .logEvent({
        category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
        action: action || AUDIT_ACTIONS.PERMISSION_DENIED,
        status: status || AUDIT_STATUSES.DENIED,
        actor: {
          id: String(actor?.id || actor?.userId || actor?.sub || "anonymous").slice(0, 128),
          username: String(actor?.username || actor?.name || "anonymous").slice(0, 128),
          role: String(actor?.role || "viewer").slice(0, 64),
          ipAddress: actor?.ipAddress || null,
          userAgent: actor?.userAgent || null,
        },
        tenantId: tenantId ? String(tenantId).slice(0, 100) : "default",
        target: target || { type: "endpoint", id: details?.path || "rbac_gate" },
        details: details || {},
      })
      .catch(() => {});
  } catch {
    // Fail-safe: audit failure must not crash request flow
  }
}

const ROLE_ALIASES = Object.freeze({
  "platform administrator": ROLES.PLATFORM_ADMIN,
  "platform_admin": ROLES.PLATFORM_ADMIN,
  "platform-admin": ROLES.PLATFORM_ADMIN,
  "platformadmin": ROLES.PLATFORM_ADMIN,
  "admin": ROLES.PLATFORM_ADMIN,
  "superuser": ROLES.PLATFORM_ADMIN,

  "security administrator": ROLES.SECURITY_ADMIN,
  "security_admin": ROLES.SECURITY_ADMIN,
  "security-admin": ROLES.SECURITY_ADMIN,
  "securityadmin": ROLES.SECURITY_ADMIN,
  "tenant administrator": ROLES.SECURITY_ADMIN,
  "tenant_administrator": ROLES.SECURITY_ADMIN,
  "tenant admin": ROLES.SECURITY_ADMIN,
  "tenant_admin": ROLES.SECURITY_ADMIN,
  "secops": ROLES.SECURITY_ADMIN,
  "security_engineer": ROLES.SECURITY_ADMIN,

  "analyst": ROLES.ANALYST,
  "threat_analyst": ROLES.ANALYST,
  "crypto_analyst": ROLES.ANALYST,

  "developer": ROLES.DEVELOPER,
  "dev": ROLES.DEVELOPER,
  "engineer": ROLES.DEVELOPER,
  "devops": ROLES.DEVELOPER,

  "auditor": ROLES.AUDITOR,
  "compliance": ROLES.AUDITOR,
  "compliance_officer": ROLES.AUDITOR,

  "viewer": ROLES.VIEWER,
  "read_only": ROLES.VIEWER,
  "reader": ROLES.VIEWER,
});

/**
 * Granular Permission Constants
 */
const PERMISSIONS = Object.freeze({
  // Platform & Multi-Tenancy Management
  PLATFORM_MANAGE: "platform:manage",
  TENANTS_MANAGE: "tenants:manage",
  SECRETS_ROTATE: "secrets:rotate",
  USERS_MANAGE: "users:manage",

  // Security Policy & Governance
  POLICY_READ: "policy:read",
  POLICY_CREATE: "policy:create",
  POLICY_APPROVE: "policy:approve",
  POLICY_DELETE: "policy:delete",

  // Remediation & Patch Approvals
  REMEDIATION_READ: "remediation:read",
  REMEDIATION_PROPOSE: "remediation:propose",
  REMEDIATION_APPROVE: "remediation:approve",
  REMEDIATION_APPLY: "remediation:apply",

  // Assets & Inventory
  ASSETS_READ: "assets:read",
  ASSETS_WRITE: "assets:write",
  ASSETS_DELETE: "assets:delete",

  // CBOM
  CBOM_READ: "cbom:read",
  CBOM_GENERATE: "cbom:generate",

  // Scans & Findings
  SCANS_READ: "scans:read",
  SCANS_TRIGGER: "scans:trigger",
  SCANS_DELETE: "scans:delete",
  FINDINGS_READ: "findings:read",
  FINDINGS_SUPPRESS: "findings:suppress",
  FINDINGS_EXPORT: "findings:export",

  // Compliance & Cryptographic Audit Ledger
  COMPLIANCE_READ: "compliance:read",
  COMPLIANCE_EXPORT: "compliance:export",
  AUDIT_READ: "audit:read",
  AUDIT_VERIFY: "audit:verify",

  // CI / CD Workflows
  CI_READ: "ci:read",
  CI_EXECUTE: "ci:execute",

  // Integrations (Ticketing, Cloud KMS / HSM)
  TICKETING_READ: "ticketing:read",
  TICKETING_CREATE: "ticketing:create",
  KMS_READ: "kms:read",
  KMS_SYNC: "kms:sync",
});

/**
 * Explicit Role to Permissions Mapping
 */
const ROLE_PERMISSIONS = Object.freeze({
  // 1. Platform Administrator: Superuser access across all platform aspects
  [ROLES.PLATFORM_ADMIN]: new Set(["*"]),

  // 2. Security Administrator: Full authority over policy, remediation approvals, compliance, audit, and security operations
  [ROLES.SECURITY_ADMIN]: new Set([
    PERMISSIONS.POLICY_READ,
    PERMISSIONS.POLICY_CREATE,
    PERMISSIONS.POLICY_APPROVE,
    PERMISSIONS.POLICY_DELETE,
    PERMISSIONS.REMEDIATION_READ,
    PERMISSIONS.REMEDIATION_PROPOSE,
    PERMISSIONS.REMEDIATION_APPROVE,
    PERMISSIONS.REMEDIATION_APPLY,
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.ASSETS_DELETE,
    PERMISSIONS.CBOM_READ,
    PERMISSIONS.CBOM_GENERATE,
    PERMISSIONS.SCANS_READ,
    PERMISSIONS.SCANS_TRIGGER,
    PERMISSIONS.SCANS_DELETE,
    PERMISSIONS.FINDINGS_READ,
    PERMISSIONS.FINDINGS_SUPPRESS,
    PERMISSIONS.FINDINGS_EXPORT,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.COMPLIANCE_EXPORT,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_VERIFY,
    PERMISSIONS.CI_READ,
    PERMISSIONS.CI_EXECUTE,
    PERMISSIONS.TICKETING_READ,
    PERMISSIONS.TICKETING_CREATE,
    PERMISSIONS.KMS_READ,
    PERMISSIONS.KMS_SYNC,
    PERMISSIONS.USERS_MANAGE,
  ]),

  // 3. Analyst: Threat modeling, PQC risk analysis, remediation proposals, reports
  [ROLES.ANALYST]: new Set([
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.CBOM_READ,
    PERMISSIONS.CBOM_GENERATE,
    PERMISSIONS.SCANS_READ,
    PERMISSIONS.SCANS_TRIGGER,
    PERMISSIONS.FINDINGS_READ,
    PERMISSIONS.FINDINGS_SUPPRESS,
    PERMISSIONS.FINDINGS_EXPORT,
    PERMISSIONS.POLICY_READ,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.COMPLIANCE_EXPORT,
    PERMISSIONS.REMEDIATION_READ,
    PERMISSIONS.REMEDIATION_PROPOSE,
    PERMISSIONS.CI_READ,
    PERMISSIONS.TICKETING_READ,
    PERMISSIONS.TICKETING_CREATE,
    PERMISSIONS.KMS_READ,
  ]),

  // 4. Developer: Triggering scans, proposing patches, viewing assigned findings and PR gates
  [ROLES.DEVELOPER]: new Set([
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.ASSETS_WRITE,
    PERMISSIONS.CBOM_READ,
    PERMISSIONS.CBOM_GENERATE,
    PERMISSIONS.SCANS_READ,
    PERMISSIONS.SCANS_TRIGGER,
    PERMISSIONS.FINDINGS_READ,
    PERMISSIONS.FINDINGS_SUPPRESS,
    PERMISSIONS.REMEDIATION_READ,
    PERMISSIONS.REMEDIATION_PROPOSE,
    PERMISSIONS.CI_READ,
    PERMISSIONS.CI_EXECUTE,
    PERMISSIONS.TICKETING_READ,
    PERMISSIONS.POLICY_READ,
    PERMISSIONS.COMPLIANCE_READ,
  ]),

  // 5. Auditor: Strictly READ-ONLY for audit logs, compliance evidence, policies, and findings
  [ROLES.AUDITOR]: new Set([
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_VERIFY,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.COMPLIANCE_EXPORT,
    PERMISSIONS.POLICY_READ,
    PERMISSIONS.FINDINGS_READ,
    PERMISSIONS.FINDINGS_EXPORT,
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.CBOM_READ,
    PERMISSIONS.SCANS_READ,
    PERMISSIONS.REMEDIATION_READ,
    PERMISSIONS.CI_READ,
    PERMISSIONS.TICKETING_READ,
    PERMISSIONS.KMS_READ,
  ]),

  // 6. Viewer: Minimal read-only dashboard access
  [ROLES.VIEWER]: new Set([
    PERMISSIONS.ASSETS_READ,
    PERMISSIONS.CBOM_READ,
    PERMISSIONS.FINDINGS_READ,
    PERMISSIONS.SCANS_READ,
    PERMISSIONS.COMPLIANCE_READ,
    PERMISSIONS.REMEDIATION_READ,
    PERMISSIONS.CI_READ,
  ]),
});

/**
 * Normalizes any role string into one of the 6 canonical roles.
 */
function normalizeRole(role) {
  if (!role || typeof role !== "string") return ROLES.VIEWER;
  const clean = role.trim().toLowerCase().replace(/[-_]/g, " ");
  if (ROLE_ALIASES[clean]) return ROLE_ALIASES[clean];

  const rawClean = role.trim().toLowerCase();
  if (ROLE_ALIASES[rawClean]) return ROLE_ALIASES[rawClean];

  return ROLES.VIEWER;
}

/**
 * Returns all active permissions granted to a given set of user roles.
 */
function getUserPermissions(userRoles = []) {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  const permissions = new Set();

  for (const r of rolesArray) {
    const canonical = normalizeRole(r);
    const perms = ROLE_PERMISSIONS[canonical];
    if (perms) {
      if (perms.has("*")) {
        // Return all known permissions
        return Object.values(PERMISSIONS);
      }
      perms.forEach((p) => permissions.add(p));
    }
  }

  return Array.from(permissions);
}

/**
 * Checks whether the user's roles grant the required permission.
 */
function hasPermission(userRoles = [], requiredPermission) {
  if (!requiredPermission) return true;
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];

  for (const r of rolesArray) {
    const canonical = normalizeRole(r);
    const perms = ROLE_PERMISSIONS[canonical];
    if (perms) {
      if (perms.has("*")) return true;
      if (perms.has(requiredPermission)) return true;

      // Check wildcard prefix (e.g. "policy:*" matching "policy:approve")
      const [domain] = requiredPermission.split(":");
      if (perms.has(`${domain}:*`)) return true;
    }
  }

  return false;
}

/**
 * Route authorization middleware enforcing fine-grained permissions and privilege escalation defense.
 */
function requirePermission(permission, options = {}) {
  return (req, res, next) => {
    // 1. Authentication Check
    if (!req.auth || !req.auth.authenticated) {
      emitRbacAuditEvent({
        action: "AUTHORIZATION_FAILURE",
        status: "DENIED",
        actor: { id: "anonymous", username: "anonymous", role: "anonymous", ipAddress: req.ip },
        tenantId: "default",
        target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
        details: {
          code: "AUTHENTICATION_REQUIRED",
          requiredPermission: permission,
          path: req.originalUrl || req.path,
          method: req.method,
          requestId: req.id,
        },
      });

      return res.status(401).json({
        error: "Unauthorized",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required to access this resource.",
        requiredPermission: permission,
        requestId: req.id,
      });
    }

    const userRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
    req.requiredPermission = permission;

    // 2. Vertical Privilege Escalation Check: Verify user possesses the declared permission
    if (!hasPermission(userRoles, permission)) {
      emitRbacAuditEvent({
        action: "PERMISSION_DENIED",
        status: "DENIED",
        actor: {
          id: req.user?.id || req.user?.sub || req.user?.userId || req.auth?.user?.id || "unknown",
          username: req.user?.username || req.auth?.user?.username || "unknown",
          role: userRoles[0] || "viewer",
          ipAddress: req.ip,
        },
        tenantId: (req.user && req.user.tenantId) || "default-tenant",
        target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
        details: {
          code: "INSUFFICIENT_PERMISSIONS",
          requiredPermission: permission,
          userRoles,
          path: req.originalUrl || req.path,
          method: req.method,
          requestId: req.id,
        },
      });

      return res.status(403).json({
        error: "Forbidden",
        code: "INSUFFICIENT_PERMISSIONS",
        message: `Access denied. User lacks required permission: '${permission}'.`,
        requiredPermission: permission,
        userRoles,
        requestId: req.id,
      });
    }

    // 3. Horizontal Privilege Escalation (HPE) Check: Multi-tenant and object ownership boundary
    const isPlatformAdmin = userRoles.some((r) => normalizeRole(r) === ROLES.PLATFORM_ADMIN);

    if (!isPlatformAdmin) {
      const userTenant = (req.user && req.user.tenantId) || "default-tenant";

      // Inspect target tenant across params, query, body, or headers
      const targetTenant =
        (req.params && req.params.tenantId) ||
        (req.query && req.query.tenantId) ||
        (req.body && req.body.tenantId) ||
        req.headers["x-tenant-id"];

      if (targetTenant && targetTenant !== userTenant) {
        emitRbacAuditEvent({
          action: "TENANT_ISOLATION_VIOLATION",
          status: "DENIED",
          actor: {
            id: req.user?.id || req.user?.sub || req.user?.userId || req.auth?.user?.id || "unknown",
            username: req.user?.username || req.auth?.user?.username || "unknown",
            role: userRoles[0] || "viewer",
            ipAddress: req.ip,
          },
          tenantId: userTenant,
          target: { type: "tenant", id: targetTenant, name: req.originalUrl || req.path },
          details: {
            code: "HORIZONTAL_TENANT_VIOLATION",
            userTenant,
            targetTenant,
            requiredPermission: permission,
            path: req.originalUrl || req.path,
            method: req.method,
            requestId: req.id,
          },
        });

        return res.status(403).json({
          error: "Forbidden",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cross-tenant access violation. User from tenant '${userTenant}' cannot access resources belonging to tenant '${targetTenant}'.`,
          requestId: req.id,
        });
      }

      // Check object ownership if requested
      if (options.checkOwner) {
        const userId = (req.user && (req.user.sub || req.user.userId)) || "";
        const resourceOwner = (req.body && (req.body.ownerId || req.body.userId)) || (req.params && req.params.ownerId);

        if (resourceOwner && resourceOwner !== userId && !userRoles.some((r) => normalizeRole(r) === ROLES.SECURITY_ADMIN)) {
          emitRbacAuditEvent({
            action: "OBJECT_OWNERSHIP_VIOLATION",
            status: "DENIED",
            actor: {
              id: userId || "unknown",
              username: req.user?.username || req.auth?.user?.username || "unknown",
              role: userRoles[0] || "viewer",
              ipAddress: req.ip,
            },
            tenantId: (req.user && req.user.tenantId) || "default-tenant",
            target: { type: "resource", id: resourceOwner, name: req.originalUrl || req.path },
            details: {
              code: "HORIZONTAL_OWNER_VIOLATION",
              userId,
              resourceOwner,
              requiredPermission: permission,
              path: req.originalUrl || req.path,
              method: req.method,
              requestId: req.id,
            },
          });

          return res.status(403).json({
            error: "Forbidden",
            code: "HORIZONTAL_OWNER_VIOLATION",
            message: "Object ownership violation. You cannot modify or access resources owned by another user.",
            requestId: req.id,
          });
        }
      }
    }

    next();
  };
}

/**
 * Route authorization middleware accepting multiple permissions (OR/AND).
 */
function requirePermissions(permissions = [], { matchAll = false, ...options } = {}) {
  const permList = Array.isArray(permissions) ? permissions : [permissions];
  return (req, res, next) => {
    if (!req.auth || !req.auth.authenticated) {
      emitRbacAuditEvent({
        action: "AUTHORIZATION_FAILURE",
        status: "DENIED",
        actor: { id: "anonymous", username: "anonymous", role: "anonymous", ipAddress: req.ip },
        tenantId: "default",
        target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
        details: {
          code: "AUTHENTICATION_REQUIRED",
          requiredPermissions: permList,
          path: req.originalUrl || req.path,
          method: req.method,
          requestId: req.id,
        },
      });

      return res.status(401).json({
        error: "Unauthorized",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required to access this resource.",
        requiredPermissions: permList,
        requestId: req.id,
      });
    }

    const userRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
    const hasAccess = matchAll
      ? permList.every((p) => hasPermission(userRoles, p))
      : permList.some((p) => hasPermission(userRoles, p));

    if (!hasAccess) {
      emitRbacAuditEvent({
        action: "PERMISSION_DENIED",
        status: "DENIED",
        actor: {
          id: req.user?.id || req.user?.sub || req.user?.userId || req.auth?.user?.id || "unknown",
          username: req.user?.username || req.auth?.user?.username || "unknown",
          role: userRoles[0] || "viewer",
          ipAddress: req.ip,
        },
        tenantId: (req.user && req.user.tenantId) || "default-tenant",
        target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
        details: {
          code: "INSUFFICIENT_PERMISSIONS",
          requiredPermissions: permList,
          userRoles,
          path: req.originalUrl || req.path,
          method: req.method,
          requestId: req.id,
        },
      });

      return res.status(403).json({
        error: "Forbidden",
        code: "INSUFFICIENT_PERMISSIONS",
        message: `Access denied. Requires ${matchAll ? "all" : "one"} of permissions: ${permList.join(", ")}`,
        requiredPermissions: permList,
        userRoles,
        requestId: req.id,
      });
    }

    next();
  };
}

/**
 * Master Registry of Endpoint Permission Declarations.
 * Maps route signatures (METHOD PATH) to their declared permission requirements.
 */
const ENDPOINT_PERMISSIONS = Object.freeze({
  // Assets & CBOM
  "GET /api/v1/assets": PERMISSIONS.ASSETS_READ,
  "POST /api/v1/assets": PERMISSIONS.ASSETS_WRITE,
  "DELETE /api/v1/assets/:id": PERMISSIONS.ASSETS_DELETE,
  "GET /api/v1/cboms": PERMISSIONS.CBOM_READ,
  "POST /api/v1/cboms": PERMISSIONS.CBOM_GENERATE,
  "POST /api/v1/cbom/merge": PERMISSIONS.CBOM_GENERATE,

  // Scans & Findings
  "GET /api/v1/scans": PERMISSIONS.SCANS_READ,
  "POST /api/v1/scans": PERMISSIONS.SCANS_TRIGGER,
  "DELETE /api/v1/scans/:id": PERMISSIONS.SCANS_DELETE,
  "GET /api/v1/findings": PERMISSIONS.FINDINGS_READ,
  "POST /api/v1/findings/:id/suppress": PERMISSIONS.FINDINGS_SUPPRESS,
  "GET /api/v1/findings/export": PERMISSIONS.FINDINGS_EXPORT,

  // Policy-as-Code & Governance
  "GET /api/v1/policy": PERMISSIONS.POLICY_READ,
  "POST /api/v1/policy": PERMISSIONS.POLICY_CREATE,
  "POST /api/v1/policy/approve": PERMISSIONS.POLICY_APPROVE,
  "DELETE /api/v1/policy/:id": PERMISSIONS.POLICY_DELETE,

  // Remediation & Patch Approvals
  "GET /api/v1/remediation": PERMISSIONS.REMEDIATION_READ,
  "POST /api/v1/remediation/plan": PERMISSIONS.REMEDIATION_PROPOSE,
  "POST /api/v1/remediation/approve": PERMISSIONS.REMEDIATION_APPROVE,
  "POST /api/v1/remediation/apply": PERMISSIONS.REMEDIATION_APPLY,

  // Compliance & Audits
  "GET /api/v1/compliance": PERMISSIONS.COMPLIANCE_READ,
  "GET /api/v1/compliance/export": PERMISSIONS.COMPLIANCE_EXPORT,
  "GET /api/v1/auth/audit": PERMISSIONS.AUDIT_READ,

  // CI Workflows & Integrations
  "GET /api/v1/ci": PERMISSIONS.CI_READ,
  "POST /api/v1/ci/scan": PERMISSIONS.CI_EXECUTE,
  "GET /api/v1/integrations/ticketing": PERMISSIONS.TICKETING_READ,
  "POST /api/v1/integrations/ticketing": PERMISSIONS.TICKETING_CREATE,
  "GET /api/v1/integrations/kms": PERMISSIONS.KMS_READ,
  "POST /api/v1/integrations/kms/sync": PERMISSIONS.KMS_SYNC,

  // Platform & Secrets Administration
  "POST /api/v1/auth/secrets/rotate": PERMISSIONS.SECRETS_ROTATE,
  "POST /api/v1/auth/admin/users": PERMISSIONS.USERS_MANAGE,
  "POST /api/v1/auth/users": PERMISSIONS.USERS_MANAGE,
});

/**
 * Evaluates capability access against the canonical Authorization Matrix.
 * Returns { allowed, status, code, message, matrixValue, scope }.
 * If denied, emits a structured audit event.
 */
function evaluateCapability(role, capability, context = {}) {
  const normRole = normalizeRole(role);
  const matrixEntry = AUTHORIZATION_MATRIX[capability];
  if (!matrixEntry) {
    return {
      allowed: false,
      status: 400,
      code: "UNKNOWN_CAPABILITY",
      message: `Unknown capability: '${capability}'`,
    };
  }

  // Resolve role column in matrix
  let colKey = "viewer";
  const cleanRole = String(role || "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (!role || cleanRole === "anonymous") {
    colKey = "anonymous";
  } else if (cleanRole === "platform admin" || cleanRole === "platform administrator" || cleanRole === "superuser") {
    colKey = "platform_admin";
  } else if (
    cleanRole === "admin" ||
    cleanRole === "security admin" ||
    cleanRole === "security administrator" ||
    cleanRole === "tenant admin" ||
    cleanRole === "tenant administrator" ||
    cleanRole === "secops"
  ) {
    colKey = "admin";
  } else if (cleanRole === "analyst" || cleanRole === "threat analyst" || cleanRole === "crypto analyst") {
    colKey = "analyst";
  } else if (cleanRole === "developer" || cleanRole === "dev" || cleanRole === "engineer") {
    colKey = "developer";
  } else if (cleanRole === "auditor" || cleanRole === "compliance" || cleanRole === "compliance officer") {
    colKey = "auditor";
  } else {
    colKey = "viewer";
  }

  const matrixValue = matrixEntry[colKey];

  // Universal Cross-Tenant Invariant: Any cross-tenant access by non-platform_admin is strictly rejected
  if (context.isCrossTenant && colKey !== "platform_admin") {
    const reason = `Cross-tenant access violation. Role '${colKey}' is strictly tenant-scoped and cannot perform '${capability}' across tenants.`;
    if (context.emitAudit !== false) {
      emitRbacAuditEvent({
        action: "TENANT_ISOLATION_VIOLATION",
        status: "DENIED",
        actor: {
          id: context.userId || (colKey === "anonymous" ? "anonymous" : "unknown"),
          username: context.username || (colKey === "anonymous" ? "anonymous" : "unknown"),
          role: colKey,
        },
        tenantId: context.tenantId || "default",
        target: { type: "tenant", id: context.targetTenantId || "foreign_tenant" },
        details: { code: "HORIZONTAL_TENANT_VIOLATION", capability, role: colKey, reason },
      });
    }

    return {
      allowed: false,
      status: 403,
      code: "HORIZONTAL_TENANT_VIOLATION",
      message: reason,
      matrixValue,
    };
  }

  // Universal Platform Scope Invariant: Platform scope requires platform_admin authority
  if (context.isPlatformScope && colKey !== "platform_admin") {
    const reason = `Platform-level operations require platform_admin authority.`;
    if (context.emitAudit !== false) {
      emitRbacAuditEvent({
        action: "PERMISSION_DENIED",
        status: "DENIED",
        actor: {
          id: context.userId || "unknown",
          username: context.username || "unknown",
          role: colKey,
        },
        tenantId: context.tenantId || "default",
        target: { type: "platform", id: "platform_governance" },
        details: { code: "INSUFFICIENT_PERMISSIONS", capability, role: colKey, reason },
      });
    }

    return {
      allowed: false,
      status: 403,
      code: "INSUFFICIENT_PERMISSIONS",
      message: reason,
      matrixValue: "NO",
    };
  }

  if (matrixValue === "NO") {
    const status = colKey === "anonymous" ? 401 : 403;
    const code = colKey === "anonymous" ? "AUTHENTICATION_REQUIRED" : "INSUFFICIENT_PERMISSIONS";
    const reason = `Access denied. Role '${colKey}' lacks capability '${capability}'.`;

    if (context.emitAudit !== false) {
      emitRbacAuditEvent({
        action: colKey === "anonymous" ? "AUTHORIZATION_FAILURE" : "PERMISSION_DENIED",
        status: "DENIED",
        actor: {
          id: context.userId || (colKey === "anonymous" ? "anonymous" : "unknown"),
          username: context.username || (colKey === "anonymous" ? "anonymous" : "unknown"),
          role: colKey,
        },
        tenantId: context.tenantId || "default",
        target: { type: "capability", id: capability },
        details: { code, capability, role: colKey, reason },
      });
    }

    return {
      allowed: false,
      status,
      code,
      message: reason,
      matrixValue,
    };
  }

  if (matrixValue === "scoped") {
    if (context.isCrossTenant && normRole !== ROLES.PLATFORM_ADMIN) {
      const reason = `Cross-tenant access violation. Role '${colKey}' is strictly tenant-scoped for '${capability}'.`;
      if (context.emitAudit !== false) {
        emitRbacAuditEvent({
          action: "TENANT_ISOLATION_VIOLATION",
          status: "DENIED",
          actor: {
            id: context.userId || "unknown",
            username: context.username || "unknown",
            role: colKey,
          },
          tenantId: context.tenantId || "default",
          target: { type: "tenant", id: context.targetTenantId || "foreign_tenant" },
          details: { code: "HORIZONTAL_TENANT_VIOLATION", capability, role: colKey, reason },
        });
      }

      return {
        allowed: false,
        status: 403,
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: reason,
        matrixValue,
      };
    }

    return {
      allowed: true,
      status: 200,
      scope: "tenant",
      matrixValue,
    };
  }

  if (matrixValue === "policy") {
    if (context.isMasterRotation || context.bypassPolicy) {
      const reason = `Master secret rotation requires platform administrator authority.`;
      if (context.emitAudit !== false) {
        emitRbacAuditEvent({
          action: "PERMISSION_DENIED",
          status: "DENIED",
          actor: {
            id: context.userId || "unknown",
            username: context.username || "unknown",
            role: colKey,
          },
          tenantId: context.tenantId || "default",
          target: { type: "secret", id: "platform_master_key" },
          details: { code: "POLICY_RESTRICTED", capability, role: colKey, reason },
        });
      }

      return {
        allowed: false,
        status: 403,
        code: "POLICY_RESTRICTED",
        message: reason,
        matrixValue,
      };
    }

    return {
      allowed: true,
      status: 200,
      scope: "policy_governed",
      matrixValue,
    };
  }

  if (matrixValue === "YES") {
    return {
      allowed: true,
      status: 200,
      scope: normRole === ROLES.PLATFORM_ADMIN ? "global" : "standard",
      matrixValue,
    };
  }

  return {
    allowed: false,
    status: 403,
    code: "DENIED",
    message: "Access denied.",
    matrixValue,
  };
}

module.exports = {
  ROLES,
  ROLE_ALIASES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  CAPABILITIES,
  AUTHORIZATION_MATRIX,
  normalizeRole,
  hasPermission,
  getUserPermissions,
  requirePermission,
  requirePermissions,
  evaluateCapability,
  emitRbacAuditEvent,
  ENDPOINT_PERMISSIONS,
};
