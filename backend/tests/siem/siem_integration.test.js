// @ecdat-synthetic-corpus
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  validateSiemEvent,
  getSiemSchema,
  createSiemEvent,
  createSiemEventFromAudit,
  formatEvent,
  formatCef,
  formatSyslogRfc5424,
  SiemDispatcher,
  defaultSiemDispatcher,
} = require("../../src/siem");

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

test("Phase 18.2 — JSON Schema enforces mandatory SIEM fields and rejects invalid payloads", () => {
  const validEvent = {
    version: "1.0.0",
    event_id: "sec-evt-test-12345",
    timestamp: new Date().toISOString(),
    event_type: "SECURITY_AUDIT",
    actor: {
      id: "sec-admin-1",
      username: "admin_alice",
      role: "security_officer",
      ip: "192.168.1.100",
    },
    tenant: {
      id: "tenant-fintech-global",
      name: "FinTech Global Inc.",
    },
    action: "POLICY_ACTIVATE",
    resource: {
      type: "POLICY",
      id: "pol-bfsi-pqc-2026",
      name: "BFSI Post-Quantum Mandate",
    },
    result: {
      status: "SUCCESS",
      code: 200,
    },
    request_id: "req-987654321",
    risk_context: {
      severity: "HIGH",
      risk_score: 85,
      quantum_risk: true,
      compliance_impact: ["NIST_SP_800_208", "CNSA_2_0"],
    },
    metadata: {
      scanner: "ECDAT",
      environment: "production",
    },
  };

  const validation = validateSiemEvent(validEvent);
  assert.equal(validation.valid, true, `Validation failed: ${validation.errors?.join("; ") || ""}`);

  // Test invalid: missing actor
  const missingActor = { ...validEvent };
  delete missingActor.actor;
  assert.equal(validateSiemEvent(missingActor).valid, false);

  // Test invalid: missing tenant
  const missingTenant = { ...validEvent };
  delete missingTenant.tenant;
  assert.equal(validateSiemEvent(missingTenant).valid, false);

  // Test invalid: missing risk_context
  const missingRisk = { ...validEvent };
  delete missingRisk.risk_context;
  assert.equal(validateSiemEvent(missingRisk).valid, false);

  // Test invalid: invalid severity enum
  const badSeverity = {
    ...validEvent,
    risk_context: { ...validEvent.risk_context, severity: "SUPER_CRITICAL" },
  };
  assert.equal(validateSiemEvent(badSeverity).valid, false);
});

test("Phase 18.2 — Multi-Format Serialization (JSON, CEF, Syslog RFC 5424)", () => {
  const event = createSiemEvent({
    actor: { id: "u-1", username: "analyst_bob", role: "auditor" },
    tenant: { id: "corp-1", name: "Acme Corp" },
    action: "REMEDIATION_APPLY",
    resource: { type: "CODE_ASSET", id: "crypto_utils.py" },
    result: { status: "SUCCESS" },
    riskContext: {
      severity: "CRITICAL",
      riskScore: 92,
      quantumRisk: true,
    },
    requestId: "req-cef-syslog-1",
  });

  // 1. CEF Format
  const cef = formatCef(event);
  assert.ok(cef.startsWith("CEF:0|ECDAT|CryptographicDiscovery|"), "Must start with CEF header");
  assert.ok(cef.includes("suser=analyst_bob"));
  assert.ok(cef.includes("act=REMEDIATION_APPLY"));
  assert.ok(cef.includes("cs1=corp-1"));

  // 2. Syslog RFC 5424 Format
  const syslog = formatSyslogRfc5424(event);
  assert.match(syslog, /^<\d+>1 \d{4}-\d{2}-\d{2}T/);
  assert.ok(syslog.includes("ecdat-scanner"));
  assert.ok(syslog.includes('[meta@54321 action="REMEDIATION_APPLY"'));
  assert.ok(syslog.includes('severity="CRITICAL"'));

  // 3. Dispatcher format selector
  assert.equal(typeof formatEvent(event, "json"), "string");
  assert.equal(typeof formatEvent(event, "cef"), "string");
  assert.equal(typeof formatEvent(event, "syslog"), "string");
});

test("Phase 18.2 — Audit-to-SIEM Bridge automatically maps audit records with zero secret exposure", () => {
  const auditRecord = {
    eventId: "aud-445566",
    timestamp: new Date().toISOString(),
    category: "policy_changes",
    action: "POLICY_ROLLBACK",
    actor: {
      id: "adm-1",
      username: "chief_crypto",
      role: "admin",
      ipAddress: "10.0.0.42",
    },
    tenantId: "tenant-omega",
    target: "policy-v1.0.0",
    status: "SUCCESS",
    details: {
      reason: "Emergency rollback to baseline",
      admin_api_token: "should-never-leak-into-siem",
    },
  };

  const siemEvent = createSiemEventFromAudit(auditRecord);

  assert.equal(siemEvent.event_type, "SECURITY_AUDIT");
  assert.equal(siemEvent.actor.username, "chief_crypto");
  assert.equal(siemEvent.tenant.id, "tenant-omega");
  assert.equal(siemEvent.action, "POLICY_ROLLBACK");
  assert.equal(siemEvent.result.status, "SUCCESS");
  assert.ok(siemEvent.risk_context.severity);
  // Ensure token is scrubbed
  assert.equal(siemEvent.metadata?.details?.admin_api_token, undefined);

  const validation = validateSiemEvent(siemEvent);
  assert.equal(validation.valid, true, `Converted event must satisfy schema: ${validation.errors?.join("; ")}`);
});

