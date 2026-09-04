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

test("CBOM Upload API - Ingests CBOM via POST /api/v1/cboms with JSON body and metadata", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      scanner_type: "network",
      scan_label: "Core Edge Load Balancer",
      project_name: "alpha_banking",
      components: [
        {
          type: "cryptographic-asset",
          name: "TLS 1.2 Protocol",
          "bom-ref": "net:tls/api.alpha.bank:443",
          cryptoProperties: {
            assetType: "protocol",
            protocolProperties: {
              type: "tls",
              version: "TLS 1.2",
            },
          },
        },
      ],
    };

    const res = await fetch(
      `${baseUrl}/api/v1/cboms?policy_profile=regulated_bfsi`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify(payload),
      },
    );

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.scan_id);
    assert.strictEqual(body.scanner_type, "network");
    assert.strictEqual(body.project_id, "alpha_banking");
    assert.strictEqual(body.policy_profile, "regulated_bfsi");
    assert.strictEqual(body.metrics.total_findings, 1);

    // Verify GET /api/v1/scans/:scanId
    const scanRes = await fetch(`${baseUrl}/api/v1/scans/${body.scan_id}`);
    assert.strictEqual(scanRes.status, 200);
    const scanData = await scanRes.json();
    assert.strictEqual(scanData.id, body.scan_id);
    assert.strictEqual(scanData.name, "Core Edge Load Balancer");
    assert.strictEqual(scanData.scanner_type, "network");
    assert.strictEqual(scanData.project_id, "alpha_banking");

    // Verify GET /api/v1/scans/:scanId/errors
    const errRes = await fetch(
      `${baseUrl}/api/v1/scans/${body.scan_id}/errors`,
    );
    assert.strictEqual(errRes.status, 200);
    const errData = await errRes.json();
    assert.strictEqual(errData.scan_id, body.scan_id);
    assert.strictEqual(errData.total_errors, 0);
  });
});

test("CBOM Upload API - Ingests CBOM via multipart file upload", async () => {
  await withServer(async (baseUrl) => {
    const cbomContent = JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          type: "cryptographic-asset",
          name: "SHA-256",
          "bom-ref": "code:sha256/utils.js:10",
          cryptoProperties: {
            assetType: "algorithm",
            algorithmProperties: { primitive: "hash" },
          },
        },
      ],
    });

    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const bodyParts = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="scanner_type"',
      "",
      "static",
      `--${boundary}`,
      'Content-Disposition: form-data; name="scan_label"',
      "",
      "Multipart Upload Test",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test_cbom.json"',
      "Content-Type: application/json",
      "",
      cbomContent,
      `--${boundary}--`,
    ];
    const multipartBody = bodyParts.join("\r\n");

    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: multipartBody,
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.scan_id);
    assert.strictEqual(body.scanner_type, "static");
    assert.strictEqual(body.name, "Multipart Upload Test");
  });
});

test("CBOM Upload API - Rejects invalid CycloneDX documents with clear validation errors", async () => {
  await withServer(async (baseUrl) => {
    // 1. Invalid format
    const res1 = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: JSON.stringify({
        bomFormat: "SPDX",
        specVersion: "2.3",
      }),
    });
    assert.strictEqual(res1.status, 400);
    const data1 = await res1.json();
    assert.ok(data1.message.includes("Invalid bomFormat"));

    // 2. Missing components
    const res2 = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
      }),
    });
    assert.strictEqual(res2.status, 400);
    const data2 = await res2.json();
    assert.ok(data2.message.includes("missing required 'components'"));
  });
});

test("CBOM Upload API - Rejects prototype pollution dangerous keys", async () => {
  await withServer(async (baseUrl) => {
    // Attempt prototype pollution
    const maliciousJson =
      '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[],"__proto__":{"polluted":true}}';

    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: maliciousJson,
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(
      data.message.includes("Dangerous property detected") ||
        data.message.includes("__proto__"),
    );
  });
});

test("CBOM Upload API - Detects and aggressively redacts private keys so they are never persisted", async () => {
  await withServer(async (baseUrl) => {
    const fakePrivateKey =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m4K...FAKE_SECRET_KEY...END\n-----END RSA PRIVATE KEY-----";

    const payload = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          type: "cryptographic-asset",
          name: "Leaked Private Key Component",
          "bom-ref": "secret:key/leaked.pem",
          cryptoProperties: {
            assetType: "related-crypto-material",
          },
          properties: [
            { name: "ecdat:raw_key_material", value: fakePrivateKey },
            {
              name: "ecdat:description",
              value: `Key snippet: ${fakePrivateKey}`,
            },
          ],
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/cboms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.ECDAT_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    const scanId = body.scan_id;

    // 1. Verify scan errors records the redaction notice
    const errRes = await fetch(`${baseUrl}/api/v1/scans/${scanId}/errors`);
    assert.strictEqual(errRes.status, 200);
    const errData = await errRes.json();
    assert.strictEqual(errData.total_errors, 1);
    assert.strictEqual(
      errData.errors[0].error_code,
      "SECURITY_PRIVATE_KEY_REDACTED",
    );

    // 2. Fetch annotated CBOM and verify the private key NEVER appears
    const cbomRes = await fetch(`${baseUrl}/api/v1/cboms/${scanId}`);
    assert.strictEqual(cbomRes.status, 200);
    const cbomText = await cbomRes.text();
    assert.strictEqual(
      cbomText.includes("FAKE_SECRET_KEY"),
      false,
      "Private key MUST NOT exist in annotated CBOM",
    );
    assert.ok(
      cbomText.includes("[REDACTED_PRIVATE_KEY]"),
      "Redaction placeholder must be present",
    );

    // 3. Directly inspect PostgreSQL cboms table to guarantee raw_json is also redacted!
    const cbomRow = await db("cboms").where({ scan_id: scanId }).first();
    assert.ok(cbomRow);
    const rawStored =
      typeof cbomRow.raw_json === "string"
        ? cbomRow.raw_json
        : JSON.stringify(cbomRow.raw_json);
    assert.strictEqual(
      rawStored.includes("FAKE_SECRET_KEY"),
      false,
      "Private key MUST NOT exist in raw_json database storage",
    );
  });
});

test.after(async () => {
  await db.destroy();
});
