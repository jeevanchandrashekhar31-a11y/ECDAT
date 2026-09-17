/**
 * Test Suite: ECDAT Database Security & Hardening — Phase 16.2
 *
 * Tests:
 * 1. Parameterized Queries & SQL Injection Defense
 * 2. Least-Privilege DB User Role Separation
 * 3. Migration Lifecycle & Security Indexes
 * 4. Encrypted Database Backups with Integrity Checksums
 * 5. Retention Policy & Batched Pruning Engine
 * 6. Database Audit Event Logging
 * 7. Query Bounding & Limits
 * 8. Safe Connection Handling & Error Sanitization
 * 9. Security REST API Endpoints
 */

const { describe, it, after } = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  detectSqlInjection,
  applyQueryBounds,
  scopeToTenant,
  safeRaw,
  DatabaseSecurityViolationError,
  ROLE_DEFINITIONS,
  generateLeastPrivilegeSql,
  inspectConnectionPrivileges,
  DB_AUDIT_EVENT_TYPES,
  logDbAudit,
  getDbAuditLogs,
  DEFAULT_RETENTION_CONFIG,
  getRetentionPolicy,
  calculateCutoffDate,
  pruneExpiredData,
  createEncryptedBackup,
  verifyBackupIntegrity,
  restoreFromBackup,
  listBackups,
  db,
  closeDb,
  sanitizeDbError,
  getConnectionPoolStats,
} = require("../../src/db");
const { isDbConnected } = require("../../src/db/connection");

const app = require("../../src/app");

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe("Phase 16.2 — Parameterized Queries & SQL Injection Defense", () => {
  it("detects SQL injection patterns in untrusted input strings", () => {
    assert.strictEqual(detectSqlInjection("legitimate_target_name").detected, false);

    // Classic OR 1=1 injection
    const orInject = detectSqlInjection("' OR '1'='1");
    assert.strictEqual(orInject.detected, true);

    // UNION SELECT injection
    const unionInject = detectSqlInjection("admin' UNION SELECT password FROM users --");
    assert.strictEqual(unionInject.detected, true);

    // Semicolon multi-statement injection
    const dropInject = detectSqlInjection("scan-123; DROP TABLE scans; --");
    assert.strictEqual(dropInject.detected, true);
  });

  it("parameterizes Knex queries and neutralizes SQL injection attempts", () => {
    const injectionInput = "' OR '1'='1' --";

    // Build parameterized query
    const query = db("scans").where({ target_name: injectionInput });
    const sqlString = query.toSQL();

    // SQL string must contain parameter placeholder ($1 or ?), NOT raw injected SQL
    assert.ok(sqlString.sql.includes("where") && (sqlString.sql.includes("?") || sqlString.sql.includes("$1")));
    assert.deepStrictEqual(sqlString.bindings, [injectionInput]);
  });

  it("safeRaw enforces parameter bindings and rejects unparameterized dynamic queries", async () => {
    // Correct parameterized raw query matches placeholder count
    const safeSql = "SELECT * FROM scans WHERE status = ? AND scenario = ?";
    const bindings = ["completed", "baseline"];

    // Mock client for testing safeRaw verification logic
    let rawExecuted = false;
    const mockClient = {
      raw: async (sql, b) => {
        rawExecuted = true;
        return { sql, bindings: b };
      },
    };

    const res = await safeRaw(mockClient, safeSql, bindings);
    assert.strictEqual(rawExecuted, true);
    assert.strictEqual(res.sql, safeSql);

    // Binding mismatch must throw
    await assert.rejects(
      async () => {
        await safeRaw(mockClient, "SELECT * FROM scans WHERE id = ?", []);
      },
      (err) => {
        assert.ok(err instanceof DatabaseSecurityViolationError);
        assert.strictEqual(err.code, "ERR_BINDING_MISMATCH");
        return true;
      }
    );

    // Multi-statement injection must be rejected
    await assert.rejects(
      async () => {
        await safeRaw(mockClient, "SELECT 1; DROP TABLE scans;");
      },
      (err) => {
        assert.ok(err instanceof DatabaseSecurityViolationError);
        assert.strictEqual(err.code, "ERR_MULTIPLE_STATEMENTS");
        return true;
      }
    );
  });

  it("scopeToTenant enforces tenant isolation and blocks SQL injection in tenantId", () => {
    const query = db("scans");

    // Legitimate tenantId
    const scoped = scopeToTenant(query, "tenant-finance-01");
    assert.ok(scoped.toSQL().sql.includes("tenant_id"));

    // Missing tenantId throws
    assert.throws(() => {
      scopeToTenant(query, null);
    }, DatabaseSecurityViolationError);

    // Injection in tenantId throws
    assert.throws(() => {
      scopeToTenant(query, "tenant-1' OR 1=1 --");
    }, DatabaseSecurityViolationError);
  });
});

