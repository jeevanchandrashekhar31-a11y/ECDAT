/**
 * Secure Cookie & CSRF Protection Middleware — Phase 15.2
 *
 * Implements:
 * - Secure cookie attributes: HttpOnly, Secure, SameSite=Strict, Path=/
 * - Double Submit Cookie pattern & X-CSRF-Token verification
 * - Origin / Referer validation for state-changing operations
 * - Ambient cookie extraction for authentication middleware
 */

const crypto = require("crypto");
const config = require("../config");

const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_COOKIE_NAME = "ecdat_csrf_token";
const ACCESS_COOKIE_NAME = "ecdat_access_token";
const REFRESH_COOKIE_NAME = "ecdat_refresh_token";

/**
 * Parses raw Cookie header into key-value map.
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return {};
  const cookies = {};
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx !== -1) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  });
  return cookies;
}

/**
 * Generates a cryptographically strong CSRF token.
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Constant-time comparison for CSRF tokens.
 */
function safeTokenCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Sets secure HTTP-only and CSRF cookies on the response.
 */
function setAuthCookies(res, { accessToken, refreshToken = null, csrfToken = null }) {
  const isProduction = config.NODE_ENV === "production";

  // 1. Access Token Cookie: HttpOnly, SameSite=Strict (if provided)
  if (accessToken) {
    const accessCookieOpts = [
      `${ACCESS_COOKIE_NAME}=${encodeURIComponent(accessToken)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      `Max-Age=${15 * 60}`, // 15 minutes
    ];
    if (isProduction) accessCookieOpts.push("Secure");
    res.appendHeader("Set-Cookie", accessCookieOpts.join("; "));
  }

  // 2. Refresh Token Cookie (if provided): Scoped to auth path
  if (refreshToken) {
    const refreshCookieOpts = [
      `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/api/v1/auth",
      `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
    ];
    if (isProduction) refreshCookieOpts.push("Secure");
    res.appendHeader("Set-Cookie", refreshCookieOpts.join("; "));
  }

  // 3. CSRF Cookie (readable by client JavaScript to echo back in header)
  if (csrfToken) {
    const csrfCookieOpts = [
      `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
      "SameSite=Strict",
      "Path=/",
      `Max-Age=${15 * 60}`,
    ];
    if (isProduction) csrfCookieOpts.push("Secure");
    res.appendHeader("Set-Cookie", csrfCookieOpts.join("; "));
  }
}

/**
 * Clears all authentication and CSRF cookies.
 */
function clearAuthCookies(res) {
  const clearFlags = "Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict";
  res.appendHeader("Set-Cookie", `${ACCESS_COOKIE_NAME}=; ${clearFlags}; HttpOnly`);
  res.appendHeader("Set-Cookie", `${REFRESH_COOKIE_NAME}=; Path=/api/v1/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict`);
  res.appendHeader("Set-Cookie", `${CSRF_COOKIE_NAME}=; ${clearFlags}`);
}

/**
 * CSRF Protection Middleware
 * Defends cookie-authenticated state-changing requests against CSRF attacks.
 */
function csrfProtectionMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  // Parse cookies
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;

  const path = (req.path || "").toLowerCase();
  const rawPath = (req.originalUrl || "").split("?")[0].toLowerCase();
  const cleanPath = path.replace(/\/+$/, "") || "/";
  const cleanRawPath = rawPath.replace(/\/+$/, "") || "/";
  const exemptLoginPaths = [
    "/api/v1/auth/evaluation/enter",
    "/auth/evaluation/enter",
    "/evaluation/enter",
    "/api/v1/auth/evaluation/persona",
    "/auth/evaluation/persona",
    "/evaluation/persona",
    "/api/v1/auth/evaluation/reset",
    "/auth/evaluation/reset",
    "/evaluation/reset",
    "/api/v1/auth/evaluation/seed",
    "/auth/evaluation/seed",
    "/evaluation/seed",
    "/api/v1/auth/local/login",
    "/auth/local/login",
    "/local/login",
    "/api/v1/auth/cookie/login",
    "/auth/cookie/login",
    "/cookie/login",
    "/api/v1/auth/ldap/login",
    "/auth/ldap/login",
    "/ldap/login",
    "/api/v1/auth/oidc/callback",
    "/auth/oidc/callback",
    "/oidc/callback",
    "/api/v1/auth/mfa/verify",
    "/auth/mfa/verify",
    "/mfa/verify",
    "/api/v1/auth/local/register",
    "/auth/local/register",
    "/local/register",
    "/api/v1/auth/register",
    "/auth/register",
    "/register",
    "/api/v1/auth/token/refresh",
    "/auth/token/refresh",
    "/token/refresh",
    "/api/v1/auth/password-reset/request",
    "/auth/password-reset/request",
    "/password-reset/request",
    "/api/v1/auth/password-reset/confirm",
    "/auth/password-reset/confirm",
    "/password-reset/confirm",
    "/api/v1/auth/forgot-password",
    "/auth/forgot-password",
    "/forgot-password",
    "/api/v1/auth/reset-password",
    "/auth/reset-password",
    "/reset-password",
  ];

  if (
    exemptLoginPaths.includes(cleanPath) ||
    exemptLoginPaths.includes(cleanRawPath) ||
    exemptLoginPaths.includes(path) ||
    exemptLoginPaths.includes(rawPath)
  ) {
    return next();
  }

  // CSRF protection applies when cookie-based authentication is present
  const hasCookieAuth = Boolean(cookies[ACCESS_COOKIE_NAME] || cookies[REFRESH_COOKIE_NAME]);

  if (!isStateChanging || !hasCookieAuth) {
    return next();
  }

  // 1. Origin / Referer validation
  const origin = req.headers["origin"] || req.headers["referer"];
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const allowedOrigins = config.CORS_ORIGIN || [];
      const originBase = `${originUrl.protocol}//${originUrl.host}`;
      const isAllowed =
        allowedOrigins.includes(originBase) ||
        originUrl.hostname === "localhost" ||
        originUrl.hostname === "127.0.0.1";

      if (!isAllowed) {
        return res.status(403).json({
          error: "CSRFValidationFailed",
          message: "Request origin does not match trusted CORS allowlist.",
          requestId: req.id,
        });
      }
    } catch {
      return res.status(403).json({
        error: "CSRFValidationFailed",
        message: "Invalid Origin or Referer header.",
        requestId: req.id,
      });
    }
  }

  // 2. Double Submit Cookie / Header Token Verification
  const headerToken = req.headers[CSRF_HEADER_NAME] || req.headers["x-xsrf-token"];
  const cookieToken = cookies[CSRF_COOKIE_NAME];

  if (!headerToken || !cookieToken) {
    return res.status(403).json({
      error: "CSRFValidationFailed",
      message: "Missing CSRF token in header or cookie.",
      requestId: req.id,
    });
  }

  if (!safeTokenCompare(headerToken, cookieToken)) {
    return res.status(403).json({
      error: "CSRFValidationFailed",
      message: "CSRF token mismatch. Action rejected.",
      requestId: req.id,
    });
  }

  next();
}

module.exports = {
  parseCookies,
  generateCsrfToken,
  safeTokenCompare,
  setAuthCookies,
  clearAuthCookies,
  csrfProtectionMiddleware,
  CSRF_HEADER_NAME,
  CSRF_COOKIE_NAME,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
};
