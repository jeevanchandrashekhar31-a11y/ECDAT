/**
 * ECDAT Encrypted Database Backup & Restoration Engine — Phase 16.2
 *
 * Implements:
 * 1. Logical snapshot generation across application tables
 * 2. Mandatory AES-256-GCM authenticated encryption at rest for backup dumps
 * 3. SHA-256 cryptographic checksum integrity verification
 * 4. Safe restoration with transaction rollback
 * 5. Full audit logging for backup and restore lifecycle
 */

const crypto = require("crypto");
const { defaultEncryptionAtRest } = require("../security");
const { logDbAudit, DB_AUDIT_EVENT_TYPES } = require("./audit_logger");

// Target tables included in full database backups
const BACKUP_TABLES = [
  "policy_profiles",
  "rule_versions",
  "scans",
  "cboms",
  "assets",
  "components",
  "findings",
  "risk_assessments",
  "recommendations",
  "scan_errors",
  "vulnerability_correlations",
];

// In-memory backup catalog
const backupCatalog = new Map();

class BackupError extends Error {
  constructor(message, code = "ERR_BACKUP", details = {}) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates an encrypted database backup snapshot.
 *
 * @param {object} client - Knex instance
 * @param {object} [options]
 * @param {string} [options.actor="system"]
 * @param {string[]} [options.tables] - Optional subset of tables
 * @returns {Promise<object>} Backup manifest
 */
async function createEncryptedBackup(client, options = {}) {
  const actor = options.actor || "system";
  const tablesToBackup = options.tables || BACKUP_TABLES;
  const backupId = `backup_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const snapshotData = {
    backupId,
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    tables: {},
    tableCounts: {},
  };

  // Collect table data if client is provided
  if (client) {
    for (const table of tablesToBackup) {
      try {
        const tableExists = await client.schema.hasTable(table);
        if (tableExists) {
          const rows = await client(table).select("*");
          snapshotData.tables[table] = rows;
          snapshotData.tableCounts[table] = rows.length;
        }
      } catch (_err) {
        snapshotData.tableCounts[table] = 0;
      }
    }
  }

  // 1. Serialize to JSON
  const rawJson = JSON.stringify(snapshotData);

  // 2. Encrypt using AES-256-GCM authenticated encryption
  const encryptedCiphertext = defaultEncryptionAtRest.encrypt(rawJson, {
    aad: { backupId, type: "ecdat_db_backup" },
  });

  // 3. Compute SHA-256 checksum over encrypted payload
  const checksumSha256 = crypto.createHash("sha256").update(encryptedCiphertext).digest("hex");

  const backupRecord = {
    id: backupId,
    createdAt: snapshotData.createdAt,
    actor,
    tablesIncluded: Object.keys(snapshotData.tables),
    tableCounts: snapshotData.tableCounts,
    totalRecords: Object.values(snapshotData.tableCounts).reduce((a, b) => a + b, 0),
    encrypted: true,
    cipher: "AES-256-GCM",
    checksumSha256,
    sizeBytes: Buffer.byteLength(encryptedCiphertext, "utf8"),
    ciphertext: encryptedCiphertext,
  };

  // Store in catalog
  backupCatalog.set(backupId, backupRecord);

  // 4. Log audit event
  await logDbAudit(client, {
    eventType: DB_AUDIT_EVENT_TYPES.BACKUP_CREATED,
    recordId: backupId,
    actor,
    action: "BACKUP",
    status: "SUCCESS",
    details: {
      backupId,
      totalRecords: backupRecord.totalRecords,
      checksumSha256,
      sizeBytes: backupRecord.sizeBytes,
    },
  });

  // Return manifest without raw ciphertext in basic response
  const { ciphertext: _c, ...manifest } = backupRecord;
  return manifest;
}

/**
 * Verifies the integrity of a backup archive.
 *
 * @param {string} backupId
 * @returns {object} Verification status
 */
function verifyBackupIntegrity(backupId) {
  const record = backupCatalog.get(backupId);
  if (!record) {
    throw new BackupError(`Backup '${backupId}' not found`, "ERR_BACKUP_NOT_FOUND");
  }

  // 1. Verify SHA-256 checksum
  const computedChecksum = crypto.createHash("sha256").update(record.ciphertext).digest("hex");
  const checksumValid = computedChecksum === record.checksumSha256;

  if (!checksumValid) {
    return {
      backupId,
      valid: false,
      error: "SHA-256 checksum mismatch: backup archive has been corrupted or tampered with.",
    };
  }

  // 2. Verify decryption with authentication tag
  try {
    defaultEncryptionAtRest.decrypt(record.ciphertext, {
      aad: { backupId, type: "ecdat_db_backup" },
      parseJson: true,
    });

    return {
      backupId,
      valid: true,
      checksumValid: true,
      decryptionVerified: true,
      createdAt: record.createdAt,
      totalRecords: record.totalRecords,
      sizeBytes: record.sizeBytes,
    };
  } catch (err) {
    return {
      backupId,
      valid: false,
      error: `Decryption integrity failed: ${err.message}`,
    };
  }
}

/**
 * Restores tables from an encrypted backup snapshot.
 *
 * @param {object} client - Knex instance
 * @param {string} backupId
 * @param {object} [options]
 * @returns {Promise<object>} Restoration summary
 */
async function restoreFromBackup(client, backupId, options = {}) {
  const actor = options.actor || "system";
  const record = backupCatalog.get(backupId);
  if (!record) {
    throw new BackupError(`Backup '${backupId}' not found`, "ERR_BACKUP_NOT_FOUND");
  }

  // 1. Verify integrity before attempting restore
  const verification = verifyBackupIntegrity(backupId);
  if (!verification.valid) {
    throw new BackupError(`Restore rejected: backup integrity verification failed (${verification.error})`);
  }

  // 2. Decrypt backup payload
  const decrypted = defaultEncryptionAtRest.decrypt(record.ciphertext, {
    aad: { backupId, type: "ecdat_db_backup" },
    parseJson: true,
  });

  const restoredCounts = {};

  // 3. Transactionally restore tables
  if (client) {
    await client.transaction(async (trx) => {
      for (const [tableName, rows] of Object.entries(decrypted.tables || {})) {
        const tableExists = await trx.schema.hasTable(tableName);
        if (tableExists && rows && rows.length > 0) {
          // Clean existing table data
          await trx(tableName).del();
          // Insert backup rows
          await trx(tableName).insert(rows);
          restoredCounts[tableName] = rows.length;
        }
      }
    });
  }

  // 4. Log audit event
  await logDbAudit(client, {
    eventType: DB_AUDIT_EVENT_TYPES.BACKUP_RESTORED,
    recordId: backupId,
    actor,
    action: "RESTORE",
    status: "SUCCESS",
    details: {
      backupId,
      restoredCounts,
    },
  });

  return {
    backupId,
    restoredAt: new Date().toISOString(),
    restoredCounts,
  };
}

/**
 * Lists all available backup manifests.
 *
 * @returns {Array<object>}
 */
function listBackups() {
  const manifests = [];
  for (const record of backupCatalog.values()) {
    const { ciphertext: _c, ...manifest } = record;
    manifests.push(manifest);
  }
  return manifests;
}

module.exports = {
  BACKUP_TABLES,
  BackupError,
  createEncryptedBackup,
  verifyBackupIntegrity,
  restoreFromBackup,
  listBackups,
};
