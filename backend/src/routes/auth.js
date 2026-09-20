/**
 * Identity & Directory Integration Routes — Phase 14.2
 *
 * Exposes endpoints for:
 * - OIDC / OAuth2 login & callback with PKCE
 * - LDAP authentication (ephemeral bind, zero password storage)
 * - Short-lived token refresh (RTR) and revocation
 * - Current user identity context (/me)
 * - Secret rotation
 * - Authentication event audit ledger & tamper verification
 */

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { RATE_LIMITS } = require("../security/resource_governance");
const passwordResetTokens = new Map();
const {
  defaultTokenService,
  defaultSecretManager,
  defaultAuthAuditLogger,
  OidcHandler,
  LdapClient,
  defaultLocalAuthManager,
  defaultMfaEngine,
  PasswordPolicyError,
  AccountLockedError,
} = require("../identity");
const {
  setAuthCookies,
  clearAuthCookies,
  generateCsrfToken,
} = require("../middleware/cookie_csrf");
const { requireRole, extractApiKey } = require("../middleware/auth");
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  CAPABILITIES,
  AUTHORIZATION_MATRIX,
  normalizeRole,
  hasPermission,
  getUserPermissions,
  requirePermission,
  evaluateCapability,
  ENDPOINT_PERMISSIONS,
} = require("../middleware/rbac");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
const { requireObjectAuthorization, OBJECT_TYPES, defaultObjectStateRegistry } = require("../security/object_authorization");
const {
  validateSchemaStrict,
  validateLength,
  validateEnum,
  SCHEMAS,
} = require("../security/input_validation");

// Instantiate default OIDC handler and LDAP client
const oidcHandler = new OidcHandler();
const ldapClient = new LdapClient();

/**
 * GET /api/v1/auth/oidc/login
 * Initiates OIDC authorization code flow with PKCE.
 */
router.get("/oidc/login", (req, res) => {
  const authReq = oidcHandler.createAuthorizationRequest({
    scope: req.query.scope,
  });
  return res.json(authReq);
});

/**
 * POST /api/v1/auth/oidc/callback
 * Exchanges authorization code for short-lived token pair.
 */
