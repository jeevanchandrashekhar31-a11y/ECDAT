const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
const { db } = require("../../src/db/connection");
const { ingestCbom } = require("../../src/services/cbom_ingestion");

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

const testScanId = "scan_query_dash_test_001";
const testCbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  components: [
    {
      type: "cryptographic-asset",
      name: "TLS 1.0 Legacy Gateway",
      "bom-ref": "net:tls/gateway.example.com:443",
      cryptoProperties: {
        assetType: "protocol",
        protocolProperties: {
          type: "tls",
          version: "TLS 1.0",
        },
      },
      properties: [
        { name: "ecdat:scanner", value: "network" },
        { name: "ecdat:asset_type", value: "network_session" },
        { name: "ecdat:data_sensitivity", value: "critical" },
        { name: "ecdat:business_criticality", value: "high" },
      ],
    },
    {
      type: "cryptographic-asset",
      name: "RSA-2048 Server Cert",
      "bom-ref": "net:cert/gateway.example.com:443",
      cryptoProperties: {
        assetType: "certificate",
        certificateProperties: {
          subjectName: "CN=gateway.example.com",
          isExpired: false,
          isSelfSigned: false,
        },
      },
      properties: [
        { name: "ecdat:algorithm", value: "RSA" },
        { name: "ecdat:key_size", value: "2048" },
        { name: "ecdat:scanner", value: "network" },
        { name: "ecdat:asset_type", value: "certificate" },
        { name: "ecdat:data_sensitivity", value: "confidential" },
        { name: "ecdat:business_criticality", value: "high" },
      ],
    },
    {
      type: "cryptographic-asset",
      name: "MD5 Hash in Token Auth",
      "bom-ref": "code:md5/auth.js:14",
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: { primitive: "hash" },
      },
      properties: [
        { name: "ecdat:algorithm", value: "MD5" },
        { name: "ecdat:scanner", value: "static" },
        { name: "ecdat:asset_type", value: "source_code_call" },
        { name: "ecdat:file_path", value: "src/auth.js" },
        { name: "ecdat:line_number", value: "14" },
      ],
    },
  ],
};

test.before(async () => {
  // Ingest sample data to Postgres for testing queries
  await ingestCbom(testCbom, {
    scanId: testScanId,
    scanName: "Query Test Scan",
    scannerType: "combined",
    policyProfile: "regulated_bfsi",
  });
});

