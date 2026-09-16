/**
 * ECDAT Compliance Module (Phase 11.3)
 */

const {
  ComplianceMapper,
  NON_CERTIFICATION_DISCLAIMER,
  SUPPORT_LEVELS,
  sanitizeEvidenceData,
  redactSecretString,
} = require("./compliance_mapper");

let _defaultMapper = null;

function getDefaultComplianceMapper(options = {}) {
  if (!_defaultMapper || Object.keys(options).length > 0) {
    _defaultMapper = new ComplianceMapper(options);
  }
  return _defaultMapper;
}

function assessCompliance(assetsOrCbom, standardIds = null, options = {}) {
  const mapper = getDefaultComplianceMapper(options);
  return mapper.assess(assetsOrCbom, standardIds);
}

module.exports = {
  ComplianceMapper,
  NON_CERTIFICATION_DISCLAIMER,
  SUPPORT_LEVELS,
  sanitizeEvidenceData,
  redactSecretString,
  getDefaultComplianceMapper,
  assessCompliance,
};
