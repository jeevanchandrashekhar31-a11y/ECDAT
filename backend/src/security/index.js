/**
 * ECDAT Security & Data Protection Barrel — Phase 16.1
 */

const dataClassification = require("./data_classification");
const secretStoragePolicy = require("./secret_storage_policy");
const encryptionAtRest = require("./encryption_at_rest");
const transitSecurity = require("./transit_security");
const cryptoClassifier = require("./crypto_classifier");
const cryptoSecurityService = require("./crypto_security_service");
const resultIntegrity = require("./result_integrity");

module.exports = {
  ...dataClassification,
  ...secretStoragePolicy,
  ...encryptionAtRest,
  ...transitSecurity,
  ...cryptoClassifier,
  ...cryptoSecurityService,
  ...resultIntegrity,
};