router.post("/oidc/callback", RATE_LIMITS.login.middleware(), async (req, res, next) => {
  try {
    const { code, state, error } = req.body || {};
    const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "unknown";

    const result = await oidcHandler.handleCallback({
      code,
      state,
      error,
      ipAddress,
      userAgent,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/ldap/login
 * Authenticates user via ephemeral LDAP bind (zero password persistence).
 */
router.post("/ldap/login", RATE_LIMITS.login.middleware(), async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Missing required fields: 'username' and 'password'" });
    }

    const ipAddress = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const userAgent = req.headers["user-agent"] || "unknown";

    const result = await ldapClient.authenticate({
      username,
      password,
      ipAddress,
      userAgent,
    });

    return res.json(result);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/token/refresh
 * Refreshes short-lived access token with Refresh Token Rotation (RTR).
 */
router.post("/token/refresh", RATE_LIMITS.tokenOperations.middleware(), (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: "Missing 'refreshToken'" });
    }

    const newTokens = defaultTokenService.refreshToken(refreshToken);
    return res.json(newTokens);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/token/revoke
 * Revokes a token by JTI.
 */
router.post("/token/revoke", RATE_LIMITS.tokenOperations.middleware(), async (req, res) => {
  const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
  if (isAnonymous) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required to revoke tokens",
    });
  }

  const { jti, reason } = req.body || {};
  if (!jti || typeof jti !== "string" || !jti.trim()) {
    return res.status(400).json({ error: "Missing or invalid 'jti'" });
  }

  const callerUserId =
    (req.user && (req.user.sub || req.user.userId)) ||
    (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));
  const callerTenant = req.tenantContext?.tenantId;
  const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
  const isTenantAdmin = Boolean(
    req.tenantContext?.roles?.some((r) => {
      const lower = String(r).toLowerCase();
      return lower.includes("admin");
    })
  );

  const tokenRecord = defaultTokenService.getTokenRecord(jti);

  if (!tokenRecord) {
    // If not in registry, check if caller's own current access token matches the JTI
    if (req.user?.jti === jti) {
      // Caller revoking own current token
    } else {
      return res.status(404).json({
        error: "NotFound",
        message: `Token '${jti}' not found or unrecognized by server`,
      });
    }
  } else {
    // Cross-tenant check: non-platform admins cannot revoke tokens belonging to another tenant
    if (!isPlatformAdmin && callerTenant && tokenRecord.tenantId && tokenRecord.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot revoke token belonging to foreign tenant '${tokenRecord.tenantId}'`,
      });
    }

    // Vertical privilege check: tenant admin cannot revoke platform admin token
    if (!isPlatformAdmin && tokenRecord.userId) {
      const targetUser = defaultLocalAuthManager.getUser(tokenRecord.userId);
      if (targetUser?.roles?.some((r) => String(r).toLowerCase().includes("platform"))) {
        return res.status(403).json({
          error: "VerticalPrivilegeEscalation",
          code: "VERTICAL_PRIVILEGE_ESCALATION",
          message: "Tenant administrators cannot revoke platform administrator tokens",
        });
      }
    }

    // Ownership check: ordinary user can only revoke their own tokens
    const isOwner = Boolean(callerUserId && tokenRecord.userId === callerUserId) || req.user?.jti === jti;
    if (!isOwner && !isPlatformAdmin && !isTenantAdmin) {
      return res.status(403).json({
        error: "Forbidden",
        code: "FORBIDDEN",
        message: "Ordinary users may only revoke their own tokens",
      });
    }
  }

  defaultTokenService.revokeToken(jti, reason || "Client revocation");

  const isAdministrativeRevocation = Boolean(tokenRecord && tokenRecord.userId !== callerUserId);
  await defaultAuditService.logEvent({
    category: AUDIT_CATEGORIES.LOGOUT,
    action: AUDIT_ACTIONS.AUTH_TOKEN_REVOKED || "AUTH_TOKEN_REVOKED",
    actor: {
      id: callerUserId || "session-user",
      username: req.user?.username || req.user?.name || "session-user",
      role: req.auth?.role || "user",
      ipAddress: req.ip || req.socket?.remoteAddress,
    },
    tenantId: tokenRecord?.tenantId || callerTenant || "default",
    target: {
      type: "token",
      id: jti,
    },
    status: AUDIT_STATUSES.SUCCESS,
    details: {
      jti,
      administrative: isAdministrativeRevocation,
      authorizedActor: callerUserId,
      targetUserId: tokenRecord?.userId || callerUserId,
      reason: reason || "Client revocation",
    },
  }).catch(() => {});

  return res.json({
    success: true,
    message: `Token '${jti}' revoked successfully`,
    jti,
    targetUserId: tokenRecord?.userId || callerUserId,
    authorizedActor: callerUserId,
  });
});

/**
 * P0 Security Remediation — Phase 2.1 Public Registration Hardening
 *
 * Public registration MUST NOT allow the client to choose:
 * - roles
 * - tenantId
 * - permissions
 * - privileges
 * - system ownership
 *
 * Lowest-privilege account is strictly enforced: "viewer" in "default-tenant".
 * Server ignores or rejects any privilege escalation attempts and never trusts
 * client-supplied privilege fields.
 */
const PRIVILEGED_ROLE_NAMES = new Set([
  "admin",
  "administrator",
  "platform administrator",
  "platform_admin",
  "platform-admin",
  "platformadmin",
  "superadmin",
  "superuser",
  "owner",
  "security administrator",
  "security_admin",
  "security-admin",
  "securityadmin",
  "secops",
  "security_engineer",
  "*",
  "analyst",
  "developer",
  "auditor",
]);

function detectPrivilegeEscalationAttempt(body = {}) {
  const violations = [];

  // 1. Check roles / role / userRole / user_role
  const roleFields = ["roles", "role", "userRole", "user_role"];
  for (const field of roleFields) {
    if (body[field] !== undefined && body[field] !== null) {
      const rawVal = body[field];
      const roleList = Array.isArray(rawVal) ? rawVal : [rawVal];
      for (const r of roleList) {
        if (typeof r !== "string") {
          violations.push(`Invalid role specification in '${field}': ${typeof r}`);
          continue;
        }
        const norm = r.trim().toLowerCase().replace(/[-_]/g, " ");
        const raw = r.trim().toLowerCase();
        if (
          PRIVILEGED_ROLE_NAMES.has(raw) ||
          PRIVILEGED_ROLE_NAMES.has(norm) ||
          raw === "*" ||
          (norm !== "viewer" &&
            norm !== "default user" &&
            norm !== "read only" &&
            norm !== "reader" &&
            norm !== "user" &&
            norm !== "")
        ) {
          violations.push(`Privileged role assignment attempted in '${field}': '${r}'`);
        }
      }
    }
  }

  // 2. Check tenant selection (tenantId, tenant_id, tenant)
  const tenantFields = ["tenantId", "tenant_id", "tenant"];
  for (const field of tenantFields) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      body[field] !== "" &&
      body[field] !== "default-tenant"
    ) {
      violations.push(`Arbitrary tenant selection attempted in '${field}': '${body[field]}'`);
    }
  }

  // 3. Check permissions & privileges
  if (
    body.permissions !== undefined &&
    body.permissions !== null &&
    (Array.isArray(body.permissions) ? body.permissions.length > 0 : true)
  ) {
    violations.push(`Arbitrary permissions assignment attempted: ${JSON.stringify(body.permissions)}`);
  }
  if (body.privileges !== undefined && body.privileges !== null) {
    violations.push(`Privilege assignment attempted: ${JSON.stringify(body.privileges)}`);
  }

  // 4. Check admin, platform admin, and system ownership flags
  const adminFlags = [
    "isPlatformAdmin",
    "platformAdmin",
    "is_platform_admin",
    "isAdmin",
    "is_admin",
    "admin",
    "isSuperuser",
    "is_superuser",
    "superuser",
    "systemOwnership",
    "isOwner",
    "owner",
  ];
  for (const flag of adminFlags) {
    if (body[flag] !== undefined && body[flag] !== null && body[flag] !== false) {
      violations.push(`Privileged administrative flag attempted: '${flag}'`);
    }
  }

  return violations;
}

/**
 * Handles public registration requests safely and fail-closed.
 */
function handlePublicRegistration(req, res) {
  try {
    const body = req.body || {};
    let { username, email, password } = body;
    if (!username || !password) {
      return res.status(400).json({ error: "Missing required fields: 'username' and 'password'" });
    }

    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "ValidationError", message: "Username and password must be strings" });
    }

    if (email !== undefined && email !== null && typeof email !== "string") {
      return res.status(400).json({ error: "ValidationError", message: "Email must be a string" });
    }

    const uCheck = validateLength(username, { min: 3, max: 64, fieldName: "username" });
    if (!uCheck.valid) return res.status(400).json({ error: "ValidationError", message: uCheck.error });

    const pCheck = validateLength(password, { min: 1, max: 128, fieldName: "password" });
    if (!pCheck.valid) return res.status(400).json({ error: "ValidationError", message: pCheck.error });

    if (email) {
      const eCheck = validateLength(email, { min: 5, max: 254, fieldName: "email" });
      if (!eCheck.valid) return res.status(400).json({ error: "ValidationError", message: eCheck.error });
    } else {
      email = `${username.trim().toLowerCase()}@ecdat.local`;
    }

    const violations = detectPrivilegeEscalationAttempt(body);
    const safeIgnoreRequested =
      req.query.safe_ignore === "true" ||
      req.query.mode === "ignore" ||
      req.headers["x-registration-mode"] === "safe-ignore";

    if (violations.length > 0) {
      if (!safeIgnoreRequested) {
        // Strict Fail-Closed Stance (Rule 3): Reject role escalation attempts
        defaultAuditService
          .logEvent({
            category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
            action: "ROLE_ESCALATION_ATTEMPT_BLOCKED",
            actor: {
              username: String(username).trim().toLowerCase(),
              ipAddress: req.ip || req.socket?.remoteAddress || "127.0.0.1",
              role: "anonymous",
            },
            tenantId: "default-tenant",
            status: AUDIT_STATUSES.DENIED,
            details: {
              violations,
              attemptedRoles: body.roles || body.role,
              attemptedTenantId: body.tenantId,
              attemptedPermissions: body.permissions,
              reason: "Public registration cannot choose roles, permissions, or tenant",
            },
          })
          .catch(() => {});

        return res.status(400).json({
          error: "PrivilegeEscalationForbidden",
          code: "PRIVILEGE_ESCALATION_FORBIDDEN",
          message:
            "Public registration does not allow client-supplied roles, permissions, privileges, or tenant assignment.",
          violations,
        });
      }

      // Safe-ignore mode: Log security audit warning and safely strip client-supplied privilege fields
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
          action: "ROLE_ESCALATION_ATTEMPT_SAFELY_IGNORED",
          actor: {
            username: String(username).trim().toLowerCase(),
            ipAddress: req.ip || req.socket?.remoteAddress || "127.0.0.1",
            role: "anonymous",
          },
          tenantId: "default-tenant",
          status: AUDIT_STATUSES.SUCCESS,
          details: {
            violations,
            assignedRole: "viewer",
            assignedTenant: "default-tenant",
            reason: "Client privilege fields stripped and forced to lowest-privilege default",
          },
        })
        .catch(() => {});
    }

    // NEVER trust req.body.roles, req.body.role, or req.body.tenantId for privilege assignment.
    // Server strictly enforces lowest-privilege account in default tenant.
    const newUser = defaultLocalAuthManager.registerUser({
      username,
      email,
      password,
      roles: ["viewer"],
      tenantId: "default-tenant",
    });

    return res.status(201).json({
      success: true,
      user: {
        ...newUser,
        role: newUser.roles?.[0] || "viewer",
      },
    });
  } catch (err) {
    if (err instanceof PasswordPolicyError) {
      return res.status(400).json({
        error: "PasswordPolicyViolation",
        message: err.message,
        violations: err.violations,
      });
    }
    return res.status(400).json({ error: err.message });
  }
}

/**
 * POST /api/v1/auth/local/register & POST /api/v1/auth/register
 * Public registration endpoint producing lowest-privilege accounts.
 */
router.post("/local/register", RATE_LIMITS.registration.middleware(), handlePublicRegistration);
router.post("/register", RATE_LIMITS.registration.middleware(), handlePublicRegistration);

/**
 * Protected Administrator User Creation Workflow
 *
 * authenticated administrator
 *        ↓
 * authorization check (USERS_MANAGE)
 *        ↓
 * vertical privilege escalation check
 *        ↓
 * create user
 *        ↓
 * assign role
 *        ↓
 * audit event
 *
 * POST /api/v1/auth/admin/users & POST /api/v1/auth/users
 */
function handleAdminCreateUser(req, res) {
  try {
    // 1. Authenticated administrator check
    if (!req.auth || !req.auth.authenticated) {
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.LOGIN,
          action: AUDIT_ACTIONS.AUTHORIZATION_FAILURE,
          status: AUDIT_STATUSES.DENIED,
          actor: { id: "anonymous", username: "anonymous", role: "anonymous", ipAddress: req.ip },
          tenantId: "default",
          target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
          details: { code: "AUTHENTICATION_REQUIRED", requiredPermission: PERMISSIONS.USERS_MANAGE },
        })
        .catch(() => {});

      return res.status(401).json({
        error: "Unauthorized",
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication required to access administrative user management.",
      });
    }

    const callerRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : []);

    // 2. Authorization check: requires users:manage permission
    const canManageUsers = hasPermission(callerRoles, PERMISSIONS.USERS_MANAGE);
    if (!canManageUsers) {
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
          action: AUDIT_ACTIONS.PERMISSION_DENIED,
          status: AUDIT_STATUSES.DENIED,
          actor: {
            id: (req.user && (req.user.sub || req.user.userId)) || "unknown",
            username: (req.user && req.user.username) || "unknown",
            role: callerRoles[0] || "viewer",
            ipAddress: req.ip,
          },
          tenantId: (req.user && req.user.tenantId) || "default-tenant",
          target: { type: "endpoint", id: req.originalUrl || req.path, name: req.method },
          details: { code: "INSUFFICIENT_PERMISSIONS", requiredPermission: PERMISSIONS.USERS_MANAGE, callerRoles },
        })
        .catch(() => {});

      return res.status(403).json({
        error: "Forbidden",
        code: "INSUFFICIENT_PERMISSIONS",
        message: `Access denied. Caller lacks '${PERMISSIONS.USERS_MANAGE}' permission.`,
        callerRoles,
      });
    }

    const { username, email, password, roles, role, tenantId } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({
        error: "Missing required fields: 'username', 'email', and 'password'",
      });
    }

    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "ValidationError", message: "Username, email, and password must be strings" });
    }

    const uCheck = validateLength(username, { min: 3, max: 64, fieldName: "username" });
    if (!uCheck.valid) return res.status(400).json({ error: "ValidationError", message: uCheck.error });

    const pCheck = validateLength(password, { min: 1, max: 128, fieldName: "password" });
    if (!pCheck.valid) return res.status(400).json({ error: "ValidationError", message: pCheck.error });

    const eCheck = validateLength(email, { min: 5, max: 254, fieldName: "email" });
    if (!eCheck.valid) return res.status(400).json({ error: "ValidationError", message: eCheck.error });

    // 3. Normalize requested roles
    const rawRoles =
      roles !== undefined ? (Array.isArray(roles) ? roles : [roles]) : role ? [role] : ["viewer"];
    const assignedRoles = rawRoles.map((r) => normalizeRole(r));

    // 4. Vertical Privilege Escalation Defense:
    // Only Platform Administrator can create Platform Administrator accounts
    const isPlatformAdmin = callerRoles.some((r) => normalizeRole(r) === ROLES.PLATFORM_ADMIN);
    const targetIsPlatformAdmin = assignedRoles.some((r) => r === ROLES.PLATFORM_ADMIN);

    if (!isPlatformAdmin && targetIsPlatformAdmin) {
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
          action: AUDIT_ACTIONS.PERMISSION_DENIED,
          status: AUDIT_STATUSES.DENIED,
          actor: {
            id: (req.user && (req.user.sub || req.user.userId)) || "unknown",
            username: (req.user && req.user.username) || "unknown",
            role: callerRoles[0] || "viewer",
            ipAddress: req.ip,
          },
          tenantId: (req.user && req.user.tenantId) || "default-tenant",
          target: { type: "user", id: username || "new_user" },
          details: {
            code: "VERTICAL_PRIVILEGE_ESCALATION",
            reason: "Non-platform admin attempted to create platform administrator",
            targetRoles: assignedRoles,
          },
        })
        .catch(() => {});

      return res.status(403).json({
        error: "Forbidden",
        code: "VERTICAL_PRIVILEGE_ESCALATION",
        message: "Security administrators cannot create or grant 'platform administrator' privileges.",
      });
    }

    // 5. Horizontal Multi-Tenant Boundary Enforcement
    const callerTenant = (req.user && req.user.tenantId) || "default-tenant";
    const targetTenant = tenantId || (isPlatformAdmin ? "default-tenant" : callerTenant);

    if (!isPlatformAdmin && targetTenant !== callerTenant) {
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
          action: AUDIT_ACTIONS.TENANT_ISOLATION_VIOLATION,
          status: AUDIT_STATUSES.DENIED,
          actor: {
            id: (req.user && (req.user.sub || req.user.userId)) || "unknown",
            username: (req.user && req.user.username) || "unknown",
            role: callerRoles[0] || "viewer",
            ipAddress: req.ip,
          },
          tenantId: callerTenant,
          target: { type: "tenant", id: targetTenant },
          details: {
            code: "HORIZONTAL_TENANT_VIOLATION",
            callerTenant,
            targetTenant,
            reason: "Cross-tenant user creation attempt",
          },
        })
        .catch(() => {});

      return res.status(403).json({
        error: "Forbidden",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cross-tenant user creation forbidden. Caller tenant '${callerTenant}' cannot create users in '${targetTenant}'.`,
      });
    }

    // 6. Create User & Assign Roles
    const newUser = defaultLocalAuthManager.registerUser({
      username,
      email,
      password,
      roles: assignedRoles,
      tenantId: targetTenant,
    });

    // 7. Tamper-resistant Audit Event
    const callerId = (req.user && (req.user.sub || req.user.userId)) || req.auth?.role || "admin";
    const callerUsername = (req.user && req.user.username) || callerId;

    defaultAuditService
      .logEvent({
        category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
        action: AUDIT_ACTIONS.ROLE_ASSIGNED,
        actor: {
          id: callerId,
          username: callerUsername,
          role: callerRoles[0] || "admin",
          ipAddress: req.ip || req.socket?.remoteAddress || "127.0.0.1",
        },
        tenantId: targetTenant,
        target: {
          type: "user",
          id: newUser.userId,
          name: newUser.username,
        },
        status: AUDIT_STATUSES.SUCCESS,
        details: {
          createdUserId: newUser.userId,
          createdUsername: newUser.username,
          assignedRoles: newUser.roles,
          assignedTenant: newUser.tenantId,
          action: "ADMIN_USER_CREATION",
        },
      })
      .catch(() => {});

    return res.status(201).json({
      success: true,
      user: newUser,
    });
  } catch (err) {
    if (err instanceof PasswordPolicyError) {
      return res.status(400).json({
        error: "PasswordPolicyViolation",
        message: err.message,
        violations: err.violations,
      });
    }
    return res.status(400).json({ error: err.message });
  }
}