test("Phase 18.2 — Dispatcher manages queue, HMAC verification, and batch flushing", async () => {
  const dispatcher = new SiemDispatcher({
    batchSize: 5,
    maxBufferSize: 50,
    flushIntervalMs: 0, // manual flush for test
    hmacSecret: "test-hmac-secret-key-1234",
  });

  for (let i = 0; i < 7; i++) {
    const event = createSiemEvent({
      actor: { username: `user_${i}` },
      tenant: { id: "test-tenant" },
      action: "SCAN_EXECUTION",
      resource: { type: "SCAN", id: `scan-${i}` },
      result: { status: "SUCCESS" },
      riskContext: { severity: "LOW", riskScore: 20 },
    });
    const res = dispatcher.ingestEvent(event);
    assert.equal(res.success, true);
  }

  assert.equal(dispatcher.stats.totalIngested, 7);

  // Query events in JSON and CEF
  const jsonQuery = dispatcher.getEvents({}, { limit: 10, format: "json" });
  assert.equal(jsonQuery.total, 7);
  assert.equal(jsonQuery.events.length, 7);

  const cefQuery = dispatcher.getEvents({}, { limit: 5, format: "cef" });
  assert.equal(cefQuery.events.length, 5);
  assert.ok(typeof cefQuery.events[0] === "string");
  assert.ok(cefQuery.events[0].startsWith("CEF:0"));

  // Flush queue
  const flushRes = await dispatcher.flushQueue();
  assert.ok(flushRes.dispatched > 0);
  assert.equal(dispatcher.stats.totalDispatched, 7);
});

test("Phase 18.2 — REST API endpoints for SIEM Integration", async () => {
  await withServer(async (baseUrl) => {
    // 1. GET /api/v1/siem/schema (canonical JSON schema)
    const schemaRes = await fetch(`${baseUrl}/api/v1/siem/schema`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(schemaRes.status, 200);
    const schemaData = await schemaRes.json();
    assert.equal(schemaData.title, "ECDAT SIEM Security Event Schema");
    assert.ok(schemaData.properties.risk_context);

    // 2. POST /api/v1/siem/forward (ad-hoc event ingestion & dispatch)
    const forwardRes = await fetch(`${baseUrl}/api/v1/siem/forward`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        action: "KEY_ROTATION",
        resource: { type: "KMS_KEY", id: "arn:aws:kms:us-east-1:123456789:key/test" },
        result: { status: "SUCCESS" },
        riskContext: { severity: "MEDIUM", riskScore: 50 },
      }),
    });
    assert.equal(forwardRes.status, 200);
    const forwardData = await forwardRes.json();
    assert.equal(forwardData.success, true);
    assert.ok(forwardData.ingestedEventId);

    // 3. GET /api/v1/siem/events (JSON format)
    const eventsRes = await fetch(`${baseUrl}/api/v1/siem/events?format=json`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(eventsRes.status, 200);
    const eventsData = await eventsRes.json();
    assert.ok(eventsData.total >= 1);

    // 4. GET /api/v1/siem/events (CEF format)
    const cefRes = await fetch(`${baseUrl}/api/v1/siem/events?format=cef`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(cefRes.status, 200);
    const cefText = await cefRes.text();
    assert.ok(cefText.includes("CEF:0|ECDAT|CryptographicDiscovery"));

    // 5. GET /api/v1/siem/events (Syslog format)
    const syslogRes = await fetch(`${baseUrl}/api/v1/siem/events?format=syslog`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(syslogRes.status, 200);
    const syslogText = await syslogRes.text();
    assert.ok(syslogText.includes("ecdat-scanner"));

    // 6. GET /api/v1/siem/config
    const configRes = await fetch(`${baseUrl}/api/v1/siem/config`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(configRes.status, 200);
    const configData = await configRes.json();
    assert.ok(configData.batchSize);

    // 7. PUT /api/v1/siem/config
    const updateConfigRes = await fetch(`${baseUrl}/api/v1/siem/config`, {
      method: "PUT",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        batchSize: 40,
        endpoints: [
          { id: "dest-splunk", name: "Splunk HEC", url: "https://api.github.com/webhook/test", format: "json" },
        ],
      }),
    });
    assert.equal(updateConfigRes.status, 200);
    const updatedConfigData = await updateConfigRes.json();
    assert.equal(updatedConfigData.config.batchSize, 40);
    assert.equal(updatedConfigData.config.endpoints.length, 1);
  });
});
