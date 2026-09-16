/**
 * ECDAT Database Security Module Barrel — Phase 16.2
 */

const connection = require("./connection");
const secureQuery = require("./secure_query");
const leastPrivilege = require("./least_privilege");
const auditLogger = require("./audit_logger");
const retentionPolicy = require("./retention_policy");
const backupService = require("./backup_service");

module.exports = {
  ...connection,
  ...secureQuery,
  ...leastPrivilege,
  ...auditLogger,
  ...retentionPolicy,
  ...backupService,
};
