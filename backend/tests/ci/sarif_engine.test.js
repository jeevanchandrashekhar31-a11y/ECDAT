const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NodeSarifEngine,
  SarifValidationError,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
} = require("../../src/ci/sarif_engine");

const SAMPLE_FINDINGS = [
  {
    rule_id: "ECDAT-STATIC-MD5",
    algorithm: "MD5",
    finding_type: "weak_hash",
    file_path: "src/auth/token.js",
    line_number: 42,
    column_number: 5,
    severity: "critical",
    confidence: "high",
    evidence: "return crypto.createHash('md5').update(token).digest('hex');",
    description: "MD5 collision vulnerability detected",
    remediation: "Replace with SHA-256",
  },
  {
    rule_id: "ECDAT-STATIC-DES",
    algorithm: "DES",
    finding_type: "weak_cipher",
    file_path: "src/crypto/cipher.js",
    line_number: 108,
    column_number: 1,
    severity: "high",
    confidence: "high",
    evidence: "crypto.createCipheriv('des-ecb', key, null)",
    description: "Legacy 56-bit DES cipher detected",
    remediation: "Migrate to AES-256-GCM",
  },
  {
    rule_id: "ECDAT-STATIC-MEDIUM",
    algorithm: "AES-128",
    finding_type: "quantum_margin",
    file_path: "src/crypto/store.js",
    line_number: 15,
    column_number: 1,
    severity: "medium",
    confidence: "medium",
    evidence: "crypto.createCipheriv('aes-128-gcm', key128, iv)",
    description: "Grover quantum search margin deduction",
    remediation: "Upgrade to AES-256 for long-term quantum margin",
  },
];

test("Node SARIF Engine - Generates valid SARIF with all 7 required dimensions", () => {
  const sarif = NodeSarifEngine.generate(SAMPLE_FINDINGS);

  // Automated validation passes
  const validation = NodeSarifEngine.validate(sarif);
  assert.equal(validation.isValid, true);
  assert.equal(validation.errors.length, 0);

  assert.equal(sarif.version, SARIF_VERSION);
  assert.equal(sarif.$schema, SARIF_SCHEMA_URI);
  assert.equal(sarif.runs.length, 1);

  const run = sarif.runs[0];
  const rules = run.tool.driver.rules;
  const results = run.results;

  assert.equal(rules.length, 3);
  assert.equal(results.length, 3);

  // 1. Rule ID
  const ruleIds = rules.map((r) => r.id);
  assert.ok(ruleIds.includes("ECDAT-STATIC-MD5"));
  assert.ok(ruleIds.includes("ECDAT-STATIC-DES"));
  assert.ok(ruleIds.includes("ECDAT-STATIC-MEDIUM"));

  // 2. Severity (mapped to error/warning/note and security-severity 0.0-10.0)
  const md5Result = results.find((r) => r.ruleId === "ECDAT-STATIC-MD5");
  assert.equal(md5Result.level, "error");
  const md5Rule = rules.find((r) => r.id === "ECDAT-STATIC-MD5");
  assert.equal(md5Rule.defaultConfiguration.level, "error");
  assert.equal(md5Rule.properties["security-severity"], "9.5");

  const medResult = results.find((r) => r.ruleId === "ECDAT-STATIC-MEDIUM");
  assert.equal(medResult.level, "warning");

  // 3. Location (physicalLocation, artifactLocation.uri, region startLine, startColumn)
  const loc = md5Result.locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, "src/auth/token.js");
  assert.equal(loc.region.startLine, 42);
  assert.equal(loc.region.startColumn, 5);

  // 4. Message
  assert.ok(md5Result.message.text.includes("MD5"));
  assert.ok(md5Result.message.text.includes("src/auth/token.js:42"));

  // 5. Help (help.text and rich markdown guidance card)
  assert.ok(md5Rule.help.text.includes("SHA-256"));
  assert.ok(md5Rule.help.markdown.includes("### [CRITICAL]"));
  assert.ok(md5Rule.help.markdown.includes("Why It Matters"));

  // 6. Evidence (sanitized snippet text)
  assert.ok(loc.region.snippet.text.includes("createHash('md5')"));

  // 7. Remediation guidance
  assert.ok(md5Rule.properties.remediation.includes("SHA-256"));
  assert.ok(md5Result.properties.remediation_guidance.includes("SHA-256"));
});

test("Node SARIF Engine - Automated validation catches missing version and schema", () => {
  const invalidDoc = { runs: [] };
  const validation = NodeSarifEngine.validate(invalidDoc);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some((e) => e.includes("Invalid SARIF version")));
  assert.ok(validation.errors.some((e) => e.includes("Invalid or missing $schema")));
});

test("Node SARIF Engine - Automated validation catches undefined rule IDs", () => {
  const invalidDoc = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "ECDAT Scanner",
            rules: [
              {
                id: "KNOWN-RULE",
                shortDescription: { text: "Known" },
                help: { text: "Help" },
              },
            ],
          },
        },
        results: [
          {
            ruleId: "UNDEFINED-RULE",
            level: "error",
            message: { text: "Undefined rule test" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "test.js" },
                  region: { startLine: 1, snippet: { text: "code" } },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const validation = NodeSarifEngine.validate(invalidDoc);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some((e) => e.includes("undefined rule ID")));
});

test("Node SARIF Engine - Automated validation catches invalid startLine (< 1)", () => {
  const invalidDoc = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "ECDAT Scanner",
            rules: [
              {
                id: "R1",
                shortDescription: { text: "Rule 1" },
                help: { text: "Help" },
              },
            ],
          },
        },
        results: [
          {
            ruleId: "R1",
            level: "error",
            message: { text: "Invalid line" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "test.js" },
                  region: { startLine: 0, snippet: { text: "code" } },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const validation = NodeSarifEngine.validate(invalidDoc);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some((e) => e.includes("startLine must be an integer >= 1")));
});

test("Node SARIF Engine - Automated validation rejects unredacted raw secrets in snippets", () => {
  const leakySarif = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "ECDAT Scanner",
            rules: [
              {
                id: "LEAK-RULE",
                shortDescription: { text: "Secret rule" },
                help: { text: "Help" },
              },
            ],
          },
        },
        results: [
          {
            ruleId: "LEAK-RULE",
            level: "error",
            message: { text: "Leaked secret" },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "secret.key" },
                  region: {
                    startLine: 1,
                    snippet: {
                      text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...RAW_SECRET_BYTES...",
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const validation = NodeSarifEngine.validate(leakySarif);
  assert.equal(validation.isValid, false);
  assert.ok(validation.errors.some((e) => e.includes("unredacted raw secret material")));
});

test("Node SARIF Engine - generateAndValidate throws SarifValidationError on invalid output", () => {
  // Valid input succeeds
  const valid = NodeSarifEngine.generateAndValidate(SAMPLE_FINDINGS);
  assert.equal(valid.version, SARIF_VERSION);

  // Forcing invalid output by monkeypatching or testing throws
  assert.throws(
    () => {
      NodeSarifEngine.validate = () => ({ isValid: false, errors: ["Forced error"] });
      try {
        NodeSarifEngine.generateAndValidate(SAMPLE_FINDINGS);
      } finally {
        delete NodeSarifEngine.validate; // restores prototype method
      }
    },
    (err) => err instanceof SarifValidationError && err.errors.includes("Forced error")
  );
});
