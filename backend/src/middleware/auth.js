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

/**
 * API Key Authentication Middleware
 * - Requires authentication for write routes (POST, PUT, PATCH, DELETE)
 * - Optionally protects read routes if REQUIRE_AUTH_FOR_READS is set to true
 * - Performs constant-time comparison via crypto.timingSafeEqual
 * - Bypasses /health probes
 */
function apiKeyAuthMiddleware(req, res, next) {
  const configuredKey = config.ECDAT_API_KEY;

  // If no key configured on the server, allow open access
  if (!configuredKey) {
    req.auth = { authenticated: false, mode: "open" };
    return next();
  }

  const demoPipelinePaths = [
    "/health",
    "/api/v1/health",
    "/cbom/merge",
    "/cbom/quantum-risk",
    "/cbom/merged",
    "/cbom/risk",
    "/cbom/pqc-report",
    "/api/v1/cbom/merge",
    "/api/v1/cbom/quantum-risk",
    "/api/v1/cbom/merged",
    "/api/v1/cbom/risk",
    "/api/v1/cbom/pqc-report",
  ];

  const publicAuthPaths = [
    "/api/v1/auth/oidc/login",
    "/api/v1/auth/oidc/callback",
    "/api/v1/auth/ldap/login",
    "/api/v1/auth/local/register",
    "/api/v1/auth/local/login",
    "/api/v1/auth/mfa/setup",
    "/api/v1/auth/mfa/enable",
    "/api/v1/auth/mfa/verify",
    "/api/v1/auth/cookie/login",
    "/api/v1/auth/csrf-token",
    "/api/v1/auth/rbac/catalog",
    "/api/v1/auth/token/refresh",
    "/api/v1/auth/token/revoke",
    "/api/v1/auth/logout",
    "/api/v1/auth/logout-all",
    "/auth/oidc/login",
    "/auth/oidc/callback",
    "/auth/ldap/login",
    "/auth/local/register",
    "/auth/local/login",
    "/auth/mfa/setup",
    "/auth/mfa/enable",
    "/auth/mfa/verify",
    "/auth/cookie/login",
    "/auth/csrf-token",
    "/auth/rbac/catalog",
    "/auth/token/refresh",
    "/auth/token/revoke",
    "/auth/logout",
    "/auth/logout-all",
  ];

  const rawPath = req.originalUrl || req.path || "";
  const pathOnly = (req.path || "").toLowerCase();
  const originalPathOnly = (rawPath.split("?")[0] || "").toLowerCase();

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

  // Scanner pipeline, health routes, and auth endpoints are public
  if (
    demoPipelinePaths.includes(pathOnly) ||
    demoPipelinePaths.includes(originalPathOnly) ||
    publicAuthPaths.includes(pathOnly) ||
    publicAuthPaths.includes(originalPathOnly) ||
    pathOnly.startsWith("/scan/") ||
    pathOnly.startsWith("/api/v1/scan/") ||
    originalPathOnly.startsWith("/scan/") ||
    originalPathOnly.startsWith("/api/v1/scan/")
  ) {
    if (providedKey) {
      const authResult = verifyCredentials(providedKey);
      if (authResult) {
        req.auth = authResult;
        if (authResult.user) req.user = authResult.user;
      }
    }
    return next();
  }

  const method = req.method.toUpperCase();
  const isWriteRoute = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isProtectedRead =
    config.REQUIRE_AUTH_FOR_READS && ["GET", "HEAD"].includes(method);

  if (isWriteRoute || isProtectedRead) {
    if (!providedKey) {
      return res.status(401).json({
        error: "Unauthorized",
        message:
          "Authentication required. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
      });
    }

    const authResult = verifyCredentials(providedKey);
    if (!authResult) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Invalid API key.",
      });
    }

    req.auth = authResult;
    if (authResult.user) req.user = authResult.user;
  } else {
    // Optional / public read routes
    if (providedKey) {
      const authResult = verifyCredentials(providedKey);
      if (authResult) {
        req.auth = authResult;
        if (authResult.user) req.user = authResult.user;
      } else {
        req.auth = { authenticated: false, role: "anonymous", roles: [] };
      }
    } else {
      req.auth = { authenticated: false, role: "anonymous", roles: [] };
    }
  }

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
  const required = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    const userRoles = (req.auth && req.auth.roles) || (req.auth && [req.auth.role]) || ["anonymous"];
    const hasRole = userRoles.some((r) => r === "admin" || required.includes(r));
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
};
