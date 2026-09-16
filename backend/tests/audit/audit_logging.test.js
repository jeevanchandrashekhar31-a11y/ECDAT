const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  AuditService,
  defaultAuditService,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
  AUDIT_STATUSES,
  scrubSensitiveFields,
  computeEventHash,
  verifyChainIntegrity,
} = require("../../src/audit");

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

test("Phase 18.1 — Scrubber strictly redacts secrets, keys, and tokens", () => {
  const dirtyPayload = {
    username: "crypto_admin",
    password: "SuperSecretPassword123!",
    api_key: "ecdat-live-sec-999999",
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
    nested: {
      client_secret: "super-client-secret",
      bearer_token: "Bearer top-secret-token",
      algorithm: "ML-KEM-768",
    },
    safeArray: [
      { secret: "hidden", id: "asset-1" },
      { label: "clean" },
    ],
  };

  const clean = scrubSensitiveFields(dirtyPayload);

  assert.equal(clean.username, "crypto_admin");
  assert.equal(clean.password, "[REDACTED_SECRET]");
  assert.equal(clean.api_key, "[REDACTED_SECRET]");
  assert.equal(clean.token, "[REDACTED_SECRET]");
  assert.equal(clean.private_key, "[REDACTED_PRIVATE_KEY]");
  assert.equal(clean.nested.client_secret, "[REDACTED_SECRET]");
  assert.equal(clean.nested.bearer_token, "Bearer [REDACTED_TOKEN]");
  assert.equal(clean.nested.algorithm, "ML-KEM-768");
  assert.equal(clean.safeArray[0].secret, "[REDACTED_SECRET]");
  assert.equal(clean.safeArray[0].id, "asset-1");
  assert.equal(clean.safeArray[1].label, "clean");
});

test("Phase 18.1 — Audit Service logs all 11 required categories and enforces hash-chaining", async () => {
  const auditSvc = new AuditService({ maxMemoryRecords: 100, secretKey: "test-audit-key" });

  const requiredCategories = [
    { category: AUDIT_CATEGORIES.LOGIN, action: AUDIT_ACTIONS.LOGIN },
    { category: AUDIT_CATEGORIES.LOGOUT, action: AUDIT_ACTIONS.LOGOUT },
    { category: AUDIT_CATEGORIES.PERMISSION_CHANGE, action: AUDIT_ACTIONS.ROLE_ASSIGN },
    { category: AUDIT_CATEGORIES.SCAN, action: AUDIT_ACTIONS.SCAN_COMPLETE },
    { category: AUDIT_CATEGORIES.CONFIG_CHANGE, action: AUDIT_ACTIONS.CONFIG_UPDATE },
    { category: AUDIT_CATEGORIES.POLICY_CHANGE, action: AUDIT_ACTIONS.POLICY_ACTIVATE },
    { category: AUDIT_CATEGORIES.REMEDIATION_APPROVAL, action: AUDIT_ACTIONS.REMEDIATION_APPROVE },
    { category: AUDIT_CATEGORIES.REMEDIATION_EXECUTION, action: AUDIT_ACTIONS.REMEDIATION_APPLY },
    { category: AUDIT_CATEGORIES.EXPORT, action: AUDIT_ACTIONS.EXPORT_CBOM },
    { category: AUDIT_CATEGORIES.INTEGRATION_CHANGE, action: AUDIT_ACTIONS.INTEGRATION_ADD },
    { category: AUDIT_CATEGORIES.SECRET_OPERATION, action: AUDIT_ACTIONS.SECRET_ROTATE },
  ];

  assert.equal(requiredCategories.length, 11, "All 11 mandatory categories must be covered");

  let prevHash = "0".repeat(64);
  for (let i = 0; i < requiredCategories.length; i++) {
    const item = requiredCategories[i];
    const event = await auditSvc.logEvent({
      category: item.category,
      action: item.action,
      actor: { id: `user-${i}`, username: `admin-${i}`, role: "admin" },
      tenantId: "tenant-primary",
      target: { id: `target-${i}`, type: "system" },
      status: AUDIT_STATUSES.SUCCESS,
      details: {
        operationIndex: i,
        password: "leaked-secret-attempt",
      },
    });

    assert.ok(event.eventId, "Event must have eventId");
    assert.equal(event.sequenceNumber, i + 1, `Sequence number must be ${i + 1}`);
    assert.equal(event.previousHash, prevHash, "Previous hash must chain continuously");
    assert.ok(event.hash, "Hash must be present");
    assert.ok(event.signature, "HMAC signature must be present");
    assert.equal(event.details.password, "[REDACTED_SECRET]", "Secrets must be redacted in details");

    prevHash = event.hash;
  }

  // Verify chain integrity
  const verification = auditSvc.verifyIntegrity();
  assert.equal(verification.valid, true, "Hash chain must be completely valid");
  assert.equal(verification.verifiedRecords, 11);
  assert.equal(verification.tamperDetected, false);
});

