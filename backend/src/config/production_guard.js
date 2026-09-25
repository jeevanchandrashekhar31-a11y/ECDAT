/**
 * ECDAT Production Security Configuration Guard (Phase 24.3)
 *
 * Enforces secure-by-default production invariants:
 * 1. Unsafe development settings must never silently become production defaults.
 * 2. Fail startup when mandatory security configuration is missing.
 * 3. Prohibit known development secrets, mock passwords, and debug bypasses in production.
 */

// const fs = require("fs");
// const path = require("path");

class InsecureProductionConfigError extends Error {
  constructor(message, violations = []) {
    super(`Insecure Production Configuration: ${message}`);
    this.name = "InsecureProductionConfigError";
    this.code = "ERR_CONFIG_INSECURE_PRODUCTION";
    this.violations = [...violations];
  }
}

class MissingMandatorySecurityConfigError extends InsecureProductionConfigError {
  constructor(missingKeys = []) {
    super(
      `Mandatory security configuration is missing in production: [${missingKeys.join(", ")}]`,
      missingKeys.map((k) => `Missing mandatory key: '${k}'`)
    );
    this.name = "MissingMandatorySecurityConfigError";
    this.code = "ERR_CONFIG_MANDATORY_MISSING";
    this.missingKeys = missingKeys;
  }
}

class UnsafeDevelopmentDefaultDetectedError extends InsecureProductionConfigError {
  constructor(unsafeDefaults = []) {
    super(
      `Unsafe development default detected in production environment: [${unsafeDefaults.join(", ")}]`,
      unsafeDefaults.map((d) => `Unsafe development setting: '${d}'`)
    );
    this.name = "UnsafeDevelopmentDefaultDetectedError";
    this.code = "ERR_CONFIG_UNSAFE_DEV_DEFAULT";
    this.unsafeDefaults = unsafeDefaults;
  }
}

// Blacklist of known development, demo, and test mock credentials
const KNOWN_INSECURE_DEV_SECRETS = new Set([
  "ecdat-dev-master-encryption-key",
  "change-this-local-api-key",
  "change-this-local-postgres-password",
  "change-this-production-password",
  "change-this-local-key",
  "dummy-secret-key-for-testing",
  "super-secure-jwt-signing-key-example",
  "secret",
  "password",
  "admin",
  "123456",
  "12345678",
  "default",
  "root",
  "test",
  "dev",
]);

// Mandatory configuration keys required in production
const MANDATORY_PRODUCTION_KEYS = [
  "ECDAT_API_KEY",
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "JWT_SECRET",
  "CORS_ORIGIN",
];

// Prohibited development flags in production
const PROHIBITED_DEV_FLAGS = [
  "ALLOW_DEV_BYPASS",
  "DISABLE_AUTH",
  "SKIP_AUTH",
  "DEBUG_EXPOSE_STACK_TRACES",
  "INSECURE_SKIP_VERIFY",
  "ALLOW_INSECURE_DB_IN_PRODUCTION",
];

/**
 * Validates whether an input secret has adequate complexity and is not a known dev mock.
 */
function isKnownDevOrWeakSecret(val) {
  if (!val || typeof val !== "string") return true;
  const lower = val.trim().toLowerCase();
  if (KNOWN_INSECURE_DEV_SECRETS.has(lower)) return true;
  if (lower.startsWith("change-this-") || lower.startsWith("dummy") || lower.startsWith("mock") || lower.startsWith("test-")) return true;
  return false;
}

/**
 * Validates that production configuration meets all secure-by-default standards.
 * Fails hard on missing mandatory configuration or unsafe development defaults.
 */
