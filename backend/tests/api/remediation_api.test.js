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

test("Remediation API - POST /api/v1/remediation/plan defaults to DRY RUN", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      findings: [
        {
          id: "fnd-md5-db",
          algorithm: "MD5",
          severity: "HIGH",
          location: "src/db/hash.js",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/remediation/plan`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.mode, "DRY_RUN");
    assert.equal(data.is_dry_run, true);
    assert.equal(data.summary.total_actionable_findings, 1);

    const rem = data.remediations[0];
    assert.equal(rem.finding.id, "fnd-md5-db");
    assert.ok(rem.why_it_matters.summary);
    assert.ok(rem.recommended_remediation.steps.length >= 1);
    assert.ok(rem.migration_options.length >= 2);
    assert.ok(rem.expected_impact.blast_radius);
    assert.ok(rem.dependencies.required_libraries);
    assert.ok(rem.testing_plan.stages.length >= 3);
    assert.equal(rem.rollback_plan.zero_downtime_guaranteed, true);
    assert.ok(rem.confidence.level);
    assert.equal(rem.dry_run.mode, "DRY_RUN");
  });
});

test("Remediation API - POST /api/v1/remediation/plan/:findingId generates plan for single finding", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      finding: {
        algorithm: "RSA",
        key_size: 1024,
        severity: "CRITICAL",
        location: "keys/jwt.key",
      },
      environment: "production",
    };

    const res = await fetch(`${baseUrl}/api/v1/remediation/plan/fnd-rsa-jwt`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.finding.id, "fnd-rsa-jwt");
    assert.ok(data.why_it_matters.summary.includes("RSA-1024"));
    assert.equal(data.recommended_remediation.action_type, "KEY_ROTATION");
    assert.equal(data.dry_run.mode, "DRY_RUN");
  });
});

test("Remediation API - POST /api/v1/remediation/simulate forces safe simulation with zero mutations", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      findings: [
        {
          id: "fnd-tls-legacy",
          algorithm: "TLS 1.0",
          severity: "CRITICAL",
          location: "ingress/gateway.yaml",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/remediation/simulate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.simulation, true);
    assert.equal(data.mode, "DRY_RUN");
    assert.ok(data.message.includes("Remediation simulation completed safely"));
    assert.equal(data.remediations[0].dry_run.simulation_status, "SIMULATED_SUCCESS");
  });
});
