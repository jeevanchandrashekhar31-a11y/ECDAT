const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
const { db } = require("../../src/db/connection");

// Helper to launch an ephemeral test server
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

test("API - GET /health returns 200 with service status and version", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, "healthy");
    assert.strictEqual(data.service, "ecdat-backend");
    assert.ok(data.version);
    assert.ok(typeof data.uptime_seconds === "number");

    // Verify X-Request-Id header is present
    const reqId = res.headers.get("x-request-id");
    assert.ok(reqId && reqId.length > 0);
  });
});

test("API - Bad JSON payload returns safe 400 error", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/cbom/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: '{"invalid_json": broken...',
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, "BadRequest");
    assert.ok(data.message.includes("Invalid JSON"));
    assert.ok(data.requestId);
  });
});

test("API - 404 Route returns clean JSON error", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/nonexistent_endpoint`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, "NotFound");
  });
});

test("API - CBOM Ingestion & Retrieval Pipeline", async () => {
  await withServer(async (baseUrl) => {
    const sampleCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          type: "cryptographic-asset",
          name: "TLS 1.0",
          "bom-ref": "net:target/api.test.com:443",
          cryptoProperties: {
            assetType: "protocol",
            protocolProperties: {
              type: "tls",
              version: "TLS 1.0",
            },
          },
        },
        {
          type: "cryptographic-asset",
          name: "RSA-2048",
          "bom-ref": "net:cert/api.test.com:443",
          cryptoProperties: {
            assetType: "certificate",
            certificateProperties: {
              subjectName: "CN=api.test.com",
              isExpired: false,
              isSelfSigned: false,
            },
          },
          properties: [
            { name: "ecdat:algorithm", value: "RSA" },
            { name: "ecdat:key_size", value: "2048" },
          ],
        },
      ],
    };

    // 1. Ingest CBOM
    const ingestRes = await fetch(
      `${baseUrl}/api/v1/cbom/ingest?policyProfile=public_internet`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify(sampleCbom),
      },
    );

    assert.strictEqual(ingestRes.status, 201);
    const ingestData = await ingestRes.json();
    assert.ok(ingestData.scan_id);
    assert.strictEqual(ingestData.policy_profile, "public_internet");
    assert.strictEqual(ingestData.metrics.total_findings, 2);

    const scanId = ingestData.scan_id;

    // 2. Fetch Annotated CBOM
    const cbomRes = await fetch(`${baseUrl}/api/v1/cbom/${scanId}`);
    assert.strictEqual(cbomRes.status, 200);
    const annotated = await cbomRes.json();
    assert.strictEqual(annotated.bomFormat, "CycloneDX");
    const tlsComp = annotated.components.find((c) => c.name === "TLS 1.0");
    assert.ok(
      tlsComp.properties.some(
        (p) => p.name === "ecdat:risk:severity" && p.value === "Critical",
      ),
    );

    // 3. Fetch Findings with Filter
    const findingsRes = await fetch(
      `${baseUrl}/api/v1/findings?scanId=${scanId}&severity=critical`,
    );
    assert.strictEqual(findingsRes.status, 200);
    const findingsData = await findingsRes.json();
    assert.strictEqual(findingsData.total, 1);
    assert.strictEqual(findingsData.findings[0].algorithm, "TLS 1.0");

    // 4. Fetch Assets
    const assetsRes = await fetch(`${baseUrl}/api/v1/assets?scanId=${scanId}`);
    assert.strictEqual(assetsRes.status, 200);
    const assetsData = await assetsRes.json();
    assert.strictEqual(assetsData.total, 2);

    // 5. Fetch Dashboard Summary
    const dashRes = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?scanId=${scanId}`,
    );
    assert.strictEqual(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.strictEqual(dashData.metrics.total_findings, 2);
    assert.strictEqual(dashData.metrics.severity_counts.critical, 1);

    // 6. Fetch HTML Report
    const htmlRes = await fetch(`${baseUrl}/api/v1/reports/${scanId}/html`);
    assert.strictEqual(htmlRes.status, 200);
    assert.ok(htmlRes.headers.get("content-type").includes("text/html"));
    const htmlContent = await htmlRes.text();
    assert.ok(htmlContent.includes("ECDAT Cryptographic Risk Assessment"));
    assert.ok(htmlContent.includes("CI/CD FAIL"));
  });
});

test.after(async () => {
  await db.destroy();
});
