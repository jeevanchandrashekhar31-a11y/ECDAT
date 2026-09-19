const crypto = require("crypto");
const config = require("../config");

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Constant-time dummy comparison to mitigate length-based timing leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extracts API key from request headers only. Query-string credentials are
 * deliberately unsupported because URLs are retained in browser history,
 * proxies, referrers, and access logs.
 * Headers take precedence:
 * - 'X-API-Key: <key>'
 * - 'Authorization: Bearer <key>' or 'Authorization: ApiKey <key>'
 */
function extractApiKey(req) {
  // 1. Header: X-API-Key
  const xApiKey = req.headers["x-api-key"];
  if (xApiKey && typeof xApiKey === "string") {
    return xApiKey.trim();
  }

  // 2. Header: Authorization
  const authHeader = req.headers["authorization"];
  if (authHeader && typeof authHeader === "string") {
    const parts = authHeader.trim().split(/\s+/);
    if (
      parts.length === 2 &&
      (parts[0].toLowerCase() === "bearer" ||
        parts[0].toLowerCase() === "apikey")
    ) {
      return parts[1].trim();
    }
    if (parts.length === 1) {
      return parts[0].trim();
    }
  }

  // 3. Cookie: ecdat_access_token (secure HTTP-only cookie auth)
  if (req.headers && req.headers.cookie) {
    const { parseCookies, ACCESS_COOKIE_NAME } = require("./cookie_csrf");
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[ACCESS_COOKIE_NAME]) {
      return cookies[ACCESS_COOKIE_NAME];
    }
  }

  return null;
}

const ROUTE_CLASSIFICATIONS = Object.freeze({
  PUBLIC: "public",
  ANONYMOUS: "anonymous",
  HEALTH: "health",
  SCAN: "scan",
  AUTH: "auth",
  INTERNAL: "internal",
  ADMIN: "admin",
});

