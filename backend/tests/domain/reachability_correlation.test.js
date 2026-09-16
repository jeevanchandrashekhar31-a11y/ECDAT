const test = require("node:test");
const assert = require("node:assert");

const {
  findPackageInKnowledgeBase,
  classifyReachability,
  correlateCryptoDependencies,
  normalizePkgName,
  extractNameFromPurl,
} = require("../../src/correlation/reachability");

const { CryptoReachabilityLevel, ConfidenceLevel } = require("../../src/domain/contracts");
const { getRules } = require("../../src/risk_engine/rules_loader");

test("Phase 22.1 — Crypto Reachability & Dependency Correlation Tests", async (t) => {
  const rules = getRules();
  const mappingRules = rules.crypto_dependency_mapping;

  await t.test("1. Package Name and Purl Normalization", () => {
    // Scoped npm packages
    assert.strictEqual(normalizePkgName("@noble/curves"), "curves");
    assert.strictEqual(normalizePkgName("  cryptography  "), "cryptography");
    assert.strictEqual(normalizePkgName(""), "");
    assert.strictEqual(normalizePkgName(null), "");

    // Package URLs (purl)
    assert.strictEqual(
      extractNameFromPurl("pkg:npm/%40angular/animation@12.3.1"),
      "@angular/animation"
    );
    assert.strictEqual(
      extractNameFromPurl("pkg:golang/golang.org/x/crypto@v0.14.0"),
      "golang.org/x/crypto"
    );
    assert.strictEqual(
      extractNameFromPurl("pkg:cargo/rustls@0.21.0"),
      "rustls"
    );
    assert.strictEqual(
      extractNameFromPurl("pkg:pypi/cryptography@41.0.3"),
      "cryptography"
    );
  });

  await t.test("2. Knowledge Base Package Lookup", () => {
    // Exact match by package_id / canonical_name
    const pyCrypto = findPackageInKnowledgeBase("cryptography", mappingRules);
    assert.ok(pyCrypto, "Must locate 'cryptography' in knowledge base");
    assert.strictEqual(pyCrypto.canonical_name, "cryptography");

    const goCrypto = findPackageInKnowledgeBase("golang.org/x/crypto", mappingRules);
    assert.ok(goCrypto, "Must locate 'golang.org/x/crypto' in knowledge base");

    // Non-crypto package lookup
    const nonCrypto = findPackageInKnowledgeBase("left-pad", mappingRules);
    assert.strictEqual(nonCrypto, null, "Non-crypto package should return null");
  });

  await t.test("3. Tier 1: CAPABILITY_PRESENT (Unreachable Invariant)", () => {
    const classification = classifyReachability({
      packageName: "cryptography",
      version: "41.0.3",
      purl: "pkg:pypi/cryptography@41.0.3",
      ecosystem: "pypi",
      isPresentInManifest: true,
      imports: [],
      directCalls: [],
      runtimeEvidence: [],
      customMappingRules: mappingRules,
    });

    assert.strictEqual(classification.reachability_level, CryptoReachabilityLevel.CAPABILITY_PRESENT);
    // Mandatory guarantee: Reachability is never overstated
    assert.strictEqual(classification.is_reachable, false);
    assert.strictEqual(classification.confidence, ConfidenceLevel.LOW);
    assert.ok(classification.rationale.includes("Reachability is not overstated"));
  });

  await t.test("4. Tier 2: TRANSIENT_IMPORT (Unreachable Invariant)", () => {
    const classification = classifyReachability({
      packageName: "cryptography",
      version: "41.0.3",
      purl: "pkg:pypi/cryptography@41.0.3",
      ecosystem: "pypi",
      isPresentInManifest: true,
      imports: ["from cryptography.hazmat import backends"],
      directCalls: [],
      runtimeEvidence: [],
      customMappingRules: mappingRules,
    });

    assert.strictEqual(classification.reachability_level, CryptoReachabilityLevel.TRANSIENT_IMPORT);
    // Mandatory guarantee: Reachability is never overstated
    assert.strictEqual(classification.is_reachable, false);
    assert.strictEqual(classification.confidence, ConfidenceLevel.LOW);
    assert.ok(classification.rationale.includes("Reachability is not overstated"));
  });

  await t.test("5. Tier 3: DIRECT_API_CALL (Confirmed Static Reachability)", () => {
    const classification = classifyReachability({
      packageName: "cryptography",
      version: "41.0.3",
      purl: "pkg:pypi/cryptography@41.0.3",
      ecosystem: "pypi",
      isPresentInManifest: true,
      imports: ["from cryptography.hazmat.primitives.ciphers import Cipher"],
      directCalls: [
        { api: "Cipher", line_number: 14, location: "src/crypto/aes.py" },
      ],
      runtimeEvidence: [],
      customMappingRules: mappingRules,
    });

    assert.strictEqual(classification.reachability_level, CryptoReachabilityLevel.DIRECT_API_CALL);
    assert.strictEqual(classification.is_reachable, true);
    assert.strictEqual(classification.confidence, ConfidenceLevel.HIGH);
    assert.ok(classification.rationale.includes("call site(s) identified"));
  });

  await t.test("6. Tier 4: RUNTIME_CONFIRMED (Confirmed Active Telemetry)", () => {
    const classification = classifyReachability({
      packageName: "cryptography",
      version: "41.0.3",
      purl: "pkg:pypi/cryptography@41.0.3",
      ecosystem: "pypi",
      isPresentInManifest: true,
      imports: ["from cryptography.hazmat.primitives.ciphers import Cipher"],
      directCalls: [
        { api: "Cipher", line_number: 14, location: "src/crypto/aes.py" },
      ],
      runtimeEvidence: [
        { target_package: "cryptography", description: "Active AES-GCM encryption in process" },
      ],
      customMappingRules: mappingRules,
    });

    assert.strictEqual(classification.reachability_level, CryptoReachabilityLevel.RUNTIME_CONFIRMED);
    assert.strictEqual(classification.is_reachable, true);
    assert.strictEqual(classification.confidence, ConfidenceLevel.HIGH);
    assert.ok(classification.rationale.includes("Runtime telemetry"));
  });

  await t.test("7. End-to-End correlateCryptoDependencies Aggregation", () => {
    const sbomComponents = [
      { name: "cryptography", version: "41.0.3", purl: "pkg:pypi/cryptography@41.0.3" },
      { name: "golang.org/x/crypto", version: "v0.14.0", purl: "pkg:golang/golang.org/x/crypto@v0.14.0" },
      { name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" }, // non-crypto
    ];

    const staticFindings = [
      { target_package: "cryptography", api: "Cipher", location: "src/worker.py" },
    ];

    const dynamicFindings = [];

    const result = correlateCryptoDependencies({
      components: sbomComponents,
      staticFindings,
      dynamicFindings,
    });

    assert.ok(result.summary);
    assert.strictEqual(result.summary.crypto_packages_detected, 2);
    assert.strictEqual(result.summary.reachable_crypto_count, 1);
    assert.strictEqual(result.summary.unreachable_crypto_count, 1);
    assert.strictEqual(result.correlated_packages.length, 2);

    const cryptoPkg = result.correlated_packages.find((p) => p.canonical_name === "cryptography");
    assert.strictEqual(cryptoPkg.is_reachable, true);
    assert.strictEqual(cryptoPkg.reachability_level, CryptoReachabilityLevel.DIRECT_API_CALL);

    const goPkg = result.correlated_packages.find((p) => p.canonical_name === "golang.org/x/crypto");
    assert.strictEqual(goPkg.is_reachable, false);
    assert.strictEqual(goPkg.reachability_level, CryptoReachabilityLevel.CAPABILITY_PRESENT);
  });
});
