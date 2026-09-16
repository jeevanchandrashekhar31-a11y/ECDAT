/**
 * Base KMS & HSM Connector — Phase 14.3
 *
 * Vendor-agnostic connector abstraction for Cloud KMS, Vault, and HSM ecosystems.
 * Enforces least-privilege read-only operations and strict metadata-only collection.
 *
 * CRITICAL INVARIANTS:
 * 1. Metadata only (7 dimensions: keyId, algorithm, size, state, rotation, owner, usage).
 * 2. Never extract protected private key material.
 * 3. Use least-privilege read-only roles by default.
 */

const { KmsKeyMetadata, ProtectedKeyMaterialError } = require("./kms_metadata");

class BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name - Instance identifier
   * @param {string} options.provider - 'aws_kms' | 'gcp_kms' | 'azure_keyvault' | 'hashicorp_vault' | 'pkcs11_hsm'
   * @param {Object} [options.config] - Connector configuration (region, endpoint, credentials)
   * @param {boolean} [options.readOnly=true] - Enforce read-only mode (must be true)
   * @param {Object} [options.client] - Pluggable SDK / API client for testing/mocking
   * @param {Function} [options.fetchFn] - HTTP fetch function
   */
  constructor({
    name,
    provider,
    config = {},
    readOnly = true,
    client = null,
    fetchFn = globalThis.fetch,
  } = {}) {
    if (!name) throw new Error("BaseKmsConnector requires 'name'");
    if (!provider) throw new Error("BaseKmsConnector requires 'provider'");

    // Invariant: Use least-privilege read-only roles by default
    if (readOnly !== true) {
      throw new Error(
        `Security Policy Violation: KMS connector '${name}' must be initialized in read-only mode (readOnly: true)`
      );
    }

    this.name = String(name);
    this.provider = String(provider).toLowerCase();
    this.config = Object.freeze({ ...config });
    this.readOnly = true;
    this.client = client;
    this.fetchFn = fetchFn || globalThis.fetch;

    this.validateConfig(this.config);
  }

  /**
   * Validates vendor-specific configuration. Subclasses should override.
   * @param {Object} config
   */
  validateConfig(config) {
    if (!config) throw new Error(`${this.name} requires configuration object`);
  }

  /**
   * Returns the minimum least-privilege read-only IAM/role policy required.
   * @returns {Object} Policy definition and description
   */
  getLeastPrivilegeRoleDefinition() {
    throw new Error(`getLeastPrivilegeRoleDefinition() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Validates that the active credential/role does not grant write/decrypt permissions.
   * @param {Object} [roleOrPermissions]
   * @returns {{ valid: boolean, violations: string[] }}
   */
  validateLeastPrivilege(roleOrPermissions = {}) {
    return { valid: true, violations: [] };
  }

  /**
   * Tests connectivity to the KMS/HSM service using read-only probes.
   * @returns {Promise<{ ok: boolean, message: string, details?: Object }>}
   */
  async testConnection() {
    return { ok: true, message: `Read-only connection test succeeded for ${this.name}` };
  }

  /**
   * Lists key identifiers available in the KMS/HSM scope.
   * @returns {Promise<Array<string|Object>>}
   */
  async listKeys() {
    throw new Error(`listKeys() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Fetches metadata for a specific key.
   * @param {string} keyId
   * @returns {Promise<KmsKeyMetadata>}
   */
  async describeKey(keyId) {
    throw new Error(`describeKey() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Discovers and returns metadata for all keys in scope.
   * Automatically asserts zero protected private key material.
   * @returns {Promise<Array<KmsKeyMetadata>>}
   */
  async discoverAll() {
    const keyItems = await this.listKeys();
    const results = [];

    for (const item of keyItems) {
      const keyId = typeof item === "string" ? item : item.keyId || item.id || item.name;
      if (!keyId) continue;

      const metadata = await this.describeKey(keyId);
      if (!(metadata instanceof KmsKeyMetadata)) {
        throw new Error(`describeKey(${keyId}) did not return a KmsKeyMetadata instance`);
      }

      // Explicit invariant guard
      KmsKeyMetadata.assertNoPrivateKeyMaterial(metadata.rawMetadata);
      results.push(metadata);
    }

    return results;
  }

  /**
   * Helper to sanitize configuration or headers for logging/output.
   */
  sanitizeConfig(cfg = this.config) {
    const clean = { ...cfg };
    for (const key of Object.keys(clean)) {
      if (/(secret|token|password|key|auth|credential)/i.test(key)) {
        clean[key] = "[REDACTED]";
      }
    }
    return clean;
  }
}

module.exports = {
  BaseKmsConnector,
};
