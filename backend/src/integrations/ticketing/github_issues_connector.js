/**
 * GitHub Issues Ticketing Connector — Phase 14.1
 *
 * Implements connector interface for GitHub Issues API.
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

class GitHubIssuesConnector extends BaseTicketingConnector {
  constructor(options = {}) {
    super({
      name: options.name || "github-issues-default",
      connectorType: "github",
      config: options.config || {},
      fetchFn: options.fetchFn,
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.repo) throw new Error("GitHub connector requires 'repo' in 'owner/repo' format");
    if (!config.token) throw new Error("GitHub connector requires personal access 'token'");
  }

  get baseUrl() {
    return (this.config.baseUrl || "https://api.github.com").replace(/\/+$/, "");
  }

  /**
   * Pure formatter converting TicketRequest into GitHub Issues API payload.
   */
  formatPayload(ticketRequest) {
    const sev = String(ticketRequest.severity || "MEDIUM").toUpperCase();

    const bodyMarkdown = [
      `## 🛡️ ECDAT Cryptographic Security Finding`,
      ``,
      `| Field | Value |`,
      `|---|---|`,
      `| **Asset ID** | \`${ticketRequest.assetId}\` |`,
      `| **Finding ID** | \`${ticketRequest.findingId}\` |`,
      `| **Severity** | **\`${sev}\`** |`,
      `| **Owner** | \`${ticketRequest.owner}\` |`,
      `| **Evidence Link** | [Inspect Evidence Source](${ticketRequest.evidenceLink}) |`,
      `| **CBOM Reference** | \`${ticketRequest.cbomRef}\` |`,
      `| **Risk Score** | **\`${ticketRequest.riskScore}\`** |`,
      ``,
      `### 🔧 Remediation Guidance`,
      `${ticketRequest.remediation}`,
      ``,
      `---`,
      `*Reported automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)*`,
    ].join("\n");

    const labels = [
      "security",
      "cryptography",
      `severity:${sev.toLowerCase()}`,
      "ecdat",
    ];

    if (this.config.extraLabels && Array.isArray(this.config.extraLabels)) {
      labels.push(...this.config.extraLabels);
    }

    const payload = {
      title: ticketRequest.title || `[ECDAT ${sev}] Finding ${ticketRequest.findingId} on ${ticketRequest.assetId}`,
      body: bodyMarkdown,
      labels,
    };

    // If owner looks like a valid GitHub username (alphanumeric with hyphens, not email)
    if (ticketRequest.owner && !ticketRequest.owner.includes("@") && /^[a-zA-Z0-9-]+$/.test(ticketRequest.owner)) {
      payload.assignees = [ticketRequest.owner];
    } else if (this.config.defaultAssignees && Array.isArray(this.config.defaultAssignees)) {
      payload.assignees = this.config.defaultAssignees;
    }

    return payload;
  }

  async sendCreateRequest(ticketRequest, payload) {
    const endpoint = `${this.baseUrl}/repos/${this.config.repo}/issues`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ECDAT-Ticketing-Connector",
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data.message || JSON.stringify(data);
      throw new Error(`GitHub issue creation failed (HTTP ${res.status}): ${errMsg}`);
    }

    return new TicketResponse({
      success: true,
      ticketId: `#${data.number}`,
      ticketUrl: data.html_url || "",
      connectorType: "github",
      status: data.state || "open",
      rawResponse: data,
    });
  }

  async testConnection() {
    const endpoint = `${this.baseUrl}/repos/${this.config.repo}`;
    const res = await this.fetchFn(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ECDAT-Ticketing-Connector",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub connection test failed for repo '${this.config.repo}' with HTTP ${res.status}`);
    }

    return {
      ok: true,
      message: `Successfully connected to GitHub repository '${this.config.repo}'`,
    };
  }
}

module.exports = {
  GitHubIssuesConnector,
};
