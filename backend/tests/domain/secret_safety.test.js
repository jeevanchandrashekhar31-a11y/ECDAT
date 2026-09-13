const test = require("node:test");
const assert = require("node:assert/strict");

const { redactPrivateKeys } = require("../../src/services/cbom_validation");
const { generateHtmlReport } = require("../../src/risk_engine/html_reporter");
const { ParserFailureError } = require("../../src/domain/errors");
const { sanitizeConfigForLogging } = require("../../src/config");

const SAMPLE_RAW_KEY =
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y3+secretKeyBytesHereForTestingOnlyNotRealKey1234567890=\n-----END RSA PRIVATE KEY-----";

test("Secret Safety - Raw secrets never appear in CBOM or JSON objects", () => {
  const payload = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [
      {
        name: "test-key-component",
        properties: [{ name: "key_pem", value: SAMPLE_RAW_KEY }],
      },
    ],
  };

  const { sanitized, redactedCount } = redactPrivateKeys(payload);
  assert.equal(redactedCount, 1);
  const jsonStr = JSON.stringify(sanitized);

  assert.ok(!jsonStr.includes("MIIEowIBAAKCAQEA"));
  assert.ok(!jsonStr.includes(SAMPLE_RAW_KEY));
  assert.ok(jsonStr.includes("[REDACTED_PRIVATE_KEY]"));
});

test("Secret Safety - Raw secrets never appear in error messages and error details", () => {
  const err = new ParserFailureError(`Failed to parse key: ${SAMPLE_RAW_KEY}`, {
    keySnippet: SAMPLE_RAW_KEY,
  });

  const errJson = JSON.stringify(err.toJSON());
  assert.ok(!err.message.includes("MIIEowIBAAKCAQEA"));
  assert.ok(!errJson.includes(SAMPLE_RAW_KEY));
  assert.ok(err.message.includes("[REDACTED_PRIVATE_KEY]"));
  assert.ok(err.details.keySnippet.includes("[REDACTED_PRIVATE_KEY]"));
});

test("Secret Safety - Raw secrets never appear in UI / HTML reports", () => {
  const mockSummary = {
    report_metadata: { generated_at: new Date().toISOString() },
    metrics: {
      overall_cicd_pass: true,
      total_assets: 1,
      total_findings: 1,
      severity_counts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      assets_at_quantum_risk: 0,
    },
    top_risky_assets: [
      {
        asset_id: `asset_${SAMPLE_RAW_KEY}`,
        name: `Key asset with ${SAMPLE_RAW_KEY}`,
        algorithm: "RSA",
        asset_type: "hardcoded_private_key",
        severity: "Critical",
        mosca_status: "At_Risk",
        explanation: `Raw secret evidence: ${SAMPLE_RAW_KEY}`,
      },
    ],
    mosca_analysis_table: [],
    recommendations: [],
    assumptions: [],
  };


  const html = generateHtmlReport(mockSummary);
  assert.ok(!html.includes("MIIEowIBAAKCAQEA"));
  assert.ok(!html.includes(SAMPLE_RAW_KEY));
  assert.ok(html.includes("[REDACTED_PRIVATE_KEY]"));
});

test("Secret Safety - Raw secrets never appear in logging output", () => {
  const configObj = {
    ECDAT_API_KEY: "super-secret-api-token-value",
    database: {
      password: "db-secret-password-123",
      url: "postgresql://postgres:secretpassword@localhost:5432/ecdat",
    },
    rawKey: SAMPLE_RAW_KEY,
  };

  const sanitized = sanitizeConfigForLogging(configObj);
  const logStr = JSON.stringify(sanitized);

  assert.ok(!logStr.includes("super-secret-api-token-value"));
  assert.ok(!logStr.includes("db-secret-password-123"));
  assert.ok(!logStr.includes(":secretpassword@"));
  assert.ok(logStr.includes("***REDACTED***"));
});
