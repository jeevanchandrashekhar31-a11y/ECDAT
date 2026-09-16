/**
 * PKCS#11 / Hardware Security Module (HSM) Connector — Phase 14.3
 *
 * Implements metadata collection for PKCS#11 compliant Hardware Security Modules
 * (e.g., Thales Luna, Utimaco, AWS CloudHSM, Nitrokey, SoftHSM).
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Read-Only Token Session: Opened with CKF_SERIAL_SESSION (never CKF_RW_SESSION).
 * 2. Never Query CKA_VALUE: CKA_VALUE for private/secret keys is strictly excluded from attribute templates.
 * 3. Only Public & Operational Attributes: CKA_CLASS, CKA_KEY_TYPE, CKA_LABEL, CKA_ID,
 *    CKA_MODULUS_BITS, CKA_VALUE_LEN, CKA_EXTRACTABLE, CKA_NEVER_EXTRACTABLE, CKA_ENCRYPT, CKA_DECRYPT, etc.
 */

const { BaseKmsConnector } = require("./base_kms_connector");
const { KmsKeyMetadata, ProtectedKeyMaterialError } = require("./kms_metadata");

// PKCS#11 Attribute Constants (standard RFC 7512 / PKCS#11 v2.40/v3.0)
const CKA_ALLOWED_ATTRIBUTES = Object.freeze([
  "CKA_CLASS",
  "CKA_KEY_TYPE",
  "CKA_LABEL",
  "CKA_ID",
  "CKA_MODULUS_BITS",
  "CKA_VALUE_LEN",
  "CKA_EXTRACTABLE",
  "CKA_NEVER_EXTRACTABLE",
  "CKA_SENSITIVE",
  "CKA_ALWAYS_SENSITIVE",
  "CKA_ENCRYPT",
  "CKA_DECRYPT",
  "CKA_SIGN",
  "CKA_VERIFY",
  "CKA_WRAP",
  "CKA_UNWRAP",
  "CKA_TOKEN",
]);

const CKA_FORBIDDEN_ATTRIBUTES = Object.freeze([
  "CKA_VALUE", // Raw key bytes
  "CKA_PRIVATE_EXPONENT", // RSA d
  "CKA_PRIME_1", // RSA p
  "CKA_PRIME_2", // RSA q
  "CKA_EXPONENT_1", // RSA d mod (p-1)
  "CKA_EXPONENT_2", // RSA d mod (q-1)
  "CKA_COEFFICIENT", // RSA q^-1 mod p
  "CKA_VALUE_BITS",
]);

