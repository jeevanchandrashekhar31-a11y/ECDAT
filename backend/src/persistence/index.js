/**
 * Persistence Subsystem Boundary
 * Responsible for transactional persistence and data mapping between
 * domain entities and PostgreSQL tables via Knex.
 */

const { db } = require("../db/connection");
const { ingestCbomTransaction } = require("../services/cbom_ingestion");

/**
 * Persists a complete scan execution record transactionally.
 * @param {object} params
 * @returns {Promise<object>}
 */
async function persistScanExecution({ scanRecord, rawCbom = null }) {
  return await ingestCbomTransaction(scanRecord, rawCbom);
}

/**
 * Retrieves an asset by ID from persistence.
 * @param {string} scanId
 * @param {string} assetId
 */
async function findAssetById(scanId, assetId) {
  return await db("assets")
    .where({ scan_id: scanId, id: assetId })
    .first();
}

/**
 * Retrieves findings for a scan with optional filters.
 * @param {string} scanId
 * @param {object} filters
 */
async function findFindingsByScan(scanId, filters = {}) {
  let query = db("findings").where({ scan_id: scanId });
  if (filters.severity) {
    query = query.where("severity", filters.severity);
  }
  if (filters.algorithm) {
    query = query.where("algorithm", filters.algorithm);
  }
  return await query;
}

const {
  storeVulnerabilityCorrelations,
  findVulnerabilityCorrelationsByScan,
  findVulnerabilityCorrelationsByApp,
} = require("./vulnerability_store");

module.exports = {
  persistScanExecution,
  findAssetById,
  findFindingsByScan,
  storeVulnerabilityCorrelations,
  findVulnerabilityCorrelationsByScan,
  findVulnerabilityCorrelationsByApp,
  db,
};

