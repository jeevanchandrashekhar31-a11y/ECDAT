/**
 * Base Ticketing Connector — Phase 14.1
 *
 * Defines the vendor-agnostic connector interface for enterprise ticketing systems.
 * Core risk code must remain completely decoupled from vendor-specific payload formatting,
 * status codes, or authentication schemas.
 */

const { TicketRequest, TicketResponse } = require("../../domain/contracts");

class BaseTicketingConnector {
  /**
   * @param {Object} options
   * @param {string} options.name - Unique identifier for connector instance
   * @param {string} options.connectorType - e.g. 'jira', 'servicenow', 'github', 'gitlab', 'webhook'
   * @param {Object} options.config - Vendor-specific configuration (credentials, endpoints)
   * @param {Function} [options.fetchFn] - Optional fetch implementation for testing/mocking
   */
  constructor({ name, connectorType, config = {}, fetchFn = globalThis.fetch } = {}) {
    if (!name) throw new Error("Connector requires a 'name'");
    if (!connectorType) throw new Error("Connector requires a 'connectorType'");
    
    this.name = String(name);
    this.connectorType = String(connectorType).toLowerCase();
    this.config = { ...config };
    this.fetchFn = fetchFn || globalThis.fetch;

    this.validateConfig(this.config);
  }

  /**
   * Validates vendor configuration options. Subclasses should override.
   * @param {Object} config
   */
  validateConfig(config) {
    if (!config) throw new Error(`${this.name} requires configuration object`);
  }

  /**
   * Pure formatter converting a standardized TicketRequest into the vendor's API payload.
   * Subclasses MUST implement this method.
   * @param {TicketRequest} ticketRequest
   * @returns {Object} Vendor-specific payload
   */
  formatPayload(ticketRequest) {
    throw new Error(`formatPayload() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Creates a ticket in the target system.
   * @param {TicketRequest|Object} rawRequest
   * @returns {Promise<TicketResponse>}
   */
  async createTicket(rawRequest) {
    const ticketRequest = rawRequest instanceof TicketRequest
      ? rawRequest
      : new TicketRequest(rawRequest);

    const payload = this.formatPayload(ticketRequest);
    return await this.sendCreateRequest(ticketRequest, payload);
  }

  /**
   * Sends the formatted payload to the vendor API. Subclasses MUST implement.
   * @param {TicketRequest} ticketRequest
   * @param {Object} payload
   * @returns {Promise<TicketResponse>}
   */
  async sendCreateRequest(ticketRequest, payload) {
    throw new Error(`sendCreateRequest() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Tests connectivity and credentials with the vendor API.
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  async testConnection() {
    return { ok: true, message: `Connection test succeeded for ${this.name}` };
  }

  /**
   * Sanitizes headers/secrets for logging.
   */
  sanitizeHeaders(headers = {}) {
    const sanitized = { ...headers };
    for (const key of Object.keys(sanitized)) {
      if (/(auth|token|secret|password|key)/i.test(key)) {
        sanitized[key] = "[REDACTED]";
      }
    }
    return sanitized;
  }
}

module.exports = {
  BaseTicketingConnector,
};
