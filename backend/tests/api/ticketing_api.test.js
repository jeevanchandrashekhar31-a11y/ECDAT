const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  defaultTicketingService,
  WebhookConnector,
} = require("../../src/integrations/ticketing");

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

test("Ticketing API - GET /api/v1/integrations/ticketing/connectors returns connector list", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/connectors`, {
      method: "GET",
      headers: AUTH_HEADERS,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.connectors));
  });
});

test("Ticketing API - POST /api/v1/integrations/ticketing/register registers new connector", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      name: "api-test-webhook",
      type: "webhook",
      config: {
        url: "https://hooks.slack.com/services/test-webhook",
        secret: "my-secret-key-123",
      },
    };

    const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/register`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "api-test-webhook");
    assert.equal(data.type, "webhook");

    const registered = defaultTicketingService.getConnector("api-test-webhook");
    assert.ok(registered);
    assert.equal(registered.connectorType, "webhook");
  });
});

test("Ticketing API - POST /api/v1/integrations/ticketing/preview formats vendor payload with 8 fields", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      connector: "api-test-webhook",
      asset_id: "asset-srv-auth-1",
      finding_id: "find-md5-001",
      severity: "CRITICAL",
      owner: "crypto-team@enterprise.com",
      evidence_link: "https://git.internal/repo#L42",
      remediation: "Upgrade from MD5 to SHA-256",
      cbom_ref: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
      risk_score: 9.8,
    };

    const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/preview`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.connectorName, "api-test-webhook");
    assert.equal(data.connectorType, "webhook");

    const ticket = data.payload.ticket;
    assert.equal(ticket.asset_id, "asset-srv-auth-1");
    assert.equal(ticket.finding_id, "find-md5-001");
    assert.equal(ticket.severity, "CRITICAL");
    assert.equal(ticket.owner, "crypto-team@enterprise.com");
    assert.equal(ticket.evidence_link, "https://git.internal/repo#L42");
    assert.equal(ticket.remediation, "Upgrade from MD5 to SHA-256");
    assert.equal(ticket.cbom_ref, "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79");
    assert.equal(ticket.risk_score, 9.8);
  });
});

test("Ticketing API - POST /api/v1/integrations/ticketing/create validates 8 mandatory fields", async () => {
  await withServer(async (baseUrl) => {
    // Missing required fields (e.g. remediation, cbom_ref)
    const incompletePayload = {
      connector: "api-test-webhook",
      asset_id: "asset-1",
      finding_id: "find-1",
      severity: "HIGH",
      owner: "owner@corp.com",
    };

    const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/create`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(incompletePayload),
    });

    // Should return 400 Bad Request or 500 error from validation
    assert.ok(res.status >= 400);
  });
});

test("Ticketing API - POST /api/v1/integrations/ticketing/batch processes findings cleanly", async () => {
  // Register mock webhook that returns ok
  const mockConnector = new WebhookConnector({
    name: "mock-batch-hook",
    config: { url: "https://mock.corp/hook" },
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ticketId: "wh_batch_123" }),
    }),
  });
  defaultTicketingService.registerConnector(mockConnector);

  await withServer(async (baseUrl) => {
    const payload = {
      connectors: ["mock-batch-hook"],
      defaultOwner: "crypto-secops@enterprise.com",
      cbomRef: "urn:ecdat:cbom:batch-1",
      findings: [
        {
          asset_id: "asset-web-1",
          finding_id: "find-rc4-1",
          severity: "CRITICAL",
          file_path: "src/server.js",
          line_number: 10,
          remediation: "Upgrade to AES-256-GCM",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/integrations/ticketing/batch`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.totalFindings, 1);
    assert.equal(data.processed, 1);
    assert.equal(data.results[0].findingId, "find-rc4-1");
  });
});
