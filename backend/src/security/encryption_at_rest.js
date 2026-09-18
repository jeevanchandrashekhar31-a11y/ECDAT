/**
 * ECDAT Authenticated Encryption at Rest Engine — Phase 16.1
 *
 * Implements AES-256-GCM authenticated encryption for sensitive data at rest.
 *
 * Specifications:
 * - Cipher: AES-256-GCM (NIST SP 800-38D)
 * - Key Length: 256 bits (32 bytes)
 * - IV: 96 bits (12 bytes) cryptographically random per operation
 * - Tag: 128 bits (16 bytes) authentication tag for integrity verification
 * - Serialization Format: `enc:v1:<kid>:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 * - Additional Authenticated Data (AAD): Optional context binding (e.g. tenant_id, entity_id)
 * - Key Management: Keyring supporting key versioning (kid) and rotation with retirement grace periods
 */

const crypto = require("crypto");
const { classifyField, CLASSIFICATION_TIERS } = require("./data_classification");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128 bits
const CIPHERTEXT_PREFIX = "enc:v1:";

class EncryptionAtRestError extends Error {
  constructor(message, code = "ERR_ENCRYPTION_AT_REST") {
    super(message);
    this.name = "EncryptionAtRestError";
    this.code = code;
  }
}

class EncryptionAtRestService {
  /**
   * @param {object} [options]
   * @param {string|Buffer} [options.masterKey] - 32-byte master key or hex/base64 string
   * @param {string} [options.masterKid="key_v1"] - Identifier for initial master key
   */
  constructor(options = {}) {
    // Map of kid -> { kid, keyBuffer, status: 'active' | 'retired', createdAt }
    this.keyring = new Map();
    this.activeKid = options.masterKid || "key_v1";

    const initialKey = options.masterKey || process.env.DATA_ENCRYPTION_KEY;
    if (initialKey) {
      this.addKey(this.activeKid, initialKey, "active");
    } else {
      // Default deterministic dev key for fallback if not provided in dev/test
      const devKey = crypto.createHash("sha256").update("ecdat-dev-master-encryption-key-2026").digest();
      this.addKey(this.activeKid, devKey, "active");
    }
  }

