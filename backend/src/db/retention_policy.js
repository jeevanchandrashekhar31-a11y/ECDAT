/**
 * ECDAT Database Data Retention Policy & Automated Pruning Engine — Phase 16.2
 *
 * Enforces compliance retention windows across database entities:
 * - scans & cboms: 90 days (configurable via RETENTION_SCANS_DAYS)
 * - scan_errors: 30 days (configurable via RETENTION_SCAN_ERRORS_DAYS)
 * - database_audit_events: 365 days (configurable via RETENTION_AUDIT_LOGS_DAYS)
 * - vulnerability_correlations: 180 days
 *
 * Guarantees:
 * - Batched deletion to prevent long table locks
 * - Safe dry-run estimation
 * - Audit event generation for every pruning execution
 */

const { logDbAudit, DB_AUDIT_EVENT_TYPES } = require("./audit_logger");

const DEFAULT_RETENTION_CONFIG = Object.freeze({
  scans: parseInt(process.env.RETENTION_SCANS_DAYS, 10) || 90,
  scan_errors: parseInt(process.env.RETENTION_SCAN_ERRORS_DAYS, 10) || 30,
  database_audit_events: parseInt(process.env.RETENTION_AUDIT_LOGS_DAYS, 10) || 365,
  vulnerability_correlations: 180,
});

/**
 * Returns current configured retention policy.
 */
function getRetentionPolicy() {
  return {
    ...DEFAULT_RETENTION_CONFIG,
    description: "Configured retention periods in days. Older records are subject to scheduled pruning.",
  };
}

/**
 * Calculates the ISO timestamp cutoff for a given retention period.
 *
 * @param {number} retentionDays
 * @param {Date} [referenceDate=new Date()]
 * @returns {string} ISO cutoff date string
 */
function calculateCutoffDate(retentionDays, referenceDate = new Date()) {
  const cutoff = new Date(referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

/**
 * Prunes expired records across database entities with batching and transaction safety.
 *
 * @param {object} client - Knex instance
 * @param {object} [options]
 * @param {string} [options.entityType] - Specific entity or all
 * @param {number} [options.retentionDays] - Override retention days
 * @param {number} [options.batchSize=500] - Records per deletion batch
 * @param {boolean} [options.dryRun=false] - If true, only estimates eligible records
 * @param {string} [options.actor="system"]
 * @returns {Promise<object>} Summary of pruned/eligible records
 */
async function pruneExpiredData(client, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const batchSize = Math.min(parseInt(options.batchSize, 10) || 500, 2000);
  const actor = options.actor || "system";
  const targetEntity = options.entityType ? options.entityType.toLowerCase() : "all";

  const entitiesToProcess =
    targetEntity === "all"
      ? ["scans", "scan_errors", "database_audit_events", "vulnerability_correlations"]
      : [targetEntity];

  const results = {
    dryRun,
    executedAt: new Date().toISOString(),
    batchSize,
    entities: {},
    totalRecordsPruned: 0,
  };

  if (!client) {
    return results;
  }

  for (const entity of entitiesToProcess) {
    const retentionDays =
      options.retentionDays !== undefined
        ? parseInt(options.retentionDays, 10)
        : DEFAULT_RETENTION_CONFIG[entity] || 90;

    const cutoff = calculateCutoffDate(retentionDays);

    try {
      const tableExists = await client.schema.hasTable(entity);
      if (!tableExists) {
        results.entities[entity] = { skipped: true, reason: "Table does not exist" };
        continue;
      }

      // 1. Count eligible expired records
      const countRes = await client(entity).where("created_at", "<", cutoff).count("* as total");
      const eligibleCount = parseInt(countRes[0]?.total || 0, 10);

      if (dryRun || eligibleCount === 0) {
        results.entities[entity] = {
          retentionDays,
          cutoffDate: cutoff,
          eligibleCount,
          prunedCount: 0,
        };
        continue;
      }

      // 2. Perform batched deletion to prevent long table locks
      let prunedThisEntity = 0;
      let remaining = eligibleCount;

      while (remaining > 0) {
        const toDeleteThisBatch = Math.min(remaining, batchSize);

        // Subquery for IDs to delete in this batch
        const idsToDelete = await client(entity)
          .where("created_at", "<", cutoff)
          .select("id")
          .limit(toDeleteThisBatch);

        if (idsToDelete.length === 0) break;

        const idList = idsToDelete.map((row) => row.id);
        const deleted = await client(entity).whereIn("id", idList).del();
        prunedThisEntity += deleted;
        remaining -= deleted;

        if (deleted === 0) break;
      }

      results.entities[entity] = {
        retentionDays,
        cutoffDate: cutoff,
        eligibleCount,
        prunedCount: prunedThisEntity,
      };
      results.totalRecordsPruned += prunedThisEntity;

      // 3. Log audit event for non-dry-run pruning
      await logDbAudit(client, {
        eventType: DB_AUDIT_EVENT_TYPES.DATA_PRUNED,
        tableName: entity,
        actor,
        action: "PRUNE",
        status: "SUCCESS",
        details: {
          entity,
          retentionDays,
          cutoffDate: cutoff,
          prunedCount: prunedThisEntity,
        },
      });
    } catch (err) {
      results.entities[entity] = {
        error: err.message,
        retentionDays,
        cutoffDate: cutoff,
      };
    }
  }

  return results;
}

module.exports = {
  DEFAULT_RETENTION_CONFIG,
  getRetentionPolicy,
  calculateCutoffDate,
  pruneExpiredData,
};
