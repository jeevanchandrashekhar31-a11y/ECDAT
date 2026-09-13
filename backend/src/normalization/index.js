/**
 * Normalization Subsystem Boundary
 * Responsible for mapping raw, heterogeneous observations into canonical domain models
 * (CryptoAsset, Finding, canonical algorithm identifiers, and standard key sizes).
 */

const {
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
} = require("../risk_engine/normalizer");

const {
  CryptoAsset,
  Finding,
  Evidence,
  ConfidenceLevel,
  generateAssetId,
  generateFindingId,
} = require("../domain");

/**
 * Normalizes a raw discovery observation into canonical domain Finding and CryptoAsset instances.
 * @param {object} params
 * @returns {{ asset: CryptoAsset, finding: Finding }}
 */
function normalizeObservation({
  target,
  rawAlgorithm,
  rawKeySize,
  rawAssetType,
  dataSensitivity,
  businessCriticality,
  evidenceLocation,
  evidenceSnippet,
  lineNumber,
  confidence = "high",
  analysisSource = "ast",
  tenantId = "default",
  applicationId = "default",
}) {
  const normAlgo = normalizeAlgorithm(rawAlgorithm, rawKeySize);
  const normAssetType = normalizeAssetType(rawAssetType);
  const normSens = normalizeDataSensitivity(dataSensitivity);
  const normCrit = normalizeBusinessCriticality(businessCriticality);

  const assetId = generateAssetId({
    tenantId,
    applicationId,
    assetType: normAssetType,
    provenance: {
      kind: analysisSource === "ssl_handshake" ? "tls_endpoint" : "source_code",
      locator: target,
    },
    coreProperties: {
      algorithm: normAlgo.canonicalName,
      keySize: normAlgo.keySize,
    },
  });

  const asset = new CryptoAsset({
    assetId,
    primaryIdentifier: target,
    assetType: normAssetType,
    dataSensitivity: normSens,
    businessCriticality: normCrit,
  });

  const evidence = new Evidence({
    location: evidenceLocation || target,
    lineNumber,
    snippet: evidenceSnippet,
    proofType: analysisSource === "ssl_handshake" ? "tls_handshake" : "source_code",
    confidence: confidence.toLowerCase() === "high" ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
  });

  const findingId = generateFindingId({
    tenantId,
    applicationId,
    assetId,
    ruleId: `RULE-${normAlgo.canonicalName}`,
    algorithmStandard: normAlgo.canonicalName,
  });

  const finding = new Finding({
    findingId,
    assetId,
    algorithmStandard: normAlgo.canonicalName,
    keySizeBits: normAlgo.keySize,
    confidence: confidence.toLowerCase() === "high" ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM,
    evidence,
    analysisSource,
  });

  return { asset, finding };
}

module.exports = {
  normalizeObservation,
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
};