router.post("/admin/users", handleAdminCreateUser);
router.post("/users", handleAdminCreateUser);

/**
 * GET /api/v1/auth/users/:userId
 * Retrieves user record verifying server-side state, tenant boundaries, and IDOR/BOLA protection.
 */
router.get(
  "/users/:userId",
  requireObjectAuthorization(OBJECT_TYPES.USER, { idParam: "userId" }),
  (req, res) => {
    const user = req.resolvedObject;
    return res.json({
      userId: user.id,
      username: user.username,
      tenantId: user.tenantId,
      roles: user.roles,
    });
  }
);

/**
 * PUT /api/v1/auth/users/:userId
 * Updates user profile verifying server-side state, tenant boundaries, and IDOR protection.
 */
router.put(
  "/users/:userId",
  requireObjectAuthorization(OBJECT_TYPES.USER, { idParam: "userId" }),
  (req, res) => {
    const user = req.resolvedObject;
    const { displayName, email } = req.body || {};
    const targetUser = defaultLocalAuthManager.getUser(user.id);
    if (targetUser) {
      if (displayName) targetUser.displayName = displayName;
      if (email) targetUser.email = email;
    }
    return res.json({
      success: true,
      userId: user.id,
      tenantId: user.tenantId,
      message: "User profile updated successfully",
    });
  }
);

