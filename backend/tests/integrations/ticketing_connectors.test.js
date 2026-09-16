const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TicketRequest,
  TicketResponse,
  JiraConnector,
  ServiceNowConnector,
  GitHubIssuesConnector,
  GitLabIssuesConnector,
  WebhookConnector,
  TicketingService,
} = require("../../src/integrations/ticketing");

const SAMPLE_TICKET_DATA = {
  assetId: "asset-auth-srv-01",
  findingId: "find-md5-tok-001",
  severity: "CRITICAL",
  owner: "secops-crypto@enterprise.com",
  evidenceLink: "https://github.com/org/repo/blob/main/src/token.js#L42",
  remediation: "Migrate from MD5 to SHA-256 with 64-char storage column.",
  cbomRef: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  riskScore: 9.6,
  title: "[CRITICAL] MD5 Collision in Token Service",
};

test("TicketRequest - Enforces all 8 mandatory fields", () => {
  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  assert.equal(req.assetId, "asset-auth-srv-01");
  assert.equal(req.findingId, "find-md5-tok-001");
  assert.equal(req.severity, "CRITICAL");
  assert.equal(req.owner, "secops-crypto@enterprise.com");
  assert.equal(req.evidenceLink, "https://github.com/org/repo/blob/main/src/token.js#L42");
  assert.equal(req.remediation, "Migrate from MD5 to SHA-256 with 64-char storage column.");
  assert.equal(req.cbomRef, "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79");
  assert.equal(req.riskScore, 9.6);

  // Missing assetId
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, assetId: "" }), /asset ID/);
  // Missing findingId
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, findingId: "" }), /finding ID/);
  // Missing severity
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, severity: "" }), /severity/);
  // Missing owner
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, owner: "" }), /owner/);
  // Missing evidenceLink
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, evidenceLink: "" }), /evidence link/);
  // Missing remediation
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, remediation: "" }), /remediation/);
  // Missing cbomRef
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, cbomRef: "" }), /CBOM reference/);
  // Missing riskScore
  assert.throws(() => new TicketRequest({ ...SAMPLE_TICKET_DATA, riskScore: null }), /risk score/);
});

test("JiraConnector - Formats all 8 fields and creates ticket", async () => {
  let captured = {};
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 201,
      json: async () => ({ key: "SEC-101", id: "10001" }),
    };
  };

  const connector = new JiraConnector({
    name: "jira-test",
    config: {
      host: "https://jira.corp.com",
      projectKey: "SEC",
      username: "user@corp.com",
      apiToken: "token123",
      issueType: "Vulnerability",
    },
    fetchFn: mockFetch,
  });

  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const payload = connector.formatPayload(req);
  const fields = payload.fields;

  assert.equal(fields.project.key, "SEC");
  assert.equal(fields.issuetype.name, "Vulnerability");
  assert.equal(fields.priority.name, "Highest");
  assert.ok(fields.labels.includes("ecdat"));
  assert.ok(fields.labels.includes("sev-critical"));

  // Check all 8 fields in description
  const desc = fields.description;
  assert.ok(desc.includes(req.assetId));
  assert.ok(desc.includes(req.findingId));
  assert.ok(desc.includes(req.severity));
  assert.ok(desc.includes(req.owner));
  assert.ok(desc.includes(req.evidenceLink));
  assert.ok(desc.includes(req.remediation));
  assert.ok(desc.includes(req.cbomRef));
  assert.ok(desc.includes(String(req.riskScore)));

  const res = await connector.createTicket(req);
  assert.equal(res.success, true);
  assert.equal(res.ticketId, "SEC-101");
  assert.equal(res.ticketUrl, "https://jira.corp.com/browse/SEC-101");
  assert.equal(res.connectorType, "jira");
  assert.ok(captured.opts.headers.Authorization.startsWith("Basic "));
});

test("ServiceNowConnector - Formats incident with 8 fields and sends create request", async () => {
  let captured = {};
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 201,
      json: async () => ({ result: { number: "INC0099", sys_id: "sys_123", state: "1" } }),
    };
  };

  const connector = new ServiceNowConnector({
    name: "snow-test",
    config: {
      instanceUrl: "https://snow.corp.com",
      username: "admin",
      password: "pwd",
      table: "sn_si_incident",
      assignmentGroup: "CryptoOps",
    },
    fetchFn: mockFetch,
  });

  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const payload = connector.formatPayload(req);

  assert.equal(payload.urgency, "1");
  assert.equal(payload.impact, "1");
  assert.equal(payload.correlation_id, req.findingId);
  assert.equal(payload.correlation_display, "ECDAT");
  assert.equal(payload.assignment_group, "CryptoOps");

  const desc = payload.description;
  assert.ok(desc.includes(req.assetId));
  assert.ok(desc.includes(req.findingId));
  assert.ok(desc.includes(req.severity));
  assert.ok(desc.includes(req.owner));
  assert.ok(desc.includes(req.evidenceLink));
  assert.ok(desc.includes(req.remediation));
  assert.ok(desc.includes(req.cbomRef));
  assert.ok(desc.includes(String(req.riskScore)));

  const res = await connector.createTicket(req);
  assert.equal(res.success, true);
  assert.equal(res.ticketId, "INC0099");
  assert.ok(res.ticketUrl.includes("sys_id=sys_123"));
  assert.equal(res.connectorType, "servicenow");
});

