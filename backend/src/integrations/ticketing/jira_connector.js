/**
 * Jira Ticketing Connector — Phase 14.1
 *
 * Implements connector interface for Atlassian Jira Cloud and Jira Data Center/Server.
 * Includes all 8 mandatory fields:
 * - asset ID
 * - finding ID
 * - severity
 * - owner
 * - evidence link
 * - remediation
 * - CBOM reference
 * - risk score
 */

const { BaseTicketingConnector } = require("./base_connector");
const { TicketResponse } = require("../../domain/contracts");

const DEFAULT_PRIORITY_MAP = {
  CRITICAL: "Highest",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFO: "Lowest",
  INFORMATIONAL: "Lowest",
};

class JiraConnector extends BaseTicketingConnector {
  constructor(options = {}) {
    super({
      name: options.name || "jira-default",
      connectorType: "jira",
      config: options.config || {},
      fetchFn: options.fetchFn,
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.host) throw new Error("Jira connector requires 'host' URL");
    if (!config.projectKey) throw new Error("Jira connector requires 'projectKey'");
    if (!config.apiToken) throw new Error("Jira connector requires 'apiToken'");
    if (!config.username) throw new Error("Jira connector requires 'username' (email/service account)");
  }

  get normalizedHost() {
    return this.config.host.replace(/\/+$/, "");
  }

  getAuthHeader() {
    const creds = Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString("base64");
    return `Basic ${creds}`;
  }

  mapPriority(severity) {
    const sev = String(severity || "MEDIUM").toUpperCase();
    const customMap = this.config.priorityMapping || {};
    return customMap[sev] || DEFAULT_PRIORITY_MAP[sev] || "Medium";
  }

  /**
   * Pure formatter converting TicketRequest into Jira REST API v2/v3 issue payload.
   */
  formatPayload(ticketRequest) {
    const priority = this.mapPriority(ticketRequest.severity);
    const issueType = this.config.issueType || "Bug";

    // Build Jira wiki-markup description containing all 8 mandatory fields
    const descriptionLines = [
      "h2. ECDAT Cryptographic Finding Details",
      "",
      "||Field||Value||",
      `|*Asset ID*|${ticketRequest.assetId}|`,
      `|*Finding ID*|${ticketRequest.findingId}|`,
      `|*Severity*|${ticketRequest.severity}|`,
      `|*Owner*|${ticketRequest.owner}|`,
      `|*Evidence Link*|[${ticketRequest.evidenceLink}|${ticketRequest.evidenceLink}]|`,
      `|*CBOM Reference*|${ticketRequest.cbomRef}|`,
      `|*Risk Score*|${ticketRequest.riskScore}|`,
      "",
      "h3. Remediation Guidance",
      ticketRequest.remediation,
      "",
      "----",
      "_Generated automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)_",
    ];

    const fields = {
      project: { key: this.config.projectKey },
      summary: ticketRequest.title || `[${ticketRequest.severity}] Cryptographic Finding: ${ticketRequest.findingId} on ${ticketRequest.assetId}`,
      description: descriptionLines.join("\n"),
      issuetype: { name: issueType },
      priority: { name: priority },
      labels: [
        "ecdat",
        "cryptography",
        "security",
        `sev-${ticketRequest.severity.toLowerCase()}`,
      ],
    };

    // Custom fields if configured
    if (this.config.customFields && typeof this.config.customFields === "object") {
      for (const [k, v] of Object.entries(this.config.customFields)) {
        fields[k] = v;
      }
    }

    return { fields };
  }

  async sendCreateRequest(ticketRequest, payload) {
    const endpoint = `${this.normalizedHost}/rest/api/2/issue`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: this.getAuthHeader(),
      Accept: "application/json",
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data.errorMessages ? data.errorMessages.join("; ") : JSON.stringify(data.errors || data);
      throw new Error(`Jira ticket creation failed (HTTP ${res.status}): ${errMsg}`);
    }

    const ticketKey = data.key || data.id;
    const ticketUrl = `${this.normalizedHost}/browse/${ticketKey}`;

    return new TicketResponse({
      success: true,
      ticketId: ticketKey,
      ticketUrl,
      connectorType: "jira",
      status: "OPEN",
      rawResponse: data,
    });
  }

  async testConnection() {
    const endpoint = `${this.normalizedHost}/rest/api/2/myself`;
    const res = await this.fetchFn(endpoint, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Jira connection test failed with status ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      message: `Successfully connected to Jira host '${this.normalizedHost}' as '${data.displayName || data.name || this.config.username}'`,
    };
  }
}

module.exports = {
  JiraConnector,
  DEFAULT_PRIORITY_MAP,
};
