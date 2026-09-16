/**
 * GitLab Issues Ticketing Connector — Phase 14.1
 *
 * Implements connector interface for GitLab REST API v4 Issues.
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

class GitLabIssuesConnector extends BaseTicketingConnector {
  constructor(options = {}) {
    super({
      name: options.name || "gitlab-issues-default",
      connectorType: "gitlab",
      config: options.config || {},
      fetchFn: options.fetchFn,
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.projectId) throw new Error("GitLab connector requires 'projectId' (numeric ID or URL-encoded path)");
    if (!config.token) throw new Error("GitLab connector requires personal/project access 'token'");
  }

  get baseUrl() {
    return (this.config.baseUrl || "https://gitlab.com/api/v4").replace(/\/+$/, "");
  }

  get encodedProjectId() {
    return encodeURIComponent(String(this.config.projectId));
  }

  /**
   * Pure formatter converting TicketRequest into GitLab Issues API payload.
   */
  formatPayload(ticketRequest) {
    const sev = String(ticketRequest.severity || "MEDIUM").toUpperCase();

    const description = [
      `## 🦊 ECDAT Cryptographic Vulnerability Finding`,
      ``,
      `| Field | Value |`,
      `|---|---|`,
      `| **Asset ID** | \`${ticketRequest.assetId}\` |`,
      `| **Finding ID** | \`${ticketRequest.findingId}\` |`,
      `| **Severity** | **\`${sev}\`** |`,
      `| **Owner** | \`${ticketRequest.owner}\` |`,
      `| **Evidence Link** | [Inspect Evidence](${ticketRequest.evidenceLink}) |`,
      `| **CBOM Reference** | \`${ticketRequest.cbomRef}\` |`,
      `| **Risk Score** | **\`${ticketRequest.riskScore}\`** |`,
      ``,
      `### 🔧 Remediation Guidance`,
      `${ticketRequest.remediation}`,
      ``,
      `/confidential`,
      `---`,
      `*Reported automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)*`,
    ].join("\n");

    const labels = [
      "security",
      "cryptography",
      sev.toLowerCase(),
      "ecdat",
    ];

    if (this.config.extraLabels && Array.isArray(this.config.extraLabels)) {
      labels.push(...this.config.extraLabels);
    }

    const payload = {
      title: ticketRequest.title || `[ECDAT ${sev}] Finding ${ticketRequest.findingId} on ${ticketRequest.assetId}`,
      description,
      labels: labels.join(","),
      confidential: this.config.confidential !== undefined ? Boolean(this.config.confidential) : true,
    };

    if (Number.isFinite(ticketRequest.riskScore)) {
      payload.weight = Math.round(ticketRequest.riskScore);
    }

    return payload;
  }

  async sendCreateRequest(ticketRequest, payload) {
    const endpoint = `${this.baseUrl}/projects/${this.encodedProjectId}/issues`;
    const headers = {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": this.config.token,
      Accept: "application/json",
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = (data.message && JSON.stringify(data.message)) || JSON.stringify(data);
      throw new Error(`GitLab issue creation failed (HTTP ${res.status}): ${errMsg}`);
    }

    return new TicketResponse({
      success: true,
      ticketId: `#${data.iid || data.id}`,
      ticketUrl: data.web_url || "",
      connectorType: "gitlab",
      status: data.state || "opened",
      rawResponse: data,
    });
  }

  async testConnection() {
    const endpoint = `${this.baseUrl}/projects/${this.encodedProjectId}`;
    const res = await this.fetchFn(endpoint, {
      method: "GET",
      headers: {
        "PRIVATE-TOKEN": this.config.token,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`GitLab connection test failed for project '${this.config.projectId}' with HTTP ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      message: `Successfully connected to GitLab project '${data.name_with_namespace || this.config.projectId}'`,
    };
  }
}

module.exports = {
  GitLabIssuesConnector,
};
