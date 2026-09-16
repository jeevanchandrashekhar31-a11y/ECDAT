/**
 * Cloud KMS & HSM REST API Router — Phase 14.3
 *
 * Exposes endpoints for managing KMS connectors, executing read-only key metadata discovery,
 * validating least-privilege policies, and exporting CBOM artifacts.
 */

const express = require("express");
const {
  defaultKmsDiscoveryService,
  AwsKmsConnector,
  GcpKmsConnector,
  AzureKeyVaultConnector,
  VaultTransitConnector,
  Pkcs11HsmConnector,
  KmsKeyMetadata,
  ProtectedKeyMaterialError,
} = require("../integrations/kms");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");

const router = express.Router();

/**
 * GET /api/v1/integrations/kms/connectors
 * Lists all registered KMS/HSM connectors and their least-privilege role definitions.
 */
router.get("/connectors", (req, res) => {
  try {
    const connectors = defaultKmsDiscoveryService.listConnectors();
    res.json({
      count: connectors.length,
      connectors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/integrations/kms/register
 * Registers a new KMS/HSM connector.
 */
router.post("/register", (req, res) => {
  try {
    const { name, provider, config = {} } = req.body || {};

    if (!name || !provider) {
      return res.status(400).json({ error: "Missing required fields: 'name' and 'provider'" });
    }

    let connector;
    const prov = provider.toLowerCase();

    switch (prov) {
      case "aws_kms":
        connector = new AwsKmsConnector({ name, config, readOnly: true });
        break;
      case "gcp_kms":
        connector = new GcpKmsConnector({ name, config, readOnly: true });
        break;
      case "azure_keyvault":
        connector = new AzureKeyVaultConnector({ name, config, readOnly: true });
        break;
      case "hashicorp_vault":
        connector = new VaultTransitConnector({ name, config, readOnly: true });
        break;
      case "pkcs11_hsm":
        connector = new Pkcs11HsmConnector({ name, config, readOnly: true });
        break;
      default:
        return res.status(400).json({
          error: `Unsupported provider '${provider}'. Supported: aws_kms, gcp_kms, azure_keyvault, hashicorp_vault, pkcs11_hsm`,
        });
    }

    defaultKmsDiscoveryService.registerConnector(connector);

    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.INTEGRATION_CHANGE,
      action: AUDIT_ACTIONS.INTEGRATION_ADD,
      actor: {
        id: req.auth?.role || "admin",
        username: req.headers["x-actor-username"] || req.auth?.role || "admin",
        role: req.auth?.role || "admin",
        ipAddress: req.ip,
      },
      tenantId: req.tenantContext?.tenantId || "default",
      target: name,
      status: AUDIT_STATUSES.SUCCESS,
      details: { name, provider: connector.provider },
    }).catch(() => {});

    res.status(201).json({
      message: `KMS connector '${name}' registered successfully in read-only mode`,
      connector: {
        name: connector.name,
        provider: connector.provider,
        readOnly: connector.readOnly,
        leastPrivilegeRole: connector.getLeastPrivilegeRoleDefinition(),
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/integrations/kms/test-connection
 * Tests connectivity for a registered connector.
 */
router.post("/test-connection", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "Field 'name' is required" });

    const connector = defaultKmsDiscoveryService.getConnector(name);
    if (!connector) {
      return res.status(404).json({ error: `Connector '${name}' not found` });
    }

    const result = await connector.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/integrations/kms/discover
 * Runs discovery across all or filtered registered connectors.
 */
router.post("/discover", async (req, res) => {
  try {
    const { provider, connectorName } = req.body || {};
    const discoveryResult = await defaultKmsDiscoveryService.discoverAll({ provider, connectorName });
    const summary = defaultKmsDiscoveryService.getSummary(discoveryResult.keys);

    res.json({
      ...discoveryResult,
      summary,
    });
  } catch (err) {
    if (err instanceof ProtectedKeyMaterialError) {
      return res.status(500).json({
        securityViolation: true,
        error: err.message,
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/integrations/kms/to-cbom
 * Discovers keys or takes provided keys and exports to CycloneDX CBOM JSON.
 */
router.post("/to-cbom", async (req, res) => {
  try {
    let keys = req.body && Array.isArray(req.body.keys) ? req.body.keys : null;

    if (!keys) {
      const discoveryResult = await defaultKmsDiscoveryService.discoverAll(req.body || {});
      keys = discoveryResult.keys;
    }

    const cbom = defaultKmsDiscoveryService.toCbom(keys);
    res.json(cbom);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/integrations/kms/validate-policy
 * Validates whether a provided IAM/role policy satisfies least-privilege read-only rules.
 */
router.post("/validate-policy", (req, res) => {
  try {
    const { provider, actions = [], permissions = [], capabilities = [] } = req.body || {};
    if (!provider) return res.status(400).json({ error: "Missing required field 'provider'" });

    const prov = provider.toLowerCase();
    let result = { valid: true, violations: [] };

    if (prov === "aws_kms") {
      const conn = new AwsKmsConnector({ name: "policy-validator", readOnly: true });
      result = conn.validateLeastPrivilege(actions);
    } else if (prov === "gcp_kms") {
      const conn = new GcpKmsConnector({ name: "policy-validator", readOnly: true });
      result = conn.validateLeastPrivilege(permissions);
    } else if (prov === "azure_keyvault") {
      const conn = new AzureKeyVaultConnector({ name: "policy-validator", readOnly: true });
      result = conn.validateLeastPrivilege(actions);
    } else if (prov === "hashicorp_vault") {
      const conn = new VaultTransitConnector({ name: "policy-validator", readOnly: true });
      result = conn.validateLeastPrivilege(capabilities);
    } else if (prov === "pkcs11_hsm") {
      const conn = new Pkcs11HsmConnector({ name: "policy-validator", readOnly: true });
      result = conn.validateLeastPrivilege(actions);
    } else {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }

    res.json({
      provider: prov,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
