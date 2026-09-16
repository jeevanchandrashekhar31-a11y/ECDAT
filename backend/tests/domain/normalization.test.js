const test = require("node:test");
const assert = require("node:assert");

const {
  normalizeObservation,
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
} = require("../../src/normalization");

const { AssetType, DataSensitivity, BusinessCriticality } = require("../../src/risk_engine/types");
const { CryptoAsset, Finding } = require("../../src/domain");

test("Phase 22.1 — Normalization Subsystem Tests", async (t) => {
  await t.test("1. Algorithm Normalization: Classical Approved & Weak Algorithms", () => {
    // Weak / Broken
    const md5Norm = normalizeAlgorithm("md5");
    assert.strictEqual(md5Norm.canonicalName, "MD5");
    assert.ok(md5Norm.matchedRule);

    const sha1Norm = normalizeAlgorithm("sha-1");
    assert.strictEqual(sha1Norm.canonicalName, "SHA-1");

    const desNorm = normalizeAlgorithm("DES");
    assert.strictEqual(desNorm.canonicalName, "DES");

    const tripleDesNorm = normalizeAlgorithm("TripleDES");
    assert.strictEqual(tripleDesNorm.canonicalName, "3DES");

    const rc4Norm = normalizeAlgorithm("arcfour");
    assert.strictEqual(rc4Norm.canonicalName, "RC4");

    // Classical Approved
    const aes256 = normalizeAlgorithm("aes-256-gcm");
    assert.strictEqual(aes256.canonicalName, "AES");
    assert.strictEqual(aes256.keySize, 256);

    const rsa2048 = normalizeAlgorithm("rsa", 2048);
    assert.strictEqual(rsa2048.canonicalName, "RSA");
    assert.strictEqual(rsa2048.keySize, 2048);

    const ed25519 = normalizeAlgorithm("ed25519");
    assert.strictEqual(ed25519.canonicalName.toLowerCase(), "ed25519");
  });

  await t.test("2. Algorithm Normalization: Post-Quantum & Hybrid Primitives", () => {
    const mlkem768 = normalizeAlgorithm("ML-KEM-768");
    assert.ok(["ML-KEM-768", "ML-KEM", "Kyber-768", "Kyber"].includes(mlkem768.canonicalName) || mlkem768.matchedRule);

    const mldsa = normalizeAlgorithm("ML-DSA-65");
    assert.ok(["ML-DSA-65", "ML-DSA", "Dilithium-3", "Dilithium"].includes(mldsa.canonicalName) || mldsa.matchedRule);

    const hybridTls = normalizeAlgorithm("X25519Kyber768Draft00");
    assert.ok(hybridTls.canonicalName);
  });

  await t.test("3. Protocol Version Normalization", () => {
    const tls10 = normalizeAlgorithm("TLSv1.0");
    assert.strictEqual(tls10.canonicalName, "TLS 1.0");

    const tls11 = normalizeAlgorithm("TLS 1.1");
    assert.strictEqual(tls11.canonicalName, "TLS 1.1");

    const tls12 = normalizeAlgorithm("TLSv1_2");
    assert.strictEqual(tls12.canonicalName, "TLS 1.2");

    const tls13 = normalizeAlgorithm("TLS 1.3");
    assert.strictEqual(tls13.canonicalName, "TLS 1.3");
  });

  await t.test("4. Unknown and Edge Case Algorithm Handling", () => {
    const unknownEmpty = normalizeAlgorithm("");
    assert.strictEqual(unknownEmpty.canonicalName, "Unknown");
    assert.strictEqual(unknownEmpty.matchedRule, null);

    const unknownNull = normalizeAlgorithm(null);
    assert.strictEqual(unknownNull.canonicalName, "Unknown");

    const nonStandard = normalizeAlgorithm("CUSTOM_PROPRIETARY_CRYPTO_2026");
    assert.ok(nonStandard.canonicalName === "CUSTOM_PROPRIETARY_CRYPTO_2026" || nonStandard.canonicalName === "Unknown");
  });

  await t.test("5. Asset Type Normalization", () => {
    assert.strictEqual(normalizeAssetType("protocol"), AssetType.NETWORK_SESSION);
    assert.strictEqual(normalizeAssetType("tls"), AssetType.NETWORK_SESSION);
    assert.strictEqual(normalizeAssetType("certificate"), AssetType.CERTIFICATE);
    assert.strictEqual(normalizeAssetType("x509"), AssetType.CERTIFICATE);
    assert.strictEqual(normalizeAssetType("private_key"), AssetType.HARDCODED_PRIVATE_KEY);
    assert.strictEqual(normalizeAssetType("library"), AssetType.LIBRARY_PRESENCE);
    assert.strictEqual(normalizeAssetType("stored_data"), AssetType.STORED_ENCRYPTED_DATA);
    assert.strictEqual(normalizeAssetType("signing"), AssetType.SIGNING_KEY);
    // Default fallback to FILE
    assert.strictEqual(normalizeAssetType("algorithm"), AssetType.FILE);
    assert.strictEqual(normalizeAssetType("unrecognized_type"), AssetType.FILE);
  });

  await t.test("6. Data Sensitivity Normalization", () => {
    assert.strictEqual(normalizeDataSensitivity("public"), DataSensitivity.PUBLIC);
    assert.strictEqual(normalizeDataSensitivity("internal"), DataSensitivity.INTERNAL);
    assert.strictEqual(normalizeDataSensitivity("confidential"), DataSensitivity.CONFIDENTIAL);
    assert.strictEqual(normalizeDataSensitivity("restricted"), DataSensitivity.RESTRICTED);
    assert.strictEqual(normalizeDataSensitivity("unknown"), DataSensitivity.INTERNAL);
  });

  await t.test("7. Business Criticality Normalization", () => {
    assert.strictEqual(normalizeBusinessCriticality("low"), BusinessCriticality.LOW);
    assert.strictEqual(normalizeBusinessCriticality("medium"), BusinessCriticality.MEDIUM);
    assert.strictEqual(normalizeBusinessCriticality("high"), BusinessCriticality.HIGH);
    assert.strictEqual(normalizeBusinessCriticality("critical"), BusinessCriticality.CRITICAL);
    assert.strictEqual(normalizeBusinessCriticality("other"), BusinessCriticality.MEDIUM);
  });

  await t.test("8. End-to-End Observation Normalization Pipeline", () => {
    const rawObs = {
      target: "src/auth/tokens.py",
      rawAlgorithm: "md5",
      rawKeySize: null,
      rawAssetType: "file",
      dataSensitivity: "confidential",
      businessCriticality: "high",
      evidenceLocation: "src/auth/tokens.py",
      evidenceSnippet: "hashlib.md5(token)",
      lineNumber: 42,
      confidence: "high",
      analysisSource: "ast",
      tenantId: "tenant_fintech_01",
      applicationId: "app_payments",
    };

    const { asset, finding } = normalizeObservation(rawObs);

    assert.ok(asset instanceof CryptoAsset);
    assert.ok(finding instanceof Finding);

    // Canonical fields verified
    assert.strictEqual(finding.algorithmStandard, "MD5");
    assert.strictEqual(asset.assetType, AssetType.FILE);
    assert.strictEqual(asset.dataSensitivity, DataSensitivity.CONFIDENTIAL);
    assert.strictEqual(asset.businessCriticality, BusinessCriticality.HIGH);

    // Asset ID determinism
    assert.ok(asset.assetId.startsWith("urn:ecdat:"));
    assert.strictEqual(asset.primaryIdentifier, "src/auth/tokens.py");

    // Finding ID and evidence linking
    assert.ok(finding.findingId.startsWith("urn:ecdat:"));
    assert.strictEqual(finding.evidence.location, "src/auth/tokens.py");
    assert.strictEqual(finding.evidence.lineNumber, 42);
    assert.strictEqual(finding.evidence.snippet, "hashlib.md5(token)");
  });
});
