/**
 * ECDAT SBOM Ingestion & Normalization Engine (Phase 3.1)
 *
 * Ingests, validates, and normalizes CycloneDX and SPDX SBOMs.
 * Standardizes:
 * - Component
 * - Version
 * - Package URL (purl)
 * - License
 * - Dependency Relationships
 */

const { validateSbomStructure } = require("./sbom_validation");
const { redactPrivateKeys } = require("./cbom_validation");
const {
  InvalidInputError,
  UnsupportedFormatError,
  ErrorCode,
} = require("../domain/errors");

/**
 * Extracts normalized license strings from CycloneDX licenses array.
 */
function extractCycloneDxLicenses(licensesField) {
  if (!licensesField || !Array.isArray(licensesField)) return [];
  const licenses = [];

  for (const item of licensesField) {
    if (typeof item === "string") {
      licenses.push(item);
    } else if (item.expression) {
      licenses.push(item.expression);
    } else if (item.license) {
      if (item.license.id) licenses.push(item.license.id);
      else if (item.license.name) licenses.push(item.license.name);
    }
  }
  return licenses;
}

/**
 * Normalizes CycloneDX document components and dependencies.
 */
function normalizeCycloneDx(payload) {
  const components = [];
  const relationships = [];

  const rawComponents = Array.isArray(payload.components)
    ? payload.components
    : [];

  for (const comp of rawComponents) {
    const id = comp["bom-ref"] || comp.purl || `${comp.name}@${comp.version || "unknown"}`;
    const purl = comp.purl || null;
    const licenses = extractCycloneDxLicenses(comp.licenses);

    components.push({
      component_id: id,
      name: comp.name || "unknown",
      version: comp.version || "unknown",
      purl: purl,
      licenses: licenses,
      type: comp.type || "library",
      description: comp.description || null,
      crypto_properties: comp.cryptoProperties || null,
    });
  }

  // Dependency graph
  if (Array.isArray(payload.dependencies)) {
    for (const dep of payload.dependencies) {
      const fromRef = dep.ref;
      if (fromRef && Array.isArray(dep.dependsOn)) {
        for (const toRef of dep.dependsOn) {
          relationships.push({
            from: fromRef,
            to: toRef,
            relationship_type: "DEPENDS_ON",
          });
        }
      }
    }
  }

  return { components, relationships };
}

/**
 * Extracts Package URL (purl) from SPDX externalRefs.
 */
function extractSpdxPurl(externalRefs) {
  if (!externalRefs || !Array.isArray(externalRefs)) return null;
  for (const ref of externalRefs) {
    const type = String(ref.referenceType || "").toLowerCase();
    if (type === "purl" && ref.referenceLocator) {
      return ref.referenceLocator;
    }
    if (
      String(ref.referenceCategory || "").toUpperCase() === "PACKAGE-MANAGER" &&
      type === "purl" &&
      ref.referenceLocator
    ) {
      return ref.referenceLocator;
    }
  }
  return null;
}

/**
 * Normalizes SPDX license strings.
 */
function extractSpdxLicenses(pkg) {
  const licenses = [];
  const ignored = new Set(["NOASSERTION", "NONE", "", null, undefined]);

  if (pkg.licenseConcluded && !ignored.has(pkg.licenseConcluded)) {
    licenses.push(pkg.licenseConcluded);
  }
  if (pkg.licenseDeclared && !ignored.has(pkg.licenseDeclared)) {
    if (!licenses.includes(pkg.licenseDeclared)) {
      licenses.push(pkg.licenseDeclared);
    }
  }
  return licenses;
}

/**
 * Normalizes SPDX document packages and relationships.
 */
function normalizeSpdx(payload) {
  const components = [];
  const relationships = [];

  const rawPackages = Array.isArray(payload.packages) ? payload.packages : [];

  for (const pkg of rawPackages) {
    const id = pkg.SPDXID || pkg.name;
    const purl = extractSpdxPurl(pkg.externalRefs);
    const licenses = extractSpdxLicenses(pkg);

    components.push({
      component_id: id,
      name: pkg.name || "unknown",
      version: pkg.versionInfo || "unknown",
      purl: purl,
      licenses: licenses,
      type: pkg.primaryPackagePurpose ? pkg.primaryPackagePurpose.toLowerCase() : "library",
      description: pkg.description || pkg.summary || null,
      crypto_properties: null,
    });
  }

  // SPDX Relationships
  if (Array.isArray(payload.relationships)) {
    for (const rel of payload.relationships) {
      const type = String(rel.relationshipType || "DEPENDS_ON").toUpperCase();
      const elem1 = rel.spdxElementId;
      const elem2 = rel.relatedSpdxElement;

      if (!elem1 || !elem2) continue;

      if (type === "DEPENDS_ON") {
        relationships.push({ from: elem1, to: elem2, relationship_type: "DEPENDS_ON" });
      } else if (type === "DEPENDENCY_OF") {
        relationships.push({ from: elem2, to: elem1, relationship_type: "DEPENDS_ON" });
      } else if (type === "CONTAINS") {
        relationships.push({ from: elem1, to: elem2, relationship_type: "CONTAINS" });
      } else {
        relationships.push({ from: elem1, to: elem2, relationship_type: type });
      }
    }
  }

  return { components, relationships };
}

/**
 * Primary Ingestion Entry Point:
 * Validates, sanitizes, and normalizes CycloneDX and SPDX SBOM payloads.
 */
function ingestSbom(rawPayload, options = {}) {
  // 1. Schema & Safety Validation
  const validation = validateSbomStructure(rawPayload, options);
  if (!validation.valid) {
    const isUnsupported = validation.errors.some((e) =>
      e.includes("Unrecognized SBOM schema") || e.includes("Unsupported"),
    );
    if (isUnsupported) {
      throw new UnsupportedFormatError(
        `SBOM Ingestion Format Error: ${validation.errors.join("; ")}`,
        { errors: validation.errors, warnings: validation.warnings },
        ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC,
      );
    }
    throw new InvalidInputError(
      `SBOM Ingestion Validation Failed: ${validation.errors.join("; ")}`,
      { errors: validation.errors, warnings: validation.warnings },
      ErrorCode.ERR_INPUT_INVALID_PARAMETER,
    );
  }

  // 2. Secret Redaction (Never persist or process raw secrets)
  const { sanitized } = redactPrivateKeys(rawPayload);

  // 3. Normalization based on Format
  let normalized;
  if (validation.format === "CycloneDX") {
    normalized = normalizeCycloneDx(sanitized);
  } else if (validation.format === "SPDX") {
    normalized = normalizeSpdx(sanitized);
  } else {
    throw new UnsupportedFormatError(
      `Unsupported format '${validation.format}'`,
      {},
      ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC,
    );
  }

  return {
    status: "SUCCESS",
    format: validation.format,
    spec_version: validation.version,
    component_count: normalized.components.length,
    relationship_count: normalized.relationships.length,
    components: normalized.components,
    dependency_relationships: normalized.relationships,
    ingestion_timestamp: new Date().toISOString(),
  };
}

module.exports = {
  ingestSbom,
  normalizeCycloneDx,
  normalizeSpdx,
  extractCycloneDxLicenses,
  extractSpdxPurl,
  extractSpdxLicenses,
};
