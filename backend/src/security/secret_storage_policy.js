/**
 * ECDAT Secret Storage Policy & Zero-Secret Invariant Validator — Phase 16.1
 *
 * Enforces the core invariant:
 * "Never store secret/key contents unless there is a documented, unavoidable requirement."
 *
 * Invariants:
 * 1. Raw private cryptographic keys (RSA, ECC, Ed25519, OpenSSH, PGP) are strictly FORBIDDEN
 *    from being persisted anywhere in ECDAT (database, CBOMs, assets, findings, logs).
 * 2. If private key material is detected in ingested data, it is either rejected with a
 *    SecurityViolation error or scrubbed with an audit log.
 * 3. Documented Exceptions are strictly enumerated, audited, and require field-level encryption
 *    at rest (AES-256-GCM) with key rotation support.
 */

// Regex covering standard private key formats and headers
const PRIVATE_KEY_REGEX =
  /(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)/gi;

// Sensitive private key parameter names that indicate cryptographic secret material
const FORBIDDEN_SECRET_KEY_FIELDS = new Set([
  "privatekey",
  "private_key",
  "privatekeybytes",
  "private_key_bytes",
  "secretbytes",
  "secret_bytes",
  "rawkey",
  "raw_key",
  "keymaterial",
  "key_material",
  "privateexponent",
  "private_exponent",
  "rsa_d",
  "ecc_d",
  "seed_bytes",
]);

/**
 * Registry of Documented, Unavoidable Requirements for Storing Secret Material.
 * Any secret storage outside this registry is strictly prohibited.
 */
const DOCUMENTED_STORAGE_EXCEPTIONS = new Map([
  [
    "INTEGRATION_CREDENTIAL_STORAGE",
    {
      id: "INTEGRATION_CREDENTIAL_STORAGE",
      title: "Outbound 3rd-Party Integration Credentials",
      rationale:
        "ECDAT must authenticate to customer-managed external systems (Cloud KMS, Vault Transit, Jira, ServiceNow, GitHub, GitLab, Webhooks) to discover key metadata and synchronize tickets.",
      allowedEntities: ["integrations.kms", "integrations.ticketing", "integrations.webhook"],
      allowedSecretTypes: ["api_token", "client_secret", "access_key", "password", "hmac_signing_key"],
      mandatoryControls: [
        "MUST be encrypted at rest using AES-256-GCM field-level encryption",
        "MUST use random 96-bit IV and 128-bit authentication tag",
        "MUST NEVER be logged or included in debug traces",
        "MUST be masked in API responses",
        "MUST support credential rotation with versioning",
      ],
      approvedBy: "ECDAT Architecture Security Review Board",
      reviewDate: "2026-09-05",
    },
  ],
  [
    "MFA_TOTP_SECRET_STORAGE",
    {
      id: "MFA_TOTP_SECRET_STORAGE",
      title: "User Multi-Factor Authentication TOTP Seeds",
      rationale:
        "ECDAT must verify RFC 6238 TOTP codes submitted by users during authentication against the shared base32 seed.",
      allowedEntities: ["identity.users", "identity.mfa"],
      allowedSecretTypes: ["totp_seed", "recovery_code_hash"],
      mandatoryControls: [
        "MUST be encrypted at rest using AES-256-GCM",
        "MUST NOT be returned in API responses after initial user enrollment QR display",
        "MUST be bound to tenant and user identity",
      ],
      approvedBy: "ECDAT Identity & Security Team",
      reviewDate: "2026-09-05",
    },
  ],
  [
    "SESSION_SIGNING_KEY_STORAGE",
    {
      id: "SESSION_SIGNING_KEY_STORAGE",
      title: "JWT Token Signing Keys in Secret Manager",
      rationale:
        "ECDAT TokenService requires active and grace-period JWT signing keys to sign and verify user session tokens.",
      allowedEntities: ["identity.secret_manager"],
      allowedSecretTypes: ["hmac_sha256_key", "asymmetric_private_key"],
      mandatoryControls: [
        "Managed by dedicated SecretManager with Kid indexing",
        "Automated rotation with dual-key overlapping grace periods",
        "Never exported through public API endpoints",
      ],
      approvedBy: "ECDAT Cryptographic Architecture Review",
      reviewDate: "2026-09-05",
    },
  ],
]);

class ProhibitedSecretStorageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProhibitedSecretStorageError";
    this.code = "ERR_PROHIBITED_SECRET_STORAGE";
    this.details = details;
  }
}

/**
 * Recursively inspects an object or string for private key headers or prohibited secret fields.
 *
 * @param {any} data
 * @param {string} [currentPath=""]
 * @returns {Array<{ path: string, type: string, description: string }>} Detected secret violations
 */
function detectSecrets(data, currentPath = "") {
  const detected = [];
  if (data === null || data === undefined) return detected;

  // 1. String inspection for PEM private key headers
  if (typeof data === "string") {
    PRIVATE_KEY_REGEX.lastIndex = 0;
    if (PRIVATE_KEY_REGEX.test(data)) {
      detected.push({
        path: currentPath || "root",
        type: "PRIVATE_KEY_PEM",
        description: "Private cryptographic key header detected in string data.",
      });
    }
    return detected;
  }

  // 2. Array inspection
  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const childPath = `${currentPath}[${index}]`;
      detected.push(...detectSecrets(item, childPath));
    });
    return detected;
  }

  // 3. Object inspection for forbidden keys and string values
  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

      // Check if the property name itself indicates raw private key material
      if (FORBIDDEN_SECRET_KEY_FIELDS.has(normalizedKey)) {
        detected.push({
          path: childPath,
          type: "FORBIDDEN_KEY_FIELD",
          description: `Forbidden secret key field '${key}' detected. Private key storage is prohibited.`,
        });
      }

      detected.push(...detectSecrets(value, childPath));
    }
  }

  return detected;
}

/**
 * Recursively scrubs private key material from data, replacing it with a redaction marker.
 *
 * @param {any} data
 * @param {string} [currentPath=""]
 * @returns {{ sanitized: any, scrubbedCount: number, scrubbedPaths: string[] }}
 */
function scrubSecrets(data, currentPath = "") {
  if (data === null || data === undefined) {
    return { sanitized: data, scrubbedCount: 0, scrubbedPaths: [] };
  }

  if (typeof data === "string") {
    PRIVATE_KEY_REGEX.lastIndex = 0;
    if (PRIVATE_KEY_REGEX.test(data)) {
      PRIVATE_KEY_REGEX.lastIndex = 0;
      const sanitized = data.replace(PRIVATE_KEY_REGEX, "[REDACTED_PROHIBITED_PRIVATE_KEY]");
      return { sanitized, scrubbedCount: 1, scrubbedPaths: [currentPath || "root"] };
    }
    return { sanitized: data, scrubbedCount: 0, scrubbedPaths: [] };
  }

  if (Array.isArray(data)) {
    let totalCount = 0;
    const paths = [];
    const sanitizedArr = data.map((item, idx) => {
      const res = scrubSecrets(item, `${currentPath}[${idx}]`);
      totalCount += res.scrubbedCount;
      paths.push(...res.scrubbedPaths);
      return res.sanitized;
    });
    return { sanitized: sanitizedArr, scrubbedCount: totalCount, scrubbedPaths: paths };
  }

  if (typeof data === "object") {
    let totalCount = 0;
    const paths = [];
    const sanitizedObj = {};

    for (const [key, value] of Object.entries(data)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

      if (FORBIDDEN_SECRET_KEY_FIELDS.has(normalizedKey)) {
        sanitizedObj[key] = "[REDACTED_PROHIBITED_KEY_FIELD]";
        totalCount += 1;
        paths.push(childPath);
      } else {
        const res = scrubSecrets(value, childPath);
        sanitizedObj[key] = res.sanitized;
        totalCount += res.scrubbedCount;
        paths.push(...res.scrubbedPaths);
      }
    }

    return { sanitized: sanitizedObj, scrubbedCount: totalCount, scrubbedPaths: paths };
  }

  return { sanitized: data, scrubbedCount: 0, scrubbedPaths: [] };
}

