/**
 * Phase 22.2 — Backend Property & Fuzz Testing Suite
 *
 * Targets:
 * 1. CBOM Validation Service (JSON parsing, schema validation, prototype pollution, recursion, bounds)
 * 2. Policy-as-Code Engine (schema validation, ReDoS resistance, prototype pollution, secret leakage)
 * 3. Secret redaction and boundary guarantees across all parsers
 *
 * Requirements:
 * - No memory corruption
 * - No uncontrolled recursion
 * - No unbounded resource use
 * - No secrets in crash output
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  validateCbomStructure,
  checkForDangerousKeys,
  redactPrivateKeys,
  detectPrivateKeys,
} = require("../../src/services/cbom_validation");

const {
  PolicyEngine,
  PolicyValidationError,
} = require("../../src/policy/policy_engine");

const CANARY_SECRETS = [
  "CANARY_SECRET_NODE_PRIVATE_KEY_TOKEN_776655",
  "CANARY_NODE_API_KEY_SEC_LIVE_wxyz9876",
  "CANARY_NODE_PASSWORD_SUPER_SECRET_123!",
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAcanaryNodeKey...",
];

function assertNoSecretLeak(str) {
  for (const canary of CANARY_SECRETS) {
    if (typeof str === "string" && str.includes(canary)) {
      throw new Error(`CRITICAL LEAK: Canary token leaked in output/error: ${canary.substring(0, 12)}...`);
    }
  }
}

describe("Phase 22.2 — Backend Parser Property and Fuzz Testing", () => {
  // =========================================================================
  // 1. CBOM PARSER FUZZING
  // =========================================================================
  describe("CBOM Validation Fuzzing & Resilience", () => {
    it("should safely reject prototype pollution fuzz payloads without modifying Object.prototype", () => {
      const beforeKeys = Object.keys(Object.prototype);

      const pollutionPayloads = [
        JSON.parse('{"bomFormat": "CycloneDX", "__proto__": {"polluted": true}}'),
        JSON.parse('{"bomFormat": "CycloneDX", "constructor": {"prototype": {"polluted": true}}}'),
        JSON.parse('{"components": [{"__proto__": {"injected": "yes"}}]}'),
        JSON.parse('{"properties": [{"name": "test", "constructor": {"prototype": {"bad": 1}}}]}'),
      ];

      for (const payload of pollutionPayloads) {
        const result = validateCbomStructure(payload);
        assert.equal(result.valid, false, "Must reject prototype pollution payload");
        assert.ok(result.errors.some(e => e.includes("Dangerous property") || e.includes("prototype")));
      }

      // Assert Object.prototype was NOT polluted
      assert.equal(Object.prototype.polluted, undefined);
      assert.equal(Object.prototype.injected, undefined);
      assert.deepEqual(Object.keys(Object.prototype), beforeKeys);
    });

    it("should prevent uncontrolled recursion on deeply nested CBOM structures (> 64 levels)", () => {
      // Construct deeply nested payload: 100 levels
      let nested = { leaf: true };
      for (let i = 0; i < 100; i++) {
        nested = { child: nested };
      }

      const cbom = {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [nested],
      };

      const result = validateCbomStructure(cbom);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("nesting exceeds") || e.includes("levels")));
    });

    it("should safely detect and reject cyclical objects without hanging or crashing", () => {
      const cyclic = { bomFormat: "CycloneDX", components: [] };
      cyclic.self = cyclic;

      const result = validateCbomStructure(cyclic);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("Cyclic") || e.includes("safety limit")));
    });

    it("should redact and never echo canary private keys in validation errors", () => {
      const canary = CANARY_SECRETS[0];
      const cbomWithKey = {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [
          {
            name: "RSA-Service",
            properties: [
              {
                name: "private_key",
                value: `-----BEGIN RSA PRIVATE KEY-----\n${canary}\n-----END RSA PRIVATE KEY-----`,
              },
            ],
          },
        ],
      };

      // 1. Detection
      assert.equal(detectPrivateKeys(cbomWithKey), true);

      // 2. Rejection without leaking the key content in error messages
      const result = validateCbomStructure(cbomWithKey, { rejectPrivateKey: true });
      assert.equal(result.valid, false);
      for (const err of result.errors) {
        assertNoSecretLeak(err);
      }

      // 3. Redaction
      const redacted = redactPrivateKeys(cbomWithKey);
      assert.equal(redacted.redactedCount, 1);
      assertNoSecretLeak(JSON.stringify(redacted.sanitized));
      assert.ok(JSON.stringify(redacted.sanitized).includes("[REDACTED_PRIVATE_KEY"));
    });

    it("should survive mutated garbage payloads without unhandled exceptions", () => {
      const garbagePayloads = [
        null,
        undefined,
        12345,
        "not a json object",
        [],
        [1, 2, 3],
        { bomFormat: null },
        { bomFormat: 1234, specVersion: {} },
        { components: "not an array" },
        { components: [null, undefined, 42, "string", {}] },
      ];

      for (const payload of garbagePayloads) {
        const result = validateCbomStructure(payload);
        assert.equal(typeof result.valid, "boolean");
        assert.ok(Array.isArray(result.errors));
      }
    });
  });

  // =========================================================================
  // 2. POLICY ENGINE FUZZING
  // =========================================================================
  describe("Policy Engine Fuzzing & Resilience", () => {
    let engine;

    beforeEach(() => {
      engine = new PolicyEngine();
    });

    it("should reject prototype pollution attempts in policy documents", () => {
      const maliciousPolicy = JSON.parse(
        '{"version": "1.0.0", "id": "p1", "name": "Test", "__proto__": {"admin": true}, "rules": []}'
      );

      const result = engine.validatePolicy(maliciousPolicy);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("prototype")));
      assert.equal(Object.prototype.admin, undefined);
    });

    it("should reject schema violations with bounded execution time", () => {
      const malformedPolicies = [
        {},
        { version: 123 },
        { version: "1.0", id: "" },
        { version: "1.0.0", id: "p1", name: "A" }, // name too short
        { version: "1.0.0", id: "p1", name: "Valid Name", rules: "not an array" },
        { version: "1.0.0", id: "p1", name: "Valid Name", rules: [{ id: 123 }] },
      ];

      for (const pol of malformedPolicies) {
        const startTime = Date.now();
        const result = engine.validatePolicy(pol);
        const duration = Date.now() - startTime;

        assert.equal(result.valid, false);
        assert.ok(duration < 500, "Validation must complete within 500ms");
      }
    });

    it("should evaluate findings without hanging when policy contains complex patterns", () => {
      const policy = {
        version: "1.0.0",
        id: "perf-test-policy",
        name: "Performance Test Policy",
        default_action: "ALLOW",
        rules: [
          {
            id: "rule_md5",
            name: "Block MD5",
            category: "algorithm",
            action: "BLOCK",
            algorithms: {
              prohibited: ["MD5", "DES", "RC4"],
            },
          },
        ],
      };

      const loadRes = engine.loadPolicy(policy);
      assert.equal(loadRes.id, "perf-test-policy");

      // Evaluate 1,000 synthetic assets rapidly
      const startTime = Date.now();
      const assets = Array.from({ length: 1000 }, (_, i) => ({
        asset_id: `asset_${i}`,
        algorithm: i % 2 === 0 ? "MD5" : "AES-256-GCM",
        type: "algorithm",
      }));

      const evaluation = engine.evaluate(assets);
      const duration = Date.now() - startTime;

      assert.equal(evaluation.verdict, "BLOCK");
      assert.equal(evaluation.metrics.counts_by_verdict.BLOCK, 500);
      assert.equal(evaluation.metrics.counts_by_verdict.ALLOW, 500);
      assert.ok(duration < 2000, `1,000 evaluations must complete in under 2s, took ${duration}ms`);
    });

    it("should not leak canary passwords or tokens in validation error messages", () => {
      const canary = CANARY_SECRETS[2];
      const policyWithCanary = {
        version: "1.0.0",
        id: `invalid-id-with-space and-${canary}`,
        name: "Test",
        rules: [],
      };

      const result = engine.validatePolicy(policyWithCanary);
      assert.equal(result.valid, false);
      for (const err of result.errors) {
        // Assert error message does not dump the raw canary token
        assertNoSecretLeak(err);
      }
    });
  });
});
