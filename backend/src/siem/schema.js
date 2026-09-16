/**
 * ECDAT SIEM Integration Subsystem — Phase 18.2 Schema Validator
 *
 * Validates security events against the formal JSON schema:
 * `rules/schemas/siem_security_event.schema.json`
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

let addFormats = null;
try {
  addFormats = require("ajv-formats");
} catch {
  // ajv-formats optional
}

const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../rules/schemas/siem_security_event.schema.json"
);

let ajvInstance = null;
let validateFn = null;

function getSiemSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

function getValidator() {
  if (validateFn) return validateFn;

  ajvInstance = new Ajv({ allErrors: true, strict: false });

  if (addFormats) {
    try {
      addFormats(ajvInstance);
    } catch {}
  } else {
    // Basic date-time format fallback
    ajvInstance.addFormat("date-time", {
      validate: (dateTimeString) => !isNaN(Date.parse(dateTimeString)),
    });
  }

  const schemaContent = getSiemSchema();
  validateFn = ajvInstance.compile(schemaContent);
  return validateFn;
}

/**
 * Validates a SIEM event against the canonical schema.
 *
 * @param {object} event
 * @returns {{ valid: boolean, errors: Array<string>|null }}
 */
function validateSiemEvent(event) {
  const validate = getValidator();
  const valid = validate(event);

  if (!valid) {
    const errorMessages = (validate.errors || []).map(
      (err) => `${err.instancePath || "/"} ${err.message}`
    );
    return { valid: false, errors: errorMessages };
  }

  return { valid: true, errors: null };
}

module.exports = {
  validateSiemEvent,
  getSiemSchema,
  SCHEMA_PATH,
};