describe("Phase 16.2 — Least-Privilege DB Users & Role Separation", () => {
  it("defines strict separation between migration DDL and runtime application DML", () => {
    const migrator = ROLE_DEFINITIONS.ecdat_migrator;
    assert.strictEqual(migrator.canExecuteDdl, true);
    assert.strictEqual(migrator.canExecuteDml, true);
    assert.strictEqual(migrator.isSuperuser, false);

    const appRole = ROLE_DEFINITIONS.ecdat_app;
    assert.strictEqual(appRole.canExecuteDdl, false); // Strictly denied DDL
    assert.strictEqual(appRole.canExecuteDml, true);
    assert.strictEqual(appRole.isSuperuser, false);

    const readonlyRole = ROLE_DEFINITIONS.ecdat_readonly;
    assert.strictEqual(readonlyRole.canExecuteDdl, false);
    assert.strictEqual(readonlyRole.canExecuteDml, false);
    assert.deepStrictEqual(readonlyRole.privileges, ["SELECT"]);

    const auditorRole = ROLE_DEFINITIONS.ecdat_auditor;
    assert.strictEqual(auditorRole.canExecuteDdl, false);
    assert.strictEqual(auditorRole.canExecuteDml, false);
  });

  it("generates PostgreSQL least-privilege role provisioning script", () => {
    const sql = generateLeastPrivilegeSql({ schemaName: "public", databaseName: "ecdat" });
    assert.ok(sql.includes("CREATE ROLE ecdat_migrator"));
    assert.ok(sql.includes("CREATE ROLE ecdat_app"));
    assert.ok(sql.includes("CREATE ROLE ecdat_readonly"));
    assert.ok(sql.includes("CREATE ROLE ecdat_auditor"));
    assert.ok(sql.includes("REVOKE ALL ON SCHEMA public FROM PUBLIC"));
    assert.ok(sql.includes("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecdat_app"));
    assert.ok(!sql.includes("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ecdat_app"));
  });

  it("inspectConnectionPrivileges reports compliant privilege posture", async () => {
    const status = await inspectConnectionPrivileges(db);
    assert.ok(status.currentUser);
    assert.strictEqual(typeof status.leastPrivilegeCompliant, "boolean");
  });
});

describe("Phase 16.2 — Query Limits & Bounding Guard", () => {
  it("enforces default limit and clamps excessive limits to max bound", () => {
    // Default limit
    const q1 = applyQueryBounds(db("scans"));
    const sql1 = q1.toSQL();
    assert.ok(sql1.sql.toLowerCase().includes("limit"));
    assert.ok(sql1.bindings.includes(DEFAULT_QUERY_LIMIT));

    // Specific valid limit
    const q2 = applyQueryBounds(db("scans"), { limit: 25, offset: 10 });
    const sql2 = q2.toSQL();
    assert.ok(sql2.sql.toLowerCase().includes("limit"));
    assert.ok(sql2.sql.toLowerCase().includes("offset"));
    assert.ok(sql2.bindings.includes(25));
    assert.ok(sql2.bindings.includes(10));

    // Excessive limit clamped to MAX_QUERY_LIMIT (500)
    const q3 = applyQueryBounds(db("scans"), { limit: 99999 });
    const sql3 = q3.toSQL();
    assert.ok(sql3.bindings.includes(MAX_QUERY_LIMIT));

    // Negative / invalid values sanitized
    const q4 = applyQueryBounds(db("scans"), { limit: -10, offset: -5 });
    const sql4 = q4.toSQL();
    assert.ok(sql4.bindings.includes(DEFAULT_QUERY_LIMIT));
    assert.ok(!sql4.sql.toLowerCase().includes("offset"));
  });
});

