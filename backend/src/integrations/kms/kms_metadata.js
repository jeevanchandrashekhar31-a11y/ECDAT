/**
 * KMS & HSM Key Metadata Model & Invariants — Phase 14.3
 *
 * Enforces the 7 required metadata dimensions:
 * 1. key identifier
 * 2. algorithm
 * 3. size/parameters
 * 4. state
 * 5. rotation metadata
 * 6. owner
 * 7. usage metadata
 *
 * CRITICAL SECURITY INVARIANT:
 * "Never extract protected private key material."
 * Enforces strict runtime assertion that private key bytes, exponents, seeds,
 * or raw secret material are NEVER populated or returned.
 */

// Forbidden field names that must NEVER appear in metadata
const FORBIDDEN_PRIVATE_KEY_FIELDS = new Set([
  "privatekey",
  "private_key",
  "d",
  "p",
  "q",
  "dp",
  "dq",
  "qi",
  "rawkey",
  "raw_key",
  "secretbytes",
  "secret_bytes",
  "secretmaterial",
  "secret_material",
  "privatekeybytes",
  "private_key_bytes",
  "seed",
  "masterkey",
  "master_key",
  "keymaterial",
  "key_material",
]);

class ProtectedKeyMaterialError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtectedKeyMaterialError";
  }
}

class KmsKeyMetadata {
  /**
   * @param {Object} options
   * @param {string} options.keyId - Canonical key identifier (ARN, URI, ID, path)
   * @param {string} options.algorithm - Cryptographic algorithm (AES-256-GCM, RSA-2048, etc.)
   * @param {number|string} options.size - Key size in bits (256, 2048, etc.) or parameter spec
   * @param {string} options.state - Lifecycle state (Enabled, Disabled, Active, etc.)
   * @param {Object} options.rotation - Rotation metadata { enabled, periodDays, lastRotatedAt, nextRotationAt, version }
   * @param {string} options.owner - Account, project, Vault namespace, or Owner tag
   * @param {Object} options.usage - Usage metadata { keyUsage, operations, origin, isExportable }
   * @param {string} [options.provider] - 'aws_kms' | 'gcp_kms' | 'azure_keyvault' | 'hashicorp_vault' | 'pkcs11_hsm'
   * @param {string} [options.description] - Description or label
   * @param {Object} [options.rawMetadata] - Raw vendor metadata with private fields scrubbed
   */
  constructor({
    keyId,
    algorithm,
    size,
    state,
    rotation = {},
    owner,
    usage = {},
    provider = "unknown",
    description = "",
    rawMetadata = {},
  }) {
    if (!keyId) throw new Error("KmsKeyMetadata requires non-empty 'keyId'");
    if (!algorithm) throw new Error("KmsKeyMetadata requires non-empty 'algorithm'");
    if (size === undefined || size === null) throw new Error("KmsKeyMetadata requires 'size' (key length or parameters)");
    if (!state) throw new Error("KmsKeyMetadata requires non-empty 'state'");
    if (!owner) throw new Error("KmsKeyMetadata requires non-empty 'owner'");

    // 1. Enforce strict invariant: Never allow private key material
    KmsKeyMetadata.assertNoPrivateKeyMaterial(rawMetadata);

    this.keyId = String(keyId);
    this.algorithm = String(algorithm).toUpperCase();
    this.size = typeof size === "number" ? size : String(size);
    this.state = String(state);
    this.provider = String(provider).toLowerCase();
    this.description = String(description || "");
    this.owner = String(owner);

    // 2. Rotation metadata
    this.rotation = Object.freeze({
      enabled: Boolean(rotation.enabled),
      periodDays: rotation.periodDays !== undefined ? Number(rotation.periodDays) : null,
      lastRotatedAt: rotation.lastRotatedAt ? String(rotation.lastRotatedAt) : null,
      nextRotationAt: rotation.nextRotationAt ? String(rotation.nextRotationAt) : null,
      version: rotation.version !== undefined ? String(rotation.version) : "1",
    });

    // 3. Usage metadata
    this.usage = Object.freeze({
      keyUsage: String(usage.keyUsage || "ENCRYPT_DECRYPT"),
      operations: Array.isArray(usage.operations) ? [...usage.operations] : ["encrypt", "decrypt"],
      origin: String(usage.origin || "KMS"),
      isExportable: Boolean(usage.isExportable), // Typically false for KMS/HSM
    });

    this.rawMetadata = Object.freeze(KmsKeyMetadata.sanitizeMetadata(rawMetadata));

    Object.freeze(this);
  }

  /**
   * Runtime guard enforcing zero private key material.
   */
  static assertNoPrivateKeyMaterial(obj, path = "") {
    if (!obj || typeof obj !== "object") return;

    for (const key of Object.keys(obj)) {
      const normalized = key.toLowerCase().replace(/[-_]/g, "");
      if (FORBIDDEN_PRIVATE_KEY_FIELDS.has(normalized)) {
        throw new ProtectedKeyMaterialError(
          `CRITICAL SECURITY VIOLATION: Private key material detected in field '${path ? `${path}.${key}` : key}'. ECDAT collects metadata only!`
        );
      }
      if (typeof obj[key] === "object" && obj[key] !== null) {
        this.assertNoPrivateKeyMaterial(obj[key], path ? `${path}.${key}` : key);
      }
    }
  }

  /**
   * Recursively sanitizes raw metadata to guarantee safety.
   */
  static sanitizeMetadata(obj) {
    if (!obj || typeof obj !== "object") return {};
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      const normalized = k.toLowerCase().replace(/[-_]/g, "");
      if (FORBIDDEN_PRIVATE_KEY_FIELDS.has(normalized)) {
        clean[k] = "[REDACTED_PROTECTED_MATERIAL]";
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        clean[k] = this.sanitizeMetadata(v);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  /**
   * Converts KMS key metadata into CycloneDX CBOM component.
   */
  toCbomComponent() {
    return {
      type: "cryptographic-asset",
      "bom-ref": `cbom:${this.provider}:${this.keyId}`,
      name: this.keyId,
      description: this.description || `${this.provider.toUpperCase()} Managed Key (${this.algorithm})`,
      cryptoProperties: {
        assetType: "key",
        algorithm: this.algorithm,
        keyLength: typeof this.size === "number" ? this.size : parseInt(this.size, 10) || 0,
        state: this.state,
        provider: this.provider,
        rotationEnabled: this.rotation.enabled,
        rotationPeriodDays: this.rotation.periodDays,
        owner: this.owner,
        keyUsage: this.usage.keyUsage,
        isExportable: this.usage.isExportable,
      },
      properties: [
        { name: "ecdat:kms:provider", value: this.provider },
        { name: "ecdat:kms:key_id", value: this.keyId },
        { name: "ecdat:kms:owner", value: this.owner },
        { name: "ecdat:kms:rotation_enabled", value: String(this.rotation.enabled) },
        { name: "ecdat:kms:state", value: this.state },
      ],
    };
  }

  toJSON() {
    return {
      keyId: this.keyId,
      algorithm: this.algorithm,
      size: this.size,
      state: this.state,
      rotation: this.rotation,
      owner: this.owner,
      usage: this.usage,
      provider: this.provider,
      description: this.description,
      rawMetadata: this.rawMetadata,
    };
  }
}

module.exports = {
  KmsKeyMetadata,
  ProtectedKeyMaterialError,
  FORBIDDEN_PRIVATE_KEY_FIELDS,
};
