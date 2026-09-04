const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

class RulesValidationError extends Error {
  constructor(message, validationErrors = []) {
    super(message);
    this.name = "RulesValidationError";
    this.validationErrors = validationErrors;
  }
}

const DEFAULT_RULES_DIR = path.resolve(__dirname, "../../../rules");

const RULE_FILES_CONFIG = [
  {
    name: "algorithm_risk",
    rulePath: "algorithm_risk.json",
    schemaPath: "schemas/algorithm_risk.schema.json",
  },
  {
    name: "mosca_config",
    rulePath: "mosca_config.json",
    schemaPath: "schemas/mosca_config.schema.json",
  },
  {
    name: "policy_profiles",
    rulePath: "policy_profiles.json",
    schemaPath: "schemas/policy_profiles.schema.json",
  },
  {
    name: "pqc_recommendations",
    rulePath: "pqc_recommendations.json",
    schemaPath: "schemas/pqc_recommendations.schema.json",
  },
  {
    name: "crypto_library_catalog",
    rulePath: "crypto_library_catalog.json",
    schemaPath: "schemas/crypto_library_catalog.schema.json",
  },
];

let cachedRules = null;

/**
 * Loads a JSON file safely.
 */
function readJsonFileSync(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new RulesValidationError(`Required rule file not found: ${filePath}`);
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    throw new RulesValidationError(
      `JSON parsing error in file ${filePath}: ${err.message}`,
    );
  }
}

/**
 * Formats Ajv errors into clear, actionable messages.
 */
function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return ["Unknown validation failure"];
  return errors.map((err) => {
    const field = err.instancePath ? `Field '${err.instancePath}'` : "Root";
    return `${field} ${err.message} (schema rule: ${err.schemaPath})`;
  });
}

/**
 * Validates and loads all rule sets against their JSON schemas.
 * Fails safely with actionable errors.
 */
function loadAndValidateAllRules(rulesDir = DEFAULT_RULES_DIR) {
  const ajv = new Ajv({ allErrors: true, verbose: true });
  const loadedRules = {};
  const allErrors = [];

  for (const config of RULE_FILES_CONFIG) {
    const ruleFullPath = path.join(rulesDir, config.rulePath);
    const schemaFullPath = path.join(rulesDir, config.schemaPath);

    // 1. Read Schema and Rule JSON
    const schemaData = readJsonFileSync(schemaFullPath);
    const ruleData = readJsonFileSync(ruleFullPath);

    // 2. Compile Schema
    let validateFn;
    try {
      validateFn = ajv.compile(schemaData);
    } catch (err) {
      allErrors.push(
        `Failed to compile schema ${config.schemaPath}: ${err.message}`,
      );
      continue;
    }

    // 3. Validate Data
    const valid = validateFn(ruleData);
    if (!valid) {
      const formatted = formatAjvErrors(validateFn.errors);
      allErrors.push(
        `Validation failed for ${config.rulePath}:\n  - ` +
          formatted.join("\n  - "),
      );
    } else {
      loadedRules[config.name] = ruleData;
    }
  }

  if (allErrors.length > 0) {
    const combinedMessage =
      `ECDAT Rules Validation Error(s) on startup:\n` + allErrors.join("\n\n");
    throw new RulesValidationError(combinedMessage, allErrors);
  }

  cachedRules = loadedRules;
  return loadedRules;
}

function getRules(rulesDir = DEFAULT_RULES_DIR) {
  if (!cachedRules) {
    return loadAndValidateAllRules(rulesDir);
  }
  return cachedRules;
}

module.exports = {
  loadAndValidateAllRules,
  getRules,
  RulesValidationError,
  DEFAULT_RULES_DIR,
};
