const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  defaultKmsDiscoveryService,
  AwsKmsConnector,
} = require("../../src/integrations/kms");

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

test("KMS API - GET /api/v1/integrations/kms/connectors returns connector list", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/integrations/kms/connectors`, {
      method: "GET",
      headers: AUTH_HEADERS,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.connectors));
    assert.equal(typeof data.count, "number");
  });
});

test("KMS API - POST /api/v1/integrations/kms/register validates and registers connectors", async () => {
  await withServer(async (baseUrl) => {
    // Missing parameters
    const badRes = await fetch(`${baseUrl}/api/v1/integrations/kms/register`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(badRes.status, 400);

    // Unsupported provider
    const unsuppRes = await fetch(`${baseUrl}/api/v1/integrations/kms/register`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ name: "unsupp", provider: "unknown_cloud" }),
    });
    assert.equal(unsuppRes.status, 400);

    // Valid AWS KMS registration
    const regRes = await fetch(`${baseUrl}/api/v1/integrations/kms/register`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        name: "api-aws-kms-test",
        provider: "aws_kms",
        config: {
          region: "eu-west-1",
          mockKeys: ["k-api-1"],
          mockKeyDetails: {
            "k-api-1": {
              KeyMetadata: {
                Arn: "arn:aws:kms:eu-west-1:1111:key/k-api-1",
                KeySpec: "SYMMETRIC_DEFAULT",
                KeyState: "Enabled",
                AWSAccountId: "1111",
              },
              RotationStatus: { KeyRotationEnabled: true },
            },
          },
        },
      }),
    });

    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.connector.name, "api-aws-kms-test");
    assert.equal(regData.connector.readOnly, true);
    assert.ok(regData.connector.leastPrivilegeRole);
  });
});

test("KMS API - POST /api/v1/integrations/kms/test-connection probes connector", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/integrations/kms/test-connection`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ name: "api-aws-kms-test" }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
  });
});

test("KMS API - POST /api/v1/integrations/kms/validate-policy validates least-privilege read-only rules", async () => {
  await withServer(async (baseUrl) => {
    // AWS least-privilege violation check
    const badAws = await fetch(`${baseUrl}/api/v1/integrations/kms/validate-policy`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        provider: "aws_kms",
        actions: ["kms:ListKeys", "kms:Decrypt"],
      }),
    });

    assert.equal(badAws.status, 200);
    const badAwsData = await badAws.json();
    assert.equal(badAwsData.valid, false);
    assert.ok(badAwsData.violations.length > 0);

    // GCP least-privilege valid check
    const goodGcp = await fetch(`${baseUrl}/api/v1/integrations/kms/validate-policy`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        provider: "gcp_kms",
        permissions: ["cloudkms.cryptoKeys.get", "cloudkms.cryptoKeys.list"],
      }),
    });

    assert.equal(goodGcp.status, 200);
    const goodGcpData = await goodGcp.json();
    assert.equal(goodGcpData.valid, true);
    assert.equal(goodGcpData.violations.length, 0);

    // Vault least-privilege check
    const badVault = await fetch(`${baseUrl}/api/v1/integrations/kms/validate-policy`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        provider: "hashicorp_vault",
        capabilities: ["read", "delete", "sudo"],
      }),
    });

    assert.equal(badVault.status, 200);
    const badVaultData = await badVault.json();
    assert.equal(badVaultData.valid, false);
    assert.ok(badVaultData.violations.length >= 2);
  });
});

test("KMS API - POST /api/v1/integrations/kms/discover discovers keys across connectors", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/integrations/kms/discover`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ connectorName: "api-aws-kms-test" }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.totalCount >= 1);
    assert.ok(data.keys.length >= 1);
    assert.ok(data.summary);
    assert.equal(data.summary.byProvider["aws_kms"] >= 1, true);
  });
});

test("KMS API - POST /api/v1/integrations/kms/to-cbom exports discovered keys to CycloneDX CBOM", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/integrations/kms/to-cbom`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({ connectorName: "api-aws-kms-test" }),
    });

    assert.equal(res.status, 200);
    const cbom = await res.json();
    assert.equal(cbom.bomFormat, "CycloneDX");
    assert.equal(cbom.specVersion, "1.6");
    assert.ok(Array.isArray(cbom.components));
    assert.ok(cbom.components.length >= 1);
    assert.equal(cbom.components[0].type, "cryptographic-asset");
    assert.ok(cbom.components[0].cryptoProperties);
  });
});
