const knex = require("knex");
const knexConfig = require("../../knexfile");
const config = require("../config");

const environment =
  config.NODE_ENV === "production"
    ? "production"
    : config.NODE_ENV === "test"
      ? "test"
      : "development";
const db = knex(knexConfig[environment]);

/**
 * Checks if the PostgreSQL connection is active and healthy.
 */
async function isDbConnected() {
  try {
    await db.raw("SELECT 1");
    return true;
  } catch (_err) {
    return false;
  }
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
    console.error("❌ Database migration failed:", err.message);
    throw err;
  }
}

/**
 * Closes the database pool.
 */
async function closeDb() {
  await db.destroy();
}

module.exports = {
  db,
  isDbConnected,
  runMigrations,
  closeDb,
};
