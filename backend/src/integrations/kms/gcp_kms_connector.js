/**
 * GCP Cloud KMS Connector — Phase 14.3
 *
 * Implements metadata collection for Google Cloud KMS.
 * Enforces least-privilege read-only role: roles/cloudkms.viewer
 * Permissions allowed:
 *   - cloudkms.cryptoKeys.list
 *   - cloudkms.cryptoKeys.get
 *   - cloudkms.cryptoKeyVersions.list
 *   - cloudkms.cryptoKeyVersions.get
 *
 * Explicitly denies encrypt/decrypt or key alteration roles.
 */

const { BaseKmsConnector } = require("./base_kms_connector");
const { KmsKeyMetadata } = require("./kms_metadata");

const GCP_READ_ONLY_PERMISSIONS = Object.freeze([
  "cloudkms.cryptoKeys.list",
  "cloudkms.cryptoKeys.get",
  "cloudkms.cryptoKeyVersions.list",
  "cloudkms.cryptoKeyVersions.get",
  "cloudkms.keyRings.list",
  "cloudkms.keyRings.get",
]);

const GCP_DISALLOWED_PERMISSIONS = Object.freeze([
  "cloudkms.cryptoKeyVersions.useToEncrypt",
  "cloudkms.cryptoKeyVersions.useToDecrypt",
  "cloudkms.cryptoKeyVersions.useToSign",
  "cloudkms.cryptoKeyVersions.useToVerifyMac",
  "cloudkms.cryptoKeys.create",
  "cloudkms.cryptoKeys.update",
  "cloudkms.cryptoKeyVersions.destroy",
  "cloudkms.cryptoKeyVersions.restore",
]);

