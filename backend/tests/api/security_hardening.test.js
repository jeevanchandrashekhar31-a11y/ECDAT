const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCbomStructure,
  MAX_COMPONENTS_LIMIT,
  MAX_NESTING_DEPTH,
} = require("../../src/services/cbom_validation");

test("CBOM validation rejects unsafe component counts", () => {
  const result = validateCbomStructure({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: Array.from({ length: MAX_COMPONENTS_LIMIT + 1 }, () => ({})),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /exceeds safety limit/);
});

test("CBOM validation rejects excessive object nesting", () => {
  const payload = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [],
  };
  let current = payload;
  for (let i = 0; i <= MAX_NESTING_DEPTH; i += 1) {
    current.child = {};
    current = current.child;
  }
  const result = validateCbomStructure(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /nesting exceeds/);
});
