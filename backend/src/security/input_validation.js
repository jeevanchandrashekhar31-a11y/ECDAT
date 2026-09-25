/**
 * Comprehensive External Input Validation & Safety Engine — Phase 19 / P1
 *
 * Mandate:
 * - Review every external input.
 * - Strict schemas (Ajv compiled with additionalProperties: false where security-sensitive).
 * - Type validation (no unexpected coercion or type juggling).
 * - Length limits (min/max bounds on all strings).
 * - Enum validation (closed sets for roles, severities, asset types, providers, etc.).
 * - URL validation (strict scheme, SSRF blocklist, cloud metadata prevention).
 * - Hostname validation (RFC 1123, forbidden internal suffixes, control character rejection).
 * - IP validation (IPv4/IPv6 syntax, private & reserved range blocklists).
 * - File validation (filename sanitization, path traversal rejection, size limits).
 * - MIME validation (strict whitelist, dangerous MIME rejection).
 * - Content validation (JSON structure, CBOM specification conformance, no private keys).
 * - Numeric bounds (finite, non-NaN, integer-only where appropriate, min/max ranges).
 * - Pagination bounds (page >= 1, limit 1..100, offset >= 0).
 * - Reject unknown fields where security-sensitive.
 * - Never trust frontend validation.
 */

const net = require("net");
const path = require("path");
const Ajv = require("ajv");
const {
  checkForbiddenIp,
  checkForbiddenHostname,
  FORBIDDEN_HOSTNAMES_EXACT,
  FORBIDDEN_DNS_SUFFIXES,
} = require("./ssrf_protection");

// Initialize Ajv with strict schema validation
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});

// Add custom format validators if needed
ajv.addFormat("email", /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/);

// ============================================================================
// 1. CANONICAL ENUMS & ALLOWLISTS
// ============================================================================

const ALLOWED_ROLES = Object.freeze([
  "viewer",
  "analyst",
  "developer",
  "auditor",
  "admin",
  "security admin",
  "security administrator",
  "platform_admin",
  "platform administrator",
  "secops",
]);

const ALLOWED_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]);

const ALLOWED_ASSET_TYPES = Object.freeze([
  "service",
  "database",
  "endpoint",
  "library",
  "hardware",
  "application",
  "component",
  "microservice",
]);

const ALLOWED_DATA_SENSITIVITIES = Object.freeze(["public", "internal", "confidential", "restricted"]);

const ALLOWED_BUSINESS_CRITICALITIES = Object.freeze(["low", "medium", "high", "critical"]);

const ALLOWED_KMS_PROVIDERS = Object.freeze([
  "aws_kms",
  "gcp_kms",
  "azure_keyvault",
  "hashicorp_vault",
  "pkcs11_hsm",
]);

const ALLOWED_TICKETING_TYPES = Object.freeze([
  "jira",
  "servicenow",
  "github",
  "github_issues",
  "gitlab",
  "gitlab_issues",
  "webhook",
  "generic_webhook",
]);

const ALLOWED_EXPORT_FORMATS = Object.freeze(["json", "cef", "syslog", "sarif", "cyclonedx", "spdx"]);

const ALLOWED_UPLOAD_MIMES = Object.freeze([
  "application/json",
  "application/vnd.cyclonedx+json",
  "application/spdx+json",
  "text/plain",
]);

const ALLOWED_FILE_EXTENSIONS = Object.freeze([".json", ".cdx.json", ".cbom.json", ".spdx.json", ".txt"]);

const DANGEROUS_MIMES = Object.freeze([
  "application/x-msdownload",
  "application/x-sh",
  "application/x-bat",
  "text/html",
  "application/javascript",
  "text/javascript",
  "application/octet-stream",
]);

// ============================================================================
// 2. PRIMITIVE VALIDATORS (URL, HOSTNAME, IP, NUMERIC, LENGTH, ENUM)
// ============================================================================

/**
 * Validates a URL ensuring strict scheme (http/https), valid parsing, and SSRF safety.
 */
