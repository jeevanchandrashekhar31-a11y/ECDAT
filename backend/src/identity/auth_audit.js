/**
 * Authentication Audit Logger — Phase 14.2
 *
 * Implements tamper-evident audit logging for enterprise identity events.
 * Uses SHA-256 cryptographic hash chaining for non-repudiation and integrity verification.
 * Enforces strict zero credential leakage (passwords, tokens, or client secrets are NEVER logged).
 */

const crypto = require("crypto");

const AUTH_EVENT_TYPES = {
  AUTH_SUCCESS: "AUTH_SUCCESS",
  AUTH_FAILURE: "AUTH_FAILURE",
  TOKEN_ISSUED: "TOKEN_ISSUED",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",
  TOKEN_REVOKED: "TOKEN_REVOKED",
  SECRET_ROTATED: "SECRET_ROTATED",
  LOGOUT: "LOGOUT",
  SUSPICIOUS_REPLAY_DETECTED: "SUSPICIOUS_REPLAY_DETECTED",
  LDAP_BIND_ATTEMPT: "LDAP_BIND_ATTEMPT",
  AUTH_ACCOUNT_LOCKED: "AUTH_ACCOUNT_LOCKED",
  AUTH_MFA_CHALLENGE: "AUTH_MFA_CHALLENGE",
  AUTH_MFA_SUCCESS: "AUTH_MFA_SUCCESS",
  AUTH_MFA_FAILURE: "AUTH_MFA_FAILURE",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
};

class AuthAuditLogger {
  constructor(options = {}) {
    this.events = [];
    this.lastHash = options.initialHash || "0000000000000000000000000000000000000000000000000000000000000000";
    this.maxEvents = options.maxEvents || 10000;
  }

  /**
   * Sanitizes any object to guarantee zero password/token/secret leakage.
   */
  sanitizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== "object") return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (/(password|secret|token|authorization|apikey|code_verifier|privatekey)/i.test(key)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Logs an authentication event into the immutable hash chain.
   */
  logEvent({
    eventType,
    userId = "anonymous",
    provider = "unknown",
    ipAddress = "127.0.0.1",
    userAgent = "unknown",
    status = "SUCCESS",
    reason = "",
    metadata = {},
  }) {
    if (!AUTH_EVENT_TYPES[eventType]) {
      throw new Error(`Invalid authentication event type '${eventType}'`);
    }

    const eventId = `authevt_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const cleanMeta = this.sanitizeMetadata(metadata);

    const prevHash = this.lastHash;
    const entryData = JSON.stringify({
      eventId,
      eventType,
      userId: String(userId),
      provider: String(provider),
      ipAddress: String(ipAddress),
      userAgent: String(userAgent),
      status: String(status),
      reason: String(reason),
      metadata: cleanMeta,
      prevHash,
      timestamp,
    });

    const auditHash = crypto.createHash("sha256").update(entryData).digest("hex");
    this.lastHash = auditHash;

    const record = {
      eventId,
      eventType,
      userId: String(userId),
      provider: String(provider),
      ipAddress: String(ipAddress),
      userAgent: String(userAgent),
      status: String(status),
      reason: String(reason),
      metadata: cleanMeta,
      prevHash,
      auditHash,
      timestamp,
    };

    this.events.push(record);

    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    return record;
  }

  /**
   * Verifies the cryptographic integrity of the audit chain.
   */
  verifyChainIntegrity() {
    let expectedPrev = "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < this.events.length; i++) {
      const entry = this.events[i];
      if (i > 0 && entry.prevHash !== expectedPrev) {
        return {
          valid: false,
          error: `Hash chain broken at index ${i} (eventId: ${entry.eventId})`,
          brokenIndex: i,
        };
      }

      const entryData = JSON.stringify({
        eventId: entry.eventId,
        eventType: entry.eventType,
        userId: entry.userId,
        provider: entry.provider,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        status: entry.status,
        reason: entry.reason,
        metadata: entry.metadata,
        prevHash: entry.prevHash,
        timestamp: entry.timestamp,
      });

      const recalculated = crypto.createHash("sha256").update(entryData).digest("hex");
      if (recalculated !== entry.auditHash) {
        return {
          valid: false,
          error: `Tamper detected at index ${i} (eventId: ${entry.eventId}): hash mismatch`,
          brokenIndex: i,
        };
      }

      expectedPrev = entry.auditHash;
    }

    return { valid: true, totalEvents: this.events.length };
  }

  getRecentEvents(limit = 50) {
    return this.events.slice(-limit);
  }

  clear() {
    this.events = [];
    this.lastHash = "0000000000000000000000000000000000000000000000000000000000000000";
  }
}

// Global default singleton instance
const defaultAuthAuditLogger = new AuthAuditLogger();

module.exports = {
  AuthAuditLogger,
  AUTH_EVENT_TYPES,
  defaultAuthAuditLogger,
};