const PUBLIC_AUTH_PATHS = Object.freeze([
  "/api/v1/auth/oidc/login",
  "/api/v1/auth/oidc/callback",
  "/api/v1/auth/ldap/login",
  "/api/v1/auth/local/register",
  "/api/v1/auth/register",
  "/api/v1/auth/local/login",
  "/api/v1/auth/mfa/verify",
  "/api/v1/auth/cookie/login",
  "/api/v1/auth/csrf-token",
  "/api/v1/auth/rbac/catalog",
  "/api/v1/auth/token/refresh",
  "/api/v1/auth/password-reset/request",
  "/api/v1/auth/password-reset/confirm",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/auth/oidc/login",
  "/auth/oidc/callback",
  "/auth/ldap/login",
  "/auth/local/register",
  "/auth/register",
  "/auth/local/login",
  "/auth/mfa/verify",
  "/auth/cookie/login",
  "/auth/csrf-token",
  "/auth/rbac/catalog",
  "/auth/token/refresh",
  "/auth/password-reset/request",
  "/auth/password-reset/confirm",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

/**
 * Checks if a given path belongs to any scanner, CBOM, or SBOM pipeline.
 * Scanner endpoints require authentication by default.
 */
function isScannerRoute(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return false;
  const p = rawPath.split("?")[0].toLowerCase().replace(/\/+$/, "") || "/";
  const scannerPrefixes = [
    "/scan",
    "/api/v1/scan",
    "/cbom",
    "/cboms",
    "/api/v1/cbom",
    "/api/v1/cboms",
    "/sbom",
    "/sboms",
    "/api/v1/sbom",
    "/api/v1/sboms",
    "/api/v1/ci/scan",
  ];
  return scannerPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * Authoritatively classifies any platform route into one of 7 security categories:
 * 'health', 'public', 'anonymous', 'auth', 'scan', 'internal', 'admin'.
 */
function classifyRoute(rawPath, method = "GET") {
  if (!rawPath || typeof rawPath !== "string") return ROUTE_CLASSIFICATIONS.ANONYMOUS;
  const p = rawPath.split("?")[0].toLowerCase().replace(/\/+$/, "") || "/";
  const m = String(method).toUpperCase();

  // 1. Health
  if (p === "/health" || p === "/api/v1/health") {
    return ROUTE_CLASSIFICATIONS.HEALTH;
  }

  // 2. Admin
  const adminExactPaths = [
    "/api/v1/auth/admin/users",
    "/api/v1/auth/users",
    "/api/v1/auth/secrets/rotate",
    "/api/v1/siem/config",
    "/api/v1/security/database/audit-logs",
  ];
  if (adminExactPaths.includes(p)) {
    return ROUTE_CLASSIFICATIONS.ADMIN;
  }
  if (p.startsWith("/api/v1/policy/") && (p.endsWith("/approve") || p.endsWith("/activate") || p.endsWith("/rollback"))) {
    return ROUTE_CLASSIFICATIONS.ADMIN;
  }
  if (p.startsWith("/api/v1/remediation/approvals/") && (p.endsWith("/approve") || p.endsWith("/apply"))) {
    return ROUTE_CLASSIFICATIONS.ADMIN;
  }

  // 3. Internal
  const internalExactPaths = [
    "/metrics/record",
    "/api/v1/metrics/record",
    "/telemetry/ebpf",
    "/api/v1/telemetry/ebpf",
    "/api/v1/certificates/ingest",
    "/api/v1/ci/feedback",
    "/api/v1/siem/forward",
    "/api/v1/security/database/prune",
    "/api/v1/security/database/backups",
    "/api/v1/security/database/test-query",
  ];
  if (internalExactPaths.includes(p) || p.startsWith("/api/v1/security/database/backups/")) {
    return ROUTE_CLASSIFICATIONS.INTERNAL;
  }

  // 4. Scanner Pipeline
  if (
    isScannerRoute(p) ||
    p === "/scans" ||
    p.startsWith("/scans/") ||
    p === "/api/v1/scans" ||
    p.startsWith("/api/v1/scans/")
  ) {
    return ROUTE_CLASSIFICATIONS.SCAN;
  }

  // 5. Auth
  if (p === "/auth" || p.startsWith("/auth/") || p === "/api/v1/auth" || p.startsWith("/api/v1/auth/")) {
    return ROUTE_CLASSIFICATIONS.AUTH;
  }

  // 6. Public
  if (p === "/metrics" || p === "/api/v1/metrics" || p.startsWith("/metrics/") || p.startsWith("/api/v1/metrics/")) {
    return ROUTE_CLASSIFICATIONS.PUBLIC;
  }

  return ROUTE_CLASSIFICATIONS.ANONYMOUS;
}

/**
 * API Key Authentication Middleware
 * - Requires authentication for write routes (POST, PUT, PATCH, DELETE)
 * - Scanner routes (/scan/*, /cbom/*, etc.) strictly require authentication by default
 * - Optionally protects read routes if REQUIRE_AUTH_FOR_READS is set to true
 * - Performs constant-time comparison via crypto.timingSafeEqual
 * - Bypasses /health probes
 */
function apiKeyAuthMiddleware(req, res, next) {
  const rawPath = req.originalUrl || req.path || "";
  const pathOnly = (req.path || "").toLowerCase();
  const originalPathOnly = (rawPath.split("?")[0] || "").toLowerCase();

  const isHealthPath =
    pathOnly === "/health" ||
    pathOnly === "/api/v1/health" ||
    originalPathOnly === "/health" ||
    originalPathOnly === "/api/v1/health";

  if (isHealthPath) {
    req.auth = { authenticated: false, role: "anonymous", roles: [] };
    return next();
  }

  const configuredKey = config.ECDAT_API_KEY;
  const publicAuthPaths = PUBLIC_AUTH_PATHS;

  const providedKey = extractApiKey(req);

  // Helper to verify token or API key
  const verifyCredentials = (tokenOrKey) => {
    // 1. Try API Key match
    if (configuredKey && safeCompare(tokenOrKey, configuredKey)) {
      return { authenticated: true, mode: "api_key", role: "admin", roles: ["admin"] };
    }

    // 2. Try short-lived JWT token verification
    try {
      const { defaultTokenService } = require("../identity/token_service");
      const tokenPayload = defaultTokenService.verifyToken(tokenOrKey, "access");
      const roles = tokenPayload.roles || ["viewer"];
      return {
        authenticated: true,
        mode: "jwt",
        role: roles[0] || "viewer",
        roles,
        user: tokenPayload,
      };
    } catch {
      return null;
    }
  };

  // 1. If an API key or token was provided, validate it strictly.
  // Presenting an invalid credential fails with 401 for Bearer tokens or 403 for API keys.
  if (providedKey) {
    const authResult = verifyCredentials(providedKey);
    if (!authResult) {
      const authHeader = (req.headers["authorization"] || "").trim().toLowerCase();
      const isBearer = authHeader.startsWith("bearer");
      if (isBearer) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid, expired, or revoked token.",
        });
      }
      return res.status(403).json({
        error: "Forbidden",
        message: "Invalid API key.",
      });
    }
    req.auth = authResult;
    if (authResult.user) req.user = authResult.user;
    return next();
  }

  if (!configuredKey) {
    return res.status(503).json({
      error: "Service Misconfigured",
      code: "AUTH_NOT_CONFIGURED",
      message: "Server authentication is not configured. Refusing all requests.",
    });
  }


  // 3. Scanner API endpoints MUST be authenticated by default
  // No blanket startsWith("/scan/") or unauthenticated pipeline bypasses permitted
  if (isScannerRoute(pathOnly) || isScannerRoute(originalPathOnly)) {
    return res.status(401).json({
      error: "Unauthorized",
      message:
        "Authentication required for scanner endpoints. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
    });
  }

  // 4. Public auth endpoints (login, registration, CSRF, etc.)
  const isPublicAuthPath =
    publicAuthPaths.includes(pathOnly) ||
    publicAuthPaths.includes(originalPathOnly);

  if (isPublicAuthPath) {
    req.auth = { authenticated: false, role: "anonymous", roles: [] };
    return next();
  }

  // 5. All write routes (POST, PUT, PATCH, DELETE) require authentication
  const method = req.method.toUpperCase();
  const isWriteRoute = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isProtectedRead =
    config.REQUIRE_AUTH_FOR_READS && ["GET", "HEAD"].includes(method);

  if (isWriteRoute || isProtectedRead) {
    try {
      const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
      defaultAuditService
        .logEvent({
          category: AUDIT_CATEGORIES.LOGIN,
          action: AUDIT_ACTIONS.AUTHORIZATION_FAILURE,
          status: AUDIT_STATUSES.DENIED,
          actor: { id: "anonymous", username: "anonymous", role: "anonymous", ipAddress: req.ip },
          tenantId: "default",
          target: { type: "endpoint", id: rawPath, name: method },
          details: { code: "AUTHENTICATION_REQUIRED", method, path: rawPath, requestId: req.id },
        })
        .catch(() => {});
    } catch {
      // Fail-safe
    }

    return res.status(401).json({
      error: "Unauthorized",
      code: "AUTHENTICATION_REQUIRED",
      message:
        "Authentication required. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
    });
  }

  // 6. Open read routes (GET, HEAD) when REQUIRE_AUTH_FOR_READS=false
  req.auth = { authenticated: false, role: "anonymous", roles: [] };
  next();
}