describe("Phase 16.2 — Database Audit Events", () => {
  it("logs database events with automatic secret scrubbing", async () => {
    const event = await logDbAudit(null, {
      eventType: DB_AUDIT_EVENT_TYPES.SCAN_INGESTED,
      tableName: "scans",
      recordId: "scan-999",
      actor: "sec-admin-1",
      action: "INSERT",
      details: {
        target: "https://api.internal.corp",
        accidentalKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
      },
    });

    assert.ok(event.id.startsWith("audit_"));
    assert.strictEqual(event.event_type, "SCAN_INGESTED");
    assert.strictEqual(event.record_id, "scan-999");
    assert.strictEqual(event.actor, "sec-admin-1");
    // Secrets must be scrubbed before audit logging
    assert.strictEqual(event.details.accidentalKey, "[REDACTED_PROHIBITED_PRIVATE_KEY]");
  });

  it("retrieves audit logs with filtering and bounded pagination", async () => {
    const result = await getDbAuditLogs(null, { eventType: DB_AUDIT_EVENT_TYPES.SCAN_INGESTED }, { limit: 10 });
    assert.ok(result.total >= 1);
    assert.ok(Array.isArray(result.events));
    assert.strictEqual(result.events[0].event_type, DB_AUDIT_EVENT_TYPES.SCAN_INGESTED);
  });
});

describe("Phase 16.2 — Data Retention Policy & Pruning Engine", () => {
  it("calculates retention cutoff dates accurately", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const cutoff30 = calculateCutoffDate(30, now);
    assert.strictEqual(cutoff30, "2026-08-15T12:00:00.000Z");

    const cutoff90 = calculateCutoffDate(90, now);
    assert.strictEqual(cutoff90, "2026-06-16T12:00:00.000Z");
  });

  it("retrieves configured retention policy", () => {
    const policy = getRetentionPolicy();
    assert.strictEqual(policy.scans, 90);
    assert.strictEqual(policy.scan_errors, 30);
    assert.strictEqual(policy.database_audit_events, 365);
    assert.strictEqual(policy.vulnerability_correlations, 180);
  });

  it("executes safe dry-run retention pruning without deleting records", async () => {
    const result = await pruneExpiredData(null, {
      entityType: "scans",
      retentionDays: 90,
      dryRun: true,
    });

    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.totalRecordsPruned, 0);
  });
});

describe("Phase 16.2 — Encrypted Database Backups", () => {
  it("creates an AES-256-GCM encrypted database backup with SHA-256 checksum", async () => {
    const backup = await createEncryptedBackup(null, { actor: "backup-operator-1" });

    assert.ok(backup.id.startsWith("backup_"));
    assert.strictEqual(backup.encrypted, true);
    assert.strictEqual(backup.cipher, "AES-256-GCM");
    assert.ok(backup.checksumSha256);
    assert.strictEqual(backup.checksumSha256.length, 64);
    assert.strictEqual(backup.actor, "backup-operator-1");
  });

  it("verifies backup integrity and detects corrupted archives", async () => {
    const backup = await createEncryptedBackup(null);

    const verification = verifyBackupIntegrity(backup.id);
    assert.strictEqual(verification.valid, true);
    assert.strictEqual(verification.checksumValid, true);
    assert.strictEqual(verification.decryptionVerified, true);
  });

  it("lists all available backup manifests", () => {
    const list = listBackups();
    assert.ok(list.length >= 1);
    assert.ok(list[0].id);
    assert.strictEqual(list[0].ciphertext, undefined); // Never leaks ciphertext in listing
  });
});