test("GitHubIssuesConnector - Formats markdown card with 8 fields and creates issue", async () => {
  let captured = {};
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 201,
      json: async () => ({ number: 42, html_url: "https://github.com/org/repo/issues/42", state: "open" }),
    };
  };

  const connector = new GitHubIssuesConnector({
    name: "gh-test",
    config: {
      repo: "enterprise/crypto-service",
      token: "ghp_test123",
    },
    fetchFn: mockFetch,
  });

  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const payload = connector.formatPayload(req);

  assert.ok(payload.title.includes(req.title));
  assert.ok(payload.labels.includes("security"));
  assert.ok(payload.labels.includes("severity:critical"));

  const body = payload.body;
  assert.ok(body.includes(req.assetId));
  assert.ok(body.includes(req.findingId));
  assert.ok(body.includes(req.severity));
  assert.ok(body.includes(req.owner));
  assert.ok(body.includes(req.evidenceLink));
  assert.ok(body.includes(req.remediation));
  assert.ok(body.includes(req.cbomRef));
  assert.ok(body.includes(String(req.riskScore)));

  const res = await connector.createTicket(req);
  assert.equal(res.success, true);
  assert.equal(res.ticketId, "#42");
  assert.equal(res.ticketUrl, "https://github.com/org/repo/issues/42");
  assert.equal(res.connectorType, "github");
});

test("GitLabIssuesConnector - Formats confidential issue with 8 fields and weight", async () => {
  let captured = {};
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 201,
      json: async () => ({ iid: 15, id: 1015, web_url: "https://gitlab.com/grp/prj/-/issues/15", state: "opened" }),
    };
  };

  const connector = new GitLabIssuesConnector({
    name: "gl-test",
    config: {
      projectId: "grp/prj",
      token: "glpat_test123",
      confidential: true,
    },
    fetchFn: mockFetch,
  });

  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const payload = connector.formatPayload(req);

  assert.equal(payload.confidential, true);
  assert.equal(payload.weight, 10); // Math.round(9.6)
  assert.ok(payload.labels.includes("security"));

  const desc = payload.description;
  assert.ok(desc.includes(req.assetId));
  assert.ok(desc.includes(req.findingId));
  assert.ok(desc.includes(req.severity));
  assert.ok(desc.includes(req.owner));
  assert.ok(desc.includes(req.evidenceLink));
  assert.ok(desc.includes(req.remediation));
  assert.ok(desc.includes(req.cbomRef));
  assert.ok(desc.includes(String(req.riskScore)));

  const res = await connector.createTicket(req);
  assert.equal(res.success, true);
  assert.equal(res.ticketId, "#15");
  assert.equal(res.ticketUrl, "https://gitlab.com/grp/prj/-/issues/15");
  assert.equal(res.connectorType, "gitlab");
});

test("WebhookConnector - Signs payload with HMAC-SHA256 and delivers 8 fields", async () => {
  let captured = {};
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ticketId: "wh_alert_555", status: "ACKNOWLEDGED" }),
    };
  };

  const secret = "shared-webhook-secret-999";
  const connector = new WebhookConnector({
    name: "webhook-test",
    config: {
      url: "https://siem.corp.com/hooks/crypto",
      secret,
    },
    fetchFn: mockFetch,
  });

  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const payload = connector.formatPayload(req);

  assert.equal(payload.event, "ecdat.finding.ticket");
  const ticket = payload.ticket;
  assert.equal(ticket.asset_id, req.assetId);
  assert.equal(ticket.finding_id, req.findingId);
  assert.equal(ticket.severity, req.severity);
  assert.equal(ticket.owner, req.owner);
  assert.equal(ticket.evidence_link, req.evidenceLink);
  assert.equal(ticket.remediation, req.remediation);
  assert.equal(ticket.cbom_ref, req.cbomRef);
  assert.equal(ticket.risk_score, req.riskScore);

  const res = await connector.createTicket(req);
  assert.equal(res.success, true);
  assert.equal(res.ticketId, "wh_alert_555");
  assert.equal(res.connectorType, "webhook");

  const sigHeader = captured.opts.headers["X-ECDAT-Signature"];
  assert.ok(sigHeader && sigHeader.startsWith("sha256="));
});

test("TicketingService - Multi-dispatch and finding batch processing", async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({ key: "TICK-1", number: 1, ticketId: "wh_1" }),
  });

  const jira = new JiraConnector({
    name: "jira-srv",
    config: { host: "https://j.corp", projectKey: "P", username: "u", apiToken: "t" },
    fetchFn: mockFetch,
  });
  const webhook = new WebhookConnector({
    name: "wh-srv",
    config: { url: "https://wh.corp/hook" },
    fetchFn: mockFetch,
  });

  const service = new TicketingService();
  service.registerConnector(jira);
  service.registerConnector(webhook);

  assert.equal(service.listConnectors().length, 2);

  // Multi-dispatch
  const req = new TicketRequest(SAMPLE_TICKET_DATA);
  const results = await service.dispatchMulti(req);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.success === true));

  // Batch from findings with zero vendor logic in findings
  const findings = [
    {
      asset_id: "asset-1",
      finding_id: "find-1",
      severity: "CRITICAL",
      owner: "team-a@corp.com",
      evidence_link: "https://code.internal/1",
      remediation: "Upgrade to AES-256-GCM",
      cbom_ref: "urn:cbom:1",
      risk_score: 9.5,
    },
    {
      asset_id: "asset-2",
      finding_id: "find-2",
      severity: "HIGH",
      owner: "team-b@corp.com",
      evidence_link: "https://code.internal/2",
      remediation: "Replace SHA-1 with SHA-256",
      cbom_ref: "urn:cbom:2",
      risk_score: 8.0,
    },
  ];

  const batch = await service.batchCreateFromFindings(findings);
  assert.equal(batch.totalFindings, 2);
  assert.equal(batch.processed, 2);
  assert.equal(batch.results.length, 2);
});
