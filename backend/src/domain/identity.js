/**
 * ECDAT Deterministic Identity Generator (Node.js)
 * Implements versioned, collision-resistant URN generation using RFC 8785
 * JSON Canonicalization and SHA-256 cryptographic digests.
 */

const crypto = require("crypto");

const ACTIVE_IDENTITY_VERSION = "v1";

/**
 * Normalizes an identifier slug (tenant or application) into safe alphanumeric characters.
 * @param {string} slug
 * @returns {string}
 */
function normalizeSlug(slug) {
  if (!slug || typeof slug !== "string") return "default";
  const cleaned = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return cleaned || "default";
}

/**
 * Deterministic RFC 8785-compliant JSON canonicalization.
 * Sorts object keys recursively and ensures strict deterministic serialization.
 * @param {any} value
 * @returns {string}
 */
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(",")}]`;
  }

  const sortedKeys = Object.keys(value).sort();
  const pairs = sortedKeys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`);

  return `{${pairs.join(",")}}`;
}

/**
 * Computes a SHA-256 hex digest over canonical JSON bytes.
 * @param {any} descriptor
 * @param {number} length - Number of hex characters (default: 32)
 * @returns {string}
 */
function computeCanonicalHash(descriptor, length = 32) {
  const canonical = canonicalizeJson(descriptor);
  const fullHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return fullHash.slice(0, length);
}

/**
 * Generates a deterministic CryptoAsset URN.
 * Format: urn:ecdat:<version>:asset:<tenant>:<app>:<assetType>:<digest>
 *
 * @param {object} params
 * @param {string} [params.tenantId="default"]
 * @param {string} [params.applicationId="default"]
 * @param {string} params.assetType - Canonical asset type
 * @param {object} params.provenance - { kind, locator } (excluding local paths/line numbers)
 * @param {object} [params.coreProperties={}] - Cryptographic attributes (algorithm, keySize, etc.)
 * @param {string} [params.version="v1"]
 * @returns {string}
 */
function generateAssetId({
  tenantId = "default",
  applicationId = "default",
  assetType,
  provenance = {},
  coreProperties = {},
  version = ACTIVE_IDENTITY_VERSION,
}) {
  if (!assetType) throw new Error("generateAssetId requires assetType");
  const normTenant = normalizeSlug(tenantId);
  const normApp = normalizeSlug(applicationId);
  const normAssetType = String(assetType).toLowerCase();

  const descriptor = {
    version,
    entity: "asset",
    tenantId: normTenant,
    applicationId: normApp,
    assetType: normAssetType,
    provenance: {
      kind: String(provenance.kind || "source_code"),
      locator: String(provenance.locator || "unknown").replace(/\\/g, "/"),
    },
    coreProperties: { ...coreProperties },
  };

  const digest = computeCanonicalHash(descriptor, 32);
  return `urn:ecdat:${version}:asset:${normTenant}:${normApp}:${normAssetType}:${digest}`;
}

/**
 * Generates a deterministic Finding URN.
 * Format: urn:ecdat:<version>:finding:<tenant>:<app>:<digest>
 *
 * @param {object} params
 * @param {string} [params.tenantId="default"]
 * @param {string} [params.applicationId="default"]
 * @param {string} params.assetId - Parent asset URN
 * @param {string} params.ruleId - Rule identifier
 * @param {string} params.algorithmStandard - Normalized algorithm standard
 * @param {string} [params.contextDescriptor=""] - Semantic context excluding volatile line numbers
 * @param {string} [params.version="v1"]
 * @returns {string}
 */
function generateFindingId({
  tenantId = "default",
  applicationId = "default",
  assetId,
  ruleId,
  algorithmStandard,
  contextDescriptor = "",
  version = ACTIVE_IDENTITY_VERSION,
}) {
  if (!assetId) throw new Error("generateFindingId requires assetId");
  if (!algorithmStandard) throw new Error("generateFindingId requires algorithmStandard");

  const normTenant = normalizeSlug(tenantId);
  const normApp = normalizeSlug(applicationId);

  const descriptor = {
    version,
    entity: "finding",
    tenantId: normTenant,
    applicationId: normApp,
    assetId: String(assetId),
    ruleId: String(ruleId || "GENERIC"),
    algorithmStandard: String(algorithmStandard).toUpperCase(),
    contextDescriptor: String(contextDescriptor || ""),
  };

  const digest = computeCanonicalHash(descriptor, 32);
  return `urn:ecdat:${version}:finding:${normTenant}:${normApp}:${digest}`;
}

/**
 * Generates a deterministic Evidence ID.
 * @param {object} params
 * @returns {string}
 */
function generateEvidenceId({
  proofType = "source_code",
  canonicalLocation,
  snippetHash = null,
  version = ACTIVE_IDENTITY_VERSION,
}) {
  const normLoc = String(canonicalLocation || "unknown").replace(/\\/g, "/");
  const descriptor = {
    version,
    entity: "evidence",
    proofType: String(proofType),
    canonicalLocation: normLoc,
    snippetHash: snippetHash ? String(snippetHash) : null,
  };
  const digest = computeCanonicalHash(descriptor, 32);
  return `urn:ecdat:${version}:evidence:${digest}`;
}

/**
 * Generates a deterministic Relationship ID.
 * @param {object} params
 * @returns {string}
 */
function generateRelationshipId({
  sourceAssetId,
  targetAssetId,
  relationshipType,
  version = ACTIVE_IDENTITY_VERSION,
}) {
  if (!sourceAssetId || !targetAssetId || !relationshipType) {
    throw new Error("generateRelationshipId requires sourceAssetId, targetAssetId, and relationshipType");
  }
  const descriptor = {
    version,
    entity: "relationship",
    sourceAssetId: String(sourceAssetId),
    targetAssetId: String(targetAssetId),
    relationshipType: String(relationshipType),
  };
  const digest = computeCanonicalHash(descriptor, 32);
  return `urn:ecdat:${version}:rel:${digest}`;
}

/**
 * Parses and validates an ECDAT URN.
 * @param {string} urn
 * @returns {{ version: string, entityType: string, tenantId: string, appId: string, digest: string, extra?: string }}
 */
function parseIdentifier(urn) {
  if (!urn || typeof urn !== "string" || !urn.startsWith("urn:ecdat:")) {
    throw new Error(`Invalid ECDAT URN format: '${urn}'`);
  }
  const parts = urn.split(":");
  if (parts.length < 5) {
    throw new Error(`Malformed ECDAT URN: '${urn}'`);
  }
  const version = parts[2];
  const entityType = parts[3];

  if (entityType === "asset" && parts.length === 7) {
    return {
      version,
      entityType,
      tenantId: parts[4],
      appId: parts[5],
      assetType: parts[6],
      digest: parts[7] || parts[6],
    };
  }

  if (entityType === "finding" && parts.length === 6) {
    return {
      version,
      entityType,
      tenantId: parts[4],
      appId: parts[5],
      digest: parts[6] || parts[5],
    };
  }

  return {
    version,
    entityType,
    tenantId: parts[4] || "default",
    appId: parts[5] || "default",
    digest: parts[parts.length - 1],
  };
}

module.exports = {
  ACTIVE_IDENTITY_VERSION,
  normalizeSlug,
  canonicalizeJson,
  computeCanonicalHash,
  generateAssetId,
  generateFindingId,
  generateEvidenceId,
  generateRelationshipId,
  parseIdentifier,
};
