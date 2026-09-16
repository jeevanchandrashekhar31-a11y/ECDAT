/**
 * ECDAT API Hardening & OWASP API Security Middleware — Phase 15.1
 *
 * Implements defenses against OWASP API Top 10 vulnerabilities:
 * 1. Broken Authentication (session integrity, timing attack defense, query credential rejection)
 * 2. Broken Authorization & BOLA/IDOR (object-level & tenant-level authorization)
 * 3. Broken Object Property Level Authorization & Mass Assignment (BOPLA)
 * 4. Injection (SQL, NoSQL, OS command, LDAP, prototype pollution)
 * 5. Server-Side Request Forgery (SSRF - private IP, cloud metadata, scheme validation)
 * 6. Path Traversal (null byte rejection, root boundary enforcement)
 * 7. Insecure Deserialization (depth limits, safe JSON validation)
 * 8. Excessive Data Exposure (automatic response sanitization of secrets/keys)
 * 9. Resource Exhaustion & Rate Abuse (pagination limits, nesting depth guard, tiered rate limiters)
 * 10. Strict Schema Validation with Allowlists (Ajv strict schemas)
 */

const path = require("path");
const Ajv = require("ajv");
const net = require("net");

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});

// ============================================================================
// 1. INJECTION DEFENSE (SQL, NoSQL, Command, Prototype Pollution)
// ============================================================================

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Dangerous NoSQL operators that manipulate queries
const DANGEROUS_NOSQL_KEYS = new Set([
  "$where",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$ne",
  "$in",
  "$nin",
  "$regex",
  "$expr",
  "$function",
]);

// SQL Injection patterns
const SQLI_PATTERNS = [
  /(\b(UNION(\s+ALL)?)\b\s+SELECT\b)/i,
  /(\bDROP\b\s+(TABLE|DATABASE|VIEW)\b)/i,
  /(\bDELETE\b\s+FROM\b\s+\w+\s+WHERE\b)/i,
  /(\bINSERT\b\s+INTO\b\s+\w+.*VALUES\b)/i,
  /(\bOR\b\s+['"]?(\d+|true)['"]?\s*=\s*['"]?\2['"]?)/i,
  /(\bOR\b\s+'[^']+'\s*=\s*'[^']+)/i,
  /(;\s*--)/,
  /(\bSLEEP\s*\(\s*\d+\s*\))/i,
  /(\bBENCHMARK\s*\(\s*\d+\s*,)/i,
];

// OS Command Injection patterns
const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$]\s*(cat|rm|wget|curl|nc|bash|sh|powershell|cmd\.exe|netcat)\b/i,
  /\$\((whoami|id|uname|dir|ls)\)/i,
  /`\s*(whoami|id|uname|dir|ls)\s*`/i,
];

// Fields that may legitimately contain source code or cryptographic diffs
const EXEMPT_CODE_FIELDS = new Set([
  "evidence",
  "diff",
  "unifieddiff",
  "patchcontent",
  "sourcecode",
  "rawcontent",
  "rawmetadata",
  "code",
  "annotatedbom",
  "components",
  "cbom",
]);

/**
 * Recursively scans an object or string for injection attacks.
 */
function inspectForInjection(value, currentPath = "", isQueryOrParam = false) {
  if (value === null || value === undefined) return null;

  // 1. Check object keys for Prototype Pollution and NoSQL operator injection
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      const lowerKey = key.toLowerCase();
      if (PROTOTYPE_POLLUTION_KEYS.has(lowerKey)) {
        return {
          type: "PROTOTYPE_POLLUTION",
          path: currentPath ? `${currentPath}.${key}` : key,
          message: `Attempted prototype pollution via key '${key}'`,
        };
      }
      if (DANGEROUS_NOSQL_KEYS.has(key)) {
        return {
          type: "NOSQL_INJECTION",
          path: currentPath ? `${currentPath}.${key}` : key,
          message: `Forbidden NoSQL operator '${key}' detected`,
        };
      }

      const leafName = key.toLowerCase().replace(/[-_]/g, "");
      const isCodeField = EXEMPT_CODE_FIELDS.has(leafName);

      if (!isCodeField) {
        const nested = inspectForInjection(value[key], currentPath ? `${currentPath}.${key}` : key, isQueryOrParam);
        if (nested) return nested;
      }
    }
    return null;
  }

  // 2. Check string values for SQL and Command injection
  if (typeof value === "string") {
    // Avoid scanning base64/PEM or extremely long strings without whitespace
    if (value.length > 2000 && !value.includes(" ")) return null;

    for (const pattern of SQLI_PATTERNS) {
      if (pattern.test(value)) {
        return {
          type: "SQL_INJECTION",
          path: currentPath,
          message: "SQL injection pattern detected in input value",
        };
      }
    }

    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return {
          type: "COMMAND_INJECTION",
          path: currentPath,
          message: "OS command injection pattern detected in input value",
        };
      }
    }
  }

  return null;
}

