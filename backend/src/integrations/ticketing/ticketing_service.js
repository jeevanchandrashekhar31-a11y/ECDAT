/**
 * Ticketing Service & Connector Registry — Phase 14.1
 *
 * Coordinates enterprise ticketing connector dispatch without coupling core risk code.
 * Ensures all tickets enforce the 8 mandatory fields:
 * - asset ID
 * - finding ID
 * - severity
 * - owner
 * - evidence link
 * - remediation
 * - CBOM reference
 * - risk score
 */

const { TicketRequest, TicketResponse } = require("../../domain/contracts");
const { JiraConnector } = require("./jira_connector");
const { ServiceNowConnector } = require("./servicenow_connector");
const { GitHubIssuesConnector } = require("./github_issues_connector");
const { GitLabIssuesConnector } = require("./gitlab_issues_connector");
const { WebhookConnector } = require("./webhook_connector");

class TicketingService {
  constructor() {
    this.connectors = new Map();
  }

  /**
   * Registers a connector instance.
   * @param {BaseTicketingConnector} connector
   */
  registerConnector(connector) {
    if (!connector || !connector.name) {
      throw new Error("Invalid connector: missing name");
    }
    this.connectors.set(connector.name, connector);
    return this;
  }

  /**
   * Unregisters a connector.
   * @param {string} name
   */
  unregisterConnector(name) {
    return this.connectors.delete(name);
  }

  /**
   * Retrieves a registered connector.
   * @param {string} name
   */
  getConnector(name) {
    return this.connectors.get(name);
  }

  /**
   * Lists all registered connectors and their metadata.
   */
  listConnectors() {
    const list = [];
    for (const [name, conn] of this.connectors.entries()) {
      list.push({
        name,
        type: conn.connectorType,
      });
    }
    return list;
  }

  /**
   * Formats a ticket payload without dispatching (dry-run / preview).
   * @param {TicketRequest|Object} rawRequest
   * @param {string} connectorName
   */
  formatTicket(rawRequest, connectorName) {
    const conn = this.getConnector(connectorName);
    if (!conn) {
      throw new Error(`Connector '${connectorName}' is not registered`);
    }
    const ticketRequest = rawRequest instanceof TicketRequest ? rawRequest : new TicketRequest(rawRequest);
    return {
      connectorName,
      connectorType: conn.connectorType,
      payload: conn.formatPayload(ticketRequest),
    };
  }

  /**
   * Creates a ticket on a specific connector.
   * @param {TicketRequest|Object} rawRequest
   * @param {string} connectorName
   * @returns {Promise<TicketResponse>}
   */
  async createTicket(rawRequest, connectorName) {
    const conn = this.getConnector(connectorName);
    if (!conn) {
      throw new Error(`Connector '${connectorName}' is not registered`);
    }
    const ticketRequest = rawRequest instanceof TicketRequest ? rawRequest : new TicketRequest(rawRequest);
    return await conn.createTicket(ticketRequest);
  }

  /**
   * Dispatches ticket creation across multiple connectors.
   * @param {TicketRequest|Object} rawRequest
   * @param {string[]} [connectorNames]
   * @returns {Promise<Array<{ connector: string, success: boolean, ticket?: TicketResponse, error?: string }>>}
   */
  async dispatchMulti(rawRequest, connectorNames = []) {
    const ticketRequest = rawRequest instanceof TicketRequest ? rawRequest : new TicketRequest(rawRequest);
    const targetConnectors = connectorNames.length > 0
      ? connectorNames.map((n) => {
          const c = this.getConnector(n);
          if (!c) throw new Error(`Connector '${n}' not found`);
          return c;
        })
      : Array.from(this.connectors.values());

    if (targetConnectors.length === 0) {
      throw new Error("No ticketing connectors available for dispatch");
    }

    const results = [];
    for (const conn of targetConnectors) {
      try {
        const res = await conn.createTicket(ticketRequest);
        results.push({
          connector: conn.name,
          connectorType: conn.connectorType,
          success: true,
          ticket: res,
        });
      } catch (err) {
        results.push({
          connector: conn.name,
          connectorType: conn.connectorType,
          success: false,
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Maps findings into TicketRequests and creates tickets in batch.
   * @param {Array<Object>} findings
   * @param {Object} options
   * @param {string} [options.defaultOwner]
   * @param {string} [options.cbomRef]
   * @param {string[]} [options.connectorNames]
   */
  async batchCreateFromFindings(findings = [], options = {}) {
    const defaultOwner = options.defaultOwner || "crypto-secops@enterprise.com";
    const defaultCbomRef = options.cbomRef || "urn:ecdat:cbom:latest";
    const connectorNames = options.connectorNames || [];

    const results = [];

    for (const finding of findings) {
      const assetId = finding.asset_id || finding.assetId || finding.file_path || "unknown-asset";
      const findingId = finding.finding_id || finding.findingId || finding.rule_id || finding.id || `find-${Date.now()}`;
      const severity = (finding.severity || "MEDIUM").toUpperCase();
      const owner = finding.owner || defaultOwner;
      const evidenceLink = finding.evidence_link || finding.evidenceLink || (finding.file_path ? `${finding.file_path}#L${finding.line_number || 1}` : "https://ecdat.internal/evidence");
      const remediation = finding.remediation || (finding.developer_feedback && finding.developer_feedback.safe_fix && finding.developer_feedback.safe_fix.summary) || "Upgrade algorithm according to enterprise crypto policy.";
      const cbomRef = finding.cbom_ref || finding.cbomRef || defaultCbomRef;
      const riskScore = finding.risk_score !== undefined
        ? finding.risk_score
        : (finding.riskScore !== undefined ? finding.riskScore : (severity === "CRITICAL" ? 9.5 : 7.0));

      const ticketRequest = new TicketRequest({
        assetId,
        findingId,
        severity,
        owner,
        evidenceLink,
        remediation,
        cbomRef,
        riskScore,
        title: finding.title,
        description: finding.description,
        metadata: finding.metadata || {},
      });

      const dispatchResult = await this.dispatchMulti(ticketRequest, connectorNames);
      results.push({
        findingId,
        assetId,
        dispatch: dispatchResult,
      });
    }

    return {
      totalFindings: findings.length,
      processed: results.length,
      results,
    };
  }
}

// Global default singleton instance
const defaultTicketingService = new TicketingService();

module.exports = {
  TicketingService,
  defaultTicketingService,
  JiraConnector,
  ServiceNowConnector,
  GitHubIssuesConnector,
  GitLabIssuesConnector,
  WebhookConnector,
};
