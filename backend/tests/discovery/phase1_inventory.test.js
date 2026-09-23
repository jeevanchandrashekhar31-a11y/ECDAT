const { test } = require('node:test');
const assert = require('node:assert');
const { annotateCbom } = require('../../src/risk_engine/cbom_annotator');
const { persistScanToPostgres } = require('../../src/services/cbom_ingestion');
const { db } = require('../../src/db/connection');

test("Phase 1: Cryptographic Discovery & Inventory", async (t) => {
  await t.test("annotateCbom extracts Phase 1 explicit asset fields", () => {
    const mockCbom = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          "bom-ref": "net:ext:tls-endpoint-1",
          type: "cryptographic-asset",
          name: "TLS 1.2",
          cryptoProperties: {
            assetType: "protocol",
            protocolProperties: {
              version: "TLS 1.2"
            }
          },
          properties: [
            { name: "ecdat:evidence_type", value: "network_scan" },
            { name: "ecdat:confidence", value: "high" },
            { name: "ecdat:bu", value: "Finance" },
            { name: "ecdat:is_synthetic", value: "true" }
          ]
        }
      ]
    };

    const annotated = annotateCbom(mockCbom);
    const finding = annotated.classifiedResults[0];
    
    // Explicit Phase 1 properties should be populated
    assert.strictEqual(finding.algorithm, "TLS 1.2");
    assert.strictEqual(finding.primitive, "protocol");
    assert.strictEqual(finding.usage, "network_scan");
    assert.strictEqual(finding.location, "net:ext:tls-endpoint-1");
    assert.strictEqual(finding.owner, "Finance");
    assert.strictEqual(finding.protocol, "TLS 1.2");
    assert.strictEqual(finding.confidence, 1.0);
    assert.strictEqual(finding.is_synthetic, true);
    assert.strictEqual(finding.source, "scanner");
  });

  await t.test("persistScanToPostgres deduplicates and saves Phase 1 fields", async () => {
    const scanId = "test-phase1-discovery-scan";
    const tenantId = "test-tenant-1";
    
    // Delete any old test data
    await db("scans").where({ id: scanId }).del();

    const mockScanRecord = {
      id: scanId,
      tenantId: tenantId,
      name: "Phase 1 Test Scan",
      metrics: { severity_counts: {} },
      classified_findings: [
        {
          id: "find-1",
          bom_ref: "asset-1",
          asset_type: "certificate",
          algorithm: "RSA",
          key_size: 2048,
          usage: "tls_cert",
          location: "/etc/ssl/certs/cert.pem",
          owner: "Infra",
          is_synthetic: false,
          confidence: 0.9,
          mosca: { status: "SAFE" }
        },
        // Duplicate asset reference inside the same scan to test deduplication
        {
          id: "find-2",
          bom_ref: "asset-1",
          asset_type: "certificate",
          algorithm: "RSA", // update algorithm
          key_size: 4096,
          usage: "tls_cert",
          location: "/etc/ssl/certs/cert.pem",
          owner: "Infra",
          mosca: { status: "SAFE" }
        }
      ]
    };

    const success = await persistScanToPostgres(mockScanRecord, {});
    assert.strictEqual(success, true); // transaction finishes returning true
    
    // Verify asset was inserted correctly
    const assets = await db("assets").where({ scan_id: scanId });
    assert.strictEqual(assets.length, 1, "Duplicate assets within the same scan should be deterministically deduplicated");
    
    const asset = assets[0];
    assert.strictEqual(asset.tenant_id, tenantId);
    assert.strictEqual(asset.algorithm, "RSA");
    assert.strictEqual(asset.key_size, 4096); // Last one merged wins
    assert.strictEqual(asset.usage, "tls_cert");
    assert.strictEqual(asset.location, "/etc/ssl/certs/cert.pem");
    assert.strictEqual(asset.owner, "Infra");
    assert.strictEqual(asset.is_synthetic, false);
    
    // Clean up
    await db("scans").where({ id: scanId }).del();
  });
});