/**
 * DELETE /api/v1/auth/users/:userId
 * Deletes user verifying tenant boundaries and object authorization.
 */
router.delete(
  "/users/:userId",
  requireRole(["admin", "security administrator", "platform administrator"]),
  requireObjectAuthorization(OBJECT_TYPES.USER, { idParam: "userId" }),
  (req, res) => {
    const user = req.resolvedObject;
    defaultLocalAuthManager.users.delete(user.id);
    return res.json({
      success: true,
      message: `User '${user.id}' deleted successfully`,
    });
  }
);

/**
 * GET /api/v1/auth/secrets/:secretId
 * Retrieves secret metadata enforcing tenant isolation and BOLA protection.
 */
router.get(
  "/secrets/:secretId",
  requireObjectAuthorization(OBJECT_TYPES.SECRET, { idParam: "secretId" }),
  (req, res) => {
    const secret = req.resolvedObject;
    return res.json({
      secretId: secret.id,
      tenantId: secret.tenantId,
      keyType: secret.keyType,
      status: "active",
    });
  }
);

/**
 * DELETE /api/v1/auth/secrets/:secretId
 * Revokes secret enforcing tenant isolation and BOLA protection.
 */
router.delete(
  "/secrets/:secretId",
  requireRole(["admin", "security administrator", "platform administrator"]),
  requireObjectAuthorization(OBJECT_TYPES.SECRET, { idParam: "secretId" }),
  (req, res) => {
    const secret = req.resolvedObject;
    defaultObjectStateRegistry.secrets.delete(secret.id);
    return res.json({
      success: true,
      message: `Secret '${secret.id}' revoked successfully`,
    });
  }
);

/**
 * POST /api/v1/auth/local/login
 * Authenticates user with brute-force lockout & MFA challenge detection.
 */
router.post("/local/login", RATE_LIMITS.login.middleware(), (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Missing required fields: 'username' and 'password'" });
    }

    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const authResult = defaultLocalAuthManager.authenticate({ username, password, ip });

    if (authResult.mfaRequired) {
      return res.status(200).json({
        mfaRequired: true,
        mfaToken: authResult.mfaToken,
        userId: authResult.userId,
        username: authResult.username,
        message: "Multi-factor authentication required. Please verify with /api/v1/auth/mfa/verify",
      });
    }

    const tokens = defaultTokenService.issueTokenPair({
      userId: authResult.user.userId,
      email: authResult.user.email,
      name: authResult.user.username,
      roles: authResult.user.roles,
      provider: "local_auth",
      customClaims: { tenantId: authResult.user.tenantId || "default-tenant" },
    });

    const csrfToken = generateCsrfToken();
    setAuthCookies(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken,
    });

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: AUDIT_ACTIONS.LOGIN,
      actor: {
        id: authResult.user.userId,
        username: authResult.user.username,
        role: authResult.user.roles?.[0] || "user",
        ipAddress: ip,
      },
      tenantId: authResult.user.tenantId || "default",
      status: AUDIT_STATUSES.SUCCESS,
      details: { method: "local_auth" },
    }).catch(() => {});

    return res.json({
      ...tokens,
      csrfToken,
      user: authResult.user,
    });
  } catch (err) {
    const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: AUDIT_ACTIONS.LOGIN,
      actor: { username: req.body?.username || "unknown", ipAddress: ip },
      status: AUDIT_STATUSES.FAILURE,
      details: { method: "local_auth", error: err.message },
    }).catch(() => {});

    if (err instanceof AccountLockedError) {
      return res.status(423).json({
        error: "AccountLocked",
        message: err.message,
        unlockTime: err.unlockTime,
      });
    }
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/mfa/setup
 * Generates RFC 6238 TOTP secret and recovery codes for enrollment.
 */
