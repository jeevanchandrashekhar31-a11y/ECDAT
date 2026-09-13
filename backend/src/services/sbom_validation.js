/**
 * ECDAT SBOM Validation Service (Phase 3.1)
 *
 * Implements schema validation, safety guardrails, and DoS protections for
 * CycloneDX (1.4, 1.5, 1.6) and SPDX (2.2, 2.3, 3.0) documents.
 */

const MAX_COMPONENTS_LIMIT = parseInt(process.env.MAX_SBOM_COMPONENTS, 10) || 50000;
const MAX_SBOM_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_NESTING_DEPTH = 64;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SUPPORTED_CYCLONEDX_VERSIONS = new Set(["1.4", "1.5", "1.6", "1.7"]);
const SUPPORTED_SPDX_VERSIONS = new Set(["SPDX-2.2", "SPDX-2.3", "SPDX-3.0"]);

/**
 * Checks for prototype pollution, dangerous properties, cyclic objects, and excessive nesting depth.
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
    return Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_SBOM_BYTES;
  } catch {
    return false;
  }
}

/**
 * Validates incoming SBOM payloads for format specification, structural conformity, and bounds.
 */
function validateSbomStructure(payload, options = {}) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      format: "UNKNOWN",
      version: "unknown",
      errors: ["Payload must be a valid JSON object"],
      warnings,
    };
  }

  // 1. Byte limit check
  if (!isPayloadWithinByteLimit(payload)) {
    return {
      valid: false,
      format: "UNKNOWN",
      version: "unknown",
      errors: [
        `Payload exceeds the ${MAX_SBOM_BYTES} byte safety limit or cannot be serialized.`,
      ],
      warnings,
    };
  }

  // 2. Dangerous keys & nesting depth check
  const dangerousKeys = checkForDangerousKeys(payload);
  if (dangerousKeys.length > 0) {
    errors.push(...dangerousKeys);
    return { valid: false, format: "UNKNOWN", version: "unknown", errors, warnings };
  }

  // 3. Format Detection & Schema Conformance
  let detectedFormat = null;
  let detectedVersion = null;
  let componentCount = 0;

  if (payload.bomFormat === "CycloneDX" || (payload.components && Array.isArray(payload.components))) {
    detectedFormat = "CycloneDX";
    detectedVersion = String(payload.specVersion || "1.6");

    if (payload.bomFormat && payload.bomFormat !== "CycloneDX") {
      errors.push(`Invalid bomFormat: expected 'CycloneDX', received '${payload.bomFormat}'`);
    }

    if (!SUPPORTED_CYCLONEDX_VERSIONS.has(detectedVersion)) {
      errors.push(
        `Unsupported CycloneDX specVersion: expected one of [${Array.from(SUPPORTED_CYCLONEDX_VERSIONS).join(", ")}], received '${detectedVersion}'`,
      );
    }

    if (!Array.isArray(payload.components)) {
      errors.push("CycloneDX document missing required 'components' array");
    } else {
      componentCount = payload.components.length;
    }
  } else if (payload.spdxVersion || (payload.packages && Array.isArray(payload.packages))) {
    detectedFormat = "SPDX";
    detectedVersion = String(payload.spdxVersion || "SPDX-2.3");

    const versionPrefix = detectedVersion.replace(/^SPDX-/, "");
    const normalizedSpdx = `SPDX-${versionPrefix}`;
    if (!SUPPORTED_SPDX_VERSIONS.has(normalizedSpdx) && !/^SPDX-[23]\./.test(detectedVersion)) {
      errors.push(
        `Unsupported SPDX version: expected one of [${Array.from(SUPPORTED_SPDX_VERSIONS).join(", ")}], received '${detectedVersion}'`,
      );
    }

    if (!Array.isArray(payload.packages) && !payload.SPDXID) {
      errors.push("SPDX document missing required 'packages' array or 'SPDXID'");
    } else if (Array.isArray(payload.packages)) {
      componentCount = payload.packages.length;
    }
  } else {
    errors.push(
      "Unrecognized SBOM schema. Document must be a valid CycloneDX ('bomFormat': 'CycloneDX') or SPDX ('spdxVersion': 'SPDX-...') document.",
    );
    return {
      valid: false,
      format: "UNKNOWN",
      version: "unknown",
      errors,
      warnings,
    };
  }

  // 4. Resource Bounds Check (DoS prevention)
  if (componentCount > MAX_COMPONENTS_LIMIT) {
    errors.push(
      `Component count (${componentCount}) exceeds the maximum safety bound of ${MAX_COMPONENTS_LIMIT}.`,
    );
  }

  return {
    valid: errors.length === 0,
    format: detectedFormat,
    version: detectedVersion,
    componentCount,
    errors,
    warnings,
  };
}

module.exports = {
  validateSbomStructure,
  checkForDangerousKeys,
  isPayloadWithinByteLimit,
  MAX_SBOM_BYTES,
  MAX_COMPONENTS_LIMIT,
  SUPPORTED_CYCLONEDX_VERSIONS,
  SUPPORTED_SPDX_VERSIONS,
};