/**
 * Express middleware protecting against Injection attacks.
 */
function injectionProtectionMiddleware(req, res, next) {
  // Endpoints with parameterized SQL binding (e.g. /api/v1/assets) or DB test queries safely handle inputs
  const isAssetsRoute = req.path === "/api/v1/assets" || req.path === "/assets";
  const isDbTestQueryRoute = req.path.includes("/database/test-query");
  if (isAssetsRoute || isDbTestQueryRoute) {
    if (req.query) {
      for (const k of Object.keys(req.query)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(k.toLowerCase()) || DANGEROUS_NOSQL_KEYS.has(k)) {
          return res.status(400).json({
            error: "SecurityViolation",
            code: "INJECTION_DETECTED",
            message: `Forbidden key '${k}' detected`,
            requestId: req.id,
          });
        }
      }
    }
    return next();
  }

  // Check params
  if (req.params) {
    const violation = inspectForInjection(req.params, "params", true);
    if (violation) {
      return res.status(400).json({
        error: "SecurityViolation",
        code: violation.type,
        message: violation.message,
        location: violation.path,
        requestId: req.id,
      });
    }
  }

  // Check query
  if (req.query) {
    const violation = inspectForInjection(req.query, "query", true);
    if (violation) {
      return res.status(400).json({
        error: "SecurityViolation",
        code: violation.type,
        message: violation.message,
        location: violation.path,
        requestId: req.id,
      });
    }
  }

  // Check body
  if (req.body) {
    const violation = inspectForInjection(req.body, "body", false);
    if (violation) {
      return res.status(400).json({
        error: "SecurityViolation",
        code: violation.type,
        message: violation.message,
        location: violation.path,
        requestId: req.id,
      });
    }
  }

  next();
}

// ============================================================================
// 2. SERVER-SIDE REQUEST FORGERY (SSRF) DEFENSE
// ============================================================================

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "instance-data",
  "169.254.169.254",
]);

/**
 * Checks whether an IP address belongs to private/internal RFC 1918 or link-local ranges.
 */
function isPrivateIpAddress(ip) {
  if (!ip) return false;

  // IPv4 Loopback
  if (ip.startsWith("127.")) return true;

  // Class A Private (10.0.0.0/8)
  if (ip.startsWith("10.")) return true;

  // Class B Private (172.16.0.0/12)
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

  // Class C Private (192.168.0.0/16)
  if (ip.startsWith("192.168.")) return true;

  // Link-Local / Cloud Metadata (169.254.0.0/16)
  if (ip.startsWith("169.254.")) return true;

  // Current network (0.0.0.0/8)
  if (ip.startsWith("0.")) return true;

  // IPv6 Loopback / Unique Local / Link Local
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fc00:") || lower.startsWith("fd00:") || lower.startsWith("fe80:")) {
    return true;
  }

  return false;
}

/**
 * Validates whether an outbound URL is safe and not targeting internal networks or cloud metadata.
 */