  /**
   * Normalizes a 32-byte key buffer from raw Buffer, hex string, base64 string, or passphrase.
   * @param {string|Buffer} keyInput
   * @returns {Buffer}
   */
  normalizeKey(keyInput) {
    if (Buffer.isBuffer(keyInput)) {
      if (keyInput.length !== 32) {
        throw new EncryptionAtRestError(`Encryption key must be exactly 32 bytes (received ${keyInput.length} bytes)`);
      }
      return keyInput;
    }

    if (typeof keyInput === "string") {
      const trimmed = keyInput.trim();
      // Hex (64 chars)
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, "hex");
      }
      // Base64 (44 chars)
      if (/^[A-Za-z0-9+/=]{44}$/.test(trimmed)) {
        const buf = Buffer.from(trimmed, "base64");
        if (buf.length === 32) return buf;
      }
      // Derive 32-byte key using SHA-256
      return crypto.createHash("sha256").update(trimmed).digest();
    }

    throw new EncryptionAtRestError("Invalid key type: expected Buffer or string");
  }

  /**
   * Adds a key to the keyring.
   *
   * @param {string} kid
   * @param {string|Buffer} keyInput
   * @param {string} [status="active"]
   */
  addKey(kid, keyInput, status = "active") {
    if (!kid || typeof kid !== "string") {
      throw new EncryptionAtRestError("Key ID (kid) must be a non-empty string");
    }
    const keyBuffer = this.normalizeKey(keyInput);

    if (status === "active") {
      // Demote existing active keys to retired
      for (const entry of this.keyring.values()) {
        if (entry.status === "active") {
          entry.status = "retired";
        }
      }
      this.activeKid = kid;
    }

    this.keyring.set(kid, {
      kid,
      keyBuffer,
      status,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Gets key entry by kid.
   * @param {string} kid
   * @returns {Buffer}
   */
  getKey(kid) {
    const entry = this.keyring.get(kid);
    if (!entry) {
      throw new EncryptionAtRestError(`No encryption key found for kid '${kid}'`, "ERR_UNKNOWN_KID");
    }
    return entry.keyBuffer;
  }

  /**
   * Rotates master encryption key, setting the new key as active.
   *
   * @param {string|Buffer} newKeyInput
   * @param {string} [newKid]
   * @returns {{ oldKid: string, newKid: string, rotatedAt: string }}
   */
  rotateKey(newKeyInput, newKid) {
    const oldKid = this.activeKid;
    const kid = newKid || `key_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    this.addKey(kid, newKeyInput, "active");

    return {
      oldKid,
      newKid: kid,
      rotatedAt: new Date().toISOString(),
    };
  }

  /**
   * Securely destroys and zeroizes a key buffer in memory.
   * @param {string} kid
   * @returns {boolean}
   */
  destroyKey(kid) {
    const entry = this.keyring.get(kid);
    if (!entry) return false;
    if (Buffer.isBuffer(entry.keyBuffer)) {
      entry.keyBuffer.fill(0);
    }
    this.keyring.delete(kid);
    return true;
  }

  /**
   * Securely wipes all key buffers in the keyring.
   */
  clearKeyring() {
    for (const entry of this.keyring.values()) {
      if (Buffer.isBuffer(entry.keyBuffer)) {
        entry.keyBuffer.fill(0);
      }
    }
    this.keyring.clear();
  }

  /**
   * Checks whether a value is already formatted as an ECDAT encrypted string.
   * @param {any} value
   * @returns {boolean}
   */
  isEncrypted(value) {
    if (typeof value !== "string") return false;
    if (!value.startsWith(CIPHERTEXT_PREFIX)) return false;
    const parts = value.slice(CIPHERTEXT_PREFIX.length).split(":");
    return parts.length === 4; // kid:iv:tag:ciphertext
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   *
   * @param {string|object} plaintext - String or JSON-serializable object
   * @param {object} [options]
   * @param {string} [options.kid] - Key ID to use (defaults to activeKid)
   * @param {string|object} [options.aad] - Additional Authenticated Data to bind
   * @returns {string} Encrypted token in format `enc:v1:<kid>:<iv_b64>:<tag_b64>:<ciphertext_b64>`
   */
  encrypt(plaintext, options = {}) {
    if (plaintext === null || plaintext === undefined) {
      return plaintext;
    }

    // Prevent double encryption
    if (this.isEncrypted(plaintext)) {
      return plaintext;
    }

    const kid = options.kid || this.activeKid;
    const key = this.getKey(kid);

    const payload = typeof plaintext === "object" ? JSON.stringify(plaintext) : String(plaintext);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    if (options.aad) {
      const aadStr = typeof options.aad === "object" ? JSON.stringify(options.aad) : String(options.aad);
      cipher.setAAD(Buffer.from(aadStr, "utf8"));
    }

    let encrypted = cipher.update(payload, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    const ivB64 = iv.toString("base64");
    const tagB64 = tag.toString("base64");
    const ciphertextB64 = encrypted.toString("base64");

    return `${CIPHERTEXT_PREFIX}${kid}:${ivB64}:${tagB64}:${ciphertextB64}`;
  }

  /**
   * Decrypts an ECDAT encrypted token using AES-256-GCM.
   *
   * @param {string} encryptedString
   * @param {object} [options]
   * @param {string|object} [options.aad] - Additional Authenticated Data used during encryption
   * @param {boolean} [options.parseJson=false] - Attempt JSON parsing of decrypted string
   * @returns {string|object}
   */
  decrypt(encryptedString, options = {}) {
    if (!this.isEncrypted(encryptedString)) {
      return encryptedString;
    }

    const payload = encryptedString.slice(CIPHERTEXT_PREFIX.length);
    const [kid, ivB64, tagB64, ciphertextB64] = payload.split(":");

    if (!kid || !ivB64 || !tagB64 || !ciphertextB64) {
      throw new EncryptionAtRestError("Malformed encrypted string structure", "ERR_INVALID_CIPHERTEXT");
    }

    const key = this.getKey(kid);
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    if (iv.length !== IV_LENGTH) {
      throw new EncryptionAtRestError(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new EncryptionAtRestError(`Invalid Auth Tag length: expected ${TAG_LENGTH}, got ${tag.length}`);
    }

    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAuthTag(tag);

      if (options.aad) {
        const aadStr = typeof options.aad === "object" ? JSON.stringify(options.aad) : String(options.aad);
        decipher.setAAD(Buffer.from(aadStr, "utf8"));
      }

      let decrypted = decipher.update(ciphertext, undefined, "utf8");
      decrypted += decipher.final("utf8");

      if (options.parseJson) {
        try {
          return JSON.parse(decrypted);
        } catch {
          return decrypted;
        }
      }

      return decrypted;
    } catch (err) {
      throw new EncryptionAtRestError(
        `Decryption failed: authentication tag verification error or tampered ciphertext (${err.message})`,
        "ERR_AUTH_FAILED"
      );
    }
  }

  /**
   * Re-encrypts an existing encrypted string with the latest active key.
   * Useful during key rotation migration.
   *
   * @param {string} encryptedString
   * @param {object} [options]
   * @returns {string} Re-encrypted string under activeKid
   */
  reencrypt(encryptedString, options = {}) {
    if (!this.isEncrypted(encryptedString)) {
      return this.encrypt(encryptedString, options);
    }

    const payload = encryptedString.slice(CIPHERTEXT_PREFIX.length);
    const [kid] = payload.split(":");

    // If already encrypted with the active key, no re-encryption needed unless requested
    if (kid === this.activeKid && !options.force) {
      return encryptedString;
    }

    const decrypted = this.decrypt(encryptedString, options);
    return this.encrypt(decrypted, { ...options, kid: this.activeKid });
  }

  /**
   * Encrypts specific fields of an object in-place or copies.
   *
   * @param {object} data
   * @param {string[]} fields
   * @param {object} [options]
   * @returns {object}
   */
  encryptFields(data, fields = [], options = {}) {
    if (!data || typeof data !== "object") return data;
    const result = Array.isArray(data) ? [...data] : { ...data };

    for (const field of fields) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = this.encrypt(result[field], options);
      }
    }

    return result;
  }

  /**
   * Decrypts specific fields of an object.
   *
   * @param {object} data
   * @param {string[]} fields
   * @param {object} [options]
   * @returns {object}
   */
  decryptFields(data, fields = [], options = {}) {
    if (!data || typeof data !== "object") return data;
    const result = Array.isArray(data) ? [...data] : { ...data };

    for (const field of fields) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = this.decrypt(result[field], options);
      }
    }

    return result;
  }

  /**
   * Automatically discovers and encrypts all sensitive fields for a given entity type
   * according to the data classification policy.
   *
   * @param {string} entityType - e.g. 'integrations', 'identity', 'findings'
   * @param {object} record
   * @param {object} [options]
   * @returns {object}
   */
  encryptEntityFields(entityType, record, options = {}) {
    if (!record || typeof record !== "object") return record;
    const result = { ...record };

    for (const key of Object.keys(result)) {
      const classification = classifyField(entityType, key);
      if (
        classification.atRestEncryption === "REQUIRED" ||
        (options.encryptConfidential && classification.tier === CLASSIFICATION_TIERS.CONFIDENTIAL)
      ) {
        if (result[key] !== null && result[key] !== undefined) {
          result[key] = this.encrypt(result[key], {
            ...options,
            aad: options.aad || record.id || record.tenant_id,
          });
        }
      }
    }

    return result;
  }

  /**
   * Automatically discovers and decrypts all encrypted fields in a record.
   *
   * @param {string} entityType
   * @param {object} record
   * @param {object} [options]
   * @returns {object}
   */
  decryptEntityFields(entityType, record, options = {}) {
    if (!record || typeof record !== "object") return record;
    const result = { ...record };

    for (const key of Object.keys(result)) {
      if (this.isEncrypted(result[key])) {
        result[key] = this.decrypt(result[key], {
          ...options,
          aad: options.aad || record.id || record.tenant_id,
        });
      }
    }

    return result;
  }
}

// Global default singleton instance
const defaultEncryptionAtRest = new EncryptionAtRestService();

module.exports = {
  CIPHERTEXT_PREFIX,
  ALGORITHM,
  IV_LENGTH,
  TAG_LENGTH,
  EncryptionAtRestError,
  EncryptionAtRestService,
  defaultEncryptionAtRest,
};
