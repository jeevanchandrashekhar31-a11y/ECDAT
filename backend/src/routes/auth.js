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

const express = require("express");
const router = express.Router();
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
  hasPermission,
  getUserPermissions,
  requirePermission,
  ENDPOINT_PERMISSIONS,
} = require("../middleware/rbac");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");

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
router.post("/oidc/callback", async (req, res, next) => {
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
router.post("/ldap/login", async (req, res, next) => {
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
router.post("/token/refresh", (req, res) => {
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
router.post("/token/revoke", (req, res) => {
  const { jti, reason } = req.body || {};
  if (!jti) {
    return res.status(400).json({ error: "Missing 'jti'" });
  }

  defaultTokenService.revokeToken(jti, reason || "Client logout");
  return res.json({ success: true, message: `Token '${jti}' revoked successfully` });
});

/**
 * POST /api/v1/auth/local/register
 * Registers a new local user with NIST SP 800-63B password policy enforcement.
 */
router.post("/local/register", (req, res) => {
  try {
    const { username, email, password, roles, tenantId } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields: 'username', 'email', and 'password'" });
    }

    const newUser = defaultLocalAuthManager.registerUser({
      username,
      email,
      password,
      roles,
      tenantId,
    });

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
});

/**
 * POST /api/v1/auth/local/login
 * Authenticates user with brute-force lockout & MFA challenge detection.
 */
router.post("/local/login", (req, res) => {
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
router.post("/mfa/setup", (req, res) => {
  try {
    const identifier =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.body && (req.body.userId || req.body.username));

    if (!identifier) {
      return res.status(400).json({ error: "Missing user identifier for MFA setup" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user) {
      return res.status(404).json({ error: `User '${identifier}' not found` });
    }

    const mfaSetup = defaultMfaEngine.generateSecret({ accountName: user.email || user.username });
    const backupCodes = defaultMfaEngine.generateBackupCodes(8);

    user.pendingMfaSecret = mfaSetup.secret;
    user.pendingBackupHashes = backupCodes.hashedCodes;

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
 * Verifies code to complete MFA enrollment.
 */
router.post("/mfa/enable", (req, res) => {
  try {
    const { code } = req.body || {};
    const identifier =
      (req.user && (req.user.sub || req.user.userId)) ||
      (req.body && (req.body.userId || req.body.username));

    if (!identifier || !code) {
      return res.status(400).json({ error: "Missing required fields: identifier and code" });
    }

    const user = defaultLocalAuthManager.getUser(identifier);
    if (!user || !user.pendingMfaSecret) {
      return res.status(400).json({ error: "No pending MFA enrollment found for this user" });
    }

    const valid = defaultMfaEngine.verifyCode(user.pendingMfaSecret, code);
    if (!valid) {
      return res.status(400).json({ error: "Invalid TOTP code. Enrollment could not be verified." });
    }

    user.mfaEnabled = true;
    user.mfaSecret = user.pendingMfaSecret;
    user.backupCodeHashes = user.pendingBackupHashes || [];
    delete user.pendingMfaSecret;
    delete user.pendingBackupHashes;

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
 * POST /api/v1/auth/mfa/verify
 * Completes second-factor challenge during login using TOTP or single-use backup code.
 */
router.post("/mfa/verify", (req, res) => {
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
    });

    return res.json({
      ...tokens,
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
router.post("/cookie/login", (req, res) => {
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
router.post("/logout", (req, res) => {
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
router.post("/logout-all", (req, res) => {
  const userId =
    (req.user && (req.user.sub || req.user.userId)) ||
    (req.auth && req.auth.user && (req.auth.user.sub || req.auth.user.userId)) ||
    (req.body && req.body.userId);

  if (!userId) {
    return res.status(400).json({ error: "Missing 'userId' or unauthenticated request" });
  }

  const revocation = defaultTokenService.revokeAllUserSessions(userId, "Global multi-device logout");
  clearAuthCookies(res);

  return res.json({
    success: true,
    message: `All sessions revoked for user '${userId}'`,
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
router.post("/secrets/rotate", requirePermission(PERMISSIONS.SECRETS_ROTATE), (req, res) => {
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
    return res.status(401).json({
      allowed: false,
      reason: "Authentication required",
    });
  }

  const userRoles = req.auth.roles || (req.auth.role ? [req.auth.role] : ["viewer"]);
  const hasPerm = hasPermission(userRoles, permission);

  if (!hasPerm) {
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
 * GET /api/v1/auth/audit
 * Returns authentication audit log with tamper-chain integrity status.
 */
router.get("/audit", (req, res) => {
  const limit = parseInt(req.query.limit || "50", 10);
  const events = defaultAuthAuditLogger.getRecentEvents(limit);
  const integrity = defaultAuthAuditLogger.verifyChainIntegrity();

  return res.json({
    totalEvents: events.length,
    chainIntegrity: integrity,
    events,
  });
});

module.exports = router;
module.exports.oidcHandler = oidcHandler;
module.exports.ldapClient = ldapClient;
