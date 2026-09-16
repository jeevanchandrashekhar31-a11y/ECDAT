/**
 * ECDAT Secure Database Query Builder & Parameterization Guard — Phase 16.2
 *
 * Enforces:
 * 1. Parameterized queries for all SQL operations (never string interpolation)
 * 2. Strict query bounding (default limit: 50, max limit: 500) to prevent denial of service
 * 3. Tenant-scoped query isolation
 * 4. SQL injection heuristic detection
 */

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 500;

// High-confidence SQL injection patterns
const SQL_INJECTION_PATTERNS = [
  /(\b(UNION(\s+ALL)?)\b\s+SELECT)/i,
  /(\bSELECT\b[\s\S]+\bFROM\b[\s\S]+\bWHERE\b)/i,
  /(\bOR\b\s+['"]?[0-9a-zA-Z]+['"]?\s*=\s*['"]?[0-9a-zA-Z]+['"]?)/i,
  /(\bAND\b\s+['"]?[0-9a-zA-Z]+['"]?\s*=\s*['"]?[0-9a-zA-Z]+['"]?)/i,
  /(--|\#|\/\*|\*\/)/,
  /(;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b)/i,
  /(\bEXEC(\s+XP_|\s+SP_)?\b)/i,
  /(\bSLEEP\s*\(\s*\d+\s*\))/i,
  /(\bBENCHMARK\s*\(\s*\d+\s*,)/i,
  /(\bWAITFOR\s+DELAY\b)/i,
];

class DatabaseSecurityViolationError extends Error {
  constructor(message, code = "ERR_DB_SECURITY_VIOLATION", details = {}) {
    super(message);
    this.name = "DatabaseSecurityViolationError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Detects whether a string input contains dangerous SQL injection patterns.
 *
 * @param {string} value
 * @returns {{ detected: boolean, pattern?: string }}
 */
function detectSqlInjection(value) {
  if (!value || typeof value !== "string") {
    return { detected: false };
  }

  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      return {
        detected: true,
        pattern: pattern.toString(),
      };
    }
  }

  return { detected: false };
}

/**
 * Applies strict pagination and query bounding to a Knex query builder.
 * Clamps limit to [1, maxLimit] and prevents unbounded table scans.
 *
 * @param {object} queryBuilder - Knex query builder
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {number} [options.maxLimit=500]
 * @returns {object} Knex query builder with applied bounds
 */
function applyQueryBounds(queryBuilder, options = {}) {
  const maxLimit = options.maxLimit || MAX_QUERY_LIMIT;
  let limit = options.limit !== undefined ? parseInt(options.limit, 10) : DEFAULT_QUERY_LIMIT;
  let offset = options.offset !== undefined ? parseInt(options.offset, 10) : 0;

  if (isNaN(limit) || limit < 1) {
    limit = DEFAULT_QUERY_LIMIT;
  } else if (limit > maxLimit) {
    limit = maxLimit;
  }

  queryBuilder.limit(limit);

  if (!isNaN(offset) && offset > 0) {
    queryBuilder.offset(offset);
  }

  return queryBuilder;
}

/**
 * Enforces tenant scoping on a database query.
 * Rejects queries where tenant isolation is missing if required.
 *
 * @param {object} queryBuilder - Knex query builder
 * @param {string} tenantId - Tenant identifier
 * @param {string} [columnName="tenant_id"] - Column name in table
 * @returns {object} Scoped query builder
 */
function scopeToTenant(queryBuilder, tenantId, columnName = "tenant_id") {
  if (!tenantId || typeof tenantId !== "string") {
    throw new DatabaseSecurityViolationError(
      "Tenant scoping error: 'tenantId' is required for tenant-isolated database access",
      "ERR_MISSING_TENANT_ID"
    );
  }

  const check = detectSqlInjection(tenantId);
  if (check.detected) {
    throw new DatabaseSecurityViolationError(
      "SQL injection detected in tenantId parameter",
      "ERR_SQL_INJECTION_DETECTED",
      { pattern: check.pattern }
    );
  }

  return queryBuilder.where({ [columnName]: tenantId });
}

/**
 * Safe wrapper for executing raw SQL queries with mandatory parameterization.
 * Prevents string concatenation vulnerabilities by enforcing parameter bindings.
 *
 * @param {object} client - Knex instance or transaction
 * @param {string} sql - SQL query string with '?' or ':name' placeholders
 * @param {Array|object} bindings - Parameter bindings
 * @returns {Promise<any>}
 */
async function safeRaw(client, sql, bindings = []) {
  if (!sql || typeof sql !== "string") {
    throw new DatabaseSecurityViolationError("safeRaw requires a valid SQL query string");
  }

  // Detect unparameterized multi-statement injection attempts in raw SQL
  const trimmed = sql.trim();
  const withoutTrailingSemicolon = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSemicolon.includes(";")) {
    throw new DatabaseSecurityViolationError(
      "Multiple SQL statements separated by semicolons are prohibited in safeRaw",
      "ERR_MULTIPLE_STATEMENTS"
    );
  }

  // If bindings are an array or object, verify presence when placeholders exist
  const placeholderCount = (sql.match(/\?/g) || []).length;
  if (placeholderCount > 0) {
    if (!Array.isArray(bindings) || bindings.length !== placeholderCount) {
      throw new DatabaseSecurityViolationError(
        `Parameter binding mismatch: SQL contains ${placeholderCount} placeholder(s) but ${Array.isArray(bindings) ? bindings.length : 0} binding(s) were provided`,
        "ERR_BINDING_MISMATCH"
      );
    }
  }

  // Execute parameterized raw query via Knex
  return client.raw(sql, bindings);
}

module.exports = {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  SQL_INJECTION_PATTERNS,
  DatabaseSecurityViolationError,
  detectSqlInjection,
  applyQueryBounds,
  scopeToTenant,
  safeRaw,
};