/**
 * Explicit route guard to mandate API key or JWT token regardless of global settings.
 */
function requireApiKey(req, res, next) {
  const configuredKey = config.ECDAT_API_KEY;
  const providedKey = extractApiKey(req);
  if (!providedKey) {
    return res.status(401).json({
      error: "Unauthorized",
      message:
        "Authentication required. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
    });
  }

  if (configuredKey && safeCompare(providedKey, configuredKey)) {
    req.auth = { authenticated: true, role: "admin", roles: ["admin"] };
    return next();
  }

  try {
    const { defaultTokenService } = require("../identity/token_service");
    const payload = defaultTokenService.verifyToken(providedKey, "access");
    req.auth = { authenticated: true, role: payload.roles[0] || "viewer", roles: payload.roles, user: payload };
    req.user = payload;
    return next();
  } catch {
    return res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key.",
    });
  }
}

/**
 * RBAC role authorization middleware.
 */
function requireRole(allowedRoles = []) {
  const required = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .map((r) => String(r).toLowerCase().replace(/[-_]/g, " "));
  return (req, res, next) => {
    const rawRoles =
      (req.user && req.user.roles) ||
      (req.user && [req.user.role]) ||
      (req.tenantContext && req.tenantContext.roles) ||
      (req.auth && req.auth.roles) ||
      (req.auth && [req.auth.role]) ||
      ["anonymous"];
    const userRoles = rawRoles.map((r) => String(r).toLowerCase().replace(/[-_]/g, " "));
    const isPlatformAdmin =
      Boolean(req.tenantContext?.isPlatformAdmin) ||
      userRoles.includes("platform administrator") ||
      userRoles.includes("admin");
    const hasRole = isPlatformAdmin || userRoles.some((r) => required.includes(r));
    if (!hasRole) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Access denied. Requires one of roles: ${required.join(", ")}`,
      });
    }
    next();
  };
}

module.exports = {
  apiKeyAuthMiddleware,
  requireApiKey,
  requireRole,
  safeCompare,
  extractApiKey,
  ROUTE_CLASSIFICATIONS,
  classifyRoute,
  isScannerRoute,
  PUBLIC_AUTH_PATHS,
};

