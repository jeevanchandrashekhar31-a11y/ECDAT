/**
 * ECDAT Data in Transit TLS Security & Enforcement — Phase 16.1
 *
 * Enforces TLS protection for all data in transit:
 * 1. Database Connection In-Transit Encryption (PostgreSQL TLS / SSL)
 * 2. Inbound HTTP API TLS Enforcement (HTTPS redirect, HSTS, secure cookies)
 * 3. Outbound Integration TLS Enforcement (KMS connectors, ticketing integrations)
 */

const fs = require("fs");
const path = require("path");

class InsecureTransitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InsecureTransitError";
    this.code = "ERR_INSECURE_TRANSIT";
    this.details = details;
  }
}

/**
 * Builds PostgreSQL TLS configuration for Knex connection pool.
 *
 * @param {object} options
 * @param {string} [options.databaseUrl]
 * @param {string} [options.nodeEnv]
 * @param {boolean} [options.sslEnabled]
 * @param {boolean} [options.rejectUnauthorized]
 * @param {string} [options.caCertPath]
 * @returns {object|boolean} Knex connection SSL option
 */
function configureDbTls(options = {}) {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || "development";
  const rawSslEnv = process.env.DATABASE_SSL;
  const rawRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  const caCertPath = options.caCertPath || process.env.DATABASE_SSL_CA_PATH;

  // In production, TLS for database in transit is enforced by default
  const isProduction = nodeEnv === "production";
  const sslEnabled =
    options.sslEnabled !== undefined
      ? Boolean(options.sslEnabled)
      : rawSslEnv !== undefined
        ? rawSslEnv === "true" || rawSslEnv === "1"
        : isProduction;

  if (!sslEnabled) {
    if (isProduction && process.env.ALLOW_INSECURE_DB_IN_PRODUCTION !== "true") {
      throw new InsecureTransitError(
        "Production Security Violation: Insecure cleartext database connections are prohibited in production. Set DATABASE_SSL=true."
      );
    }
    return false;
  }

  // Reject unauthorized certs by default in production; allow self-signed in test if explicitly set
  const rejectUnauthorized =
    options.rejectUnauthorized !== undefined
      ? Boolean(options.rejectUnauthorized)
      : rawRejectUnauthorized !== undefined
        ? rawRejectUnauthorized === "true" || rawRejectUnauthorized === "1"
        : isProduction;

  const sslConfig = {
    rejectUnauthorized,
  };

  if (caCertPath) {
    const resolvedPath = path.isAbsolute(caCertPath) ? caCertPath : path.resolve(process.cwd(), caCertPath);
    if (fs.existsSync(resolvedPath)) {
      sslConfig.ca = fs.readFileSync(resolvedPath, "utf8");
    } else {
      throw new InsecureTransitError(`Database SSL CA certificate file not found at: '${resolvedPath}'`);
    }
  }

  return sslConfig;
}

/**
 * Express middleware enforcing HTTPS / TLS for inbound API requests.
 *
 * In production:
 * - Detects cleartext HTTP (via req.secure or X-Forwarded-Proto header)
 * - Returns 426 Upgrade Required (or 301 redirect for GET)
 * - Sets Strict-Transport-Security (HSTS) with 1-year duration, subdomains, and preload
 *
 * @param {object} [options]
 * @param {boolean} [options.enforceInDev=false]
 * @param {number} [options.hstsMaxAge=31536000] - 1 year in seconds
 */
function tlsEnforcementMiddleware(options = {}) {
  const hstsMaxAge = options.hstsMaxAge || 31536000;
  const enforceInDev = Boolean(options.enforceInDev);

  return (req, res, next) => {
    const nodeEnv = process.env.NODE_ENV || "development";
    const isProduction = nodeEnv === "production";
    const shouldEnforce = isProduction || enforceInDev;

    // Check whether the request arrived over TLS
    const isSecure =
      req.secure ||
      req.headers["x-forwarded-proto"] === "https" ||
      req.headers["x-arr-ssl"] !== undefined ||
      req.socket.encrypted;

    // Set Strict-Transport-Security header on all responses
    res.setHeader("Strict-Transport-Security", `max-age=${hstsMaxAge}; includeSubDomains; preload`);

    if (shouldEnforce && !isSecure) {
      // If it's a browser GET/HEAD navigation, redirect to HTTPS
      if (req.method === "GET" || req.method === "HEAD") {
        const host = req.headers.host || "localhost";
        return res.redirect(301, `https://${host}${req.originalUrl || req.url}`);
      }

      // If it's an API mutation (POST, PUT, DELETE, PATCH), reject with 426 Upgrade Required
      return res.status(426).json({
        error: "UpgradeRequired",
        code: "ERR_TLS_REQUIRED",
        message: "Data in transit security policy requires TLS (HTTPS). Insecure cleartext HTTP is rejected.",
        requiredProtocol: "https",
        requestId: req.id,
      });
    }

    next();
  };
}

/**
 * Validates that an outbound target URL for an external integration strictly uses TLS (HTTPS).
 *
 * @param {string} rawUrl - Outbound integration target URL
 * @param {object} [options]
 * @param {boolean} [options.allowLocalhostInDev=true]
 * @returns {{ valid: boolean, error?: string }}
 */
function validateOutboundTlsUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "URL must be a non-empty string" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: "Malformed URL" };
  }

  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const allowLocalhost =
    options.allowLocalhostInDev !== undefined
      ? options.allowLocalhostInDev && !isProduction
      : !isProduction;

  const isLocal =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";

  if (parsed.protocol.toLowerCase() !== "https:") {
    if (allowLocalhost && isLocal && parsed.protocol.toLowerCase() === "http:") {
      return { valid: true };
    }
    return {
      valid: false,
      error: `Security Policy Violation: Outbound integration target '${rawUrl}' must use TLS ('https://'). Cleartext '${parsed.protocol}' is prohibited.`,
    };
  }

  return { valid: true };
}

/**
 * Returns current TLS and data in transit security posture.
 */
function getTransitSecurityStatus() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const rawSsl = process.env.DATABASE_SSL;
  const isProduction = nodeEnv === "production";

  return {
    nodeEnv,
    databaseTls: {
      enforcedInProduction: true,
      configuredSsl: rawSsl === "true" || (isProduction && rawSsl !== "false"),
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
      caCertConfigured: Boolean(process.env.DATABASE_SSL_CA_PATH),
    },
    inboundApiTls: {
      enforceHttpsInProduction: true,
      hstsEnabled: true,
      hstsMaxAgeSeconds: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    outboundIntegrationsTls: {
      enforceHttpsForIntegrations: true,
      minimumTlsVersion: "TLSv1.2",
      recommendedTlsVersion: "TLSv1.3",
    },
  };
}

module.exports = {
  InsecureTransitError,
  configureDbTls,
  tlsEnforcementMiddleware,
  validateOutboundTlsUrl,
  getTransitSecurityStatus,
};
