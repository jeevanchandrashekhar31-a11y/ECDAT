/**
 * CBOM Validation and Sanitization Service
 *
 * Implements Phase 6.3 requirements:
 * 1. Validate CycloneDX format and supported versions (1.4, 1.5, 1.6)
 * 2. Component and finding bounds to prevent resource exhaustion (DoS)
 * 3. Unique and safe BOM refs validation
 * 4. Prototype pollution / dangerous key protection
 * 5. Private-key detection, rejection or redaction (never persisted)
 */

const MAX_COMPONENTS_LIMIT = 10000;
const MAX_CBOM_BYTES = 10 * 1024 * 1024;
const MAX_NESTING_DEPTH = 64;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Private key PEM / header patterns
const PRIVATE_KEY_REGEX =
  /(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)/gi;

/**
 * Checks for prototype pollution and unsupported dangerous keys.
 */
function checkForDangerousKeys(obj, path = "") {
  const violations = [];
  if (!obj || typeof obj !== "object") return violations;
  const stack = [{ value: obj, path, depth: 0 }];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) {
      violations.push(`Cyclic object detected at '${current.path || "root"}'.`);
      continue;
    }
    seen.add(current.value);
    if (current.depth > MAX_NESTING_DEPTH) {
      violations.push(
        `Payload nesting exceeds ${MAX_NESTING_DEPTH} levels at '${current.path || "root"}'.`,
      );
      continue;
    }
    for (const key of Object.getOwnPropertyNames(current.value)) {
      const childPath = current.path ? `${current.path}.${key}` : key;
      if (DANGEROUS_KEYS.has(key)) {
        violations.push(`Dangerous property detected: '${childPath}'`);
      } else if (
        typeof current.value[key] === "object" &&
        current.value[key] !== null
      ) {
        stack.push({
          value: current.value[key],
          path: childPath,
          depth: current.depth + 1,
        });
      }
    }
  }
  return violations;
}

function isPayloadWithinByteLimit(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_CBOM_BYTES;
  } catch {
    return false;
  }
}

/**
 * Recursively scans and redacts private-key material across all string fields.
 * Returns { sanitized, redactedCount, redactedPaths }
 */
function redactPrivateKeys(obj, path = "") {
  if (obj === null || obj === undefined)
    return { sanitized: obj, redactedCount: 0, redactedPaths: [] };

  if (typeof obj === "string") {
    if (PRIVATE_KEY_REGEX.test(obj)) {
      PRIVATE_KEY_REGEX.lastIndex = 0;
      const sanitized = obj.replace(
        PRIVATE_KEY_REGEX,
        "[REDACTED_PRIVATE_KEY]",
      );
      return { sanitized, redactedCount: 1, redactedPaths: [path || "root"] };
    }
    return { sanitized: obj, redactedCount: 0, redactedPaths: [] };
  }

  if (Array.isArray(obj)) {
    let totalCount = 0;
    const paths = [];
    const sanitizedArr = obj.map((item, idx) => {
      const res = redactPrivateKeys(item, `${path}[${idx}]`);
      totalCount += res.redactedCount;
      paths.push(...res.redactedPaths);
      return res.sanitized;
    });
    return {
      sanitized: sanitizedArr,
      redactedCount: totalCount,
      redactedPaths: paths,
    };
  }

  if (typeof obj === "object") {
    let totalCount = 0;
    const paths = [];
    const sanitizedObj = {};
    for (const [key, value] of Object.entries(obj)) {
      const res = redactPrivateKeys(value, path ? `${path}.${key}` : key);
      sanitizedObj[key] = res.sanitized;
      totalCount += res.redactedCount;
      paths.push(...res.redactedPaths);
    }
    return {
      sanitized: sanitizedObj,
      redactedCount: totalCount,
      redactedPaths: paths,
    };
  }

  return { sanitized: obj, redactedCount: 0, redactedPaths: [] };
}

/**
 * Detects whether any private keys exist without modifying the object.
 */
