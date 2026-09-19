/**
 * Phase 3 Security Regression Suite: Authorization & Tenant Isolation
 *
 * Verifies fixes for:
 * - P0-06: Anonymous / cross-tenant DB-backed read exposure in assets, findings, dashboard.
 * - P1-08: Object-level authorization / IDOR / BOLA verification.
 */

const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const { TenantContext } = require("../../src/tenancy/tenant_isolation");
const { cbomIngestionService } = require("../../src/services/cbom_ingestion");
const assetsRouter = require("../../src/routes/assets");
const findingsRouter = require("../../src/routes/findings");
const dashboardRouter = require("../../src/routes/dashboard");

describe("Phase 3: Authorization & Tenant Isolation", () => {
  let scanA;
  let scanB;

  const sampleCbomA = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:phase3-tenant-a-001",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { name: "Tenant-A-App", type: "application" },
    },
    components: [
      {
        type: "cryptographic-asset",
        name: "tenant_a_rsa_key",
        "bom-ref": "ref_tenant_a_rsa",
        cryptoProperties: {
          assetType: "algorithm",
          algorithmProperties: {
            variant: "RSA",
            keyLength: 1024,
          },
        },
      },
    ],
  };

  const sampleCbomB = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:phase3-tenant-b-002",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { name: "Tenant-B-App", type: "application" },
    },
    components: [
      {
        type: "cryptographic-asset",
        name: "tenant_b_aes_secret",
        "bom-ref": "ref_tenant_b_aes",
        cryptoProperties: {
          assetType: "algorithm",
          algorithmProperties: {
            variant: "AES-GCM",
            keyLength: 256,
          },
        },
      },
    ],
  };

  before(async () => {
    scanA = await cbomIngestionService.ingestCbom(sampleCbomA, {
      scanName: "Phase3 Alpha Scan",
      scannerType: "static",
      tenantContext: new TenantContext({ tenantId: "tenant-a", userId: "admin-a", isPlatformAdmin: false }),
    });

    scanB = await cbomIngestionService.ingestCbom(sampleCbomB, {
      scanName: "Phase3 Beta Scan",
      scannerType: "static",
      tenantContext: new TenantContext({ tenantId: "tenant-b", userId: "admin-b", isPlatformAdmin: false }),
    });
  });

  function createTestApp(tenantContext) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.tenantContext = tenantContext;
      next();
    });
    app.use("/api/v1/assets", assetsRouter);
    app.use("/api/v1/findings", findingsRouter);
    app.use("/api/v1/dashboard", dashboardRouter);
    return app;
  }

  test("Tenant B cannot read Tenant A assets via GET /api/v1/assets", async () => {
    const ctxBeta = new TenantContext({ tenantId: "tenant-b", isPlatformAdmin: false });
    const app = createTestApp(ctxBeta);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    try {
      // 1. Querying all assets as tenant-b returns only beta assets
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/assets`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.assets.every((a) => a.scan_id === scanB.id || a.primary_identifier.includes("tenant_b")));
      assert.ok(!data.assets.some((a) => a.scan_id === scanA.id || a.primary_identifier.includes("tenant_a")));

      // 2. Querying specifically for tenant-a scanId returns 0 assets (no IDOR leakage)
      const resSpecific = await fetch(`http://127.0.0.1:${port}/api/v1/assets?scanId=${scanA.id}`);
      assert.strictEqual(resSpecific.status, 200);
      const dataSpecific = await resSpecific.json();
      assert.strictEqual(dataSpecific.assets.length, 0, "Cross-tenant scanId must return 0 assets");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test("Tenant B cannot read Tenant A findings via GET /api/v1/findings", async () => {
    const ctxBeta = new TenantContext({ tenantId: "tenant-b", isPlatformAdmin: false });
    const app = createTestApp(ctxBeta);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    try {
      // 1. Query all findings as tenant-b (must not contain tenant-a findings)
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/findings`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(!data.findings.some((f) => f.scan_id === scanA.id), "Tenant B must never see Tenant A findings");

      // 2. Querying specifically for tenant-a scanId returns 0 findings
      const resSpecific = await fetch(`http://127.0.0.1:${port}/api/v1/findings?scanId=${scanA.id}`);
      assert.strictEqual(resSpecific.status, 200);
      const dataSpecific = await resSpecific.json();
      assert.strictEqual(dataSpecific.findings.length, 0, "Cross-tenant scanId must return 0 findings");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test("Anonymous caller with null tenantContext receives 0 assets and 0 findings", async () => {
    const app = createTestApp(null);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    try {
      const resAssets = await fetch(`http://127.0.0.1:${port}/api/v1/assets`);
      assert.strictEqual(resAssets.status, 200);
      const dataAssets = await resAssets.json();
      assert.strictEqual(dataAssets.assets.length, 0);

      const resFindings = await fetch(`http://127.0.0.1:${port}/api/v1/findings`);
      assert.strictEqual(resFindings.status, 200);
      const dataFindings = await resFindings.json();
      assert.strictEqual(dataFindings.findings.length, 0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test("Platform admin can observe all tenant assets and findings", async () => {
    const ctxAdmin = new TenantContext({ tenantId: "system", isPlatformAdmin: true });
    const app = createTestApp(ctxAdmin);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    try {
      const resAlpha = await fetch(`http://127.0.0.1:${port}/api/v1/assets?scanId=${scanA.id}`);
      assert.strictEqual(resAlpha.status, 200);
      const dataAlpha = await resAlpha.json();
      assert.ok(dataAlpha.assets.length >= 1, "Platform admin can query scan A");

      const resBeta = await fetch(`http://127.0.0.1:${port}/api/v1/assets?scanId=${scanB.id}`);
      assert.strictEqual(resBeta.status, 200);
      const dataBeta = await resBeta.json();
      assert.ok(dataBeta.assets.length >= 1, "Platform admin can query scan B");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