class Pkcs11HsmConnector extends BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {Object} [options.config]
   * @param {string} [options.config.modulePath] - Path to PKCS#11 library (.so / .dll / .dylib)
   * @param {number|string} [options.config.slotId=0] - Token slot ID
   * @param {string} [options.config.tokenLabel] - Label of token
   * @param {string} [options.config.userPin] - User PIN for read-only session
   * @param {Object} [options.client] - PKCS#11 mock or library wrapper
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    super({
      ...options,
      provider: "pkcs11_hsm",
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (config.slotId === undefined) {
      this.config = { ...config, slotId: 0 };
    }
  }

  getLeastPrivilegeRoleDefinition() {
    return {
      sessionType: "CKF_SERIAL_SESSION",
      accessType: "ReadOnly (User/Public session)",
      allowedAttributes: [...CKA_ALLOWED_ATTRIBUTES],
      forbiddenAttributes: [...CKA_FORBIDDEN_ATTRIBUTES],
      description: "Least-privilege read-only PKCS#11 token session querying public descriptors only.",
    };
  }

  validateLeastPrivilege(requestedAttributes = []) {
    const list = Array.isArray(requestedAttributes) ? requestedAttributes : [];
    const violations = [];

    for (const attr of list) {
      const upper = String(attr).toUpperCase();
      if (CKA_FORBIDDEN_ATTRIBUTES.includes(upper)) {
        violations.push(`Violation: Forbidden attribute '${attr}' exposes protected cryptographic material.`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async testConnection() {
    if (this.client && typeof this.client.C_GetTokenInfo === "function") {
      try {
        const info = await this.client.C_GetTokenInfo(this.config.slotId || 0);
        return { ok: true, message: `PKCS#11 token connected: ${info.label || "HSM"}` };
      } catch (err) {
        return { ok: false, message: `PKCS#11 token probe failed: ${err.message}` };
      }
    }
    return { ok: true, message: `PKCS#11 HSM connector configured for slot ${this.config.slotId}` };
  }

  async listKeys() {
    if (this.client && typeof this.client.findObjects === "function") {
      const objects = await this.client.findObjects({
        slotId: this.config.slotId,
        attributes: [
          { type: "CKA_CLASS", values: ["CKO_PRIVATE_KEY", "CKO_SECRET_KEY", "CKO_PUBLIC_KEY"] },
        ],
      });
      return objects.map((o) => o.id || o.label || `hsm-obj-${o.handle}`);
    }
    return this.config.mockKeys || [];
  }

  async describeKey(keyIdentifier) {
    let rawObj = null;

    if (this.client && typeof this.client.getAttributeValues === "function") {
      // Strictly query safe attributes only!
      const attrs = await this.client.getAttributeValues(keyIdentifier, CKA_ALLOWED_ATTRIBUTES);
      rawObj = attrs;
    } else if (this.config.mockKeyDetails && this.config.mockKeyDetails[keyIdentifier]) {
      rawObj = this.config.mockKeyDetails[keyIdentifier];
    } else {
      throw new Error(`PKCS#11 HSM: Key object '${keyIdentifier}' not found`);
    }

    // Explicit security check
    this.assertNoHsmPrivateMaterial(rawObj);

    return this.mapToKmsMetadata(keyIdentifier, rawObj);
  }

  assertNoHsmPrivateMaterial(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const forbidden of CKA_FORBIDDEN_ATTRIBUTES) {
      if (forbidden in obj || forbidden.toLowerCase() in obj) {
        throw new ProtectedKeyMaterialError(
          `CRITICAL SECURITY VIOLATION: HSM attribute '${forbidden}' detected. ECDAT never extracts private key material!`
        );
      }
    }
  }

  mapToKmsMetadata(keyIdentifier, rawObj) {
    const keyType = (rawObj.CKA_KEY_TYPE || rawObj.keyType || "CKK_RSA").toUpperCase();
    const modulusBits = rawObj.CKA_MODULUS_BITS || rawObj.modulusBits;
    const valueLen = rawObj.CKA_VALUE_LEN || rawObj.valueLen;

    const { algorithm, size } = this.parseHsmAlgorithm(keyType, modulusBits, valueLen);

    const label = rawObj.CKA_LABEL || rawObj.label || keyIdentifier;
    const id = rawObj.CKA_ID || rawObj.id || keyIdentifier;
    const slotId = this.config.slotId !== undefined ? this.config.slotId : 0;
    const canonicalKeyId = `pkcs11:slot=${slotId};id=${encodeURIComponent(id)};label=${encodeURIComponent(label)}`;

    const owner = this.config.tokenLabel || `slot-${slotId}`;

    const isExtractable = Boolean(rawObj.CKA_EXTRACTABLE ?? rawObj.extractable ?? false);
    const neverExtractable = Boolean(rawObj.CKA_NEVER_EXTRACTABLE ?? rawObj.neverExtractable ?? true);

    const operations = [];
    if (rawObj.CKA_ENCRYPT || rawObj.CKA_DECRYPT) operations.push("encrypt", "decrypt");
    if (rawObj.CKA_SIGN || rawObj.CKA_VERIFY) operations.push("sign", "verify");
    if (rawObj.CKA_WRAP || rawObj.CKA_UNWRAP) operations.push("wrapKey", "unwrapKey");

    const usage = {
      keyUsage: operations.includes("sign") ? "SIGN_VERIFY" : "ENCRYPT_DECRYPT",
      operations: operations.length > 0 ? operations : ["encrypt", "decrypt"],
      origin: "Hardware Security Module (HSM)",
      isExportable: isExtractable && !neverExtractable,
    };

    const rotation = {
      enabled: false, // HSM keys typically rely on external lifecycle management
      periodDays: null,
      lastRotatedAt: null,
      nextRotationAt: null,
      version: "1",
    };

    return new KmsKeyMetadata({
      keyId: canonicalKeyId,
      algorithm,
      size,
      state: "Active",
      rotation,
      owner,
      usage,
      provider: "pkcs11_hsm",
      description: `Hardware Security Module Token Key: ${label}`,
      rawMetadata: {
        slotId,
        label,
        id,
        keyType,
        modulusBits,
        extractable: isExtractable,
        neverExtractable,
        token: rawObj.CKA_TOKEN ?? true,
      },
    });
  }

  parseHsmAlgorithm(keyType, modulusBits, valueLen) {
    const kt = String(keyType).toUpperCase();
    if (kt.includes("RSA")) {
      const bits = modulusBits || 2048;
      return { algorithm: `RSA-${bits}`, size: bits };
    }
    if (kt.includes("EC") || kt.includes("ECDSA")) {
      return { algorithm: "ECDSA-P256", size: 256 };
    }
    if (kt.includes("AES")) {
      const bits = (valueLen || 32) * 8;
      return { algorithm: `AES-${bits}-GCM`, size: bits };
    }
    if (kt.includes("DES3") || kt.includes("3DES")) {
      return { algorithm: "3DES-EDE", size: 168 };
    }
    return { algorithm: kt, size: modulusBits || 256 };
  }
}

module.exports = {
  Pkcs11HsmConnector,
  CKA_ALLOWED_ATTRIBUTES,
  CKA_FORBIDDEN_ATTRIBUTES,
};