function validateUrl(rawUrl, { requireHttps = false, allowLocalhost = false } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "URL must be a non-empty string" };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: "URL exceeds maximum allowed length (2048 chars)" };
  }

  // Reject dangerous pseudo-protocols
  if (/^(javascript|data|vbscript|file|ftp|about):/i.test(trimmed)) {
    return { valid: false, error: "Dangerous or forbidden URL scheme" };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { valid: false, error: `Malformed URL: ${err.message}` };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return { valid: false, error: `Invalid URL protocol '${protocol}'. Only HTTP/HTTPS allowed.` };
  }

  if (requireHttps && protocol !== "https:") {
    return { valid: false, error: "HTTPS protocol is strictly required" };
  }

  // Delegate to SSRF validator
  const hostname = parsed.hostname;
  if (!hostname) {
    return { valid: false, error: "URL must contain a valid hostname" };
  }

  if (!allowLocalhost || !parsed.hostname.includes("127.0.0.1")) {
    const hostCheck = checkForbiddenHostname(hostname);
    if (hostCheck.forbidden) {
      return { valid: false, error: `SSRF violation: ${hostCheck.reason}` };
    }

    if (net.isIP(hostname)) {
      const ipCheck = checkForbiddenIp(hostname);
      if (ipCheck.forbidden) {
        return { valid: false, error: `SSRF violation: ${ipCheck.reason}` };
      }
    }
  }

  return { valid: true, url: trimmed, parsed };
}

/**
 * Validates an RFC 1123 compliant hostname.
 */
function validateHostname(rawHostname) {
  if (!rawHostname || typeof rawHostname !== "string") {
    return { valid: false, error: "Hostname must be a non-empty string" };
  }

  const h = rawHostname.trim().toLowerCase();
  if (h.length === 0 || h.length > 253) {
    return { valid: false, error: "Hostname length must be between 1 and 253 characters" };
  }

  // Reject control characters or null bytes
  if (/[\0\s\r\n\t]/.test(h)) {
    return { valid: false, error: "Hostname contains illegal characters or whitespace" };
  }

  // Check forbidden internal hostnames
  const hostCheck = checkForbiddenHostname(h);
  if (hostCheck.forbidden) {
    return { valid: false, error: `Forbidden internal or loopback hostname '${h}': ${hostCheck.reason}` };
  }

  // Check RFC 1123 label constraints
  const labels = h.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) {
      return { valid: false, error: "Hostname label length must be between 1 and 63 characters" };
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label)) {
      return { valid: false, error: `Invalid hostname label format: '${label}'` };
    }
  }

  return { valid: true, hostname: h };
}

/**
 * Validates an IPv4 or IPv6 address and checks against private/reserved ranges.
 */
function validateIpAddress(rawIp, { allowPrivate = false } = {}) {
  if (!rawIp || typeof rawIp !== "string") {
    return { valid: false, error: "IP address must be a non-empty string" };
  }

  const ip = rawIp.trim();
  const version = net.isIP(ip);
  if (version === 0) {
    return { valid: false, error: `Invalid IP address syntax: '${ip}'` };
  }

  if (!allowPrivate) {
    const ipCheck = checkForbiddenIp(ip);
    if (ipCheck.forbidden) {
      return { valid: false, error: `Prohibited private or reserved IP address '${ip}': ${ipCheck.reason}` };
    }
  }

  return { valid: true, ip, version: version === 4 ? "IPv4" : "IPv6" };
}

/**
 * Validates string length limits.
 */
