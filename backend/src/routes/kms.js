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
const { validateSafeUrlAsync } = require("../security/ssrf_protection");
const { requireObjectAuthorization, OBJECT_TYPES } = require("../security/object_authorization");
const {
  validateLength,
  validateEnum,
  ALLOWED_KMS_PROVIDERS,
} = require("../security/input_validation");
const { RATE_LIMITS } = require("../security/resource_governance");

const router = express.Router();

// Apply integration calls rate limiter to all KMS/HSM operations
router.use(RATE_LIMITS.integrationCalls.middleware());

/**
 * GET /api/v1/integrations/kms/connectors
 * Lists all registered KMS/HSM connectors and their least-privilege role definitions.
 */
router.get("/connectors", (req, res) => {
  try {
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;

    let connectors = defaultKmsDiscoveryService.listConnectors();
    if (!isPlatformAdmin && callerTenant) {
      connectors = connectors.filter((c) => !c.tenantId || c.tenantId === callerTenant);
    } else if (!isPlatformAdmin && !callerTenant) {
      connectors = [];
    }

    res.json({
      count: connectors.length,
      connectors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/integrations/kms/connectors/:id
 * Retrieves a KMS connector enforcing server-side state verification and tenant boundaries.
 */
router.get(
  "/connectors/:id",
  requireObjectAuthorization(OBJECT_TYPES.INTEGRATION, { idParam: "id" }),
  (req, res) => {
    const connector = req.resolvedObject;
    return res.json({
      name: connector.id,
      tenantId: connector.tenantId,
      provider: connector.provider,
    });
  }
);

/**
 * DELETE /api/v1/integrations/kms/connectors/:id
 * Unregisters a KMS connector enforcing server-side state verification and tenant boundaries.
 */
router.delete(
  "/connectors/:id",
  requireObjectAuthorization(OBJECT_TYPES.INTEGRATION, { idParam: "id" }),
  (req, res) => {
    const connector = req.resolvedObject;
    defaultKmsDiscoveryService.unregisterConnector(connector.id);
    return res.json({
      success: true,
      message: `KMS connector '${connector.id}' deleted successfully`,
    });
  }
);

/**
 * POST /api/v1/integrations/kms/register
 * Registers a new KMS/HSM connector.
 */
router.post("/register", async (req, res) => {
  try {
    const { name, provider, config = {} } = req.body || {};

    if (!name || !provider) {
      return res.status(400).json({ error: "Missing required fields: 'name' and 'provider'" });
    }

    if (typeof name !== "string" || typeof provider !== "string") {
      return res.status(400).json({ error: "ValidationError", message: "'name' and 'provider' must be strings" });
    }

    const nameCheck = validateLength(name, { min: 2, max: 64, fieldName: "name" });
    if (!nameCheck.valid) {
      return res.status(400).json({ error: "ValidationError", message: nameCheck.error });
    }

    const provCheck = validateEnum(provider, ALLOWED_KMS_PROVIDERS, "provider");
    if (!provCheck.valid) {
      return res.status(400).json({
        error: `Unsupported provider '${provider}'. Supported: ${ALLOWED_KMS_PROVIDERS.join(", ")}`,
      });
    }

    const urlToCheck = config.endpoint || config.url || config.vaultUrl;
    if (urlToCheck && urlToCheck !== "http://127.0.0.1:8200") {
      const check = await validateSafeUrlAsync(urlToCheck);
      if (!check.safe) {
        return res.status(400).json({
          error: "SSRFViolation",
          message: `KMS connector endpoint '${urlToCheck}' rejected: ${check.error}`,
        });
      }
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

    connector.tenantId = req.tenantContext?.tenantId || "default";
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

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;
    if (!isPlatformAdmin && callerTenant && connector.tenantId && connector.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "HorizontalTenantViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot access KMS connector belonging to foreign tenant '${connector.tenantId}'`,
      });
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
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;

    if (connectorName) {
      const conn = defaultKmsDiscoveryService.getConnector(connectorName);
      if (conn && !isPlatformAdmin && callerTenant && conn.tenantId && conn.tenantId !== callerTenant) {
        return res.status(403).json({
          error: "HorizontalTenantViolation",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cannot access KMS connector belonging to foreign tenant '${conn.tenantId}'`,
        });
      }
    }

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
