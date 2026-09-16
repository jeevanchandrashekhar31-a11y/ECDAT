/**
 * Phase 23.2 — Backend Adversarial Scanner Assessment (Hostile Input Defense)
 *
 * Validates backend scanner pipelines and parsers against adversarial scan inputs:
 * 1. Catalog schema compliance & 5 required record fields
 * 2. Deep JSON recursion bombs (>64 levels)
 * 3. Embedded private key detection and rejection in CBOM payloads
 * 4. Prototype pollution in CBOM structures
 * 5. Cyclic dependency graph traversal
 * 6. Oversized component count limits
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  validateCbomStructure,
  detectPrivateKeys,
  redactPrivateKeys,
  MAX_COMPONENTS_LIMIT,
  MAX_NESTING_DEPTH,
} = require("../../src/services/cbom_validation");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CATALOG_PATH = path.join(REPO_ROOT, "rules", "adversarial_scanner_catalog.json");

test("Phase 23.2 — Adversarial Scanner Assessment (Backend)", async (t) => {
  // 1. Verify Catalog Presence & Required 5-Point Fields
  await t.test("Catalog Mandate: All 15 scenarios record attack input, affected component, impact, mitigation, and test", () => {
    assert.ok(fs.existsSync(CATALOG_PATH), "adversarial_scanner_catalog.json must exist");
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));

    assert.equal(catalog.total_attack_scenarios, 15);
    assert.equal(catalog.scenarios.length, 15);

    for (const scenario of catalog.scenarios) {
      assert.ok(scenario.id.startsWith("ADV-SCAN-"), `Scenario ID ${scenario.id} invalid`);
      assert.ok(scenario.cwe_id.startsWith("CWE-"), `CWE ID ${scenario.cwe_id} invalid`);

      // 5 Required Fields Check
      assert.ok(scenario.attack_input, "Missing attack_input");
      assert.ok(scenario.attack_input.input_type, "Missing attack_input.input_type");
      assert.ok(scenario.attack_input.payload_description, "Missing attack_input.payload_description");

      assert.ok(scenario.affected_component, "Missing affected_component");
      assert.ok(scenario.affected_component.component_name, "Missing affected_component.component_name");
      assert.ok(scenario.affected_component.module_path, "Missing affected_component.module_path");

      assert.ok(scenario.impact, "Missing impact");
      assert.ok(scenario.impact.failure_mode, "Missing impact.failure_mode");
      assert.ok(scenario.impact.severity, "Missing impact.severity");

      assert.ok(scenario.mitigation, "Missing mitigation");
      assert.ok(scenario.mitigation.defensive_strategy, "Missing mitigation.defensive_strategy");

      assert.ok(scenario.regression_test, "Missing regression_test");
      assert.ok(scenario.regression_test.test_file, "Missing regression_test.test_file");
      assert.ok(scenario.regression_test.test_name, "Missing regression_test.test_name");
    }
  });

  // 2. ADV-SCAN-005: Deep JSON Recursion Bomb Defense
  await t.test("ADV-SCAN-005: validateCbomStructure detects 80-level deep nesting and aborts with structured error", () => {
    let deepPayload = { bomFormat: "CycloneDX", specVersion: "1.6", level: 0 };
    let current = deepPayload;
    for (let i = 1; i <= 80; i++) {
      current.sub_component = { level: i };
      current = current.sub_component;
    }

    const validation = validateCbomStructure(deepPayload);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((err) => err.includes(`exceeds ${MAX_NESTING_DEPTH} levels`)));
  });

  // 3. ADV-SCAN-006: Private Key Trap Defense in CBOM
  await t.test("ADV-SCAN-006: detectPrivateKeys catches private key traps in certificate metadata", () => {
    const hostileCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          name: "web-cert",
          type: "cryptographic-asset",
          certificate: {
            subject: "CN=example.com",
            trap: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
          },
        },
      ],
    };

    const hasPrivateKeys = detectPrivateKeys(hostileCbom);
    assert.equal(hasPrivateKeys, true);

    const scrubbed = redactPrivateKeys(hostileCbom);
    const jsonStr = JSON.stringify(scrubbed);
    assert.ok(!jsonStr.includes("BEGIN RSA PRIVATE KEY"));
    assert.ok(jsonStr.includes("[REDACTED_PRIVATE_KEY]"));
  });

  // 4. Prototype Pollution in CBOM
  await t.test("Prototype Pollution: validateCbomStructure catches constructor and prototype injection", () => {
    const poisonedCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      constructor: { prototype: { admin: true } },
    };
    const validation = validateCbomStructure(poisonedCbom);

    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((err) => err.includes("Dangerous property detected: 'constructor'")));
  });

  // 5. Cyclic Object References
  await t.test("Cyclic Graph Traversal: validateCbomStructure detects circular references without infinite loops", () => {
    const cyclicObj = { bomFormat: "CycloneDX", specVersion: "1.6" };
    cyclicObj.self = cyclicObj;

    const validation = validateCbomStructure(cyclicObj);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some(
        (err) => err.includes("Cyclic object detected") || err.includes("cannot be serialized")
      )
    );
  });

  // 6. Component Count Overflow Defense
  await t.test("Oversized Component Count: validateCbomStructure bounds max components list to safety limit", () => {
    const oversizedComponents = Array.from({ length: MAX_COMPONENTS_LIMIT + 10 }, (_, i) => ({
      name: `dummy-crypto-lib-${i}`,
      type: "library",
    }));

    const oversizedCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: oversizedComponents,
    };

    const validation = validateCbomStructure(oversizedCbom);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((err) => err.includes("exceeds safety limit")));
  });
});