class GcpKmsConnector extends BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {Object} [options.config]
   * @param {string} [options.config.projectId]
   * @param {string} [options.config.locationId="global"]
   * @param {string} [options.config.keyRingId]
   * @param {Object} [options.client] - Google Cloud KMS client instance
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    super({
      ...options,
      provider: "gcp_kms",
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.projectId) {
      this.config = { ...config, projectId: "gcp-project-default" };
    }
  }

  getLeastPrivilegeRoleDefinition() {
    return {
      role: "roles/cloudkms.viewer",
      title: "Cloud KMS Viewer",
      description: "Read-only access to Cloud KMS metadata without encryption/decryption privileges.",
      includedPermissions: [...GCP_READ_ONLY_PERMISSIONS],
      deniedPermissions: [...GCP_DISALLOWED_PERMISSIONS],
    };
  }

  validateLeastPrivilege(permissions = []) {
    const list = Array.isArray(permissions) ? permissions : permissions.permissions || [];
    const violations = [];

    for (const perm of list) {
      if (GCP_DISALLOWED_PERMISSIONS.includes(perm)) {
        violations.push(`Violation: GCP permission '${perm}' exceeds read-only least privilege requirement.`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async testConnection() {
    if (this.client && typeof this.client.listCryptoKeys === "function") {
      try {
        await this.client.listCryptoKeys({ parent: `projects/${this.config.projectId}/locations/${this.config.locationId || "global"}/keyRings/${this.config.keyRingId || "default"}` });
        return { ok: true, message: `GCP Cloud KMS connection verified for project ${this.config.projectId}` };
      } catch (err) {
        return { ok: false, message: `GCP Cloud KMS connection failed: ${err.message}` };
      }
    }
    return { ok: true, message: `GCP Cloud KMS read-only configured for project ${this.config.projectId}` };
  }

  async listKeys() {
    if (this.client && typeof this.client.listCryptoKeys === "function") {
      const parent = `projects/${this.config.projectId}/locations/${this.config.locationId || "global"}/keyRings/${this.config.keyRingId || "default"}`;
      const [keys] = await this.client.listCryptoKeys({ parent });
      return (keys || []).map((k) => k.name);
    }
    return this.config.mockKeys || [];
  }

  async describeKey(keyName) {
    let cryptoKey = null;

    if (this.client && typeof this.client.getCryptoKey === "function") {
      const [key] = await this.client.getCryptoKey({ name: keyName });
      cryptoKey = key;
    } else if (this.config.mockKeyDetails && this.config.mockKeyDetails[keyName]) {
      cryptoKey = this.config.mockKeyDetails[keyName];
    } else {
      throw new Error(`GCP KMS: Key '${keyName}' not found or client unavailable`);
    }

    return this.mapToKmsMetadata(cryptoKey);
  }

  mapToKmsMetadata(cryptoKey) {
    const primary = cryptoKey.primary || {};
    const rawAlgorithm = primary.algorithm || cryptoKey.purpose || "GOOGLE_SYMMETRIC_ENCRYPTION";
    const { algorithm, size } = this.parseAlgorithmAndSize(rawAlgorithm);

    const labels = cryptoKey.labels || {};
    const owner = labels.owner || this.config.projectId || "GCP_PROJECT";

    // Parse rotation period: e.g. "2592000s" -> 30 days
    let periodDays = null;
    if (cryptoKey.rotationPeriod) {
      const seconds = parseInt(String(cryptoKey.rotationPeriod).replace("s", ""), 10);
      if (!isNaN(seconds)) {
        periodDays = Math.round(seconds / 86400);
      }
    }

    const rotation = {
      enabled: Boolean(cryptoKey.rotationPeriod),
      periodDays,
      lastRotatedAt: null,
      nextRotationAt: cryptoKey.nextRotationTime || null,
      version: primary.name ? primary.name.split("/").pop() : "1",
    };

    const state = primary.state || "ENABLED";

    const usage = {
      keyUsage: cryptoKey.purpose || "ENCRYPT_DECRYPT",
      operations: this.mapPurposeToOperations(cryptoKey.purpose),
      origin: primary.protectionLevel || "GCP_KMS",
      isExportable: false, // GCP Cloud KMS keys are non-exportable
    };

    return new KmsKeyMetadata({
      keyId: cryptoKey.name,
      algorithm,
      size,
      state,
      rotation,
      owner,
      usage,
      provider: "gcp_kms",
      description: `GCP KMS Key: ${cryptoKey.name.split("/").pop()}`,
      rawMetadata: cryptoKey,
    });
  }

  parseAlgorithmAndSize(raw = "") {
    const s = String(raw).toUpperCase();
    if (s.includes("GOOGLE_SYMMETRIC") || s.includes("AES_256")) {
      return { algorithm: "AES-256-GCM", size: 256 };
    }
    if (s.includes("AES_128")) return { algorithm: "AES-128-GCM", size: 128 };
    if (s.includes("RSA_SIGN_PSS_2048") || s.includes("RSA_DECRYPT_OAEP_2048")) {
      return { algorithm: "RSA-2048", size: 2048 };
    }
    if (s.includes("RSA_SIGN_PSS_3072") || s.includes("RSA_DECRYPT_OAEP_3072")) {
      return { algorithm: "RSA-3072", size: 3072 };
    }
    if (s.includes("RSA_SIGN_PSS_4096") || s.includes("RSA_DECRYPT_OAEP_4096")) {
      return { algorithm: "RSA-4096", size: 4096 };
    }
    if (s.includes("EC_SIGN_P256")) return { algorithm: "ECDSA-P256", size: 256 };
    if (s.includes("EC_SIGN_P384")) return { algorithm: "ECDSA-P384", size: 384 };
    if (s.includes("EC_SIGN_SECP256K1")) return { algorithm: "ECDSA-SECP256K1", size: 256 };
    if (s.includes("HMAC_SHA256")) return { algorithm: "HMAC-SHA256", size: 256 };
    return { algorithm: s, size: 256 };
  }

  mapPurposeToOperations(purpose = "") {
    const p = String(purpose).toUpperCase();
    if (p.includes("SIGN")) return ["sign", "verify"];
    if (p.includes("MAC")) return ["generate_mac", "verify_mac"];
    return ["encrypt", "decrypt"];
  }
}

module.exports = {
  GcpKmsConnector,
  GCP_READ_ONLY_PERMISSIONS,
  GCP_DISALLOWED_PERMISSIONS,
};
