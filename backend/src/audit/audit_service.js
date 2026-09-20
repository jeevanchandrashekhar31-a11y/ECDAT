/**
 * ECDAT Audit Logging Subsystem — Phase 18.1 Audit Service
 *
 * Centralized audit logging service providing:
 * - Tamper-resistant cryptographic event chaining
 * - Zero-secret automated redaction
 * - Dual storage (in-memory ring ledger + optional PostgreSQL persistence)
 * - Integrity verification, querying, statistics, and signed JSON export
 */

const crypto = require("crypto");
const { AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES, ACTION_TO_CATEGORY_MAP } = require("./event_types");
const { scrubSecrets } = require("./scrubber");
const { GENESIS_HASH, computeEventHash, signHash, verifyAuditChain } = require("./tamper_chain");

class AuditService {
  /**
   * @param {object} [options={}]
   * @param {number} [options.maxInMemoryEvents=2000]
   * @param {string} [options.secretKey]
   */
  constructor(options = {}) {
    this.maxInMemoryEvents = options.maxInMemoryEvents || 2000;
    this.secretKey = options.secretKey || process.env.AUDIT_HMAC_SECRET || "ecdat-tamper-chain-hmac-key-2026";
    this.events = [];
    this.sequenceCounter = 0;
    this.lastHash = GENESIS_HASH;
    this.listeners = new Set();
  }

  get memoryLedger() {
    return this.events;
  }

