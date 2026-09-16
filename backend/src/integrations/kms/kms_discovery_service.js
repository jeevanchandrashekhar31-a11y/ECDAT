/**
 * KMS & HSM Discovery Service — Phase 14.3
 *
 * Central orchestration service managing KMS/Vault/HSM connectors.
 * Aggregates cryptographic key metadata fleetwide and exports to CycloneDX CBOM format.
 *
 * Invariants:
 * - Read-only discovery only.
 * - Zero private key extraction.
 */

const crypto = require("crypto");
const { KmsKeyMetadata } = require("./kms_metadata");
const { BaseKmsConnector } = require("./base_kms_connector");

class KmsDiscoveryService {
  constructor() {
    this.connectors = new Map();
  }

  /**
   * Registers a KMS connector instance.
   * @param {BaseKmsConnector} connector
   */
  registerConnector(connector) {
    if (!(connector instanceof BaseKmsConnector)) {
      throw new Error("Connector must inherit from BaseKmsConnector");
    }
    if (this.connectors.has(connector.name)) {
      throw new Error(`Connector with name '${connector.name}' already registered`);
    }
    this.connectors.set(connector.name, connector);
    return connector;
  }

  /**
   * Gets a registered connector by name.
   * @param {string} name
   */
  getConnector(name) {
    return this.connectors.get(name) || null;
  }

  /**
   * Unregisters a connector.
   * @param {string} name
   */
  unregisterConnector(name) {
    return this.connectors.delete(name);
  }

  /**
   * Lists all registered connectors and their metadata.
   */
  listConnectors() {
    return Array.from(this.connectors.values()).map((c) => ({
      name: c.name,
      provider: c.provider,
      readOnly: c.readOnly,
      config: c.sanitizeConfig(),
      leastPrivilegeRole: c.getLeastPrivilegeRoleDefinition(),
    }));
  }

  /**
   * Executes key discovery across all or filtered connectors.
   * @param {Object} [filter]
   * @param {string} [filter.provider] - Optional provider filter
   * @param {string} [filter.connectorName] - Optional specific connector
   * @returns {Promise<{ timestamp: string, totalCount: number, keys: KmsKeyMetadata[], errors: Object[] }>}
   */
  async discoverAll(filter = {}) {
    let targets = Array.from(this.connectors.values());

    if (filter.connectorName) {
      targets = targets.filter((c) => c.name === filter.connectorName);
    }
    if (filter.provider) {
      targets = targets.filter((c) => c.provider === filter.provider.toLowerCase());
    }

    const allKeys = [];
    const errors = [];

    for (const connector of targets) {
      try {
        const keys = await connector.discoverAll();
        allKeys.push(...keys);
      } catch (err) {
        errors.push({
          connectorName: connector.name,
          provider: connector.provider,
          error: err.message,
        });
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalCount: allKeys.length,
      keys: allKeys,
      errors,
    };
  }

  /**
   * Exports an array of KmsKeyMetadata into a CycloneDX Cryptographic Bill of Materials (CBOM).
   * @param {KmsKeyMetadata[]} keys
   * @returns {Object} CycloneDX CBOM JSON Document
   */
  toCbom(keys = []) {
    const keyList = Array.isArray(keys) ? keys : [];
    const components = keyList.map((k) =>
      k instanceof KmsKeyMetadata ? k.toCbomComponent() : new KmsKeyMetadata(k).toCbomComponent()
    );

    return {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: {
          components: [
            {
              type: "application",
              name: "ECDAT-KMS-Discovery-Engine",
              version: "1.0.0",
              vendor: "ECDAT",
            },
          ],
        },
        properties: [
          { name: "ecdat:module", value: "cloud_kms_hsm_metadata" },
          { name: "ecdat:extraction_policy", value: "metadata_only_read_only" },
        ],
      },
      components,
    };
  }

  /**
   * Generates a summary analysis of the discovered keys.
   * @param {KmsKeyMetadata[]} keys
   */
  getSummary(keys = []) {
    const list = Array.isArray(keys) ? keys : [];
    const byProvider = {};
    const byAlgorithm = {};
    const byState = {};

    let unrotatedCount = 0;
    let exportableCount = 0;
    let weakKeyCount = 0;

    for (const key of list) {
      // By provider
      byProvider[key.provider] = (byProvider[key.provider] || 0) + 1;

      // By algorithm
      byAlgorithm[key.algorithm] = (byAlgorithm[key.algorithm] || 0) + 1;

      // By state
      byState[key.state] = (byState[key.state] || 0) + 1;

      // Rotation check
      if (!key.rotation || !key.rotation.enabled) {
        unrotatedCount++;
      }

      // Exportability check
      if (key.usage && key.usage.isExportable) {
        exportableCount++;
      }

      // Weak key check (e.g. RSA < 2048, 3DES, DES)
      const numSize = typeof key.size === "number" ? key.size : parseInt(key.size, 10);
      if (
        (key.algorithm.includes("RSA") && numSize < 2048) ||
        key.algorithm.includes("3DES") ||
        key.algorithm.includes("DES")
      ) {
        weakKeyCount++;
      }
    }

    return {
      totalKeys: list.length,
      byProvider,
      byAlgorithm,
      byState,
      metrics: {
        unrotatedCount,
        exportableCount,
        weakKeyCount,
      },
    };
  }
}

// Singleton instance
const defaultKmsDiscoveryService = new KmsDiscoveryService();

module.exports = {
  KmsDiscoveryService,
  defaultKmsDiscoveryService,
};