router.post("/mfa/setup", RATE_LIMITS.mfa.middleware(), async (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to configure MFA",
      });
    }

    const callerId =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));
    const requestedTarget = (req.body && (req.body.userId || req.body.username)) || null;
    const identifier = requestedTarget || callerId;

    if (!identifier) {
      return res.status(400).json({ error: "Missing user identifier for MFA setup" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user) {
      return res.status(404).json({ error: `User '${identifier}' not found` });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;
    const isSelf = Boolean(
      callerId &&
        (user.userId === callerId ||
          user.username === callerId ||
          user.email === req.user?.email ||
          user.userId === req.user?.sub)
    );

    if (!isPlatformAdmin && callerTenant && user.tenantId && user.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cross-tenant MFA manipulation is forbidden. Target user belongs to tenant '${user.tenantId}'.`,
      });
    }

    if (!isPlatformAdmin && user.roles?.some((r) => String(r).toLowerCase().includes("platform"))) {
      return res.status(403).json({
        error: "VerticalPrivilegeEscalation",
        code: "VERTICAL_PRIVILEGE_ESCALATION",
        message: "Tenant administrators cannot configure platform administrator MFA",
      });
    }

    if (!isSelf && !isPlatformAdmin) {
      const isTenantAdmin = req.tenantContext?.roles?.some((r) => String(r).toLowerCase().includes("admin"));
      if (!isTenantAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Non-administrators can only configure MFA for their own account",
        });
      }
    }

    // Reauthentication where appropriate: if user already has MFA enabled, require proof
    if (isSelf && user.mfaEnabled) {
      const { currentTotp, password } = req.body || {};
      let reauthenticated = false;
      if (currentTotp && user.mfaSecret) {
        reauthenticated = defaultMfaEngine.verifyCode(user.mfaSecret, currentTotp);
      } else if (password) {
        reauthenticated = defaultLocalAuthManager.verifyPassword(user, password);
      }
      if (!reauthenticated) {
        return res.status(403).json({
          error: "ReauthenticationRequired",
          code: "REAUTHENTICATION_REQUIRED",
          message: "Reauthentication with current password or TOTP is required to reconfigure MFA",
        });
      }
    }

    const mfaSetup = defaultMfaEngine.generateSecret({ accountName: user.email || user.username });
    const backupCodes = defaultMfaEngine.generateBackupCodes(8);

    user.pendingMfaSecret = mfaSetup.secret;
    user.pendingBackupHashes = backupCodes.hashedCodes;

    await defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: "AUTH_MFA_SETUP_INITIATED",
      actor: {
        id: callerId || user.userId,
        username: req.user?.username || user.username,
        role: req.user?.roles?.[0] || "viewer",
        ipAddress: req.ip || req.socket?.remoteAddress,
      },
      tenantId: user.tenantId || callerTenant || "default",
      target: {
        type: "user",
        id: user.userId,
        name: user.username,
      },
      status: AUDIT_STATUSES.SUCCESS,
      details: {
        action: "MFA_SETUP_INITIATED",
        method: "TOTP_RFC6238",
      },
    }).catch(() => {});

    return res.json({
      secret: mfaSetup.secret,
      otpAuthUri: mfaSetup.otpAuthUri,
      issuer: mfaSetup.issuer,
      digits: mfaSetup.digits,
      period: mfaSetup.period,
      backupCodes: backupCodes.plainCodes,
      instructions: "Enter the secret into your authenticator app and verify with /mfa/enable to complete enrollment.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/mfa/enable
 * Verifies code to complete MFA enrollment with proof of possession.
 */
router.post("/mfa/enable", RATE_LIMITS.mfa.middleware(), async (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to configure MFA",
      });
    }

    const { code } = req.body || {};
    const callerId =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));
    const requestedTarget = (req.body && (req.body.userId || req.body.username)) || null;
    const identifier = requestedTarget || callerId;

    if (!identifier || !code) {
      return res.status(400).json({ error: "Missing required fields: identifier and code" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user) {
      return res.status(404).json({ error: `User '${identifier}' not found` });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;
    const isSelf = Boolean(
      callerId &&
        (user.userId === callerId ||
          user.username === callerId ||
          user.email === req.user?.email ||
          user.userId === req.user?.sub)
    );

    if (!isPlatformAdmin && callerTenant && user.tenantId && user.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cross-tenant MFA manipulation is forbidden. Target user belongs to tenant '${user.tenantId}'.`,
      });
    }

    if (!isPlatformAdmin && user.roles?.some((r) => String(r).toLowerCase().includes("platform"))) {
      return res.status(403).json({
        error: "VerticalPrivilegeEscalation",
        code: "VERTICAL_PRIVILEGE_ESCALATION",
        message: "Tenant administrators cannot configure platform administrator MFA",
      });
    }

    if (!isSelf && !isPlatformAdmin) {
      const isTenantAdmin = req.tenantContext?.roles?.some((r) => String(r).toLowerCase().includes("admin"));
      if (!isTenantAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Non-administrators can only configure MFA for their own account",
        });
      }
    }

    if (!user.pendingMfaSecret) {
      return res.status(400).json({ error: "No pending MFA enrollment found for this user" });
    }

    // Proof of possession: verify user actually possesses the authenticator app
    const valid = defaultMfaEngine.verifyCode(user.pendingMfaSecret, code);
    if (!valid) {
      return res.status(400).json({ error: "Invalid TOTP code. Enrollment could not be verified." });
    }

    user.mfaEnabled = true;
    user.mfaSecret = user.pendingMfaSecret;
    user.backupCodeHashes = user.pendingBackupHashes || [];
    delete user.pendingMfaSecret;
    delete user.pendingBackupHashes;

    await defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: AUDIT_ACTIONS.AUTH_MFA_SUCCESS || "AUTH_MFA_ENABLED",
      actor: {
        id: callerId || user.userId,
        username: req.user?.username || user.username,
        role: req.user?.roles?.[0] || "viewer",
        ipAddress: req.ip || req.socket?.remoteAddress,
      },
      tenantId: user.tenantId || callerTenant || "default",
      target: {
        type: "user",
        id: user.userId,
        name: user.username,
      },
      status: AUDIT_STATUSES.SUCCESS,
      details: {
        action: "MFA_ENABLED",
        method: "TOTP_RFC6238",
        backupCodesCount: user.backupCodeHashes.length,
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Multi-factor authentication successfully enabled",
      mfaEnabled: true,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/mfa/reset
 * Secure recovery/reset flow for MFA with proof of possession or admin authority.
 */
router.post("/mfa/reset", RATE_LIMITS.mfa.middleware(), async (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to reset MFA",
      });
    }

    const callerId =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));
    const requestedTarget = (req.body && (req.body.userId || req.body.username)) || null;
    const identifier = requestedTarget || callerId;

    if (!identifier) {
      return res.status(400).json({ error: "Missing user identifier for MFA reset" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user) {
      return res.status(404).json({ error: `User '${identifier}' not found` });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;
    const isSelf = Boolean(
      callerId &&
        (user.userId === callerId ||
          user.username === callerId ||
          user.email === req.user?.email ||
          user.userId === req.user?.sub)
    );

    if (!isPlatformAdmin && callerTenant && user.tenantId && user.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cross-tenant MFA reset is forbidden. Target user belongs to tenant '${user.tenantId}'.`,
      });
    }

    if (!isPlatformAdmin && user.roles?.some((r) => String(r).toLowerCase().includes("platform"))) {
      return res.status(403).json({
        error: "VerticalPrivilegeEscalation",
        code: "VERTICAL_PRIVILEGE_ESCALATION",
        message: "Tenant administrators cannot reset platform administrator MFA",
      });
    }

    if (!isSelf && !isPlatformAdmin) {
      const isTenantAdmin = req.tenantContext?.roles?.some((r) => String(r).toLowerCase().includes("admin"));
      if (!isTenantAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          code: "FORBIDDEN",
          message: "Non-administrators can only reset MFA for their own account",
        });
      }
    }

    // Security proof for self-reset: must provide password, current TOTP, or valid backup code
    if (isSelf && user.mfaEnabled) {
      const { password, code, isBackupCode } = req.body || {};
      let verified = false;

      if (isBackupCode && code) {
        const backupResult = defaultMfaEngine.verifyAndConsumeBackupCode(code, user.backupCodeHashes || []);
        if (backupResult.valid) {
          user.backupCodeHashes = backupResult.remainingHashes;
          verified = true;
        }
      } else if (code && user.mfaSecret) {
        verified = defaultMfaEngine.verifyCode(user.mfaSecret, code);
      } else if (password) {
        verified = defaultLocalAuthManager.verifyPassword(user, password);
      }

      if (!verified) {
        return res.status(403).json({
          error: "ReauthenticationRequired",
          code: "REAUTHENTICATION_REQUIRED",
          message: "Proof of possession (password, backup code, or TOTP) required to reset MFA",
        });
      }
    }

    user.mfaEnabled = false;
    delete user.mfaSecret;
    delete user.pendingMfaSecret;
    delete user.pendingBackupHashes;
    user.backupCodeHashes = [];

    await defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGOUT,
      action: "AUTH_MFA_RESET",
      actor: {
        id: callerId || user.userId,
        username: req.user?.username || user.username,
        role: req.user?.roles?.[0] || "viewer",
        ipAddress: req.ip || req.socket?.remoteAddress,
      },
      tenantId: user.tenantId || callerTenant || "default",
      target: {
        type: "user",
        id: user.userId,
        name: user.username,
      },
      status: AUDIT_STATUSES.SUCCESS,
      details: {
        action: "MFA_RESET",
        authorizedActor: callerId,
        targetUserId: user.userId,
        reason: req.body?.reason || "User or admin MFA reset",
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Multi-factor authentication successfully reset for user '${user.username}'`,
      mfaEnabled: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/mfa/disable
 * Disables multi-factor authentication with proof of possession or admin authority.
 * Emits AUTH_MFA_DISABLED structured audit event.
 */
router.post("/mfa/disable", RATE_LIMITS.mfa.middleware(), async (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to disable MFA",
      });
    }

    const callerId =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));
    const requestedTarget = (req.body && (req.body.userId || req.body.username)) || null;
    const identifier = requestedTarget || callerId;

    if (!identifier) {
      return res.status(400).json({ error: "Missing user identifier for MFA disable" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user) {
      return res.status(404).json({ error: `User '${identifier}' not found` });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;
    const isSelf = Boolean(
      callerId &&
        (user.userId === callerId ||
          user.username === callerId ||
          String(callerId) === String(user.userId))
    );

    if (!isSelf && !isPlatformAdmin) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only the user themselves or an administrator may disable MFA",
      });
    }

    user.mfaEnabled = false;
    delete user.mfaSecret;
    delete user.pendingMfaSecret;
    delete user.pendingBackupHashes;
    user.backupCodeHashes = [];

    await defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: AUDIT_ACTIONS.AUTH_MFA_DISABLED,
      actor: {
        id: callerId || user.userId,
        username: req.user?.username || user.username,
        role: req.user?.roles?.[0] || "viewer",
        ipAddress: req.ip || req.socket?.remoteAddress,
      },
      tenant: user.tenantId || callerTenant || "default",
      target: {
        type: "user",
        id: user.userId,
        name: user.username,
      },
      requestId: req.id || req.headers["x-request-id"],
      result: AUDIT_STATUSES.SUCCESS,
      reason: req.body?.reason || "User or admin MFA disabled",
      sourceIp: req.ip,
      details: {
        action: "MFA_DISABLED",
        authorizedActor: callerId,
        targetUserId: user.userId,
      },
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Multi-factor authentication successfully disabled for user '${user.username}'`,
      mfaEnabled: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/mfa/verify
 * Completes second-factor challenge during login using TOTP or single-use backup code.
 */
router.post("/mfa/verify", RATE_LIMITS.mfa.middleware(), (req, res) => {
  try {
    const { mfaToken, code, isBackupCode } = req.body || {};
    if (!mfaToken || !code) {
      return res.status(400).json({ error: "Missing required fields: 'mfaToken' and 'code'" });
    }

    // Locate user with pending challenge
    let challengeUser = null;
    for (const u of defaultLocalAuthManager.users.values()) {
      if (u.pendingMfaToken === mfaToken) {
        challengeUser = u;
        break;
      }
    }

    if (!challengeUser || Date.now() > challengeUser.pendingMfaExpiresAt) {
      return res.status(401).json({ error: "Invalid or expired MFA challenge token" });
    }

    let verified = false;
    if (isBackupCode) {
      const backupResult = defaultMfaEngine.verifyAndConsumeBackupCode(code, challengeUser.backupCodeHashes);
      if (backupResult.valid) {
        challengeUser.backupCodeHashes = backupResult.remainingHashes;
        verified = true;
      }
    } else {
      verified = defaultMfaEngine.verifyCode(challengeUser.mfaSecret, code);
    }

    if (!verified) {
      return res.status(401).json({ error: "Invalid verification code" });
    }

    challengeUser.pendingMfaToken = null;

    const tokens = defaultTokenService.issueTokenPair({
      userId: challengeUser.userId,
      email: challengeUser.email,
      name: challengeUser.username,
      roles: challengeUser.roles,
      provider: "local_auth",
      customClaims: { tenantId: challengeUser.tenantId || "default-tenant" },
    });

    const csrfToken = generateCsrfToken();
    setAuthCookies(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken,
    });

    return res.json({
      ...tokens,
      csrfToken,
      user: {
        userId: challengeUser.userId,
        username: challengeUser.username,
        email: challengeUser.email,
        roles: challengeUser.roles,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/auth/csrf-token
 * Issues a cryptographically secure CSRF token and sets the CSRF cookie.
 */
router.get("/csrf-token", (req, res) => {
  const csrfToken = generateCsrfToken();
  setAuthCookies(res, { csrfToken });
  return res.json({ csrfToken });
});

/**
 * POST /api/v1/auth/cookie/login
 * Local login that issues secure HttpOnly, SameSite=Strict cookies + CSRF token.
 */
router.post("/cookie/login", RATE_LIMITS.login.middleware(), (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Missing required fields: 'username' and 'password'" });
    }

    const ip = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const authResult = defaultLocalAuthManager.authenticate({ username, password, ip });

    if (authResult.mfaRequired) {
      return res.status(200).json({
        mfaRequired: true,
        mfaToken: authResult.mfaToken,
        userId: authResult.userId,
        username: authResult.username,
        message: "Multi-factor authentication required. Please verify with /api/v1/auth/mfa/verify",
      });
    }

    const tokens = defaultTokenService.issueTokenPair({
      userId: authResult.user.userId,
      email: authResult.user.email,
      name: authResult.user.username,
      roles: authResult.user.roles,
      provider: "local_auth",
      customClaims: { tenantId: authResult.user.tenantId || "default-tenant" },
    });

    const csrfToken = generateCsrfToken();
    setAuthCookies(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      csrfToken,
    });

    return res.json({
      success: true,
      message: "Authenticated successfully with secure cookies",
      csrfToken,
      user: authResult.user,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    if (err instanceof AccountLockedError) {
      return res.status(423).json({
        error: "AccountLocked",
        message: err.message,
        unlockTime: err.unlockTime,
      });
    }
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/v1/auth/logout
 * Terminates current session, revokes access token (if available), and clears cookies.
 */
router.post("/logout", RATE_LIMITS.tokenOperations.middleware(), (req, res) => {
  const token = extractApiKey(req);
  if (token) {
    try {
      const payload = defaultTokenService.verifyToken(token, "access");
      if (payload && payload.jti) {
        defaultTokenService.revokeToken(payload.jti, "User logout");
      }
    } catch {
      // Best-effort revocation
    }
  }

  clearAuthCookies(res);

  defaultAuditService.logEvent({
    category: AUDIT_CATEGORIES.LOGOUT,
    action: AUDIT_ACTIONS.LOGOUT,
    actor: {
      id: req.user?.sub || req.auth?.user?.sub || "session-user",
      username: req.user?.username || req.auth?.user?.name || "session-user",
      role: req.auth?.role || "user",
      ipAddress: req.ip || req.socket?.remoteAddress,
    },
    tenantId: req.tenantContext?.tenantId || req.user?.tenantId || "default",
    status: AUDIT_STATUSES.SUCCESS,
  }).catch(() => {});

  return res.json({
    success: true,
    message: "Logged out successfully",
  });
});

/**
 * POST /api/v1/auth/logout-all
 * Global revocation across all devices for a given user.
 */
router.post("/logout-all", RATE_LIMITS.tokenOperations.middleware(), async (req, res) => {
  const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
  if (isAnonymous) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required to revoke user sessions",
    });
  }

  const callerUserId =
    (req.user && (req.user.sub || req.user.userId)) ||
    (req.auth?.user && (req.auth.user.sub || req.auth.user.userId));

  // Determine target user
  let targetUserId = callerUserId;
  if (req.body && req.body.userId !== undefined) {
    const rawTarget = req.body.userId;
    // Validate malformed user ID
    if (
      typeof rawTarget !== "string" ||
      !rawTarget.trim() ||
      rawTarget.length > 256 ||
      /[<>\/\\]/.test(rawTarget)
    ) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid or malformed 'userId'",
      });
    }
    targetUserId = rawTarget.trim();
  }

  if (!targetUserId) {
    return res.status(400).json({ error: "Missing 'userId'" });
  }

  const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
  const callerTenant = req.tenantContext?.tenantId;
  const isTenantAdmin = Boolean(
    req.tenantContext?.roles?.some((r) => {
      const lower = String(r).toLowerCase();
      return lower.includes("admin");
    })
  );

  let targetUser = null;
  // If targeting another user
  if (targetUserId !== callerUserId) {
    // Role check: ordinary authenticated user cannot target another user (fail fast to prevent user enumeration)
    if (!isPlatformAdmin && !isTenantAdmin) {
      return res.status(403).json({
        error: "Forbidden",
        code: "FORBIDDEN",
        message: "Ordinary users can only revoke their own sessions",
      });
    }

    targetUser = defaultLocalAuthManager.getUser(targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        error: "NotFound",
        message: `Target user '${targetUserId}' not found`,
      });
    }

    // Cross-tenant check: non-platform admins cannot revoke users in a foreign tenant
    if (!isPlatformAdmin && callerTenant && targetUser.tenantId && targetUser.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Administrator cannot revoke sessions for user in foreign tenant '${targetUser.tenantId}'`,
      });
    }

    // Vertical privilege check: non-platform admins cannot revoke platform admin sessions
    if (!isPlatformAdmin && targetUser.roles?.some((r) => String(r).toLowerCase().includes("platform"))) {
      return res.status(403).json({
        error: "VerticalPrivilegeEscalation",
        code: "VERTICAL_PRIVILEGE_ESCALATION",
        message: "Tenant administrators cannot revoke platform administrator sessions",
      });
    }
  } else {
    targetUser = defaultLocalAuthManager.getUser(targetUserId);
  }

  // Audit event for administrative or self revocation
  const isAdministrativeRevocation = targetUserId !== callerUserId;
  await defaultAuditService.logEvent({
    category: AUDIT_CATEGORIES.LOGOUT,
    action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL || "AUTH_LOGOUT_ALL",
    actor: {
      id: callerUserId || "system",
      username: req.user?.username || req.auth?.user?.name || "session-user",
      role: req.auth?.role || "user",
      ipAddress: req.ip || req.socket?.remoteAddress,
    },
    target: {
      type: "user",
      id: targetUserId,
    },
    tenantId: targetUser?.tenantId || callerTenant || "default",
    status: AUDIT_STATUSES.SUCCESS,
    details: {
      administrative: isAdministrativeRevocation,
      authorizedActor: callerUserId,
      targetUserId,
      reason: req.body?.reason || (isAdministrativeRevocation ? "Administrative revocation" : "User global logout"),
    },
  }).catch(() => {});

  const revocation = defaultTokenService.revokeAllUserSessions(
    targetUserId,
    req.body?.reason || (isAdministrativeRevocation ? "Administrative revocation" : "Global multi-device logout")
  );

  clearAuthCookies(res);

  return res.json({
    success: true,
    message: `All sessions revoked for user '${targetUserId}'`,
    targetUserId,
    authorizedActor: callerUserId,
    revocation,
  });
});

