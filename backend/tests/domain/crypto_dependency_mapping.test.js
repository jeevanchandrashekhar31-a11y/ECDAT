const test = require("node:test");
const assert = require("node:assert");
const {
  classifyReachability,
  correlateCryptoDependencies,
  findPackageInKnowledgeBase,
  extractNameFromPurl,
} = require("../../src/correlation/reachability");
const { CryptoReachabilityLevel } = require("../../src/domain/contracts");
const { getRules } = require("../../src/risk_engine/rules_loader");

test("Crypto Dependency Mapping KB - Schema & Versioning Integrity", () => {
  const rules = getRules().crypto_dependency_mapping;
  assert.ok(rules, "Knowledge base loaded");
  assert.strictEqual(rules.version, "1.0.0");
  assert.ok(rules.last_updated);
  assert.ok(rules.packages.length >= 15);

  const levels = rules.reachability_levels;
  assert.strictEqual(levels.CAPABILITY_PRESENT.reachable, false);
  assert.strictEqual(levels.TRANSIENT_IMPORT.reachable, false);
  assert.strictEqual(levels.DIRECT_API_CALL.reachable, true);
  assert.strictEqual(levels.RUNTIME_CONFIRMED.reachable, true);
});

test("Crypto Reachability - Level 1: CAPABILITY_PRESENT (Never Overstated)", () => {
  // A package is installed / listed in SBOM, but never imported or called in source
  const result = classifyReachability({
    packageName: "cryptography",
    version: "41.0.3",
    purl: "pkg:pypi/cryptography@41.0.3",
    isPresentInManifest: true,
    imports: [],
    directCalls: [],
    runtimeEvidence: [],
  });

  assert.strictEqual(result.canonical_name, "cryptography");
  assert.strictEqual(result.reachability_level, CryptoReachabilityLevel.CAPABILITY_PRESENT);
  // CRITICAL REQUIREMENT: Do not overstate reachability
  assert.strictEqual(result.is_reachable, false, "Installed package must NOT be marked reachable");
  assert.strictEqual(result.has_crypto_capability, true);
  assert.ok(result.crypto_capabilities.includes("AES"));
  assert.ok(result.rationale.includes("Reachability is not overstated"));
});

test("Crypto Reachability - Level 2: TRANSIENT_IMPORT (Never Overstated)", () => {
  // A package is imported by the code/wrapper, but no direct cryptographic functions are invoked
  const result = classifyReachability({
    packageName: "crypto-js",
    version: "4.1.1",
    purl: "pkg:npm/crypto-js@4.1.1",
    isPresentInManifest: true,
    imports: ["import CryptoJS from 'crypto-js'"],
    directCalls: [],
    runtimeEvidence: [],
  });

  assert.strictEqual(result.canonical_name, "crypto-js");
  assert.strictEqual(result.reachability_level, CryptoReachabilityLevel.TRANSIENT_IMPORT);
  // CRITICAL REQUIREMENT: Do not overstate reachability
  assert.strictEqual(result.is_reachable, false, "Imported package without API calls must NOT be marked reachable");
  assert.strictEqual(result.evidence.imports.length, 1);
  assert.strictEqual(result.evidence.direct_calls.length, 0);
  assert.ok(result.rationale.includes("Reachability is not overstated"));
});

test("Crypto Reachability - Level 3: DIRECT_API_CALL (Reachable)", () => {
  // Application directly invokes cryptographic functions in source code
  const result = classifyReachability({
    packageName: "crypto-js",
    version: "4.1.1",
    isPresentInManifest: true,
    imports: ["import CryptoJS from 'crypto-js'"],
    directCalls: [{ api: "CryptoJS.AES.encrypt", line: 42, file: "auth.js" }],
    runtimeEvidence: [],
  });

  assert.strictEqual(result.canonical_name, "crypto-js");
  assert.strictEqual(result.reachability_level, CryptoReachabilityLevel.DIRECT_API_CALL);
  assert.strictEqual(result.is_reachable, true, "Direct API call confirms reachability");
  assert.strictEqual(result.evidence.direct_calls.length, 1);
  assert.ok(result.rationale.includes("directly invokes cryptographic APIs"));
});

