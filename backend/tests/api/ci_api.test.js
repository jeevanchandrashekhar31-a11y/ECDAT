const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");

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

test("CI API - GET /api/v1/ci/status returns scanner health and supported exit codes", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/ci/status`, {
      method: "GET",
      headers: AUTH_HEADERS,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ready");
    assert.equal(data.supportedExitCodes["0"], "PASS");
    assert.equal(data.supportedExitCodes["1"], "POLICY_SECURITY_FAILURE");
    assert.equal(data.supportedExitCodes["2"], "SCANNER_ERROR");
    assert.equal(data.supportedExitCodes["3"], "INVALID_CONFIG");
    assert.equal(data.conflationGuaranteedFalse, true);
  });
});

test("CI API - POST /api/v1/ci/gate evaluates findings against policy threshold", async () => {
  await withServer(async (baseUrl) => {
    // 1. Critical finding against critical gate fails (HTTP 422, exitCode 1)
    const failPayload = {
      findings: [
        {
          rule_id: "ECDAT-STATIC-MD5",
          algorithm: "MD5",
          severity: "critical",
          file_path: "src/crypto.js",
          line_number: 10,
        },
      ],
      failOn: "critical",
    };

    const resFail = await fetch(`${baseUrl}/api/v1/ci/gate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(failPayload),
    });

    assert.equal(resFail.status, 422);
    const failData = await resFail.json();
    assert.equal(failData.passed, false);
    assert.equal(failData.exitCode, 1);
    assert.ok(failData.violations.length >= 1);

    // 2. Medium finding against critical gate passes (HTTP 200, exitCode 0)
    const passPayload = {
      findings: [
        {
          rule_id: "ECDAT-STATIC-MEDIUM",
          algorithm: "AES-128",
          severity: "medium",
          file_path: "src/crypto.js",
          line_number: 10,
        },
      ],
      failOn: "critical",
    };

    const resPass = await fetch(`${baseUrl}/api/v1/ci/gate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(passPayload),
    });

    assert.equal(resPass.status, 200);
    const passData = await resPass.json();
    assert.equal(passData.passed, true);
    assert.equal(passData.exitCode, 0);
  });
});

test("CI API - POST /api/v1/ci/sarif generates OASIS SARIF v2.1.0 report", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      findings: [
        {
          rule_id: "ECDAT-DES-CIPHER",
          algorithm: "DES",
          finding_type: "weak_cipher",
          severity: "critical",
          confidence: "high",
          file_path: "legacy/crypto.js",
          line_number: 42,
          evidence: "createCipher('des')",
          remediation: "Migrate to AES-GCM",
        },
      ],
      toolName: "ECDAT API CI Scanner",
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/sarif`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const sarif = await res.json();
    assert.equal(sarif.version, "2.1.0");
    assert.ok(sarif.$schema.includes("sarif-schema-2.1.0.json"));
    assert.equal(sarif.runs[0].tool.driver.name, "ECDAT API CI Scanner");
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, "ECDAT-DES-CIPHER");
    assert.equal(sarif.runs[0].results[0].level, "error");
  });
});

test("CI API - POST /api/v1/ci/scan handles invalid config with 400 Bad Request", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      targetDir: "non_existent_dir_random_999",
      failOn: "critical",
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/scan`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.exitCode, 3);
    assert.equal(data.gateVerdict, "INVALID_CONFIG");
  });
});
