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

  // Health checks are always public
  if (req.path === "/health" || req.path === "/api/v1/health") {
    return next();
  }

  const method = req.method.toUpperCase();
  const isWriteRoute = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const isProtectedRead =
    config.REQUIRE_AUTH_FOR_READS && ["GET", "HEAD"].includes(method);

  const providedKey = extractApiKey(req);

  if (isWriteRoute || isProtectedRead) {
    if (!providedKey) {
      return res.status(401).json({
        error: "Unauthorized",
        message:
          "Authentication required. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
      });
    }

    if (!safeCompare(providedKey, configuredKey)) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Invalid API key.",
      });
    }

    req.auth = { authenticated: true, role: "admin" };
  } else {
    // Optional / public read routes
    if (providedKey && safeCompare(providedKey, configuredKey)) {
      req.auth = { authenticated: true, role: "admin" };
    } else {
      req.auth = { authenticated: false, role: "anonymous" };
    }
  }

  next();
}

/**
 * Explicit route guard to mandate API key regardless of global settings.
 */
function requireApiKey(req, res, next) {
  const configuredKey = config.ECDAT_API_KEY;
  if (!configuredKey) return next();

  const providedKey = extractApiKey(req);
  if (!providedKey) {
    return res.status(401).json({
      error: "Unauthorized",
      message:
        "Authentication required. Please provide a valid API key via X-API-Key header or Authorization: Bearer <key>.",
    });
  }

  if (!safeCompare(providedKey, configuredKey)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Invalid API key.",
    });
  }

  req.auth = { authenticated: true, role: "admin" };
  next();
}

module.exports = {
  apiKeyAuthMiddleware,
  requireApiKey,
  safeCompare,
  extractApiKey,
};