test("Crypto Reachability - Level 4: RUNTIME_CONFIRMED (Reachable)", () => {
  // Dynamic runtime telemetry or network handshake confirms active crypto usage
  const result = classifyReachability({
    packageName: "openssl",
    version: "3.0.8",
    isPresentInManifest: true,
    imports: [],
    directCalls: [],
    runtimeEvidence: [{ description: "TLS 1.3 handshake negotiated using OpenSSL 3.0.8 engine" }],
  });

  assert.strictEqual(result.canonical_name, "openssl");
  assert.strictEqual(result.reachability_level, CryptoReachabilityLevel.RUNTIME_CONFIRMED);
  assert.strictEqual(result.is_reachable, true, "Runtime confirmation guarantees reachability");
  assert.strictEqual(result.evidence.runtime_observations.length, 1);
  assert.ok(result.rationale.includes("Runtime telemetry/execution trace confirmed"));
});

test("Crypto Reachability - Knowledge Base Package Lookup & PURL normalization", () => {
  const rules = getRules().crypto_dependency_mapping;

  const pkg1 = findPackageInKnowledgeBase("pkg:pypi/cryptography@3.4.8", rules);
  assert.ok(pkg1);
  assert.strictEqual(pkg1.canonical_name, "cryptography");

  const pkg2 = findPackageInKnowledgeBase("bcprov-jdk15on", rules); // alias check
  assert.ok(pkg2);
  assert.strictEqual(pkg2.canonical_name, "bcprov-jdk18on");
  assert.ok(pkg2.pqc_support.includes("ML-KEM"));

  const pkg3 = findPackageInKnowledgeBase("ring", rules);
  assert.ok(pkg3);
  assert.ok(pkg3.ecosystems.includes("rust"));

  assert.strictEqual(extractNameFromPurl("pkg:cargo/rustls@0.21.0"), "rustls");
  assert.strictEqual(extractNameFromPurl("pkg:golang/golang.org/x/crypto@v0.14.0"), "golang.org/x/crypto");
});

test("Crypto Reachability - Full SBOM & Findings Correlation Pipeline", () => {
  const mockSbomComponents = [
    { name: "cryptography", version: "41.0.3", purl: "pkg:pypi/cryptography@41.0.3" },
    { name: "crypto-js", version: "4.1.1", purl: "pkg:npm/crypto-js@4.1.1" },
    { name: "ring", version: "0.17.5", purl: "pkg:cargo/ring@0.17.5" },
    { name: "openssl", version: "3.0.2", purl: "pkg:generic/openssl@3.0.2" },
    { name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21" }, // non-crypto
  ];

  const mockStaticFindings = [
    // Direct call for crypto-js
    {
      target_package: "crypto-js",
      api: "CryptoJS.AES.encrypt",
      code_snippet: "const enc = CryptoJS.AES.encrypt(data, key);",
    },
    // Only import for ring (no direct calls)
    {
      target_package: "ring",
      code_snippet: "use ring::aead;",
    },
  ];

  const mockDynamicFindings = [
    // Runtime evidence for openssl
    {
      target_package: "openssl",
      description: "Observed OpenSSL SSL_connect in active TLS session",
    },
  ];

  const report = correlateCryptoDependencies({
    components: mockSbomComponents,
    staticFindings: mockStaticFindings,
    dynamicFindings: mockDynamicFindings,
  });

  assert.strictEqual(report.version, "1.0.0");
  assert.strictEqual(report.summary.total_dependencies_evaluated, 5);
  assert.strictEqual(report.summary.crypto_packages_detected, 4);

  // Check 4 tiers breakdown
  const breakdown = report.summary.reachability_breakdown;
  assert.strictEqual(breakdown[CryptoReachabilityLevel.CAPABILITY_PRESENT], 1, "cryptography is CAPABILITY_PRESENT");
  assert.strictEqual(breakdown[CryptoReachabilityLevel.TRANSIENT_IMPORT], 1, "ring is TRANSIENT_IMPORT");
  assert.strictEqual(breakdown[CryptoReachabilityLevel.DIRECT_API_CALL], 1, "crypto-js is DIRECT_API_CALL");
  assert.strictEqual(breakdown[CryptoReachabilityLevel.RUNTIME_CONFIRMED], 1, "openssl is RUNTIME_CONFIRMED");

  // Strict reachability check
  assert.strictEqual(report.summary.reachable_crypto_count, 2, "Only direct call and runtime are reachable");
  assert.strictEqual(report.summary.unreachable_crypto_count, 2, "Present and transient import are unreachable");
});