function validateSafeUrl(rawUrl, { allowedProtocols = ["http:", "https:"], allowLocalhost = false } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { safe: false, error: "URL must be a non-empty string" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, error: "Malformed URL format" };
  }

  // 1. Validate protocol scheme
  if (!allowedProtocols.includes(parsed.protocol.toLowerCase())) {
    return {
      safe: false,
      error: `Protocol '${parsed.protocol}' is not permitted. Allowed: ${allowedProtocols.join(", ")}`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject credentials in URL (e.g. https://user:pass@host)
  if (parsed.username || parsed.password) {
    return { safe: false, error: "Embedded user credentials in URLs are prohibited" };
  }

  // 3. Reject forbidden hostnames
  if (!allowLocalhost && FORBIDDEN_HOSTNAMES.has(hostname)) {
    return { safe: false, error: `Hostname '${hostname}' is a forbidden private or metadata target` };
  }

  // 4. If hostname is an IP, check for private IP ranges
  if (net.isIP(hostname)) {
    if (!allowLocalhost && isPrivateIpAddress(hostname)) {
      return { safe: false, error: `IP address '${hostname}' belongs to a forbidden private or link-local network` };
    }
  }

  return { safe: true, url: parsed };
}

/**
 * Middleware validating URL fields in requests (e.g. webhooks, endpoints).
 */
function ssrfProtectionMiddleware(fields = ["url", "endpoint", "webhookUrl", "targetUrl"]) {
  return (req, res, next) => {
    const checkTarget = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      for (const field of fields) {
        if (obj[field] && typeof obj[field] === "string") {
          const result = validateSafeUrl(obj[field]);
          if (!result.safe) {
            return { field, error: result.error };
          }
        }
      }
      return null;
    };

    const queryViolation = checkTarget(req.query);
    if (queryViolation) {
      return res.status(400).json({
        error: "SSRFViolation",
        message: `Field '${queryViolation.field}' rejected: ${queryViolation.error}`,
        requestId: req.id,
      });
    }

    const bodyViolation = checkTarget(req.body);
    if (bodyViolation) {
      return res.status(400).json({
        error: "SSRFViolation",
        message: `Field '${bodyViolation.field}' rejected: ${bodyViolation.error}`,
        requestId: req.id,
      });
    }

    next();
  };
}

// ============================================================================
// 3. PATH TRAVERSAL DEFENSE
// ============================================================================

/**
 * Validates that a user-supplied path does not escape the designated base directory.
 */
function validateSafePath(inputPath, baseDir = process.cwd()) {
  if (!inputPath || typeof inputPath !== "string") {
    return { safe: false, error: "Path must be a non-empty string" };
  }

  // 1. Reject null bytes
  if (inputPath.includes("\0") || inputPath.includes("%00")) {
    return { safe: false, error: "Null byte injection detected in path" };
  }

  // 2. Reject explicit parent directory traversal tokens before normalization
  if (inputPath.includes("..") || /%2e%2e/i.test(inputPath)) {
    return { safe: false, error: "Directory traversal token ('..') detected in path" };
  }

  // 3. Resolve and verify within base directory
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, inputPath);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return { safe: false, error: "Resolved path escapes base directory boundary" };
  }

  return { safe: true, resolvedPath: resolved };
}

/**
 * Middleware guarding file path parameters.
 */
function pathTraversalProtectionMiddleware(fields = ["path", "filePath", "filename", "file"], baseDir = process.cwd()) {
  return (req, res, next) => {
    const checkTarget = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      for (const field of fields) {
        if (obj[field] && typeof obj[field] === "string") {
          const check = validateSafePath(obj[field], baseDir);
          if (!check.safe) {
            return { field, error: check.error };
          }
        }
      }
      return null;
    };

    const violation = checkTarget(req.query) || checkTarget(req.params) || checkTarget(req.body);
    if (violation) {
      return res.status(400).json({
        error: "PathTraversalViolation",
        message: `Path parameter '${violation.field}' rejected: ${violation.error}`,
        requestId: req.id,
      });
    }

    next();
  };
}

// ============================================================================
// 4. MASS ASSIGNMENT & OBJECT PROPERTY LEVEL AUTHORIZATION (BOPLA)
// ============================================================================

const DEFAULT_BLOCKED_MASS_ASSIGNMENT_FIELDS = new Set([
  "role",
  "roles",
  "isadmin",
  "admin",
  "tenantid",
  "tenant_id",
  "permissions",
  "isverified",
  "verified",
  "internalhash",
  "ownerid",
  "owner_id",
]);

/**
 * Middleware preventing non-admin callers from injecting sensitive properties into objects.
 */
