/**
 * Secret Rotation Manager — Phase 14.2
 *
 * Implements automated and programmatic secret and key rotation.
 * Supports:
 * - JWT signing keys with Key ID (`kid`)
 * - Overlapping grace periods (dual-key window allowing smooth verification of tokens issued under previous key)
 * - OAuth client secret rotation
 * - API key rotation
 * - Integration with authentication audit logger
 */

const crypto = require("crypto");
const { defaultAuthAuditLogger, AUTH_EVENT_TYPES } = require("./auth_audit");

class SecretManager {
  constructor(options = {}) {
    this.gracePeriodMs = options.gracePeriodMs || 24 * 60 * 60 * 1000; // 24 hours default
    this.auditLogger = options.auditLogger || defaultAuthAuditLogger;

    // Map of keyType -> Array of key entries:
    // { kid, key, keyType, status: 'active' | 'retiring' | 'retired', createdAt, retiredAt }
    this.keys = new Map();

    // Initialize default signing key
    this.initializeDefaultKeys(options.initialSecret);
  }

  initializeDefaultKeys(initialSecret) {
    const defaultSecret = initialSecret || crypto.randomBytes(32).toString("hex");
    this.addKey("jwt_signing", {
      kid: `key_${Date.now()}_init`,
      secret: defaultSecret,
      algorithm: "HS256",
      status: "active",
      createdAt: new Date().toISOString(),
    });
  }

  addKey(keyType, keyEntry) {
    if (!this.keys.has(keyType)) {
      this.keys.set(keyType, []);
    }
    this.keys.get(keyType).push(keyEntry);
  }

  /**
   * Gets the current active signing key for a given key type.
   */
  getActiveKey(keyType = "jwt_signing") {
    const list = this.keys.get(keyType) || [];
    const active = list.find((k) => k.status === "active");
    if (!active) {
      throw new Error(`No active key found for keyType '${keyType}'`);
    }
    return active;
  }

  /**
   * Gets all verification keys (current active key + retiring keys within grace period).
   */
  getVerificationKeys(keyType = "jwt_signing") {
    const list = this.keys.get(keyType) || [];
    const now = Date.now();

    return list.filter((k) => {
      if (k.status === "active") return true;
      if (k.status === "retiring") {
        const retiredAtTime = new Date(k.retiredAt).getTime();
        return now - retiredAtTime < this.gracePeriodMs;
      }
      return false;
    });
  }

  /**
   * Finds a key by kid across active and retiring keys.
   */
  getKeyByKid(kid, keyType = "jwt_signing") {
    const verificationKeys = this.getVerificationKeys(keyType);
    return verificationKeys.find((k) => k.kid === kid) || null;
  }

  /**
   * Rotates a key, creating a new active key and moving the old one to retiring state.
   */
  rotateKey(keyType = "jwt_signing", options = {}) {
    const list = this.keys.get(keyType) || [];
    const oldActive = list.find((k) => k.status === "active");

    const newSecret = options.newSecret || crypto.randomBytes(32).toString("hex");
    const newKid = options.newKid || `key_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const algorithm = options.algorithm || (oldActive ? oldActive.algorithm : "HS256");

    const now = new Date().toISOString();

    // Transition old active key to retiring
    if (oldActive) {
      oldActive.status = "retiring";
      oldActive.retiredAt = now;
    }

    // Insert new active key
    const newEntry = {
      kid: newKid,
      secret: newSecret,
      algorithm,
      status: "active",
      createdAt: now,
      rotatedFromKid: oldActive ? oldActive.kid : null,
    };

    this.addKey(keyType, newEntry);

    // Audit rotation event
    this.auditLogger.logEvent({
      eventType: AUTH_EVENT_TYPES.SECRET_ROTATED,
      userId: options.actor || "system",
      provider: "secret_manager",
      status: "SUCCESS",
      reason: `Rotated key for '${keyType}' from '${oldActive ? oldActive.kid : "none"}' to '${newKid}'`,
      metadata: {
        keyType,
        newKid,
        previousKid: oldActive ? oldActive.kid : null,
        gracePeriodMs: this.gracePeriodMs,
      },
    });

    return {
      success: true,
      keyType,
      newKid,
      previousKid: oldActive ? oldActive.kid : null,
      createdAt: now,
      gracePeriodMs: this.gracePeriodMs,
    };
  }

  /**
   * Purges retired keys whose grace periods have fully expired.
   */
  purgeExpiredKeys(keyType = "jwt_signing") {
    const list = this.keys.get(keyType) || [];
    const now = Date.now();
    const kept = [];
    let purgedCount = 0;

    for (const k of list) {
      if (k.status === "retiring") {
        const retiredAt = new Date(k.retiredAt).getTime();
        if (now - retiredAt >= this.gracePeriodMs) {
          k.status = "retired";
          purgedCount++;
          continue;
        }
      }
      kept.push(k);
    }

    this.keys.set(keyType, kept);
    return purgedCount;
  }
}

// Global default singleton instance
const defaultSecretManager = new SecretManager();

module.exports = {
  SecretManager,
  defaultSecretManager,
};
