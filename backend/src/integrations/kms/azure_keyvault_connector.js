/**
 * Azure Key Vault Connector — Phase 14.3
 *
 * Implements metadata collection for Azure Key Vault.
 * Enforces least-privilege read-only role:
 *   - Role: Key Vault Crypto Viewer / Key Vault Reader
 *   - Action: Microsoft.KeyVault/vaults/keys/read
 *   - Data Action: Microsoft.KeyVault/vaults/keys/read/action
 *
 * Explicitly denies cryptographic operation data actions (encrypt, decrypt, sign).
 */

const { BaseKmsConnector } = require("./base_kms_connector");
const { KmsKeyMetadata } = require("./kms_metadata");

const AZURE_READ_ONLY_ACTIONS = Object.freeze([
  "Microsoft.KeyVault/vaults/keys/read",
  "Microsoft.KeyVault/vaults/keys/read/action",
]);

const AZURE_DISALLOWED_ACTIONS = Object.freeze([
  "Microsoft.KeyVault/vaults/keys/encrypt/action",
  "Microsoft.KeyVault/vaults/keys/decrypt/action",
  "Microsoft.KeyVault/vaults/keys/sign/action",
  "Microsoft.KeyVault/vaults/keys/verify/action",
  "Microsoft.KeyVault/vaults/keys/wrap/action",
  "Microsoft.KeyVault/vaults/keys/unwrap/action",
  "Microsoft.KeyVault/vaults/keys/write",
  "Microsoft.KeyVault/vaults/keys/delete",
  "Microsoft.KeyVault/vaults/keys/backup/action",
  "Microsoft.KeyVault/vaults/keys/restore/action",
]);

