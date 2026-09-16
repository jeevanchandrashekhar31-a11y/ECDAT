/**
 * Generic Webhook Ticketing Connector — Phase 14.1
 *
 * Implements connector interface for arbitrary enterprise ticketing gateways,
 * SOAR platforms (Splunk SOAR, Palo Alto Cortex XSOAR), and event buses.
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

const crypto = require("crypto");
const { BaseTicketingConnector } = require("./base_connector");
const { TicketResponse } = require("../../domain/contracts");

class WebhookConnector extends BaseTicketingConnector {
  constructor(options = {}) {
    super({
      name: options.name || "webhook-default",
      connectorType: "webhook",
      config: options.config || {},
      fetchFn: options.fetchFn,
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.url) throw new Error("Webhook connector requires 'url'");
  }

  get url() {
    return this.config.url;
  }

  get secret() {
    return this.config.secret || "";
  }

  get maxRetries() {
    return Number.isInteger(this.config.maxRetries) ? this.config.maxRetries : 2;
  }

  /**
   * Pure formatter generating the standardized event payload with all 8 mandatory fields.
   */
  formatPayload(ticketRequest) {
    return {
      event: "ecdat.finding.ticket",
      eventId: `evt_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      ticket: {
        asset_id: ticketRequest.assetId,
        finding_id: ticketRequest.findingId,
        severity: ticketRequest.severity,
        owner: ticketRequest.owner,
        evidence_link: ticketRequest.evidenceLink,
        remediation: ticketRequest.remediation,
        cbom_ref: ticketRequest.cbomRef,
        risk_score: ticketRequest.riskScore,
        title: ticketRequest.title,
        description: ticketRequest.description,
      },
      metadata: ticketRequest.metadata || {},
    };
  }

  /**
   * Computes HMAC-SHA256 signature for payload verification.
   */
  computeSignature(payloadString, timestamp) {
    if (!this.secret) return null;
    const hmac = crypto.createHmac("sha256", this.secret);
    hmac.update(`${timestamp}.${payloadString}`);
    return `sha256=${hmac.digest("hex")}`;
  }

  async sendCreateRequest(ticketRequest, payload) {
    const payloadString = JSON.stringify(payload);
    const timestamp = payload.timestamp || new Date().toISOString();

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "ECDAT-Webhook-Connector/1.0",
      "X-ECDAT-Event": payload.event,
      "X-ECDAT-Event-Id": payload.eventId,
      "X-ECDAT-Timestamp": timestamp,
      ...(this.config.headers || {}),
    };

    const signature = this.computeSignature(payloadString, timestamp);
    if (signature) {
      headers["X-ECDAT-Signature"] = signature;
    }

    let lastError = null;
    let res = null;
    let data = null;

    // Retry loop for transient failures (HTTP 429, 502, 503, 504)
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        res = await this.fetchFn(this.url, {
          method: "POST",
          headers,
          body: payloadString,
        });

        data = await res.json().catch(() => ({}));

        if (res.ok) {
          const ticketId = data.ticketId || data.id || data.eventId || payload.eventId;
          const ticketUrl = data.ticketUrl || data.url || this.url;

          return new TicketResponse({
            success: true,
            ticketId: String(ticketId),
            ticketUrl: String(ticketUrl),
            connectorType: "webhook",
            status: data.status || "DISPATCHED",
            rawResponse: data,
          });
        }

        // Only retry on transient server errors
        if (![429, 502, 503, 504].includes(res.status)) {
          throw new Error(`Webhook endpoint returned HTTP ${res.status}: ${JSON.stringify(data)}`);
        }

        lastError = new Error(`Webhook endpoint returned HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
        if (attempt === this.maxRetries) break;
      }
    }

    throw lastError || new Error("Webhook delivery failed after maximum retries");
  }

  async testConnection() {
    const pingPayload = {
      event: "ecdat.webhook.ping",
      eventId: `ping_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    };
    const payloadStr = JSON.stringify(pingPayload);
    const headers = {
      "Content-Type": "application/json",
      "X-ECDAT-Event": "ecdat.webhook.ping",
      ...(this.config.headers || {}),
    };
    if (this.secret) {
      headers["X-ECDAT-Signature"] = this.computeSignature(payloadStr, pingPayload.timestamp);
    }

    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers,
      body: payloadStr,
    });

    if (!res.ok) {
      throw new Error(`Webhook ping failed with HTTP ${res.status}`);
    }

    return {
      ok: true,
      message: `Successfully reached webhook URL '${this.url}'`,
    };
  }
}

module.exports = {
  WebhookConnector,
};
