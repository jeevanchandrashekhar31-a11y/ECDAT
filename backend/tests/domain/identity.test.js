const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const {
  canonicalizeJson,
  computeCanonicalHash,
  generateAssetId,
  generateFindingId,
  generateEvidenceId,
  generateRelationshipId,
  parseIdentifier,
  ACTIVE_IDENTITY_VERSION,
} = require("../../src/domain/identity");

describe("Stable Deterministic Identifiers (Node.js)", () => {
  test("Canonical JSON serialization is invariant to object key insertion order", () => {
    const obj1 = { z: 1, a: "hello", m: { nested_b: 2, nested_a: 1 } };
    const obj2 = { a: "hello", m: { nested_a: 1, nested_b: 2 }, z: 1 };

    assert.equal(canonicalizeJson(obj1), canonicalizeJson(obj2));
    assert.equal(computeCanonicalHash(obj1), computeCanonicalHash(obj2));
  });

  test("Asset ID is deterministic across repeated runs", () => {
    const params = {
      tenantId: "tenant_acme",
      applicationId: "payments_service",
      assetType: "algorithm",
      provenance: { kind: "source_code", locator: "src/crypto/jwt.js" },
      coreProperties: { algorithm: "RSA", keySize: 2048 },
    };

    const id1 = generateAssetId(params);
    const id2 = generateAssetId(params);

    assert.equal(id1, id2);
    assert.ok(id1.startsWith("urn:ecdat:v1:asset:tenant_acme:payments_service:algorithm:"));
    const parsed = parseIdentifier(id1);
    assert.equal(parsed.version, "v1");
    assert.equal(parsed.tenantId, "tenant_acme");
    assert.equal(parsed.appId, "payments_service");
  });

  test("Asset ID is invariant to line numbers and display names", () => {
    const baseParams = {
      tenantId: "tenant_acme",
      applicationId: "payments_service",
      assetType: "algorithm",
      provenance: { kind: "source_code", locator: "src/crypto/jwt.js" },
      coreProperties: { algorithm: "RSA", keySize: 2048 },
    };

    const id1 = generateAssetId({ ...baseParams, lineNumber: 42, displayName: "Primary RSA Key" });
    const id2 = generateAssetId({ ...baseParams, lineNumber: 189, displayName: "Renamed Signing Key" });

    assert.equal(id1, id2, "Asset ID must not drift when line number or display name changes");
  });

  test("Delimiter injection attack resistance", () => {
    // Attack scenario: blurring field boundaries
    const idA = generateAssetId({
      tenantId: "tenant:alpha",
      applicationId: "service_beta",
      assetType: "algorithm",
      provenance: { locator: "main.go" },
    });

    const idB = generateAssetId({
      tenantId: "tenant",
      applicationId: "alpha:service_beta",
      assetType: "algorithm",
      provenance: { locator: "main.go" },
    });

    assert.notEqual(idA, idB, "Delimiter injection must not cause hash collision");
  });

  test("Tenant and application scope isolation", () => {
    const assetSpec = {
      assetType: "certificate",
      provenance: { kind: "tls_endpoint", locator: "api.internal:443" },
      coreProperties: { fingerprint: "sha256:abc12345" },
    };

    const tenantA_id = generateAssetId({ ...assetSpec, tenantId: "tenant_a", applicationId: "gateway" });
    const tenantB_id = generateAssetId({ ...assetSpec, tenantId: "tenant_b", applicationId: "gateway" });
    const app2_id = generateAssetId({ ...assetSpec, tenantId: "tenant_a", applicationId: "auth_service" });

    assert.notEqual(tenantA_id, tenantB_id, "Different tenants must have distinct IDs");
    assert.notEqual(tenantA_id, app2_id, "Different applications must have distinct IDs");
  });

  test("Finding ID generation and stability", () => {
    const assetId = "urn:ecdat:v1:asset:default:default:algorithm:abcdef0123456789";
    const finding1 = generateFindingId({
      tenantId: "default",
      applicationId: "default",
      assetId,
      ruleId: "RULE-MD5",
      algorithmStandard: "MD5",
    });

    const finding2 = generateFindingId({
      tenantId: "default",
      applicationId: "default",
      assetId,
      ruleId: "RULE-MD5",
      algorithmStandard: "MD5",
    });

    assert.equal(finding1, finding2);
    assert.ok(finding1.startsWith("urn:ecdat:v1:finding:default:default:"));

    const findingDifferentAlgo = generateFindingId({
      tenantId: "default",
      applicationId: "default",
      assetId,
      ruleId: "RULE-SHA1",
      algorithmStandard: "SHA1",
    });
    assert.notEqual(finding1, findingDifferentAlgo);
  });

  test("Synthetic large-scale collision test (5,000 distinct items have 0 collisions)", () => {
    const idSet = new Set();
    const count = 5000;

    for (let i = 0; i < count; i++) {
      const id = generateAssetId({
        tenantId: `tenant_${i % 10}`,
        applicationId: `app_${i % 25}`,
        assetType: i % 2 === 0 ? "algorithm" : "certificate",
        provenance: { locator: `src/module_${i}/crypto_${i}.ts` },
        coreProperties: { keySize: 1024 + (i % 4) * 1024, index: i },
      });
      idSet.add(id);
    }

    assert.equal(idSet.size, count, "Zero collisions expected across 5,000 generated items");
  });

  test("Identity rules JSON validates against identity_rules.schema.json", () => {
    const schemaPath = path.resolve(__dirname, "../../../rules/schemas/identity_rules.schema.json");
    const rulesPath = path.resolve(__dirname, "../../../rules/identity_rules.json");

    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate(rules);

    assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
    assert.equal(rules.activeVersion, ACTIVE_IDENTITY_VERSION);
  });
});