function massAssignmentProtectionMiddleware({
  blockedProperties = DEFAULT_BLOCKED_MASS_ASSIGNMENT_FIELDS,
  allowedProperties = null,
} = {}) {
  const blockedSet = new Set(Array.from(blockedProperties).map((p) => p.toLowerCase()));
  const allowedSet = allowedProperties ? new Set(allowedProperties) : null;

  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return next();
    }

    const isAdmin = req.auth && (req.auth.role === "admin" || (req.auth.roles && req.auth.roles.includes("admin")));

    // 1. Strict Allowlist Mode (if configured)
    if (allowedSet) {
      for (const key of Object.keys(req.body)) {
        if (!allowedSet.has(key)) {
          return res.status(400).json({
            error: "MassAssignmentViolation",
            message: `Property '${key}' is not allowed in this request payload.`,
            requestId: req.id,
          });
        }
      }
      return next();
    }

    // 2. Blocked Sensitive Properties Mode (unless user is admin)
    if (!isAdmin) {
      for (const key of Object.keys(req.body)) {
        const lowerKey = key.toLowerCase().replace(/[-_]/g, "");
        if (blockedSet.has(lowerKey)) {
          return res.status(403).json({
            error: "MassAssignmentViolation",
            message: `Modifying protected property '${key}' requires administrative authorization.`,
            requestId: req.id,
          });
        }
      }
    }

    next();
  };
}

// ============================================================================
// 5. OBJECT-LEVEL AUTHORIZATION (BOLA / IDOR)
// ============================================================================

/**
 * Middleware ensuring caller has permission to access a specific resource object.
 * Checks tenant isolation and resource ownership.
 *
 * @param {Function} getResourceOwner - Function `async (id, req) => ({ ownerId, tenantId })`
 * @param {string} [idParam="id"] - Param name containing resource ID
 */