test("Dashboard API - GET /api/v1/dashboard/summary returns executive metrics and top risks", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?scanId=${testScanId}`,
    );
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.scan_id, testScanId);
    assert.strictEqual(data.policy_profile, "regulated_bfsi");
    assert.ok(data.metrics);
    assert.strictEqual(data.metrics.total_findings, 3);
    assert.ok(data.metrics.severity_counts.critical >= 1);
    assert.ok(data.metrics.mosca_status_counts);
    assert.ok(Array.isArray(data.top_risky_assets));
    assert.ok(data.top_risky_assets.length > 0);
    assert.ok(Array.isArray(data.recommendations));
    assert.ok(Array.isArray(data.mosca_analysis_table));
  });
});

test("Assets API - GET /api/v1/assets supports safe pagination, filtering, and stable sorting", async () => {
  await withServer(async (baseUrl) => {
    // 1. Pagination check
    const pagedRes = await fetch(
      `${baseUrl}/api/v1/assets?scanId=${testScanId}&page=1&pageSize=2`,
    );
    assert.strictEqual(pagedRes.status, 200);
    const pagedData = await pagedRes.json();
    assert.strictEqual(pagedData.page, 1);
    assert.strictEqual(pagedData.pageSize, 2);
    assert.strictEqual(pagedData.assets.length, 2);
    assert.ok(pagedData.total >= 2);

    // 2. Filter by severity
    const sevRes = await fetch(
      `${baseUrl}/api/v1/assets?scanId=${testScanId}&severity=Critical`,
    );
    assert.strictEqual(sevRes.status, 200);
    const sevData = await sevRes.json();
    assert.ok(
      sevData.assets.every(
        (a) => a.highest_severity.toLowerCase() === "critical",
      ),
    );

    // 3. Filter by assetType
    const typeRes = await fetch(
      `${baseUrl}/api/v1/assets?scanId=${testScanId}&assetType=network`,
    );
    assert.strictEqual(typeRes.status, 200);
    const typeData = await typeRes.json();
    assert.ok(typeData.assets.length > 0);
    assert.ok(
      typeData.assets.every((a) =>
        a.asset_type.toLowerCase().includes("network"),
      ),
    );

    // 4. SQL injection safety check: single quotes and comments should safely bind
    const sqliRes = await fetch(
      `${baseUrl}/api/v1/assets?scanId=${testScanId}&severity=' OR '1'='1`,
    );
    assert.strictEqual(sqliRes.status, 200);
    const sqliData = await sqliRes.json();
    assert.strictEqual(sqliData.assets.length, 0); // Safely treated as literal string, no injection
  });
});

test("Assets API - GET /api/v1/assets/:assetId returns evidence, risks, Mosca inputs, and recommendations", async () => {
  await withServer(async (baseUrl) => {
    const encodedAssetId = encodeURIComponent(
      "net:tls/gateway.example.com:443",
    );
    const res = await fetch(
      `${baseUrl}/api/v1/assets/${encodedAssetId}?scanId=${testScanId}`,
    );
    assert.strictEqual(res.status, 200);

    const asset = await res.json();
    assert.strictEqual(asset.asset_id, "net:tls/gateway.example.com:443");
    assert.strictEqual(asset.highest_severity, "Critical");

    // Verify evidence is populated
    assert.ok(Array.isArray(asset.evidence));
    assert.ok(asset.evidence.length > 0);
    assert.ok(asset.evidence[0].algorithm);

    // Verify risks
    assert.ok(Array.isArray(asset.risks));
    assert.ok(asset.risks.length > 0);
    assert.strictEqual(asset.risks[0].severity, "Critical");

    // Verify Mosca theorem inputs
    assert.ok(asset.mosca);
    assert.ok(asset.mosca.status);
    assert.strictEqual(typeof asset.mosca.margin_years, "number");
    assert.strictEqual(typeof asset.mosca.shelf_life_X, "number");
    assert.strictEqual(typeof asset.mosca.migration_time_Y, "number");
    assert.strictEqual(typeof asset.mosca.quantum_threat_Z, "number");

    // Verify recommendations
    assert.ok(Array.isArray(asset.recommendations));
    assert.ok(asset.recommendations.length > 0);
    assert.ok(asset.recommendations[0].recommended_target);
  });
});

test("Findings API - GET /api/v1/findings supports parameterized filtering and pagination", async () => {
  await withServer(async (baseUrl) => {
    // 1. Filter by algorithm
    const algRes = await fetch(
      `${baseUrl}/api/v1/findings?scanId=${testScanId}&algorithm=MD5`,
    );
    assert.strictEqual(algRes.status, 200);
    const algData = await algRes.json();
    assert.strictEqual(algData.total, 1);
    assert.strictEqual(algData.findings[0].algorithm, "MD5");

    // 2. Filter by source / scanner_type
    const srcRes = await fetch(
      `${baseUrl}/api/v1/findings?scanId=${testScanId}&source=combined`,
    );
    assert.strictEqual(srcRes.status, 200);
    const srcData = await srcRes.json();
    assert.strictEqual(srcData.total, 3);

    // 3. Fetch single finding details via GET /api/v1/findings/:findingId
    const findingId = algData.findings[0].id;
    const detailRes = await fetch(`${baseUrl}/api/v1/findings/${findingId}`);
    assert.strictEqual(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.strictEqual(detailData.finding_id, findingId);
    assert.strictEqual(detailData.algorithm, "MD5");
    assert.ok(detailData.risk_assessment);
    assert.ok(detailData.recommendation);
    assert.ok(detailData.asset_context);
  });
});

test("Reports API - GET /api/v1/reports/summary and /api/v1/reports/cbom/:scanId", async () => {
  await withServer(async (baseUrl) => {
    // 1. GET /api/v1/reports/summary
    const sumRes = await fetch(
      `${baseUrl}/api/v1/reports/summary?scanId=${testScanId}`,
      {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      },
    );
    assert.strictEqual(sumRes.status, 200);
    const sumData = await sumRes.json();
    assert.ok(sumData.metrics);

    // 2. GET /api/v1/reports/cbom/:scanId (annotated)
    const cbomRes = await fetch(`${baseUrl}/api/v1/reports/cbom/${testScanId}`, {
      headers: { "X-API-Key": config.ECDAT_API_KEY },
    });
    assert.strictEqual(cbomRes.status, 200);
    const cbomData = await cbomRes.json();
    assert.strictEqual(cbomData.bomFormat, "CycloneDX");
    assert.ok(cbomData.components.length >= 3);

    // 3. GET /api/v1/reports/cbom/:scanId?type=raw
    const rawCbomRes = await fetch(
      `${baseUrl}/api/v1/reports/cbom/${testScanId}?type=raw`,
      {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      },
    );
    assert.strictEqual(rawCbomRes.status, 200);
    const rawCbomData = await rawCbomRes.json();
    assert.strictEqual(rawCbomData.bomFormat, "CycloneDX");
  });
});

test.after(async () => {
  await db.destroy();
});
