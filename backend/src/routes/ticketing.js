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
 * POST /api/v1/integrations/ticketing/register
 * Registers a new connector instance.
 */
router.post("/register", (req, res, next) => {
  try {
    const { name, type, config = {} } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: "Missing required fields: 'name' and 'type'" });
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