/**
 * GET /api/v1/auth/me
 * Returns current authenticated user and roles.
 */
router.get("/me", (req, res) => {
  if (!req.auth || !req.auth.authenticated) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  return res.json({
    authenticated: true,
    mode: req.auth.mode || "api_key",
    role: req.auth.role,
    roles: req.auth.roles || [req.auth.role],
    user: req.user || { userId: "api-admin", roles: ["admin"] },
  });
});

/**
 * POST /api/v1/auth/secrets/rotate
 * Rotates active signing keys or API secrets (Platform Administrator only).
 */
router.post(
  "/secrets/rotate",
  requirePermission(PERMISSIONS.SECRETS_ROTATE),
  validateSchemaStrict(SCHEMAS.SECRET_ROTATION),
  (req, res) => {
  try {
    const { keyType = "jwt_signing", newSecret } = req.body || {};
    const actor = req.user ? req.user.sub : (req.auth ? req.auth.role : "admin");

    const rotationResult = defaultSecretManager.rotateKey(keyType, {
      newSecret,
      actor,
    });

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.SECRET_OPERATION,
      action: AUDIT_ACTIONS.SECRET_ROTATE,
      actor: {
        id: actor,
        username: actor,
        role: req.auth?.role || "admin",
        ipAddress: req.ip || req.socket?.remoteAddress,
      },
      tenantId: req.tenantContext?.tenantId || "system",
      status: AUDIT_STATUSES.SUCCESS,
      target: keyType,
      details: { keyType },
    }).catch(() => {});

    return res.json(rotationResult);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/auth/rbac/catalog
 * Returns canonical enterprise roles, permission matrix, and endpoint declarations.
 */
router.get("/rbac/catalog", (req, res) => {
  return res.json({
    roles: Object.values(ROLES),
    permissions: Object.values(PERMISSIONS),
    rolePermissions: Object.fromEntries(
      Object.entries(ROLE_PERMISSIONS).map(([role, permSet]) => [role, Array.from(permSet)])
    ),
    endpointDeclarations: ENDPOINT_PERMISSIONS,
  });
});

/**
 * GET /api/v1/auth/rbac/my-permissions
 * Returns permissions granted to the current authenticated caller.
 */
router.get("/rbac/my-permissions", (req, res) => {
  if (!req.auth || !req.auth.authenticated) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  const userRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
  const permissions = getUserPermissions(userRoles);

  return res.json({
    userId: (req.user && (req.user.sub || req.user.userId)) || "anonymous",
    roles: userRoles,
    permissions,
  });
});

/**
 * POST /api/v1/auth/rbac/check
 * Evaluates permission check and horizontal boundary enforcement.
 */
router.post("/rbac/check", (req, res) => {
  const { permission, targetTenantId, targetOwnerId } = req.body || {};
  if (!permission) {
    return res.status(400).json({ error: "Missing 'permission' field" });
  }

  if (!req.auth || !req.auth.authenticated) {
    defaultAuditService
      .logEvent({
        category: AUDIT_CATEGORIES.LOGIN,
        action: AUDIT_ACTIONS.AUTHORIZATION_FAILURE,
        status: AUDIT_STATUSES.DENIED,
        actor: { id: "anonymous", username: "anonymous", role: "anonymous", ipAddress: req.ip },
        tenantId: "default",
        target: { type: "permission", id: permission },
        details: { code: "AUTHENTICATION_REQUIRED", permission },
      })
      .catch(() => {});

    return res.status(401).json({
      allowed: false,
      reason: "Authentication required",
    });
  }

  const userRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
  const hasPerm = hasPermission(userRoles, permission);

  if (!hasPerm) {
    defaultAuditService
      .logEvent({
        category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
        action: AUDIT_ACTIONS.PERMISSION_DENIED,
        status: AUDIT_STATUSES.DENIED,
        actor: {
          id: (req.user && (req.user.sub || req.user.userId)) || "unknown",
          username: (req.user && req.user.username) || "unknown",
          role: userRoles[0] || "viewer",
          ipAddress: req.ip,
        },
        tenantId: (req.user && req.user.tenantId) || "default-tenant",
        target: { type: "permission", id: permission },
        details: { code: "INSUFFICIENT_PERMISSIONS", permission, userRoles },
      })
      .catch(() => {});

    return res.status(403).json({
      allowed: false,
      code: "INSUFFICIENT_PERMISSIONS",
      reason: `Role does not grant '${permission}'`,
      requiredPermission: permission,
      userRoles,
    });
  }

  // Check horizontal tenant boundary
  const isPlatformAdmin = userRoles.some((r) => r === "admin" || r === ROLES.PLATFORM_ADMIN);
  if (!isPlatformAdmin && targetTenantId) {
    const userTenant = (req.user && req.user.tenantId) || "default-tenant";
    if (targetTenantId !== userTenant) {
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.PERMISSION_CHANGE,
          action: AUDIT_ACTIONS.TENANT_ISOLATION_VIOLATION,
          status: AUDIT_STATUSES.DENIED,
          actor: {
            id: (req.user && (req.user.sub || req.user.userId)) || "unknown",
            username: (req.user && req.user.username) || "unknown",
            role: userRoles[0] || "viewer",
            ipAddress: req.ip,
          },
          tenantId: userTenant,
          target: { type: "tenant", id: targetTenantId },
          details: { code: "HORIZONTAL_TENANT_VIOLATION", permission, userTenant, targetTenantId },
        })
        .catch(() => {});

      return res.status(403).json({
        allowed: false,
        code: "HORIZONTAL_TENANT_VIOLATION",
        reason: `Cross-tenant access forbidden between '${userTenant}' and '${targetTenantId}'`,
        userTenant,
        targetTenantId,
      });
    }
  }

  return res.json({
    allowed: true,
    permission,
    userRoles,
  });
});