  /**
   * Records a tamper-resistant audit event across one of the 11 required categories.
   *
   * @param {object} eventInput
   * @param {string} [eventInput.category] - One of AUDIT_CATEGORIES
   * @param {string} eventInput.action - One of AUDIT_ACTIONS or descriptive string
   * @param {object} [eventInput.actor] - { id, username, role, ipAddress, userAgent }
   * @param {string} [eventInput.tenantId]
   * @param {object} [eventInput.target] - { type, id, name }
   * @param {string} [eventInput.status="SUCCESS"] - SUCCESS | FAILURE | DENIED | LOCKED | ERROR
   * @param {object} [eventInput.details={}] - Arbitrary details (automatically scrubbed of secrets)
   * @param {string} [eventInput.ipAddress]
   * @param {string} [eventInput.userAgent]
   * @param {object} [client] - Optional Knex DB connection
   * @returns {Promise<object>} Persisted audit record with hash and signature
   */
  async logEvent(eventInput = {}, client = null) {
    // 1. Determine canonical category
    const action = eventInput.action || AUDIT_ACTIONS.CONFIG_UPDATED;
    const category = eventInput.category || ACTION_TO_CATEGORY_MAP[action] || AUDIT_CATEGORIES.CONFIG_CHANGE;

    // 2. Extract and format actor details safely
    const rawActor = {
      id: String(eventInput.actor?.id || eventInput.actor?.userId || eventInput.actor?.username || "system").slice(0, 128),
      username: String(eventInput.actor?.username || eventInput.actor?.name || eventInput.actor?.id || "system").slice(0, 128),
      role: String(eventInput.actor?.role || "viewer").slice(0, 64),
      ipAddress: eventInput.ipAddress || eventInput.sourceIp || eventInput.source_ip || eventInput.actor?.ipAddress || null,
      userAgent: eventInput.userAgent || eventInput.actor?.userAgent || null,
    };
    const { sanitized: actor } = scrubSecrets(rawActor);

    // 3. Extract target safely
    let rawTarget;
    if (typeof eventInput.target === "string") {
      rawTarget = {
        type: "resource",
        id: eventInput.target,
        name: eventInput.target,
      };
    } else if (eventInput.target && typeof eventInput.target === "object") {
      rawTarget = {
        type: String(eventInput.target.type || "system").slice(0, 64),
        id: String(eventInput.target.id || "none").slice(0, 256),
        name: eventInput.target.name ? String(eventInput.target.name).slice(0, 256) : null,
      };
    } else {
      rawTarget = { type: "system", id: "none", name: null };
    }
    const { sanitized: target } = scrubSecrets(rawTarget);

    // 4. Guaranteed Zero-Secret Scrubbing of details and reason
    const { sanitized: scrubbedDetails } = scrubSecrets(eventInput.details || {});
    let reason = eventInput.reason || eventInput.details?.reason || null;
    if (reason && typeof reason === "string") {
      const { sanitized: cleanReason } = scrubSecrets(reason);
      reason = cleanReason;
    }

    // 5. Build sequence, identifiers, and timestamps
    this.sequenceCounter++;
    const sequenceNumber = this.sequenceCounter;
    const eventId = `audit_evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;
    const tenant = String(eventInput.tenant || eventInput.tenantId || "default").slice(0, 100);
    const tenantId = tenant;
    const status = eventInput.status || eventInput.result || AUDIT_STATUSES.SUCCESS;
    const result = status;
    const requestId = eventInput.requestId || eventInput.request_id || eventInput.details?.requestId || eventInput.details?.request_id || null;
    const sourceIp = actor.ipAddress || null;

    // 6. Calculate cryptographic hash and HMAC signature
    const eventForHashing = {
      eventId,
      sequenceNumber,
      timestamp,
      category,
      action,
      actor,
      tenant,
      tenantId,
      target,
      requestId,
      result,
      status,
      reason,
      sourceIp,
      details: scrubbedDetails,
    };

    const hash = computeEventHash(eventForHashing, prevHash);
    const signature = signHash(hash, this.secretKey);
    this.lastHash = hash;

    // 7. Complete immutable record with all 9 mandated top-level fields and aliases
    const auditRecord = {
      ...eventForHashing,
      request_id: requestId,
      source_ip: sourceIp,
      ipAddress: sourceIp,
      prevHash,
      previousHash: prevHash,
      hash,
      signature,
      createdAt: timestamp,
    };

    // 8. Append to in-memory ledger
    this.events.push(auditRecord);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    // 9. Attempt database persistence if table exists
    if (client) {
      try {
        const hasTable = await client.schema.hasTable("system_audit_events");
        if (hasTable) {
          await client("system_audit_events").insert({
            event_id: auditRecord.eventId,
            sequence_number: auditRecord.sequenceNumber,
            timestamp: auditRecord.timestamp,
            category: auditRecord.category,
            action: auditRecord.action,
            actor_id: auditRecord.actor.id,
            actor_username: auditRecord.actor.username,
            actor_role: auditRecord.actor.role,
            ip_address: auditRecord.actor.ipAddress,
            user_agent: auditRecord.actor.userAgent,
            tenant_id: auditRecord.tenantId,
            target_type: auditRecord.target.type,
            target_id: auditRecord.target.id,
            target_name: auditRecord.target.name,
            status: auditRecord.status,
            details: JSON.stringify(auditRecord.details),
            prev_hash: auditRecord.prevHash,
            hash: auditRecord.hash,
            signature: auditRecord.signature,
            created_at: auditRecord.createdAt,
          });
        }
      } catch (err) {
        console.warn(`[Audit Ledger] Database persistence warning: ${err.message}`);
      }
    }

    // 10. Notify any registered event listeners (e.g. SIEM dispatcher)
    this.notifyListeners(auditRecord);

    return auditRecord;
  }

  /**
   * Retrieves audit events matching filtering criteria with bounded pagination.
   *
   * @param {object} [filter={}]
   * @param {string} [filter.category]
   * @param {string} [filter.action]
   * @param {string} [filter.actor] - Matches username or ID
   * @param {string} [filter.tenantId]
   * @param {string} [filter.status]
   * @param {string} [filter.startTime]
   * @param {string} [filter.endTime]
   * @param {object} [options={}]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @param {string} [options.sortOrder="desc"] - "asc" or "desc"
   * @returns {{ total: number, events: Array<object> }}
   */
  getEvents(filter = {}, options = {}) {
    let filtered = [...this.events];

    if (filter.category) {
      filtered = filtered.filter((e) => e.category === filter.category);
    }
    if (filter.action) {
      filtered = filtered.filter((e) => e.action === filter.action);
    }
    if (filter.actor) {
      const term = filter.actor.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.actor.username.toLowerCase().includes(term) ||
          e.actor.id.toLowerCase().includes(term)
      );
    }
    if (filter.tenantId) {
      filtered = filtered.filter((e) => e.tenantId === filter.tenantId);
    }
    if (filter.status) {
      filtered = filtered.filter((e) => e.status === filter.status);
    }
    if (filter.startTime) {
      const start = new Date(filter.startTime).getTime();
      if (!isNaN(start)) {
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= start);
      }
    }
    if (filter.endTime) {
      const end = new Date(filter.endTime).getTime();
      if (!isNaN(end)) {
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= end);
      }
    }

    const total = filtered.length;

    // Sorting
    const sortOrder = options.sortOrder === "asc" ? "asc" : "desc";
    filtered.sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sortOrder === "asc" ? diff : -diff;
    });

    const limit = options.limit ? Math.min(Math.max(parseInt(options.limit, 10), 1), 500) : 50;
    const offset = options.offset ? Math.max(parseInt(options.offset, 10), 0) : 0;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      events: paginated,
    };
  }

  /**
   * Verifies the cryptographic chain integrity of the audit ledger.
   *
   * @param {string} [tenantId] - Optional tenant scoping
   * @returns {{ valid: boolean, totalVerified: number, lastHash: string, error: object|null }}
   */
  verifyIntegrity(tenantId = null) {
    // 1. Verify global chain contiguity and cryptographic integrity
    const result = verifyAuditChain(this.events, {
      secretKey: this.secretKey,
      verifySignatures: true,
    });

    if (!result.valid) {
      return {
        ...result,
        tamperDetected: true,
        verifiedRecords: result.totalVerified,
        reason: result.error ? result.error.reason : "Audit chain integrity failure",
      };
    }

    // 2. Count records belonging to specific tenant if requested
    const verifiedCount = tenantId
      ? this.events.filter((e) => e.tenantId === tenantId || e.tenant === tenantId).length
      : result.totalVerified;

    return {
      ...result,
      tamperDetected: false,
      verifiedRecords: verifiedCount,
      totalVerified: verifiedCount,
      reason: null,
    };
  }

  /**
   * Computes summary statistics across audit categories.
   * @param {string} [tenantId] - Optional tenant scoping
   */
  getSummaryStats(tenantId = null) {
    const events = tenantId
      ? this.events.filter((e) => e.tenantId === tenantId || e.tenant === tenantId)
      : this.events;
    const total = events.length;
    const byCategory = {};
    const byStatus = {};
    let recentFailures = 0;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const evt of events) {
      byCategory[evt.category] = (byCategory[evt.category] || 0) + 1;
      byStatus[evt.status] = (byStatus[evt.status] || 0) + 1;

      if (evt.status !== AUDIT_STATUSES.SUCCESS) {
        if (new Date(evt.timestamp).getTime() > oneHourAgo) {
          recentFailures++;
        }
      }
    }

    return {
      totalEvents: total,
      totalRecords: total,
      categoriesTracked: Object.keys(AUDIT_CATEGORIES).length,
      byCategory,
      categoryDistribution: byCategory,
      byStatus,
      recentFailuresPastHour: recentFailures,
      lastSequenceNumber: this.sequenceCounter,
      lastHash: this.lastHash,
    };
  }

  /**
   * Generates a verifiable, signed audit ledger export.
   *
   * @param {object} [filter={}]
   * @returns {object} Tamper-evident export payload
   */
  exportAuditTrail(filter = {}) {
    const { events, total } = this.getEvents(filter, { limit: 2000, sortOrder: "asc" });
    const verification = verifyAuditChain(events, { secretKey: this.secretKey, verifySignatures: true });

    const exportId = `audit_exp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    return {
      export_id: exportId,
      exportId,
      exportedAt: new Date().toISOString(),
      service: "ECDAT Observability & SIEM Engine",
      version: "1.0.0",
      totalExported: total,
      chain_integrity: verification,
      chainVerification: {
        isValid: verification.valid,
        valid: verification.valid,
        totalVerified: verification.totalVerified,
        genesisHash: GENESIS_HASH,
        lastHash: verification.lastHash,
        error: verification.error,
      },
      events,
    };
  }

  /**
   * Subscribes a listener to receive real-time audit events.
   *
   * @param {function(object): void} listener
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event) {
    this.listeners.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        console.error("Error in audit event listener:", err);
      }
    });
  }

  /**
   * Resets the in-memory audit ledger (useful for isolated unit testing).
   */
  reset() {
    this.events = [];
    this.sequenceCounter = 0;
    this.lastHash = GENESIS_HASH;
  }
}

const defaultAuditService = new AuditService();

module.exports = {
  AuditService,
  defaultAuditService,
};
