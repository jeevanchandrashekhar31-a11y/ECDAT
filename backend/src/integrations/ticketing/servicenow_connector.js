/**
 * ServiceNow Ticketing Connector — Phase 14.1
 *
 * Implements connector interface for ServiceNow Table API (Incident, Security Incident, Change).
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

// ServiceNow Urgency/Impact: 1 = High, 2 = Medium, 3 = Low
const SERVICENOW_URGENCY_MAP = {
  CRITICAL: "1",
  HIGH: "1",
  MEDIUM: "2",
  LOW: "3",
  INFO: "3",
  INFORMATIONAL: "3",
};

const SERVICENOW_IMPACT_MAP = {
  CRITICAL: "1",
  HIGH: "2",
  MEDIUM: "2",
  LOW: "3",
  INFO: "3",
  INFORMATIONAL: "3",
};

class ServiceNowConnector extends BaseTicketingConnector {
  constructor(options = {}) {
    super({
      name: options.name || "servicenow-default",
      connectorType: "servicenow",
      config: options.config || {},
      fetchFn: options.fetchFn,
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.instanceUrl) throw new Error("ServiceNow connector requires 'instanceUrl'");
    if (!config.username) throw new Error("ServiceNow connector requires 'username'");
    if (!config.password) throw new Error("ServiceNow connector requires 'password'");
  }

  get normalizedInstanceUrl() {
    return this.config.instanceUrl.replace(/\/+$/, "");
  }

  get table() {
    return this.config.table || "incident";
  }

  getAuthHeader() {
    const creds = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
    return `Basic ${creds}`;
  }

  /**
   * Pure formatter converting TicketRequest into ServiceNow Table API payload.
   */
  formatPayload(ticketRequest) {
    const sev = String(ticketRequest.severity || "MEDIUM").toUpperCase();
    const urgency = SERVICENOW_URGENCY_MAP[sev] || "2";
    const impact = SERVICENOW_IMPACT_MAP[sev] || "2";

    const description = [
      `ECDAT Cryptographic Security Finding`,
      `====================================`,
      `Asset ID:        ${ticketRequest.assetId}`,
      `Finding ID:      ${ticketRequest.findingId}`,
      `Severity:        ${ticketRequest.severity}`,
      `Owner:           ${ticketRequest.owner}`,
      `Evidence Link:   ${ticketRequest.evidenceLink}`,
      `CBOM Reference:  ${ticketRequest.cbomRef}`,
      `Risk Score:      ${ticketRequest.riskScore}`,
      ``,
      `Remediation Guidance:`,
      `${ticketRequest.remediation}`,
    ].join("\n");

    const workNotes = [
      `[ECDAT Automated Security Alert]`,
      `Evidence: ${ticketRequest.evidenceLink}`,
      `CBOM Reference: ${ticketRequest.cbomRef}`,
      `Risk Score: ${ticketRequest.riskScore}`,
      `Remediation: ${ticketRequest.remediation}`,
    ].join("\n");

    const record = {
      short_description: ticketRequest.title || `[ECDAT ${ticketRequest.severity}] Finding ${ticketRequest.findingId} on ${ticketRequest.assetId}`,
      description,
      urgency,
      impact,
      correlation_id: ticketRequest.findingId,
      correlation_display: "ECDAT",
      work_notes: workNotes,
      comments: `Finding assigned to ${ticketRequest.owner}. See remediation guidance for corrective action.`,
    };

    if (this.config.assignmentGroup) {
      record.assignment_group = this.config.assignmentGroup;
    }
    if (this.config.callerId) {
      record.caller_id = this.config.callerId;
    }

    // Custom fields mapping
    if (this.config.customFields && typeof this.config.customFields === "object") {
      for (const [k, v] of Object.entries(this.config.customFields)) {
        record[k] = v;
      }
    }

    return record;
  }

  async sendCreateRequest(ticketRequest, payload) {
    const endpoint = `${this.normalizedInstanceUrl}/api/now/table/${this.table}`;
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
      const errMsg = (data.error && data.error.message) || JSON.stringify(data);
      throw new Error(`ServiceNow record creation failed (HTTP ${res.status}): ${errMsg}`);
    }

    const record = data.result || {};
    const ticketId = record.number || record.sys_id || "UNKNOWN";
    const ticketUrl = `${this.normalizedInstanceUrl}/nav_to.do?uri=${this.table}.do?sys_id=${record.sys_id}`;

    return new TicketResponse({
      success: true,
      ticketId,
      ticketUrl,
      connectorType: "servicenow",
      status: record.state || "1", // 1 = New in ServiceNow
      rawResponse: record,
    });
  }

  async testConnection() {
    const endpoint = `${this.normalizedInstanceUrl}/api/now/table/${this.table}?sysparm_limit=1`;
    const res = await this.fetchFn(endpoint, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`ServiceNow connection test failed with HTTP ${res.status}`);
    }

    return {
      ok: true,
      message: `Successfully connected to ServiceNow instance '${this.normalizedInstanceUrl}' table '${this.table}'`,
    };
  }
}

module.exports = {
  ServiceNowConnector,
  SERVICENOW_URGENCY_MAP,
  SERVICENOW_IMPACT_MAP,
};