/**
 * Asserts that the data conforms to the Zero-Secret-Storage Invariant.
 *
 * @param {string} entityType - e.g. 'scans', 'cboms', 'assets', 'findings', 'integrations.kms'
 * @param {any} data - Object or payload being prepared for storage
 * @param {object} [options]
 * @param {string} [options.exceptionId] - Documented exception identifier if applicable
 * @param {boolean} [options.throwOnViolation=true] - Whether to throw an error or return validation result
 * @returns {{ valid: boolean, violations: Array<object>, allowedException: object|null }}
 */
function assertStorageAllowed(entityType, data, { exceptionId = null, throwOnViolation = true } = {}) {
  const violations = detectSecrets(data);

  // Private key material (PEM or forbidden private key fields) NEVER has any storage exception
  if (violations.length > 0) {
    if (throwOnViolation) {
      throw new ProhibitedSecretStorageError(
        `Security Policy Violation: Attempted to store prohibited secret/key material in '${entityType}'. Zero-Secret-Storage policy strictly prohibits persisting private keys.`,
        { entityType, violations }
      );
    }
    return { valid: false, violations, allowedException: null };
  }

  // If an exception was claimed, verify it is documented and permitted for this entity
  let allowedException = null;
  if (exceptionId) {
    const exception = DOCUMENTED_STORAGE_EXCEPTIONS.get(exceptionId);
    if (!exception) {
      const err = new ProhibitedSecretStorageError(
        `Invalid Exception: '${exceptionId}' is not a recognized documented unavoidable requirement.`,
        { entityType, exceptionId }
      );
      if (throwOnViolation) throw err;
      return { valid: false, violations: [{ path: "exceptionId", description: err.message }], allowedException: null };
    }

    const matchesEntity = exception.allowedEntities.some(
      (e) => entityType === e || entityType.startsWith(e + ".") || entityType.startsWith(e)
    );

    if (!matchesEntity) {
      const err = new ProhibitedSecretStorageError(
        `Exception Mismatch: '${exceptionId}' is not permitted for entity '${entityType}'. Permitted: ${exception.allowedEntities.join(", ")}`,
        { entityType, exceptionId, allowedEntities: exception.allowedEntities }
      );
      if (throwOnViolation) throw err;
      return { valid: false, violations: [{ path: "entityType", description: err.message }], allowedException: null };
    }

    allowedException = exception;
  }

  return { valid: true, violations: [], allowedException };
}

/**
 * Returns all registered documented storage exceptions.
 */
function getDocumentedExceptions() {
  return Array.from(DOCUMENTED_STORAGE_EXCEPTIONS.values());
}

/**
 * Registers a new formally documented unavoidable requirement for secret storage.
 * Requires rigorous review and rationale.
 */
function registerDocumentedException(exceptionDefinition) {
  const { id, title, rationale, allowedEntities, allowedSecretTypes, mandatoryControls, approvedBy } =
    exceptionDefinition || {};

  if (!id || !title || !rationale || !Array.isArray(allowedEntities) || !approvedBy) {
    throw new Error(
      "registerDocumentedException requires 'id', 'title', 'rationale', 'allowedEntities', and 'approvedBy'"
    );
  }

  DOCUMENTED_STORAGE_EXCEPTIONS.set(id, {
    id,
    title,
    rationale,
    allowedEntities: [...allowedEntities],
    allowedSecretTypes: Array.isArray(allowedSecretTypes) ? [...allowedSecretTypes] : [],
    mandatoryControls: Array.isArray(mandatoryControls) ? [...mandatoryControls] : [],
    approvedBy,
    reviewDate: new Date().toISOString().split("T")[0],
  });
}

module.exports = {
  PRIVATE_KEY_REGEX,
  FORBIDDEN_SECRET_KEY_FIELDS,
  DOCUMENTED_STORAGE_EXCEPTIONS,
  ProhibitedSecretStorageError,
  detectSecrets,
  scrubSecrets,
  assertStorageAllowed,
  getDocumentedExceptions,
  registerDocumentedException,
};
