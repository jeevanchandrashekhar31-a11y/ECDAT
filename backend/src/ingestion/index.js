/**
 * Ingestion Subsystem Boundary
 * Responsible for input validation, payload size enforcement, private key redaction,
 * and CycloneDX 1.6 / SARIF format verification.
 */

const {
  validateCbomStructure,
  detectPrivateKeys,
  redactPrivateKeys,
} = require("../services/cbom_validation");

/**
 * Validates and sanitizes an incoming raw CBOM payload before ingestion.
 * @param {object} rawPayload
 * @returns {{ valid: boolean, sanitized: object, errors: Array<string>, privateKeysDetected: boolean }}
 */
function ingestCbomPayload(rawPayload) {
  const hasKeys = detectPrivateKeys(rawPayload);
  const redactResult = redactPrivateKeys(rawPayload);
  const sanitized = redactResult ? redactResult.sanitized : rawPayload;
  const validation = validateCbomStructure(sanitized);

  return {
    valid: validation.valid,
    sanitized: validation.valid ? sanitized : null,
    errors: validation.errors || [],
    warnings: validation.warnings || [],
    componentCount: validation.componentsCount || 0,
    privateKeysDetected: Boolean(hasKeys || (redactResult && redactResult.redactedCount > 0)),
  };
}

module.exports = {
  ingestCbomPayload,
  validateCbomStructure,
  detectPrivateKeys,
  redactPrivateKeys,
};