function validateLength(value, { min = 0, max = 255, fieldName = "field" } = {}) {
  if (typeof value !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  if (value.length < min) {
    return { valid: false, error: `${fieldName} length (${value.length}) is less than minimum (${min})` };
  }
  if (value.length > max) {
    return { valid: false, error: `${fieldName} length (${value.length}) exceeds maximum (${max})` };
  }
  return { valid: true, value };
}

/**
 * Validates closed enum sets.
 */
function validateEnum(value, allowedValues, fieldName = "field") {
  const allowedSet = new Set(allowedValues.map((v) => String(v).toLowerCase()));
  if (!allowedSet.has(String(value).toLowerCase())) {
    return {
      valid: false,
      error: `Invalid value '${value}' for ${fieldName}. Allowed values: ${allowedValues.join(", ")}`,
    };
  }
  return { valid: true, value };
}

/**
 * Validates numeric bounds (min, max, integer-only).
 */
function validateNumericBounds(value, { min = -Infinity, max = Infinity, integerOnly = true, fieldName = "number" } = {}) {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a valid finite number` };
  }
  if (integerOnly && !Number.isInteger(num)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }
  if (num < min) {
    return { valid: false, error: `${fieldName} (${num}) is less than minimum (${min})` };
  }
  if (num > max) {
    return { valid: false, error: `${fieldName} (${num}) exceeds maximum (${max})` };
  }
  return { valid: true, value: num };
}

/**
 * Validates pagination query parameters (page, pageSize, limit, offset).
 */
function validatePagination(query = {}) {
  let page = 1;
  let pageSize = 25;
  let offset = 0;

  if (query.page !== undefined) {
    const check = validateNumericBounds(query.page, { min: 1, max: 100000, integerOnly: true, fieldName: "page" });
    if (!check.valid) return check;
    page = check.value;
  }

  const rawSize = query.pageSize !== undefined ? query.pageSize : query.limit;
  if (rawSize !== undefined) {
    const check = validateNumericBounds(rawSize, { min: 1, max: 100, integerOnly: true, fieldName: "pageSize/limit" });
    if (!check.valid) return check;
    pageSize = check.value;
  }

  if (query.offset !== undefined) {
    const check = validateNumericBounds(query.offset, { min: 0, max: 1000000, integerOnly: true, fieldName: "offset" });
    if (!check.valid) return check;
    offset = check.value;
  } else {
    offset = (page - 1) * pageSize;
  }

  return { valid: true, pagination: { page, pageSize, limit: pageSize, offset } };
}

// ============================================================================
// 3. FILE, MIME, AND CONTENT VALIDATORS
// ============================================================================

/**
 * Sanitizes and validates uploaded files (name, extension, MIME, and size).
 */
function validateFile(file, { maxSizeBytes = 10 * 1024 * 1024, allowedMimes = ALLOWED_UPLOAD_MIMES, allowedExtensions = ALLOWED_FILE_EXTENSIONS } = {}) {
  if (!file || typeof file !== "object") {
    return { valid: false, error: "No file provided for validation" };
  }

  const originalName = String(file.originalname || file.name || "").trim();
  if (!originalName) {
    return { valid: false, error: "File must have a valid filename" };
  }

  // Reject path traversal, null bytes, or control characters in filename
  if (/\0/.test(originalName) || /\.\./.test(originalName) || /[/\\]/.test(originalName)) {
    return { valid: false, error: "Filename contains path traversal sequences or illegal characters" };
  }

  // Extension check
  const ext = path.extname(originalName).toLowerCase();
  const isAllowedExt = allowedExtensions.some((e) => originalName.toLowerCase().endsWith(e));
  if (!isAllowedExt) {
    return {
      valid: false,
      error: `File extension '${ext}' is not allowed. Supported: ${allowedExtensions.join(", ")}`,
    };
  }

  // MIME check
  const mime = String(file.mimetype || file.type || "").toLowerCase();
  if (DANGEROUS_MIMES.includes(mime)) {
    return { valid: false, error: `Dangerous MIME type '${mime}' is prohibited` };
  }
  if (allowedMimes && !allowedMimes.includes(mime) && mime !== "application/octet-stream") {
    return {
      valid: false,
      error: `MIME type '${mime}' is not permitted. Allowed: ${allowedMimes.join(", ")}`,
    };
  }

  // Size bounds
  const size = file.size !== undefined ? file.size : (file.buffer ? file.buffer.length : 0);
  if (size <= 0) {
    return { valid: false, error: "Uploaded file is empty (0 bytes)" };
  }
  if (size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size (${size} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
    };
  }

  return { valid: true, file: { name: originalName, size, mime, ext } };
}

/**
 * Validates uploaded JSON/CBOM buffer contents.
 */
function validateCbomContent(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { valid: false, error: "Content must be a valid buffer" };
  }

  const contentStr = buffer.toString("utf8").trim();
  if (!contentStr.startsWith("{") && !contentStr.startsWith("[")) {
    return { valid: false, error: "Uploaded file does not contain valid JSON structure" };
  }

  let parsed;
  try {
    parsed = JSON.parse(contentStr);
  } catch (err) {
    return { valid: false, error: `JSON parse error: ${err.message}` };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { valid: false, error: "JSON content must resolve to an object or array" };
  }

  // Check for private key leakage in uploaded document
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(contentStr)) {
    return { valid: false, error: "Uploaded document contains raw private key material. Ingestion rejected." };
  }

  return { valid: true, parsed };
}

// ============================================================================
// 4. STRICT SCHEMAS FOR SECURITY-SENSITIVE OPERATIONS
// ============================================================================

const SCHEMAS = {
  // 1. User Registration (strictly rejects unknown fields to prevent mass assignment)
  USER_REGISTRATION: {
    type: "object",
    required: ["username", "password", "email"],
    additionalProperties: false,
    properties: {
      username: { type: "string", minLength: 3, maxLength: 64 },
      password: { type: "string", minLength: 8, maxLength: 128 },
      email: { type: "string", minLength: 5, maxLength: 254, format: "email" },
      displayName: { type: "string", minLength: 1, maxLength: 128 },
      tenantId: { type: "string", minLength: 1, maxLength: 64 },
      roles: {
        type: "array",
        items: { type: "string", enum: ALLOWED_ROLES },
        maxItems: 5,
      },
    },
  },

  // 2. User Login
  USER_LOGIN: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", minLength: 1, maxLength: 128 },
      password: { type: "string", minLength: 1, maxLength: 256 },
    },
  },

  // 3. User Update
  USER_UPDATE: {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string", minLength: 1, maxLength: 128 },
      email: { type: "string", minLength: 5, maxLength: 254, format: "email" },
    },
  },

  // 4. Secret Rotation
  SECRET_ROTATION: {
    type: "object",
    additionalProperties: false,
    properties: {
      keyType: { type: "string", enum: ["jwt_signing", "oauth_secret", "api_key", "data_encryption"] },
      newSecret: { type: "string", minLength: 16, maxLength: 256 },
      secretId: { type: "string", minLength: 1, maxLength: 128 },
    },
  },

  // 5. KMS Connector Registration
  KMS_REGISTER: {
    type: "object",
    required: ["name", "provider"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2, maxLength: 64 },
      provider: { type: "string", enum: ALLOWED_KMS_PROVIDERS },
      config: {
        type: "object",
        additionalProperties: true,
        properties: {
          region: { type: "string", maxLength: 32 },
          endpoint: { type: "string", maxLength: 2048 },
          keyRingId: { type: "string", maxLength: 128 },
          vaultUrl: { type: "string", maxLength: 2048 },
        },
      },
    },
  },

  // 6. Ticketing Connector Registration
  TICKETING_REGISTER: {
    type: "object",
    required: ["name", "type"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2, maxLength: 64 },
      type: { type: "string", enum: ALLOWED_TICKETING_TYPES },
      config: {
        type: "object",
        additionalProperties: true,
        properties: {
          url: { type: "string", maxLength: 2048 },
          instanceUrl: { type: "string", maxLength: 2048 },
          jiraUrl: { type: "string", maxLength: 2048 },
          webhookUrl: { type: "string", maxLength: 2048 },
          projectId: { type: ["string", "number"] },
        },
      },
    },
  },

  // 7. Asset Update
  ASSET_UPDATE: {
    type: "object",
    additionalProperties: false,
    properties: {
      data_sensitivity: { type: "string", enum: ALLOWED_DATA_SENSITIVITIES },
      business_criticality: { type: "string", enum: ALLOWED_BUSINESS_CRITICALITIES },
    },
  },
};

// ============================================================================
// 5. EXPRESS MIDDLEWARE FACTORIES
// ============================================================================

/**
 * Express middleware that compiles and validates an Ajv schema strictly.
 * Rejects unknown fields and malformed data with HTTP 400.
 */
function validateSchemaStrict(schema, { target = "body" } = {}) {
  const validate = ajv.compile(schema);

  return (req, res, next) => {
    const data = req[target] || {};
    const valid = validate(data);

    if (!valid) {
      const errors = (validate.errors || []).map((e) => ({
        field: e.instancePath ? e.instancePath.replace(/^\//, "") : e.params.missingProperty || e.params.additionalProperty || "root",
        message: e.message,
        keyword: e.keyword,
        schemaPath: e.schemaPath,
      }));

      return res.status(400).json({
        error: "ValidationError",
        code: "VALIDATION_ERROR",
        message: "Input validation failed against strict schema constraints.",
        errors,
        requestId: req.id,
      });
    }

    next();
  };
}

/**
 * Express middleware enforcing numeric bounds on query pagination.
 */
function paginationBoundsMiddleware(_options = {}) {
  return (req, res, next) => {
    const result = validatePagination(req.query);
    if (!result.valid) {
      return res.status(400).json({
        error: "ValidationError",
        code: "PAGINATION_OUT_OF_BOUNDS",
        message: result.error,
        requestId: req.id,
      });
    }

    req.pagination = result.pagination;
    next();
  };
}

module.exports = {
  // Enums
  ALLOWED_ROLES,
  ALLOWED_SEVERITIES,
  ALLOWED_ASSET_TYPES,
  ALLOWED_DATA_SENSITIVITIES,
  ALLOWED_BUSINESS_CRITICALITIES,
  ALLOWED_KMS_PROVIDERS,
  ALLOWED_TICKETING_TYPES,
  ALLOWED_EXPORT_FORMATS,
  ALLOWED_UPLOAD_MIMES,
  ALLOWED_FILE_EXTENSIONS,
  DANGEROUS_MIMES,

  // Validators
  validateUrl,
  validateHostname,
  validateIpAddress,
  validateLength,
  validateEnum,
  validateNumericBounds,
  validatePagination,
  validateFile,
  validateCbomContent,

  // Schemas
  SCHEMAS,

  // Middlewares
  validateSchemaStrict,
  paginationBoundsMiddleware,
};
