/**
 * HashiCorp Vault Transit Engine Connector — Phase 14.3
 *
 * Implements metadata collection for HashiCorp Vault Transit Secrets Engine.
 * Enforces least-privilege read-only ACL policy:
 *   path "transit/keys" { capabilities = ["list"] }
 *   path "transit/keys/*" { capabilities = ["read"] }
 *
 * Never performs cryptographic operations (encrypt, decrypt, sign, hmac).
 */

const { BaseKmsConnector } = require("./base_kms_connector");
const { KmsKeyMetadata } = require("./kms_metadata");

const VAULT_ALLOWED_CAPABILITIES = Object.freeze(["read", "list"]);
const VAULT_DISALLOWED_CAPABILITIES = Object.freeze(["create", "update", "delete", "sudo"]);

class VaultTransitConnector extends BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {Object} [options.config]
   * @param {string} [options.config.endpoint="http://127.0.0.1:8200"]
   * @param {string} [options.config.mountPath="transit"]
   * @param {string} [options.config.token]
   * @param {string} [options.config.namespace]
   * @param {Object} [options.client]
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    super({
      ...options,
      provider: "hashicorp_vault",
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.endpoint) {
      this.config = { ...config, endpoint: "http://127.0.0.1:8200", mountPath: config.mountPath || "transit" };
    }
  }

  getLeastPrivilegeRoleDefinition() {
    const mount = this.config.mountPath || "transit";
    return {
      name: "ecdat-vault-transit-reader",
      policyHcl: `path "${mount}/keys" {\n  capabilities = ["list"]\n}\npath "${mount}/keys/*" {\n  capabilities = ["read"]\n}\n`,
      allowedCapabilities: [...VAULT_ALLOWED_CAPABILITIES],
      deniedCapabilities: [...VAULT_DISALLOWED_CAPABILITIES],
      description: "Least-privilege HashiCorp Vault policy granting read-only key metadata access.",
    };
  }

  validateLeastPrivilege(capabilities = []) {
    const caps = Array.isArray(capabilities) ? capabilities : capabilities.capabilities || [];
    const violations = [];

    for (const cap of caps) {
      if (VAULT_DISALLOWED_CAPABILITIES.includes(cap.toLowerCase())) {
        violations.push(`Violation: Vault capability '${cap}' exceeds read-only least privilege requirement.`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async testConnection() {
    if (this.config.mockKeys) {
      return { ok: true, message: `HashiCorp Vault mock connected for ${this.config.endpoint}` };
    }
    try {
      const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/sys/health`;
      const res = await this.fetchFn(url, { method: "GET" });
      return { ok: res.ok, message: `HashiCorp Vault reachable at ${this.config.endpoint} (status ${res.status})` };
    } catch (err) {
      return { ok: false, message: `HashiCorp Vault connection failed: ${err.message}` };
    }
  }

  async listKeys() {
    if (this.config.mockKeys) {
      return this.config.mockKeys;
    }

    const mount = this.config.mountPath || "transit";
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/${mount}/keys?list=true`;
    const headers = {
      "X-Vault-Token": this.config.token || "",
    };
    if (this.config.namespace) {
      headers["X-Vault-Namespace"] = this.config.namespace;
    }

    const res = await this.fetchFn(url, { method: "GET", headers });
    if (!res.ok) {
      throw new Error(`Vault listKeys failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    return (data.data && data.data.keys) || [];
  }

  async describeKey(keyName) {
    if (this.config.mockKeyDetails && this.config.mockKeyDetails[keyName]) {
      return this.mapToKmsMetadata(keyName, this.config.mockKeyDetails[keyName]);
    }

    const mount = this.config.mountPath || "transit";
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/${mount}/keys/${encodeURIComponent(keyName)}`;
    const headers = {
      "X-Vault-Token": this.config.token || "",
    };
    if (this.config.namespace) {
      headers["X-Vault-Namespace"] = this.config.namespace;
    }

    const res = await this.fetchFn(url, { method: "GET", headers });
    if (!res.ok) {
      throw new Error(`Vault describeKey('${keyName}') failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    return this.mapToKmsMetadata(keyName, data.data || data);
  }

  mapToKmsMetadata(keyName, vaultData) {
    const rawType = (vaultData.type || "aes256-gcm96").toLowerCase();
    const { algorithm, size } = this.parseVaultAlgorithm(rawType);

    const mount = this.config.mountPath || "transit";
    const keyId = `${mount}/keys/${keyName}`;

    // Auto rotate period in seconds
    let periodDays = null;
    if (vaultData.auto_rotate_period) {
      const sec = typeof vaultData.auto_rotate_period === "number"
        ? vaultData.auto_rotate_period
        : parseInt(vaultData.auto_rotate_period, 10);
      if (!isNaN(sec) && sec > 0) {
        periodDays = Math.round(sec / 86400);
      }
    }

    const rotation = {
      enabled: Boolean(periodDays && periodDays > 0),
      periodDays,
      lastRotatedAt: null,
      nextRotationAt: null,
      version: String(vaultData.latest_version || 1),
    };

    const state = vaultData.deletion_allowed ? "Active" : "Protected";
    const owner = this.config.namespace || this.config.endpoint;

    const supportsEncryption = vaultData.supports_encryption !== undefined ? Boolean(vaultData.supports_encryption) : true;
    const supportsSigning = vaultData.supports_signing !== undefined ? Boolean(vaultData.supports_signing) : false;

    const operations = [];
    if (supportsEncryption) operations.push("encrypt", "decrypt");
    if (supportsSigning) operations.push("sign", "verify");
    if (vaultData.supports_derivation) operations.push("derive_key");

    const usage = {
      keyUsage: supportsSigning ? "SIGN_VERIFY" : "ENCRYPT_DECRYPT",
      operations: operations.length > 0 ? operations : ["encrypt", "decrypt"],
      origin: "HashiCorp Vault Transit",
      isExportable: Boolean(vaultData.exportable),
    };

    return new KmsKeyMetadata({
      keyId,
      algorithm,
      size,
      state,
      rotation,
      owner,
      usage,
      provider: "hashicorp_vault",
      description: `HashiCorp Vault Transit Key: ${keyName}`,
      rawMetadata: {
        name: keyName,
        type: vaultData.type,
        latest_version: vaultData.latest_version,
        min_decryption_version: vaultData.min_decryption_version,
        auto_rotate_period: vaultData.auto_rotate_period,
        exportable: vaultData.exportable,
        derived: vaultData.derived,
        deletion_allowed: vaultData.deletion_allowed,
      },
    });
  }

  parseVaultAlgorithm(type) {
    const t = String(type).toLowerCase();
    if (t.includes("aes256")) return { algorithm: "AES-256-GCM", size: 256 };
    if (t.includes("aes128")) return { algorithm: "AES-128-GCM", size: 128 };
    if (t.includes("chacha20")) return { algorithm: "CHACHA20-POLY1305", size: 256 };
    if (t.includes("rsa-2048")) return { algorithm: "RSA-2048", size: 2048 };
    if (t.includes("rsa-3072")) return { algorithm: "RSA-3072", size: 3072 };
    if (t.includes("rsa-4096")) return { algorithm: "RSA-4096", size: 4096 };
    if (t.includes("ecdsa-p256")) return { algorithm: "ECDSA-P256", size: 256 };
    if (t.includes("ecdsa-p384")) return { algorithm: "ECDSA-P384", size: 384 };
    if (t.includes("ecdsa-p521")) return { algorithm: "ECDSA-P521", size: 521 };
    if (t.includes("ed25519")) return { algorithm: "ED25519", size: 256 };
    return { algorithm: t.toUpperCase(), size: 256 };
  }
}

module.exports = {
  VaultTransitConnector,
  VAULT_ALLOWED_CAPABILITIES,
  VAULT_DISALLOWED_CAPABILITIES,
};
