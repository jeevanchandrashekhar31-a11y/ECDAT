const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
const { ingestCbom } = require("../../src/services/cbom_ingestion");

const AUTH_HEADERS = { "X-API-Key": config.ECDAT_API_KEY, "X-User-Role": "admin" };

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

test("Phase 17.1 — Enterprise Security Dashboard Views API", async (t) => {
  const testScanId = "scan_enterprise_views_001";
  const testCbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [
      {
        type: "cryptographic-asset",
        name: "Legacy Payment Gateway RSA",
        "bom-ref": "app:payment/gateway.js",
        cryptoProperties: {
          assetType: "algorithm",
          algorithmProperties: {
            name: "RSA",
            parameterSetIdentifier: "2048",
            curve: null,
          },
        },
        properties: [
          { name: "ecdat:scanner", value: "ast" },
          { name: "ecdat:location", value: "src/payment/gateway.js" },
          { name: "ecdat:line_number", value: "142" },
          { name: "ecdat:data_sensitivity", value: "critical" },
          { name: "ecdat:business_criticality", value: "high" },
        ],
      },
      {
        type: "cryptographic-asset",
        name: "Edge API TLS Endpoint",
        "bom-ref": "net:tls/api.acme.org:443",
        cryptoProperties: {
          assetType: "protocol",
          protocolProperties: {
            type: "tls",
            version: "TLS 1.3",
            cipherSuites: ["TLS_AES_256_GCM_SHA384"],
          },
        },
        properties: [
          { name: "ecdat:scanner", value: "network" },
          { name: "ecdat:location", value: "api.acme.org:443" },
          { name: "ecdat:data_sensitivity", value: "high" },
          { name: "ecdat:business_criticality", value: "high" },
        ],
      },
    ],
  };

  await ingestCbom(testCbom, {
    scanId: testScanId,
    scanName: "Enterprise Payment & Edge Stack",
  });

  await t.test("GET /api/v1/dashboard/views returns all 13 specialized views with evidence links", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/dashboard/views?scanId=${testScanId}`, { headers: AUTH_HEADERS });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.scan_id, testScanId);
      assert.ok(data.views, "views object must be present");

      // Verify all 13 views exist
      const requiredViews = [
        "executive_overview",
        "crypto_inventory",
        "application_inventory",
        "risk_heatmap",
        "pqc_readiness",
        "certificates",
        "algorithms",
        "network_endpoints",
        "runtime_observations",
        "policy_violations",
        "remediation",
        "ownership",
        "audit_trail",
      ];

      for (const viewName of requiredViews) {
        assert.ok(data.views[viewName], `View '${viewName}' must be present in views`);
      }

      // Verify Evidence Linking: every number links to evidence
      assert.ok(data.evidence_lookup, "evidence_lookup dictionary must be provided");
      assert.ok(Object.keys(data.evidence_lookup).length > 0, "evidence_lookup must not be empty");

      // Check executive overview KPI numbers have evidence_items
      const exec = data.views.executive_overview;
      assert.ok(typeof exec.posture_score === "number");
      assert.ok(Array.isArray(exec.kpi_cards));
      for (const kpi of exec.kpi_cards) {
        assert.ok("evidence_items" in kpi, `KPI ${kpi.title} must have evidence_items`);
        assert.ok(Array.isArray(kpi.evidence_items));
      }

      // Check Risk Heatmap matrix has cells linking to evidence
      const heatmap = data.views.risk_heatmap;
      assert.ok(Array.isArray(heatmap.matrix));
      assert.ok(heatmap.matrix.length > 0);
      const sampleCell = heatmap.matrix[0];
      assert.ok("evidence_items" in sampleCell, "Heatmap cell must link to evidence items");

      // Check Remediation view has quick wins with evidence
      const remediation = data.views.remediation;
      assert.ok(Array.isArray(remediation.quick_wins));
      if (remediation.quick_wins.length > 0) {
        assert.ok(remediation.quick_wins[0].finding_id, "Quick win must link to finding_id");
      }

      // Check PQC Readiness
      const pqc = data.views.pqc_readiness;
      assert.ok(typeof pqc.mosca_summary === "object");
      assert.ok(Array.isArray(pqc.timeline));

      // Check Ownership view
      const ownership = data.views.ownership;
      assert.ok(Array.isArray(ownership.teams));

      // Check Audit Trail
      const audit = data.views.audit_trail;
      assert.ok(typeof audit.total_events === "number");
      assert.ok(Array.isArray(audit.events));
    });
  });
});
