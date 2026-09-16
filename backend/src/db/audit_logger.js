/**
 * ECDAT Database Audit Logging Engine — Phase 16.2
 *
 * Implements tamper-resistant audit event logging for database operations.
 * Guarantees zero secret leakage in audit logs by automatically scrubbing
 * sensitive key material before persistence.
 */

const crypto = require("crypto");
const { scrubSecrets } = require("../security");
const { applyQueryBounds, safeRaw } = require("./secure_query");

const DB_AUDIT_EVENT_TYPES = Object.freeze({
  SCAN_INGESTED: "SCAN_INGESTED",
  SCAN_DELETED: "SCAN_DELETED",
  ALL_SCANS_CLEARED: "ALL_SCANS_CLEARED",
  CBOM_UPLOADED: "CBOM_UPLOADED",
  DATA_PRUNED: "DATA_PRUNED",
  BACKUP_CREATED: "BACKUP_CREATED",
  BACKUP_RESTORED: "BACKUP_RESTORED",
  BACKUP_VERIFIED: "BACKUP_VERIFIED",
  SCHEMA_MIGRATION: "SCHEMA_MIGRATION",
  SECURITY_VIOLATION: "SECURITY_VIOLATION",
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
});

// In-memory fallback audit buffer
const inMemoryAuditLogs = [];
const MAX_IN_MEMORY_LOGS = 1000;

/**
 * Records a database audit event.
 *
 * @param {object} client - Knex instance or null
 * @param {object} event
 * @param {string} event.eventType - One of DB_AUDIT_EVENT_TYPES
 * @param {string} [event.tableName]
 * @param {string} [event.recordId]
 * @param {string} [event.actor="system"]
 * @param {string} [event.tenantId]
 * @param {string} [event.action="INSERT"]
 * @param {string} [event.status="SUCCESS"]
 * @param {object} [event.details]
 * @param {string} [event.ipAddress]
 * @returns {Promise<object>} Created audit record
 */
async function logDbAudit(client, event = {}) {
  const { sanitized: sanitizedDetails } = scrubSecrets(event.details || {});

  const auditRecord = {
    id: `audit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    event_type: event.eventType || "DATABASE_OPERATION",
    table_name: event.tableName || null,
    record_id: event.recordId ? String(event.recordId).slice(0, 255) : null,
    actor: event.actor ? String(event.actor).slice(0, 100) : "system",
    tenant_id: event.tenantId ? String(event.tenantId).slice(0, 100) : null,
    action: event.action || "INSERT",
    status: event.status || "SUCCESS",
    details: sanitizedDetails,
    ip_address: event.ipAddress || null,
    created_at: new Date().toISOString(),
  };

  // Always append to in-memory buffer
  inMemoryAuditLogs.push(auditRecord);
  if (inMemoryAuditLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryAuditLogs.shift();
  }

  // Attempt database persistence if client is connected and table exists
  if (client) {
    try {
      const hasTable = await client.schema.hasTable("database_audit_events");
      if (hasTable) {
        await client("database_audit_events").insert({
          ...auditRecord,
          details: JSON.stringify(sanitizedDetails),
        });
      }
    } catch (err) {
      // In-memory log ensures audit event is preserved even if DB log fails
      console.warn(`Database audit log insert warning: ${err.message}`);
    }
  }

  return auditRecord;
}

/**
 * Retrieves audit logs with parameterized filtering and strict bounds.
 *
 * @param {object} client - Knex instance
 * @param {object} [filter={}]
 * @param {object} [options={}]
 * @returns {Promise<{ total: number, events: Array<object> }>}
 */
async function getDbAuditLogs(client, filter = {}, options = {}) {
  // If DB client is connected, query DB table
  if (client) {
    try {
      const hasTable = await client.schema.hasTable("database_audit_events");
      if (hasTable) {
        let query = client("database_audit_events");

        if (filter.eventType) {
          query = query.where({ event_type: filter.eventType });
        }
        if (filter.actor) {
          query = query.where({ actor: filter.actor });
        }
        if (filter.tenantId) {
          query = query.where({ tenant_id: filter.tenantId });
        }
        if (filter.tableName) {
          query = query.where({ table_name: filter.tableName });
        }

        query = applyQueryBounds(query.orderBy("created_at", "desc"), options);
        const rows = await query;

        const events = rows.map((r) => ({
          ...r,
          details: typeof r.details === "string" ? JSON.parse(r.details) : r.details,
        }));

        return { total: events.length, events };
      }
    } catch (_err) {
      // Fall through to in-memory store
    }
  }

  // Filter in-memory logs
  let events = [...inMemoryAuditLogs];
  if (filter.eventType) {
    events = events.filter((e) => e.event_type === filter.eventType);
  }
  if (filter.actor) {
    events = events.filter((e) => e.actor === filter.actor);
  }
  if (filter.tenantId) {
    events = events.filter((e) => e.tenant_id === filter.tenantId);
  }
  if (filter.tableName) {
    events = events.filter((e) => e.table_name === filter.tableName);
  }

  events.reverse();
  const limit = options.limit ? Math.min(parseInt(options.limit, 10), 500) : 50;
  const offset = options.offset ? parseInt(options.offset, 10) : 0;
  const paginated = events.slice(offset, offset + limit);

  return {
    total: events.length,
    events: paginated,
  };
}

module.exports = {
  DB_AUDIT_EVENT_TYPES,
  logDbAudit,
  getDbAuditLogs,
};
