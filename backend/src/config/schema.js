/**
 * ECDAT Centralized Configuration Schema & Security Guardrails (Node.js)
 * Validates configuration, resolves secret references (file://, env:),
 * strips credentials from URLs, and halts insecure production startup.
 */

const fs = require("fs");
const path = require("path");

class InsecureProductionConfigError extends Error {
  constructor(message, violations = []) {
    super(`Insecure Production Configuration: ${message}`);
    this.name = "InsecureProductionConfigError";
    this.code = "ERR_CONFIG_INSECURE_PRODUCTION";
    this.violations = [...violations];
  }
}

/**
 * Resolves a secret reference if present.
 * Supports:
 * - "file:///path/to/secret"
 * - "env:SECRET_NAME"
 * - Raw string
 *
 * @param {string} value
 * @returns {string}
 */
function resolveSecret(value) {
  if (!value || typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed.startsWith("file://")) {
    const filePath = trimmed.slice(7);
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Secret file does not exist: '${resolvedPath}'`);
    }
    return fs.readFileSync(resolvedPath, "utf8").trim();
  }

  if (trimmed.startsWith("env:")) {
    const envVar = trimmed.slice(4);
    const envVal = process.env[envVar];
    if (envVal === undefined) {
      throw new Error(`Secret environment variable '${envVar}' is not defined.`);
    }
    return envVal.trim();
  }

  return trimmed;
}

/**
 * Strips user/password credentials from URLs (e.g. database connection strings) for safe logging.
 *
 * @param {string} urlString
 * @returns {string} Sanitized URL
 */
function sanitizeCredentialUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return urlString;
  try {
    const parsed = new URL(urlString);
    if (parsed.password) {
      parsed.password = "***";
    }
    if (parsed.username && parsed.username !== "postgres") {
      parsed.username = parsed.username.slice(0, 2) + "***";
    }
    return parsed.toString();
  } catch {
    // If not a valid standard URL, mask using regex
    return urlString.replace(/(:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
  }
}

/**
 * Recursively deep masks secrets in a configuration object for safe logging.
 *
 * @param {object} config
 * @returns {object} Safe sanitized configuration copy
 */
function sanitizeConfigForLogging(config) {
  if (!config || typeof config !== "object") return config;

  const sanitized = {};
  const secretKeyPatterns = [/key$/i, /secret/i, /password/i, /token/i, /auth/i];

  for (const [key, val] of Object.entries(config)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      sanitized[key] = sanitizeConfigForLogging(val);
    } else if (typeof val === "string" && (val.startsWith("postgresql://") || val.startsWith("postgres://"))) {
      sanitized[key] = sanitizeCredentialUrl(val);
    } else if (secretKeyPatterns.some((p) => p.test(key))) {
      sanitized[key] = val ? "***REDACTED***" : val;
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

const {
  validateProductionSecurity,
  MissingMandatorySecurityConfigError,
  UnsafeDevelopmentDefaultDetectedError,
} = require("./production_guard");

/**
 * Validates configuration constraints, failing hard on insecure production settings.
 *
 * @param {object} config
 */
function validateConfig(config) {
  const violations = [];

  // General constraints
  if (isNaN(config.PORT) || config.PORT <= 0 || config.PORT > 65535) {
    violations.push(`Invalid PORT '${config.PORT}'. Must be between 1 and 65535.`);
  }

  // Production security checks
  if (config.NODE_ENV === "production") {
    // 1. API Key must be set and cannot be the default demo key
    if (!config.ECDAT_API_KEY || config.ECDAT_API_KEY === "ecdat-demo-admin-key-2026") {
      violations.push("Production requires a strong, non-default ECDAT_API_KEY.");
    }

    // 2. Database credentials cannot be the default development credentials
    if (!config.DATABASE_URL || config.DATABASE_URL.includes("postgres:postgres") || config.DATABASE_URL.includes("localhost:5432/ecdat")) {
      violations.push("Production DATABASE_URL cannot use default development credentials (postgres:postgres@localhost).");
    }

    // 3. CORS origins cannot contain localhost or wildcard in production
    const corsList = Array.isArray(config.CORS_ORIGIN) ? config.CORS_ORIGIN : [config.CORS_ORIGIN];
    if (corsList.some((origin) => origin === "*" || origin.includes("localhost") || origin.includes("127.0.0.1"))) {
      violations.push("Production CORS_ORIGIN cannot contain wildcard '*' or localhost/127.0.0.1 addresses.");
    }

    // 4. Require authentication for reads must be enforced in production
    if (!config.REQUIRE_AUTH_FOR_READS) {
      violations.push("Production must enforce REQUIRE_AUTH_FOR_READS=true to prevent unauthorized data exposure.");
    }

    // 5. Data Encryption Key in production cannot be dev fallback
    if (config.DATA_ENCRYPTION_KEY && config.DATA_ENCRYPTION_KEY.includes("ecdat-dev-master-encryption-key")) {
      violations.push("Production DATA_ENCRYPTION_KEY cannot use default development key.");
    }

    // 6. Enforce TLS for database data in transit
    if (config.DATABASE_SSL === false && process.env.ALLOW_INSECURE_DB_IN_PRODUCTION !== "true") {
      violations.push("Production requires TLS in transit for database connections (DATABASE_SSL=true).");
    }

    // Run extended production guard validation if available
    try {
      validateProductionSecurity(config);
    } catch (guardErr) {
      if (guardErr instanceof InsecureProductionConfigError) {
        for (const v of guardErr.violations) {
          if (!violations.includes(v)) violations.push(v);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new InsecureProductionConfigError(
      violations.join("; "),
      violations
    );
  }

  return true;
}

module.exports = {
  InsecureProductionConfigError,
  MissingMandatorySecurityConfigError,
  UnsafeDevelopmentDefaultDetectedError,
  resolveSecret,
  sanitizeCredentialUrl,
  sanitizeConfigForLogging,
  validateConfig,
  validateProductionSecurity,
};