function detectPrivateKeys(obj) {
  const jsonStr = typeof obj === "string" ? obj : JSON.stringify(obj || {});
  PRIVATE_KEY_REGEX.lastIndex = 0;
  return PRIVATE_KEY_REGEX.test(jsonStr);
}

/**
 * Validates incoming CBOM JSON payloads for structural conformity, safety, and bounds.
 */
function validateCbomStructure(payload, options = {}) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      errors: ["Payload must be a valid JSON object or array"],
      warnings,
    };
  }

  if (!isPayloadWithinByteLimit(payload)) {
    return {
      valid: false,
      errors: [
        `Payload exceeds the ${MAX_CBOM_BYTES} byte safety limit or cannot be serialized.`,
      ],
      warnings,
    };
  }

  // 1. Check for Prototype Pollution & Dangerous Keys
  const dangerousKeys = checkForDangerousKeys(payload);
  if (dangerousKeys.length > 0) {
    errors.push(...dangerousKeys);
    return { valid: false, errors, warnings };
  }

  // 2. Private Key Policy Check
  const hasPrivateKeys = detectPrivateKeys(payload);
  if (hasPrivateKeys && options.rejectPrivateKey) {
    errors.push(
      "Uploaded payload contains private-key material. Private keys are strictly forbidden and rejected.",
    );
    return { valid: false, errors, warnings };
  }

  // 3. CycloneDX Document Structure Validation
  let componentsList = [];

  if (!Array.isArray(payload) && payload.bomFormat) {
    if (payload.bomFormat !== "CycloneDX") {
      errors.push(
        `Invalid bomFormat: expected 'CycloneDX', received '${payload.bomFormat}'`,
      );
    }

    const validVersions = ["1.4", "1.5", "1.6"];
    if (!validVersions.includes(String(payload.specVersion))) {
      errors.push(
        `Unsupported specVersion: expected one of [${validVersions.join(", ")}], received '${payload.specVersion}'`,
      );
    }

    if (!Array.isArray(payload.components)) {
      errors.push("CycloneDX document missing required 'components' array");
    } else {
      componentsList = payload.components;
    }
  } else if (Array.isArray(payload)) {
    componentsList = payload;
  } else if (Array.isArray(payload.components)) {
    componentsList = payload.components;
  } else {
    errors.push(
      "Unrecognized CBOM schema. Document must contain 'bomFormat': 'CycloneDX' or a 'components' list.",
    );
    return { valid: false, errors, warnings };
  }

  // 4. Resource Bounds Check (DoS prevention)
  if (componentsList.length > MAX_COMPONENTS_LIMIT) {
    errors.push(
      `Component count (${componentsList.length}) exceeds safety limit of ${MAX_COMPONENTS_LIMIT} components.`,
    );
    return { valid: false, errors, warnings };
  }

  // 5. BOM Refs Validation & Uniqueness
  const seenRefs = new Set();
  const invalidRefPattern = /[<>\x00-\x1F\x7F]/;

  for (let i = 0; i < componentsList.length; i++) {
    const comp = componentsList[i];
    if (comp && typeof comp === "object") {
      const bomRef = comp["bom-ref"] || comp.bom_ref;
      if (bomRef !== undefined && bomRef !== null) {
        if (typeof bomRef !== "string" || bomRef.trim() === "") {
          errors.push(
            `Component at index ${i} has an invalid empty or non-string bom-ref.`,
          );
        } else if (invalidRefPattern.test(bomRef)) {
          errors.push(
            `Component at index ${i} contains illegal characters in bom-ref.`,
          );
        } else {
          if (seenRefs.has(bomRef)) {
            warnings.push(
              `Duplicate bom-ref found at component index ${i} (will be normalized).`,
            );
          }
          seenRefs.add(bomRef);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    componentsCount: componentsList.length,
    privateKeysDetected: hasPrivateKeys,
  };
}

module.exports = {
  validateCbomStructure,
  detectPrivateKeys,
  redactPrivateKeys,
  MAX_COMPONENTS_LIMIT,
  MAX_CBOM_BYTES,
  MAX_NESTING_DEPTH,
};
