/**
 * Enterprise Ticketing Routes — Phase 14.1
 *
 * Exposes REST endpoints for:
 * - Listing ticketing connectors
 * - Registering connectors dynamically
 * - Creating tickets with all 8 mandatory fields
 * - Previewing vendor-specific payload (dry-run)
 * - Testing connector connectivity
 * - Batch ticket creation from findings
 */

const express = require("express");
const router = express.Router();
const {
  defaultTicketingService,
  JiraConnector,
  ServiceNowConnector,
  GitHubIssuesConnector,
  GitLabIssuesConnector,
  WebhookConnector,
} = require("../integrations/ticketing");
const { TicketRequest } = require("../domain/contracts");
const { validateSafeUrlAsync } = require("../security/ssrf_protection");
const { requireObjectAuthorization, OBJECT_TYPES } = require("../security/object_authorization");
const {
  validateLength,
  validateEnum,
  ALLOWED_TICKETING_TYPES,
} = require("../security/input_validation");
const { RATE_LIMITS } = require("../security/resource_governance");

// Apply integration calls rate limiter to all ticketing endpoints
router.use(RATE_LIMITS.integrationCalls.middleware());

/**
 * GET /api/v1/integrations/ticketing/connectors
 * Lists active connectors.
 */
router.get("/connectors", (req, res) => {
  const connectors = defaultTicketingService.listConnectors();
  res.json({
    total: connectors.length,
    connectors,
  });
});

/**
 * GET /api/v1/integrations/ticketing/connectors/:id
 * Retrieves a ticketing connector enforcing server-side state verification and tenant boundaries.
 */
router.get(
  "/connectors/:id",
  requireObjectAuthorization(OBJECT_TYPES.INTEGRATION, { idParam: "id" }),
  (req, res) => {
    const connector = req.resolvedObject;
    return res.json({
      name: connector.id,
      tenantId: connector.tenantId,
      type: connector.provider,
    });
  }
);

/**
 * POST /api/v1/integrations/ticketing/register
 * Registers a new connector instance.
 */
router.post("/register", async (req, res, next) => {
  try {
    const { name, type, config = {} } = req.body || {};
    if (!name || !type) {
      return res.status(400).json({ error: "Missing required fields: 'name' and 'type'" });
    }

    if (typeof name !== "string" || typeof type !== "string") {
      return res.status(400).json({ error: "ValidationError", message: "'name' and 'type' must be strings" });
    }

    const nameCheck = validateLength(name, { min: 2, max: 64, fieldName: "name" });
    if (!nameCheck.valid) {
      return res.status(400).json({ error: "ValidationError", message: nameCheck.error });
    }

    const typeCheck = validateEnum(type, ALLOWED_TICKETING_TYPES, "type");
    if (!typeCheck.valid) {
      return res.status(400).json({
        error: `Unsupported connector type '${type}'. Supported: ${ALLOWED_TICKETING_TYPES.join(", ")}`,
      });
    }

    const urlToCheck = config.url || config.webhookUrl || config.instanceUrl || config.jiraUrl;
    if (urlToCheck) {
      const check = await validateSafeUrlAsync(urlToCheck);
      if (!check.safe) {
        return res.status(400).json({
          error: "SSRFViolation",
          message: `Ticketing connector URL '${urlToCheck}' rejected: ${check.error}`,
        });
      }
    }

    let connector;
    switch (String(type).toLowerCase()) {
      case "jira":
        connector = new JiraConnector({ name, config });
        break;
      case "servicenow":
        connector = new ServiceNowConnector({ name, config });
        break;
      case "github":
      case "github_issues":
        connector = new GitHubIssuesConnector({ name, config });
        break;
      case "gitlab":
      case "gitlab_issues":
        connector = new GitLabIssuesConnector({ name, config });
        break;
      case "webhook":
      case "generic_webhook":
        connector = new WebhookConnector({ name, config });
        break;
      default:
        return res.status(400).json({
          error: `Unsupported connector type '${type}'. Supported: jira, servicenow, github, gitlab, webhook`,
        });
    }

    defaultTicketingService.registerConnector(connector);

    try {
      const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
      defaultAuditService.logEvent({
        category: AUDIT_CATEGORIES.INTEGRATION_CHANGE,
        action: AUDIT_ACTIONS.INTEGRATION_MODIFIED,
        actor: {
          id: req.user?.sub || req.auth?.user?.sub || "admin",
          username: req.user?.username || req.auth?.user?.name || "admin",
          role: req.auth?.role || "admin",
          ipAddress: req.ip,
        },
        tenant: req.tenantContext?.tenantId || "default",
        target: {
          type: "integration",
          id: name,
          name: `${type}_connector`,
        },
        requestId: req.id || req.headers["x-request-id"],
        result: AUDIT_STATUSES.SUCCESS,
        reason: `Registered ticketing connector '${name}' (${type})`,
        sourceIp: req.ip,
        details: {
          connectorName: name,
          connectorType: connector.connectorType,
        },
      }).catch(() => {});
    } catch {}

    return res.status(201).json({
      message: `Connector '${name}' registered successfully`,
      name,
      type: connector.connectorType,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integrations/ticketing/preview
 * Previews vendor-specific formatted payload (dry run).
 */
router.post("/preview", (req, res, next) => {
  try {
    const { connector, ...ticketFields } = req.body;
    if (!connector) {
      return res.status(400).json({ error: "Missing required field 'connector'" });
    }

    const preview = defaultTicketingService.formatTicket(ticketFields, connector);
    return res.json(preview);
  } catch (err) {
    if (err.message && (err.message.includes("TicketRequest requires") || err.message.includes("not registered"))) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/v1/integrations/ticketing/create
 * Creates ticket across single or multiple connectors.
 */
router.post("/create", async (req, res, next) => {
  try {
    const { connector, connectors, ...ticketFields } = req.body;

    // Validate 8 mandatory fields via TicketRequest contract
    const ticketRequest = new TicketRequest(ticketFields);

    if (connector) {
      const ticket = await defaultTicketingService.createTicket(ticketRequest, connector);
      return res.status(201).json(ticket);
    }

    const targetList = Array.isArray(connectors) ? connectors : [];
    const results = await defaultTicketingService.dispatchMulti(ticketRequest, targetList);
    return res.status(201).json({
      findingId: ticketRequest.findingId,
      dispatched: results,
    });
  } catch (err) {
    if (err.message && err.message.includes("TicketRequest requires")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/v1/integrations/ticketing/test
 * Tests connectivity for a registered connector.
 */
router.post("/test", async (req, res, next) => {
  try {
    const { connector } = req.body;
    if (!connector) {
      return res.status(400).json({ error: "Missing required field 'connector'" });
    }

    const conn = defaultTicketingService.getConnector(connector);
    if (!conn) {
      return res.status(404).json({ error: `Connector '${connector}' not found` });
    }

    const result = await conn.testConnection();
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/integrations/ticketing/batch
 * Creates tickets for an array of findings.
 */
router.post("/batch", async (req, res, next) => {
  try {
    const { findings = [], defaultOwner, cbomRef, connectors = [] } = req.body;
    if (!Array.isArray(findings) || findings.length === 0) {
      return res.status(400).json({ error: "'findings' must be a non-empty array" });
    }

    const result = await defaultTicketingService.batchCreateFromFindings(findings, {
      defaultOwner,
      cbomRef,
      connectorNames: connectors,
    });

    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