function validateProductionSecurity(config, env = process.env) {
  const isProduction =
    (config.NODE_ENV && config.NODE_ENV.toLowerCase() === "production") ||
    (env.NODE_ENV && env.NODE_ENV.toLowerCase() === "production") ||
    (env.APP_ENV && env.APP_ENV.toLowerCase() === "production");

  if (!isProduction) {
    return { isProduction: false, passed: true, violations: [] };
  }

  const missingKeys = [];
  const violations = [];

  // 1. Mandatory Security Configuration Presence
  for (const key of MANDATORY_PRODUCTION_KEYS) {
    const val = config[key] || env[key];
    if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    throw new MissingMandatorySecurityConfigError(missingKeys);
  }

  // 2. Unsafe Development Default Prohibitions
  // API Key validation
  const apiKey = String(config.ECDAT_API_KEY || env.ECDAT_API_KEY || "").trim();
  if (isKnownDevOrWeakSecret(apiKey)) {
    violations.push("ECDAT_API_KEY is using a known unsafe development default or mock credential.");
  }
  if (apiKey.length < 32) {
    violations.push(`ECDAT_API_KEY must be at least 32 characters in production (provided: ${apiKey.length}).`);
  }

  // Database URL validation
  const dbUrl = String(config.DATABASE_URL || env.DATABASE_URL || "").trim();
  if (
    dbUrl.includes("postgres:postgres@") ||
    dbUrl.includes("localhost:5432") ||
    dbUrl.includes("127.0.0.1:5432") ||
    dbUrl.includes("change-this-")
  ) {
    violations.push("DATABASE_URL cannot use localhost or default development credentials in production.");
  }

  // Data Encryption Key (Master Key for Field-Level Encryption)
  const dek = String(config.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY || "").trim();
  if (isKnownDevOrWeakSecret(dek)) {
    violations.push("DATA_ENCRYPTION_KEY is using a known unsafe development key.");
  }
  if (dek.length < 32) {
    violations.push("DATA_ENCRYPTION_KEY must be a 256-bit key (at least 32 characters/bytes) in production.");
  }

  // JWT Secret
  const jwtSecret = String(config.JWT_SECRET || env.JWT_SECRET || "").trim();
  if (isKnownDevOrWeakSecret(jwtSecret)) {
    violations.push("JWT_SECRET is using an unsafe default or placeholder.");
  }
  if (jwtSecret.length < 32) {
    violations.push("JWT_SECRET must be at least 32 characters long in production.");
  }

  // CORS Origins
  const rawCors = config.CORS_ORIGIN || env.CORS_ORIGIN;
  const corsOrigins = Array.isArray(rawCors) ? rawCors : String(rawCors).split(",").map((s) => s.trim());
  for (const origin of corsOrigins) {
    if (origin === "*") {
      violations.push("CORS_ORIGIN cannot be wildcard '*' in production.");
    }
    if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
      violations.push(`CORS_ORIGIN cannot permit development loopback addresses in production ('${origin}').`);
    }
    if (!origin.startsWith("https://")) {
      violations.push(`CORS_ORIGIN must use secure HTTPS protocol in production ('${origin}').`);
    }
  }

  // Require Auth for Reads
  const reqAuth = config.REQUIRE_AUTH_FOR_READS !== undefined ? config.REQUIRE_AUTH_FOR_READS : (env.REQUIRE_AUTH_FOR_READS === "true");
  if (!reqAuth) {
    violations.push("Production must strictly enforce REQUIRE_AUTH_FOR_READS=true to prevent unauthenticated access.");
  }

  // Database TLS in transit
  const dbSsl = config.DATABASE_SSL !== undefined ? config.DATABASE_SSL : (env.DATABASE_SSL !== "false");
  if (!dbSsl) {
    violations.push("Production must strictly enforce DATABASE_SSL=true for encrypted database transit.");
  }
  const dbSslReject = config.DATABASE_SSL_REJECT_UNAUTHORIZED !== undefined ? config.DATABASE_SSL_REJECT_UNAUTHORIZED : (env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false");
  if (!dbSslReject) {
    violations.push("DATABASE_SSL_REJECT_UNAUTHORIZED must be true in production to prevent MITM attacks.");
  }

  // 3. Prohibited Development Flags
  for (const flag of PROHIBITED_DEV_FLAGS) {
    if (env[flag] === "true" || env[flag] === "1" || config[flag] === true) {
      violations.push(`Unsafe development bypass flag '${flag}' is forbidden in production.`);
    }
  }

  if (violations.length > 0) {
    throw new UnsafeDevelopmentDefaultDetectedError(violations);
  }

  return { isProduction: true, passed: true, violations: [] };
}

module.exports = {
  InsecureProductionConfigError,
  MissingMandatorySecurityConfigError,
  UnsafeDevelopmentDefaultDetectedError,
  KNOWN_INSECURE_DEV_SECRETS,
  MANDATORY_PRODUCTION_KEYS,
  PROHIBITED_DEV_FLAGS,
  isKnownDevOrWeakSecret,
  validateProductionSecurity,
};