test("Phase 18.1 — Tamper Detection catches payload modifications and sequence breaks", async () => {
  const auditSvc = new AuditService({ maxMemoryRecords: 50, secretKey: "test-secret" });

  await auditSvc.logEvent({
    category: AUDIT_CATEGORIES.LOGIN,
    action: AUDIT_ACTIONS.LOGIN,
    actor: { username: "user1" },
  });
  await auditSvc.logEvent({
    category: AUDIT_CATEGORIES.POLICY_CHANGE,
    action: AUDIT_ACTIONS.POLICY_ACTIVATE,
    actor: { username: "user2" },
  });
  await auditSvc.logEvent({
    category: AUDIT_CATEGORIES.REMEDIATION_APPROVAL,
    action: AUDIT_ACTIONS.REMEDIATION_APPROVE,
    actor: { username: "user3" },
  });

  // 1. Initial intact state
  let check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);

  // 2. Tamper: mutate payload of record #2
  auditSvc.memoryLedger[1].action = "FORGED_ACTION";
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, false);
  assert.equal(check.tamperDetected, true);
  assert.match(check.reason, /hash mismatch/i);

  // Restore and verify back to valid
  auditSvc.memoryLedger[1].action = AUDIT_ACTIONS.POLICY_ACTIVATE;
  auditSvc.memoryLedger[1].hash = computeEventHash(auditSvc.memoryLedger[1], auditSvc.memoryLedger[1].prevHash);
  // Re-verify after manual fix
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);

  // 3. Tamper: delete record #2 to create a sequence gap
  const removed = auditSvc.memoryLedger.splice(1, 1)[0];
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, false);
  assert.match(check.reason, /sequence gap|discontinuity|hash mismatch/i);

  // Restore record
  auditSvc.memoryLedger.splice(1, 0, removed);
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);
});

test("Phase 18.1 — REST API endpoints for Audit Ledger", async () => {
  await withServer(async (baseUrl) => {
    // 1. POST /api/v1/audit/events (manual recording)
    const postRes = await fetch(`${baseUrl}/api/v1/audit/events`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        category: AUDIT_CATEGORIES.CONFIGURATION_CHANGE,
        action: AUDIT_ACTIONS.CONFIG_UPDATE,
        target: "syslog_endpoint",
        details: { configKey: "syslog_port", newValue: 514, api_key: "hidden" },
      }),
    });
    assert.equal(postRes.status, 201);
    const postData = await postRes.json();
    assert.equal(postData.success, true);
    assert.ok(postData.eventId);
    assert.ok(postData.hash);

    // 2. GET /api/v1/audit/events (querying)
    const queryRes = await fetch(`${baseUrl}/api/v1/audit/events?category=${AUDIT_CATEGORIES.CONFIGURATION_CHANGE}`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(queryRes.status, 200);
    const queryData = await queryRes.json();
    assert.ok(queryData.total >= 1);
    assert.equal(queryData.events[0].category, AUDIT_CATEGORIES.CONFIGURATION_CHANGE);
    assert.equal(queryData.events[0].details.api_key, "[REDACTED_SECRET]");

    // 3. GET /api/v1/audit/verify (chain integrity check)
    const verifyRes = await fetch(`${baseUrl}/api/v1/audit/verify`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.chainIntegrity, "VERIFIED_INTACT");
    assert.equal(verifyData.valid, true);

    // 4. GET /api/v1/audit/summary (stats telemetry)
    const summaryRes = await fetch(`${baseUrl}/api/v1/audit/summary`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(summaryRes.status, 200);
    const summaryData = await summaryRes.json();
    assert.ok(summaryData.totalRecords >= 1);
    assert.ok(summaryData.categoryDistribution);

    // 5. GET /api/v1/audit/export (verifiable signed audit package)
    const exportRes = await fetch(`${baseUrl}/api/v1/audit/export`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(exportRes.status, 200);
    const exportData = await exportRes.json();
    assert.ok(exportData.export_id);
    assert.ok(exportData.events.length >= 1);
    assert.equal(exportData.chain_integrity.valid, true);
  });
});
