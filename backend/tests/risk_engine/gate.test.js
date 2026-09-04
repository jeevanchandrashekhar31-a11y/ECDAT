const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateGate } = require("../../src/risk_engine/gate");

const summary = {
  metrics: {
    severity_counts: { critical: 1, high: 2 },
    mosca_status_counts: { SAFE: 3, WATCH: 1, AT_RISK: 1, CRITICAL_URGENT: 1 },
  },
};

test("explicit CI gates use their documented threshold", () => {
  assert.equal(evaluateGate(summary, "none").matched, false);
  assert.equal(evaluateGate(summary, "critical").matched, true);
  assert.equal(evaluateGate(summary, "high").matched, true);
  assert.equal(evaluateGate(summary, "mosca-risk").matched, true);
});

test("high gate fails for High even without Critical", () => {
  const highOnly = {
    metrics: {
      severity_counts: { critical: 0, high: 1 },
      mosca_status_counts: {},
    },
  };
  assert.equal(evaluateGate(highOnly, "critical").matched, false);
  assert.equal(evaluateGate(highOnly, "high").matched, true);
});

test("gate rejects unknown thresholds", () => {
  assert.throws(() => evaluateGate(summary, "medium"), /Unsupported --fail-on/);
});