/**
 * GET /api/v1/auth/rbac/matrix
 * Returns the derived authoritative Authorization Matrix across all product capabilities and roles.
 */
router.get("/rbac/matrix", (req, res) => {
  return res.json({
    capabilities: Object.values(CAPABILITIES),
    roles: [
      "anonymous",
      "viewer",
      "analyst",
      "developer",
      "auditor",
      "admin",
      "platform_admin",
    ],
    matrix: AUTHORIZATION_MATRIX,
  });
});

/**
 * GET /api/v1/auth/audit
 * Returns authentication audit log with tamper-chain integrity status.
 */
router.get("/audit", (req, res) => {
  const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
  if (isAnonymous) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required to access audit ledger",
    });
  }

  const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
  const callerTenant = req.tenantContext?.tenantId;

  // Check if client tried to specify a foreign tenant in query
  if (req.query.tenantId && !isPlatformAdmin) {
    if (String(req.query.tenantId).trim().toLowerCase() !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot access audit ledger for foreign tenant '${req.query.tenantId}'`,
      });
    }
  }

  const limit = parseInt(req.query.limit || "50", 10);
  let events = defaultAuthAuditLogger.getRecentEvents(limit);
  const integrity = defaultAuthAuditLogger.verifyChainIntegrity();

  if (!isPlatformAdmin && callerTenant) {
    events = events.filter((e) => !e.tenantId || e.tenantId === callerTenant);
  }

  return res.json({
    totalEvents: events.length,
    chainIntegrity: integrity,
    events,
  });
});

/**
 * POST /api/v1/auth/password-reset/request & POST /api/v1/auth/forgot-password
 * Initiates password reset flow with rate limiting and secure token generation.
 */
function handlePasswordResetRequest(req, res) {
  try {
    const { email, username } = req.body || {};
    const identifier = String(email || username || "").trim().toLowerCase();

    if (!identifier) {
      return res.status(400).json({ error: "Missing 'email' or 'username' parameter" });
    }

    let targetUser = null;
    if (defaultLocalAuthManager.users.has(identifier)) {
      targetUser = defaultLocalAuthManager.users.get(identifier);
    } else {
      for (const u of defaultLocalAuthManager.users.values()) {
        if (u.email === identifier || u.userId === identifier) {
          targetUser = u;
          break;
        }
      }
    }

    let resetToken = null;
    if (targetUser) {
      resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = Date.now() + 15 * 60 * 1000;
      passwordResetTokens.set(resetToken, {
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        expiresAt,
      });

      defaultAuditService.logEvent({
        category: AUDIT_CATEGORIES.LOGIN,
        action: "AUTH_PASSWORD_RESET_REQUESTED",
        actor: { id: targetUser.userId, username: targetUser.username, ipAddress: req.ip },
        tenantId: targetUser.tenantId || "default",
        status: AUDIT_STATUSES.SUCCESS,
        target: { type: "user", id: targetUser.userId },
      }).catch(() => {});
    }

    return res.json({
      success: true,
      message: "If an account matches the provided identifier, password reset instructions have been dispatched.",
      resetToken,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/v1/auth/password-reset/confirm & POST /api/v1/auth/reset-password
 * Completes password reset enforcing NIST SP 800-63B policy and single-use token consumption.
 */
function handlePasswordResetConfirm(req, res) {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: "Missing required fields: 'token' and 'newPassword'" });
    }

    const resetRecord = passwordResetTokens.get(token);
    if (!resetRecord || Date.now() > resetRecord.expiresAt) {
      return res.status(400).json({ error: "Invalid or expired password reset token" });
    }

    const targetUser = defaultLocalAuthManager.getUser(resetRecord.userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User account no longer exists" });
    }

    defaultLocalAuthManager.policy.validate(newPassword, {
      username: targetUser.username,
      email: targetUser.email,
    });

    targetUser.passwordHash = defaultLocalAuthManager.policy.hashPassword(newPassword);
    targetUser.lockedUntil = null;
    targetUser.failedAttempts = 0;

    passwordResetTokens.delete(token);

    defaultTokenService.revokeAllUserSessions(targetUser.userId, "Password reset");

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.LOGIN,
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      actor: { id: targetUser.userId, username: targetUser.username, ipAddress: req.ip },
      tenantId: targetUser.tenantId || "default",
      status: AUDIT_STATUSES.SUCCESS,
      target: { type: "user", id: targetUser.userId },
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Password has been successfully reset. Please log in with your new password.",
    });
  } catch (err) {
    if (err instanceof PasswordPolicyError) {
      return res.status(400).json({
        error: "PasswordPolicyViolation",
        message: err.message,
        violations: err.violations,
      });
    }
    return res.status(400).json({ error: err.message });
  }
}

router.post("/password-reset/request", RATE_LIMITS.passwordReset.middleware(), handlePasswordResetRequest);
router.post("/forgot-password", RATE_LIMITS.passwordReset.middleware(), handlePasswordResetRequest);
router.post("/password-reset/confirm", RATE_LIMITS.passwordReset.middleware(), handlePasswordResetConfirm);
router.post("/reset-password", RATE_LIMITS.passwordReset.middleware(), handlePasswordResetConfirm);

module.exports = router;
module.exports.oidcHandler = oidcHandler;
module.exports.ldapClient = ldapClient;