class AzureKeyVaultConnector extends BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {Object} [options.config]
   * @param {string} [options.config.vaultUrl] - e.g. https://myvault.vault.azure.net
   * @param {string} [options.config.tenantId]
   * @param {string} [options.config.clientId]
   * @param {Object} [options.client] - Azure KeyClient instance or mock
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    super({
      ...options,
      provider: "azure_keyvault",
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.vaultUrl) {
      this.config = { ...config, vaultUrl: "https://default.vault.azure.net" };
    }
  }

  getLeastPrivilegeRoleDefinition() {
    return {
      role: "Key Vault Crypto Viewer",
      description: "Read key metadata and properties without performing cryptographic actions.",
      assignableScopes: ["/subscriptions/{subId}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{vaultName}"],
      permissions: [
        {
          actions: ["Microsoft.KeyVault/vaults/keys/read"],
          dataActions: ["Microsoft.KeyVault/vaults/keys/read/action"],
          notDataActions: [...AZURE_DISALLOWED_ACTIONS],
        },
      ],
    };
  }

  validateLeastPrivilege(actions = []) {
    const list = Array.isArray(actions) ? actions : actions.actions || [];
    const violations = [];

    for (const act of list) {
      if (AZURE_DISALLOWED_ACTIONS.includes(act)) {
        violations.push(`Violation: Azure action '${act}' exceeds read-only least privilege requirement.`);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async testConnection() {
    if (this.client && typeof this.client.listPropertiesOfKeys === "function") {
      try {
        const iter = this.client.listPropertiesOfKeys();
        await iter.next();
        return { ok: true, message: `Azure Key Vault connected to ${this.config.vaultUrl}` };
      } catch (err) {
        return { ok: false, message: `Azure Key Vault connection failed: ${err.message}` };
      }
    }
    return { ok: true, message: `Azure Key Vault read-only configured for ${this.config.vaultUrl}` };
  }

  async listKeys() {
    if (this.client && typeof this.client.listPropertiesOfKeys === "function") {
      const keys = [];
      for await (const prop of this.client.listPropertiesOfKeys()) {
        keys.push(prop.name || prop.id);
      }
      return keys;
    }
    return this.config.mockKeys || [];
  }

  async describeKey(keyNameOrId) {
    let keyBundle = null;
    let rotationPolicy = null;

    if (this.client && typeof this.client.getKey === "function") {
      keyBundle = await this.client.getKey(keyNameOrId);
      if (typeof this.client.getKeyRotationPolicy === "function") {
        try {
          rotationPolicy = await this.client.getKeyRotationPolicy(keyNameOrId);
        } catch (_) {
          rotationPolicy = null;
        }
      }
    } else if (this.config.mockKeyDetails && this.config.mockKeyDetails[keyNameOrId]) {
      const mock = this.config.mockKeyDetails[keyNameOrId];
      keyBundle = mock.keyBundle || mock;
      rotationPolicy = mock.rotationPolicy || null;
    } else {
      throw new Error(`Azure Key Vault: Key '${keyNameOrId}' not found or client unavailable`);
    }

    return this.mapToKmsMetadata(keyBundle, rotationPolicy);
  }

  mapToKmsMetadata(keyBundle, rotationPolicy = null) {
    const key = keyBundle.key || keyBundle;
    const properties = keyBundle.properties || keyBundle;
    const kty = (key.kty || "RSA").toUpperCase();
    const crv = key.crv ? String(key.crv).toUpperCase() : null;
    const keySize = key.key_size || (kty.includes("RSA") ? 2048 : 256);

    const { algorithm, size } = this.parseAlgorithm(kty, crv, keySize);

    const tags = properties.tags || {};
    const owner = tags.owner || tags.Owner || this.config.vaultUrl;

    const attributes = properties.attributes || properties || {};
    const state = attributes.enabled ? "Enabled" : "Disabled";

    let periodDays = null;
    if (rotationPolicy && rotationPolicy.lifetimeActions) {
      // e.g. timeAfterCreate: "P90D" -> 90 days
      const action = rotationPolicy.lifetimeActions.find((a) => a.timeAfterCreate || a.timeBeforeExpiry);
      if (action) {
        const timeStr = action.timeAfterCreate || action.timeBeforeExpiry;
        const match = /P(\d+)D/.exec(timeStr);
        if (match) periodDays = parseInt(match[1], 10);
      }
    }

    const rotation = {
      enabled: Boolean(rotationPolicy || periodDays),
      periodDays,
      lastRotatedAt: attributes.created ? new Date(attributes.created).toISOString() : null,
      nextRotationAt: attributes.exp ? new Date(attributes.exp).toISOString() : null,
      version: properties.version || (properties.id ? properties.id.split("/").pop() : "1"),
    };

    const keyOps = key.key_ops || ["encrypt", "decrypt", "wrapKey", "unwrapKey"];
    const usage = {
      keyUsage: keyOps.includes("sign") ? "SIGN_VERIFY" : "ENCRYPT_DECRYPT",
      operations: keyOps,
      origin: kty.includes("HSM") ? "Azure Dedicated HSM" : "Azure Key Vault",
      isExportable: Boolean(attributes.exportable),
    };

    return new KmsKeyMetadata({
      keyId: properties.id || `${this.config.vaultUrl}/keys/${properties.name || "key"}/${rotation.version}`,
      algorithm,
      size,
      state,
      rotation,
      owner,
      usage,
      provider: "azure_keyvault",
      description: `Azure Key Vault: ${properties.name || "managed-key"}`,
      rawMetadata: {
        key: {
          kid: key.kid,
          kty: key.kty,
          key_ops: key.key_ops,
          key_size: key.key_size,
          crv: key.crv,
        },
        properties,
        rotationPolicy,
      },
    });
  }

  parseAlgorithm(kty, crv, size) {
    if (kty.includes("RSA")) {
      return { algorithm: `RSA-${size || 2048}`, size: size || 2048 };
    }
    if (kty.includes("EC")) {
      if (crv === "P-256" || crv === "SECP256R1") return { algorithm: "ECDSA-P256", size: 256 };
      if (crv === "P-384") return { algorithm: "ECDSA-P384", size: 384 };
      if (crv === "P-521") return { algorithm: "ECDSA-P521", size: 521 };
      if (crv === "SECP256K1") return { algorithm: "ECDSA-SECP256K1", size: 256 };
      return { algorithm: `ECDSA-${crv || "P256"}`, size: size || 256 };
    }
    if (kty === "OCT") {
      return { algorithm: `AES-${size || 256}-GCM`, size: size || 256 };
    }
    return { algorithm: kty, size: size || 256 };
  }
}

module.exports = {
  AzureKeyVaultConnector,
  AZURE_READ_ONLY_ACTIONS,
  AZURE_DISALLOWED_ACTIONS,
};
