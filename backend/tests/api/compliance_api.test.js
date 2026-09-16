const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const { NON_CERTIFICATION_DISCLAIMER } = require("../../src/compliance");

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

test("Compliance API - GET /api/v1/compliance/standards lists all standards with disclaimer", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/compliance/standards`, {
      headers: { "X-API-Key": config.ECDAT_API_KEY },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.certification_claimed, false);
    assert.equal(data.disclaimer, NON_CERTIFICATION_DISCLAIMER);
    assert.ok(data.total_standards >= 5);
    assert.ok(Array.isArray(data.standards));

    const pci = data.standards.find((s) => s.id === "pci_dss_v4");
    assert.ok(pci);
    assert.ok(pci.support_level_breakdown["SUPPORTED CONTROL"] >= 1);
    assert.ok(pci.support_level_breakdown["NOT SUPPORTED"] >= 1);
  });
});

test("Compliance API - GET /api/v1/compliance/standards/:standardId returns standard specification", async () => {
  await withServer(async (baseUrl) => {
    // Found standard
    const res = await fetch(`${baseUrl}/api/v1/compliance/standards/nist_cnsa_2_0`, {
      headers: { "X-API-Key": config.ECDAT_API_KEY },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.standard.id, "nist_cnsa_2_0");
    assert.equal(data.certification_claimed, false);
    assert.ok(data.standard.controls.length >= 4);

    // 404 for unknown standard
    const notFoundRes = await fetch(`${baseUrl}/api/v1/compliance/standards/unknown_999`, {
      headers: { "X-API-Key": config.ECDAT_API_KEY },
    });
    assert.equal(notFoundRes.status, 404);
  });
});

test("Compliance API - POST /api/v1/compliance/assess evaluates assets and produces evidence digest", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      assets: [
        {
          id: "kem-1",
          name: "CNSA Post-Quantum Key Exchange",
          asset_type: "key_exchange",
          algorithm: "ML-KEM-768",
          is_quantum_safe: true,
          is_hybrid: true,
        },
        {
          id: "sym-1",
          name: "CNSA Storage Cipher",
          asset_type: "cipher",
          algorithm: "AES-256",
          key_size: 256,
        },
      ],
      standards: ["nist_cnsa_2_0"],
    };

    const res = await fetch(`${baseUrl}/api/v1/compliance/assess`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.certification_claimed, false);
    assert.equal(data.disclaimer, NON_CERTIFICATION_DISCLAIMER);
    assert.equal(data.summary.total_standards_assessed, 1);
    assert.ok(data.evidence_digest);
    assert.equal(data.evidence_digest.length, 64);
  });
});

test("Compliance API - POST /api/v1/compliance/evidence-bundle generates sealed evidence package", async () => {
  await withServer(async (baseUrl) => {
    const rawPrivateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y3...\n-----END RSA PRIVATE KEY-----";
    const payload = {
      organization: "Acme Payments Corp",
      environment: "production",
      auditor_notes: "Annual PCI and CNSA 2.0 readiness inspection",
      assets: [
        {
          id: "tls-gateway",
          name: "Customer API Gateway",
          asset_type: "protocol",
          protocol: "TLS 1.3",
          cipher_suite: "TLS_AES_256_GCM_SHA384",
          private_key: rawPrivateKey,
        },
      ],
      standards: ["pci_dss_v4", "nist_cnsa_2_0"],
    };

    const res = await fetch(`${baseUrl}/api/v1/compliance/evidence-bundle`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.bundle_seal.startsWith("ECDAT-EVIDENCE-"));
    assert.ok(data.bundle_sha256);
    assert.equal(data.bundle.certification_claimed, false);
    assert.equal(data.bundle.disclaimer, NON_CERTIFICATION_DISCLAIMER);

    // Verify raw private key was strictly redacted and never leaked
    const jsonStr = JSON.stringify(data);
    assert.ok(!jsonStr.includes(rawPrivateKey));
  });
});
