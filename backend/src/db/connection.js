const knex = require("knex");
const knexConfig = require("../../knexfile");
const config = require("../config");

const isTestEnv =
  config.NODE_ENV === "test" ||
  process.env.NODE_ENV === "test" ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  (Array.isArray(process.execArgv) && process.execArgv.some((arg) => arg.includes("--test"))) ||
  (Array.isArray(process.argv) && process.argv.some((arg) => arg.includes("--test") || arg.includes(".test.js") || arg.includes("tests")));

const environment =
  config.NODE_ENV === "production"
    ? "production"
    : isTestEnv
      ? "test"
      : "development";
const db = knex(knexConfig[environment]);

/**
 * Checks if the PostgreSQL connection is active and healthy within a timeout.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000]
 */
async function isDbConnected(options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  try {
    const checkPromise = db.raw("SELECT 1");
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), timeoutMs),
    );
    await Promise.race([checkPromise, timeoutPromise]);
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Strips internal connection credentials, ports, and internal details from DB errors
 * to prevent error-based information disclosure.
 *
 * @param {Error|string} err
 * @returns {string} Sanitized safe error message
 */
function sanitizeDbError(err) {
  if (!err) return "Database operation error";
  const msg = typeof err === "string" ? err : err.message || "Database error";
  return msg
    .replace(/(:\/\/[^:]+:)[^@]+(@)/g, "$1***$2")
    .replace(/password\s*=\s*['"][^'"]+['"]/gi, "password=***")
    .replace(/token\s*=\s*['"][^'"]+['"]/gi, "token=***")
    .replace(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:)[0-9]+/g, "$1****");
}

/**
 * Programmatically runs latest database migrations.
 */
async function runMigrations() {
  try {
    const [batchNo, log] = await db.migrate.latest();
    if (log.length === 0) {
      console.log("✓ Database schema is already up to date.");
    } else {
      console.log(
        `✓ Batch ${batchNo} executed ${log.length} migration(s): \n  - ${log.join("\n  - ")}`,
      );
    }
    return { batchNo, log };
  } catch (err) {
    console.error("❌ Database migration failed:", sanitizeDbError(err));
    throw new Error(sanitizeDbError(err));
  }
}

/**
 * Programmatically rolls back the latest migration batch.
 */
async function rollbackMigrations() {
  try {
    const [batchNo, log] = await db.migrate.rollback();
    return { batchNo, log };
  } catch (err) {
    console.error("❌ Database rollback failed:", sanitizeDbError(err));
    throw new Error(sanitizeDbError(err));
  }
}

/**
 * Returns connection pool statistics for health monitoring.
 */
function getConnectionPoolStats() {
  const pool = db.client?.pool;
  return {
    numUsed: pool?.numUsed?.() || 0,
    numFree: pool?.numFree?.() || 0,
    numPendingAcquires: pool?.numPendingAcquires?.() || 0,
    numPendingCreates: pool?.numPendingCreates?.() || 0,
  };
}

/**
 * Closes the database pool safely.
 */
async function closeDb() {
  await db.destroy();
}

module.exports = {
  db,
  isDbConnected,
  sanitizeDbError,
  runMigrations,
  rollbackMigrations,
  getConnectionPoolStats,
  closeDb,
};