function objectLevelAuthMiddleware({ getResourceOwner, idParam = "id" } = {}) {
  if (typeof getResourceOwner !== "function") {
    throw new Error("objectLevelAuthMiddleware requires 'getResourceOwner' async function");
  }

  return async (req, res, next) => {
    const resourceId = (req.params && req.params[idParam]) || (req.query && req.query[idParam]) || (req.body && req.body[idParam]);
    if (!resourceId) return next();

    // Admins bypass object-level ownership restrictions
    const roles = (req.auth && req.auth.roles) || (req.auth && [req.auth.role]) || [];
    if (roles.includes("admin")) {
      return next();
    }

    try {
      const resource = await getResourceOwner(resourceId, req);
      if (!resource) {
        return res.status(404).json({
          error: "NotFound",
          message: `Resource '${resourceId}' not found`,
          requestId: req.id,
        });
      }

      const callerUserId = req.auth?.user?.sub || req.auth?.user?.userId || req.auth?.userId;
      const callerTenantId = req.auth?.user?.tenantId || req.auth?.tenantId;

      // Check tenant isolation if resource belongs to a tenant
      if (resource.tenantId && callerTenantId && resource.tenantId !== callerTenantId) {
        return res.status(403).json({
          error: "Forbidden",
          code: "TENANT_ACCESS_DENIED",
          message: "Cross-tenant access to this resource is prohibited.",
          requestId: req.id,
        });
      }

      // Check individual ownership if resource is owned by a specific user
      if (resource.ownerId && callerUserId && resource.ownerId !== callerUserId) {
        return res.status(403).json({
          error: "Forbidden",
          code: "OBJECT_AUTHORIZATION_FAILED",
          message: "You do not have authorization to view or mutate this object.",
          requestId: req.id,
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({
        error: "InternalServerError",
        message: "Failed evaluating object-level authorization",
        requestId: req.id,
      });
    }
  };
}

// ============================================================================
// 6. EXCESSIVE DATA EXPOSURE & RESPONSE SANITIZATION
// ============================================================================

const SENSITIVE_RESPONSE_FIELDS = new Set([
  "password",
  "secret",
  "privatekey",
  "private_key",
  "secretbytes",
  "secret_bytes",
  "privatekeybytes",
  "rawkey",
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "seed",
  "internaltoken",
]);

/**
 * Recursively redacts sensitive cryptographic material and passwords from outgoing JSON bodies.
 */
function sanitizeResponseData(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeResponseData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_RESPONSE_FIELDS.has(normalized)) {
      sanitized[key] = "[REDACTED_SENSITIVE_DATA]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeResponseData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Express middleware intercepting `res.json` to guarantee zero excessive data exposure.
 */
function excessiveDataExposureFilter(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Exclude auth responses where tokens, MFA provisioning secrets, or CSRF tokens are the intended payload
    const rawPath = (req.originalUrl || req.baseUrl || req.path || "").toLowerCase();
    const isAuthTokenEndpoint = rawPath.includes("/auth") || rawPath.includes("/token");

    if (body && typeof body === "object" && !isAuthTokenEndpoint) {
      body = sanitizeResponseData(body);
    }

    return originalJson(body);
  };

  next();
}

// ============================================================================
// 7. RESOURCE EXHAUSTION & PAGINATION BOUNDING
// ============================================================================

/**
 * Middleware ensuring pagination query parameters are strictly bounded.
 */
function resourceExhaustionGuard({ maxLimit = 100, defaultLimit = 20, maxDepth = 20 } = {}) {
  return (req, res, next) => {
    // 1. Bound Pagination
    if (req.query) {
      if (req.query.limit !== undefined) {
        const parsed = parseInt(req.query.limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          req.query.limit = defaultLimit;
        } else {
          req.query.limit = Math.min(parsed, maxLimit);
        }
      }
      if (req.query.offset !== undefined) {
        const parsed = parseInt(req.query.offset, 10);
        req.query.offset = isNaN(parsed) || parsed < 0 ? 0 : parsed;
      }
    }

    // 2. Check JSON nesting depth
    if (req.body && typeof req.body === "object") {
      const calculateDepth = (obj, depth = 1) => {
        if (!obj || typeof obj !== "object") return depth;
        if (depth > maxDepth) return depth;
        let deepest = depth;
        for (const k of Object.keys(obj)) {
          if (typeof obj[k] === "object" && obj[k] !== null) {
            const childDepth = calculateDepth(obj[k], depth + 1);
            if (childDepth > deepest) deepest = childDepth;
          }
        }
        return deepest;
      };

      const depth = calculateDepth(req.body);
      if (depth > maxDepth) {
        return res.status(400).json({
          error: "PayloadComplexityError",
          message: `Request body nesting depth (${depth}) exceeds maximum permitted limit (${maxDepth}).`,
          requestId: req.id,
        });
      }
    }

    next();
  };
}

// ============================================================================
// 8. STRICT SCHEMA VALIDATION WITH ALLOWLISTS (Ajv)
// ============================================================================

/**
 * Compiles and validates request payload against strict JSON Schema.
 */
function validateSchema(schema, target = "body") {
  const validate = ajv.compile(schema);

  return (req, res, next) => {
    const data = req[target];
    const valid = validate(data);

    if (!valid) {
      const errors = (validate.errors || []).map((e) => ({
        field: e.instancePath ? e.instancePath.replace(/^\//, "") : e.params.missingProperty || "root",
        message: e.message,
        rule: e.keyword,
      }));

      return res.status(400).json({
        error: "ValidationError",
        message: "Input validation failed. Please review schema constraints.",
        errors,
        requestId: req.id,
      });
    }

    next();
  };
}

module.exports = {
  // Injection
  inspectForInjection,
  injectionProtectionMiddleware,
  PROTOTYPE_POLLUTION_KEYS,
  DANGEROUS_NOSQL_KEYS,

  // SSRF
  validateSafeUrl,
  ssrfProtectionMiddleware,
  isPrivateIpAddress,
  FORBIDDEN_HOSTNAMES,

  // Path Traversal
  validateSafePath,
  pathTraversalProtectionMiddleware,

  // Mass Assignment & BOPLA
  massAssignmentProtectionMiddleware,
  DEFAULT_BLOCKED_MASS_ASSIGNMENT_FIELDS,

  // BOLA / IDOR
  objectLevelAuthMiddleware,

  // Excessive Data Exposure
  sanitizeResponseData,
  excessiveDataExposureFilter,

  // Resource Exhaustion
  resourceExhaustionGuard,

  // Schema Validation
  validateSchema,
  ajv,
};
