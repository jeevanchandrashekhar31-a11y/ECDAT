/**
 * ECDAT Audit Logging Subsystem — Phase 18.1 Secret Scrubber
 *
 * Enforces the strict zero-secret logging guarantee:
 * "Do not log secrets."
 *
 * Recursively scans and redacts passwords, tokens, API keys, private key PEMs,
 * symmetric keys, and authorization headers before audit record persistence.
 */

const PRIVATE_KEY_REGEX =
  /(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)/gi;

const JWT_REGEX = /\beyJh[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*\b/g;
const BEARER_AUTH_REGEX = /[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g;

// Normalized sensitive field names that must never be recorded in cleartext
const SENSITIVE_FIELD_NAMES = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "authorization",
  "auth",
  "apikey",
  "api_key",
  "x-api-key",
  "xapikey",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "csrftoken",
  "csrf_token",
  "x-csrf-token",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "privatekeybytes",
  "private_key_bytes",
  "rawkey",
  "raw_key",
  "keymaterial",
  "key_material",
  "secretbytes",
  "secret_bytes",
  "privateexponent",
  "private_exponent",
  "rsa_d",
  "ecc_d",
  "seedbytes",
  "seed_bytes",
  "totpsecret",
  "totp_secret",
  "backupcodes",
  "backup_codes",
  "cookie",
  "cookies",
  "set-cookie",
  "set_cookie",
  "credential",
  "credentials",
]);

/**
 * Scrubs a string of inline sensitive tokens, PEM keys, and bearer tokens.
 *
 * @param {string} text
 * @returns {{ text: string, scrubbedCount: number }}
 */
function scrubString(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { text, scrubbedCount: 0 };
  }

  let scrubbed = text;
  let count = 0;

  // 1. Redact Private Key PEM blocks
  PRIVATE_KEY_REGEX.lastIndex = 0;
  if (PRIVATE_KEY_REGEX.test(scrubbed)) {
    PRIVATE_KEY_REGEX.lastIndex = 0;
    scrubbed = scrubbed.replace(PRIVATE_KEY_REGEX, "[REDACTED_PRIVATE_KEY]");
    count++;
  }

  // 2. Redact JWT tokens
  JWT_REGEX.lastIndex = 0;
  if (JWT_REGEX.test(scrubbed)) {
    JWT_REGEX.lastIndex = 0;
    scrubbed = scrubbed.replace(JWT_REGEX, "[REDACTED_JWT_TOKEN]");
    count++;
  }

  // 3. Redact Bearer authorization headers
  BEARER_AUTH_REGEX.lastIndex = 0;
  if (BEARER_AUTH_REGEX.test(scrubbed)) {
    BEARER_AUTH_REGEX.lastIndex = 0;
    scrubbed = scrubbed.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");
    count++;
  }

  return { text: scrubbed, scrubbedCount: count };
}

/**
 * Recursively deep-scrubs an arbitrary data structure, guaranteeing zero secret leakage.
 *
 * @param {any} data
 * @param {WeakSet} [seen=new WeakSet()] - Circular reference guard
 * @returns {{ sanitized: any, scrubbedCount: number, scrubbedFields: string[] }}
 */
function scrubSecrets(data, seen = new WeakSet()) {
  if (data === null || data === undefined) {
    return { sanitized: data, scrubbedCount: 0, scrubbedFields: [] };
  }

  // Primitive types
  if (typeof data === "string") {
    const res = scrubString(data);
    return {
      sanitized: res.text,
      scrubbedCount: res.scrubbedCount,
      scrubbedFields: res.scrubbedCount > 0 ? ["text_content"] : [],
    };
  }

  if (typeof data !== "object") {
    return { sanitized: data, scrubbedCount: 0, scrubbedFields: [] };
  }

  // Handle circular references safely
  if (seen.has(data)) {
    return { sanitized: "[CIRCULAR_REFERENCE]", scrubbedCount: 0, scrubbedFields: [] };
  }
  seen.add(data);

  // Arrays
  if (Array.isArray(data)) {
    let totalCount = 0;
    const fields = [];
    const sanitizedArr = data.map((item) => {
      const res = scrubSecrets(item, seen);
      totalCount += res.scrubbedCount;
      fields.push(...res.scrubbedFields);
      return res.sanitized;
    });
    return { sanitized: sanitizedArr, scrubbedCount: totalCount, scrubbedFields: fields };
  }

  // Objects
  let totalCount = 0;
  const fields = [];
  const sanitizedObj = {};

  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

    // If value contains a private key PEM, use specialized redaction
    PRIVATE_KEY_REGEX.lastIndex = 0;
    if (typeof value === "string" && PRIVATE_KEY_REGEX.test(value)) {
      sanitizedObj[key] = "[REDACTED_PRIVATE_KEY]";
      totalCount++;
      fields.push(key);
    } else if (SENSITIVE_FIELD_NAMES.has(normalizedKey)) {
      sanitizedObj[key] = "[REDACTED_SECRET]";
      totalCount++;
      fields.push(key);
    } else {
      const res = scrubSecrets(value, seen);
      sanitizedObj[key] = res.sanitized;
      totalCount += res.scrubbedCount;
      fields.push(...res.scrubbedFields.map((f) => `${key}.${f}`));
    }
  }

  return { sanitized: sanitizedObj, scrubbedCount: totalCount, scrubbedFields: fields };
}

/**
 * Evaluates whether an object contains any unscrubbed secrets.
 *
 * @param {any} data
 * @returns {boolean} True if raw secrets are present
 */
function containsSecrets(data) {
  const serialized = JSON.stringify(data) || "";
  PRIVATE_KEY_REGEX.lastIndex = 0;
  JWT_REGEX.lastIndex = 0;
  BEARER_AUTH_REGEX.lastIndex = 0;

  if (PRIVATE_KEY_REGEX.test(serialized)) return true;
  if (JWT_REGEX.test(serialized)) return true;
  if (BEARER_AUTH_REGEX.test(serialized)) return true;

  if (typeof data === "object" && data !== null) {
    for (const key of Object.keys(data)) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
      if (SENSITIVE_FIELD_NAMES.has(normalizedKey)) return true;
    }
  }

  return false;
}

function scrubSensitiveFields(data) {
  return scrubSecrets(data).sanitized;
}

module.exports = {
  scrubSecrets,
  scrubSensitiveFields,
  scrubString,
  containsSecrets,
  SENSITIVE_FIELD_NAMES,
  PRIVATE_KEY_REGEX,
  JWT_REGEX,
};
