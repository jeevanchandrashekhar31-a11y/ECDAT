const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const { SARIF_SCHEMA_URI, SARIF_VERSION } = require("../../src/ci/sarif_engine");

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.ECDAT_API_KEY,
};

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("SARIF API - POST /api/v1/ci/sarif generates and validates SARIF", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      toolName: "ECDAT Enterprise Test",
      findings: [
        {
          rule_id: "ECDAT-STATIC-MD5",
          algorithm: "MD5",
          finding_type: "weak_hash",
          file_path: "src/auth.js",
          line_number: 10,
          column_number: 2,
          severity: "critical",
          confidence: "high",
          evidence: "createHash('md5')",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/sarif`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const sarif = await res.json();

    assert.equal(sarif.version, SARIF_VERSION);
    assert.equal(sarif.$schema, SARIF_SCHEMA_URI);
    assert.equal(sarif.runs.length, 1);

    const run = sarif.runs[0];
    assert.equal(run.tool.driver.name, "ECDAT Enterprise Test");
    assert.equal(run.results.length, 1);
    assert.equal(run.tool.driver.rules.length, 1);

    // Verify 7 dimensions present in response
    const result = run.results[0];
    const rule = run.tool.driver.rules[0];
    assert.equal(result.ruleId, "ECDAT-STATIC-MD5");
    assert.equal(result.level, "error");
    assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, "src/auth.js");
    assert.equal(result.locations[0].physicalLocation.region.startLine, 10);
    assert.ok(result.message.text.includes("MD5"));
    assert.ok(rule.help.markdown.includes("Why It Matters"));
    assert.ok(result.locations[0].physicalLocation.region.snippet.text.includes("createHash('md5')"));
    assert.ok(result.properties.remediation_guidance.length > 0);
  });
});

test("SARIF API - POST /api/v1/ci/sarif/validate validates valid SARIF report", async () => {
  await withServer(async (baseUrl) => {
    const validSarif = {
      $schema: SARIF_SCHEMA_URI,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: "ECDAT CI",
              rules: [
                {
                  id: "TEST-RULE",
                  shortDescription: { text: "Test rule" },
                  help: { text: "Help text" },
                },
              ],
            },
          },
          results: [
            {
              ruleId: "TEST-RULE",
              level: "error",
              message: { text: "Finding description" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/file.js" },
                    region: { startLine: 1, snippet: { text: "valid code" } },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/sarif/validate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ sarif: validSarif }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isValid, true);
    assert.equal(data.errors.length, 0);
  });
});

test("SARIF API - POST /api/v1/ci/sarif/validate rejects invalid SARIF report with 422", async () => {
  await withServer(async (baseUrl) => {
    const invalidSarif = {
      $schema: SARIF_SCHEMA_URI,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: "ECDAT CI",
              rules: [],
            },
          },
          results: [
            {
              ruleId: "UNDECLARED-RULE",
              level: "error",
              message: { text: "Finding with undeclared rule" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/file.js" },
                    region: { startLine: 0 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/sarif/validate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ sarif: invalidSarif }),
    });

    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.isValid, false);
    assert.ok(data.errors.some((e) => e.includes("undefined rule ID")));
    assert.ok(data.errors.some((e) => e.includes("startLine must be an integer >= 1")));
  });
});