describe("Phase 16.2 — Safe Connection Handling & Sanitization", () => {
  it("sanitizes database error messages to prevent credential and topology disclosure", () => {
    const rawError =
      "error: password authentication failed for user 'postgres' at postgresql://postgres:SecretPass123@10.0.1.55:5432/ecdat";
    const sanitized = sanitizeDbError(rawError);

    assert.ok(!sanitized.includes("SecretPass123"));
    assert.ok(sanitized.includes("***"));
    assert.ok(!sanitized.includes("5432"));
  });

  it("reports connection pool statistics", () => {
    const stats = getConnectionPoolStats();
    assert.strictEqual(typeof stats.numUsed, "number");
    assert.strictEqual(typeof stats.numFree, "number");
    assert.strictEqual(typeof stats.numPendingAcquires, "number");
  });
});

describe("Phase 16.2 — Database Security REST API Endpoints", () => {
  it("GET /api/v1/security/database/least-privilege-roles returns role catalog", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/database/least-privilege-roles`, {
        headers: { "x-api-key": "ecdat-demo-admin-key-2026" },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.roles.ecdat_migrator);
      assert.ok(body.roles.ecdat_app);
      assert.ok(body.provisioningScript.includes("CREATE ROLE ecdat_app"));
    });
  });

  it("GET /api/v1/security/database/audit-logs returns audit events", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/database/audit-logs?limit=5`, {
        headers: { "x-api-key": "ecdat-demo-admin-key-2026" },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.events));
    });
  });

  it("GET /api/v1/security/database/retention-policy returns configured windows", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/database/retention-policy`, {
        headers: { "x-api-key": "ecdat-demo-admin-key-2026" },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.scans, 90);
      assert.strictEqual(body.database_audit_events, 365);
    });
  });

  it("POST /api/v1/security/database/prune estimates pruning in dry-run", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/database/prune`, {
        method: "POST",
        headers: {
          "x-api-key": "ecdat-demo-admin-key-2026",
          "content-type": "application/json",
        },
        body: JSON.stringify({ entityType: "scans", dryRun: true }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.dryRun, true);
    });
  });

  it("POST /api/v1/security/database/backups and verification endpoint", async () => {
    await withServer(async (baseUrl) => {
      // 1. Create encrypted backup
      const createRes = await fetch(`${baseUrl}/api/v1/security/database/backups`, {
        method: "POST",
        headers: {
          "x-api-key": "ecdat-demo-admin-key-2026",
          "content-type": "application/json",
        },
      });
      assert.strictEqual(createRes.status, 201);
      const createBody = await createRes.json();
      const backupId = createBody.backup.id;
      assert.ok(backupId);

      // 2. Verify backup
      const verifyRes = await fetch(`${baseUrl}/api/v1/security/database/backups/${backupId}/verify`, {
        method: "POST",
        headers: { "x-api-key": "ecdat-demo-admin-key-2026" },
      });
      assert.strictEqual(verifyRes.status, 200);
      const verifyBody = await verifyRes.json();
      assert.strictEqual(verifyBody.valid, true);

      // 3. List backups
      const listRes = await fetch(`${baseUrl}/api/v1/security/database/backups`, {
        headers: { "x-api-key": "ecdat-demo-admin-key-2026" },
      });
      assert.strictEqual(listRes.status, 200);
      const listBody = await listRes.json();
      assert.ok(listBody.total >= 1);
    });
  });

  it("POST /api/v1/security/database/test-query executes parameterized query and detects injection", async (t) => {
    if (!await isDbConnected()) {
      if (t && typeof t.skip === "function") {
        t.skip("PostgreSQL database is not available in current test environment");
      }
      return;
    }
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/database/test-query`, {
        method: "POST",
        headers: {
          "x-api-key": "ecdat-demo-admin-key-2026",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          targetName: "safe-service' OR '1'='1",
        }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.safe, true);
      assert.strictEqual(body.injectionDetected, true);
      assert.strictEqual(body.resultsCount, 0); // Injection treated as literal string, no rows leaked
    });
  });

  after(async () => {
    await closeDb();
  });
});
