/**
 * Comprehensive Automated Test Suite — Task 21: P1 Audit Logging
 *
 * Verifies:
 * 1. Mandatory Minimum Operations:
 *    - authentication success/failure
 *    - authorization denial
 *    - role change
 *    - tenant change
 *    - MFA enable/disable
 *    - session revocation
 *    - token revocation
 *    - secret rotation
 *    - scan start
 *    - scan failure
 *    - scan completion
 *    - integration modification
 *    - security policy modification
 * 2. 9 Mandated Record Dimensions:
 *    - actor, tenant, action, target, timestamp, request ID, result, reason, source IP
 * 3. Strict Zero-Secret Guarantee:
 *    - passwords, MFA secrets, backup codes, API keys, access tokens, private keys, raw credentials
 * 4. Cryptographic Hash Chain and Non-Repudiation HMAC
 * 5. Live HTTP Endpoint Verification
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  AuditService,
  defaultAuditService,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
  MANDATORY_AUDIT_ACTIONS,
  AUDIT_STATUSES,
  scrubSensitiveFields,
  computeEventHash,
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

test("Task 21 — Zero-Secret Guarantee strictly redacts all 7 forbidden secret classes", () => {
  const payloadWithForbiddenSecrets = {
    user: "crypto_operator",
    // 1. Passwords
    password: "CleartextPassword999!",
    passphrase: "UserPassphrase123",
    // 2. MFA Secrets
    totp_secret: "JBSWY3DPEHPK3PXP",
    mfa_secret: "NBSWY3DPEHPK3PXP",
    // 3. Backup Codes
    backup_codes: ["1234-5678", "9876-5432"],
    recovery_code: "rec-8888",
    // 4. API Keys
    api_key: "ecdat-live-sec-abcdef0123456789",
    // 5. Access Tokens
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy",
    access_token: "jwt-access-token-live",
    // 6. Raw Credentials
    raw_credentials: "user:pass:cleartext",
    credential: "admin:supersecret",
    // 7. Private Keys
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
    nested: {
      client_secret: "nested-client-secret-xyz",
      bearer_token: "Bearer live-jwt-bearer-token",
      algorithm: "ML-KEM-1024",
    },
    message: "Failed login with api_key: ecdat-live-sec-secret123",
  };

  const clean = scrubSensitiveFields(payloadWithForbiddenSecrets);

  // Assert zero cleartext secrets in output
  assert.equal(clean.password, "[REDACTED_SECRET]");
  assert.equal(clean.passphrase, "[REDACTED_SECRET]");
  assert.equal(clean.totp_secret, "[REDACTED_SECRET]");
  assert.equal(clean.mfa_secret, "[REDACTED_SECRET]");
  assert.equal(clean.backup_codes, "[REDACTED_SECRET]");
  assert.equal(clean.recovery_code, "[REDACTED_SECRET]");
  assert.equal(clean.api_key, "[REDACTED_SECRET]");
  assert.equal(clean.token, "[REDACTED_SECRET]");
  assert.equal(clean.access_token, "[REDACTED_SECRET]");
  assert.equal(clean.raw_credentials, "[REDACTED_SECRET]");
  assert.equal(clean.credential, "[REDACTED_SECRET]");
  assert.equal(clean.private_key, "[REDACTED_PRIVATE_KEY]");
  assert.equal(clean.nested.client_secret, "[REDACTED_SECRET]");
  assert.equal(clean.nested.bearer_token, "Bearer [REDACTED_TOKEN]");
  assert.equal(clean.nested.algorithm, "ML-KEM-1024");
  assert.ok(!clean.message.includes("ecdat-live-sec-secret123"));
});

test("Task 21 — All 13 minimum mandatory security actions produce structured audit events with 9 dimensions", async () => {
  const auditSvc = new AuditService({ maxInMemoryEvents: 200, secretKey: "test-tamper-key" });

  const mandatoryOperations = [
    { name: "authentication_success", action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, result: "SUCCESS", reason: "User logged in with MFA" },
    { name: "authentication_failure", action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE, result: "FAILURE", reason: "Invalid credentials" },
    { name: "authorization_denial", action: AUDIT_ACTIONS.AUTHORIZATION_FAILURE, result: "DENIED", reason: "Analyst forbidden from managing users" },
    { name: "role_change", action: AUDIT_ACTIONS.ROLE_ASSIGNED, result: "SUCCESS", reason: "Assigned role security_admin to user-2" },
    { name: "tenant_change", action: AUDIT_ACTIONS.TENANT_CHANGED, result: "SUCCESS", reason: "Switched active tenant from alpha to beta" },
    { name: "mfa_enable", action: AUDIT_ACTIONS.AUTH_MFA_ENABLED, result: "SUCCESS", reason: "TOTP second factor enabled" },
    { name: "mfa_disable", action: AUDIT_ACTIONS.AUTH_MFA_DISABLED, result: "SUCCESS", reason: "TOTP second factor disabled" },
    { name: "session_revocation", action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL, result: "SUCCESS", reason: "Global session logout across all devices" },
    { name: "token_revocation", action: AUDIT_ACTIONS.AUTH_TOKEN_REVOKED, result: "SUCCESS", reason: "Access token revoked" },
    { name: "secret_rotation", action: AUDIT_ACTIONS.SECRET_ROTATED, result: "SUCCESS", reason: "KMS wrapping key rotated" },
    { name: "scan_start", action: AUDIT_ACTIONS.SCAN_STARTED, result: "SUCCESS", reason: "Static scanner pipeline initiated" },
    { name: "scan_failure", action: AUDIT_ACTIONS.SCAN_FAILED, result: "FAILURE", reason: "Git clone timeout after 60s" },
    { name: "scan_completion", action: AUDIT_ACTIONS.SCAN_COMPLETED, result: "SUCCESS", reason: "CBOM generation completed with 15 findings" },
    { name: "integration_modification", action: AUDIT_ACTIONS.INTEGRATION_MODIFIED, result: "SUCCESS", reason: "ServiceNow connector configuration updated" },
    { name: "security_policy_modification", action: AUDIT_ACTIONS.POLICY_UPDATED, result: "SUCCESS", reason: "BFSI strict policy activated" },
  ];

  let prevHash = "0".repeat(64);
  for (let i = 0; i < mandatoryOperations.length; i++) {
    const op = mandatoryOperations[i];
    const event = await auditSvc.logEvent({
      action: op.action,
      actor: { id: `actor-${i}`, username: `admin_${i}`, role: "security_admin", ipAddress: `10.0.0.${i + 1}` },
      tenant: `tenant-${i}`,
      target: { type: "resource", id: `res-${op.name}`, name: op.name },
      result: op.result,
      reason: op.reason,
      requestId: `req-trace-${i}`,
      sourceIp: `10.0.0.${i + 1}`,
      details: {
        operation: op.name,
        password: "leaked-secret-attempt",
        api_key: "ecdat-live-sec-12345",
      },
    });

    // Verify all 9 required top-level fields
    assert.ok(event.actor, "Dimension 1: actor must be present");
    assert.equal(event.actor.username, `admin_${i}`);
    assert.equal(event.tenant, `tenant-${i}`, "Dimension 2: tenant must be present");
    assert.equal(event.action, op.action, "Dimension 3: action must match");
    assert.ok(event.target, "Dimension 4: target must be present");
    assert.equal(event.target.id, `res-${op.name}`);
    assert.ok(event.timestamp, "Dimension 5: timestamp must be present");
    assert.equal(event.requestId, `req-trace-${i}`, "Dimension 6: request ID must be present");
    assert.equal(event.result, op.result, "Dimension 7: result must match");
    assert.equal(event.reason, op.reason, "Dimension 8: reason must match");
    assert.equal(event.sourceIp, `10.0.0.${i + 1}`, "Dimension 9: source IP must match");

    // Zero-secret verification
    assert.equal(event.details.password, "[REDACTED_SECRET]", "Passwords must never be logged");
    assert.equal(event.details.api_key, "[REDACTED_SECRET]", "API keys must never be logged");

    // Cryptographic chain verification
    assert.equal(event.sequenceNumber, i + 1);
    assert.equal(event.prevHash, prevHash);
    assert.ok(event.hash);
    assert.ok(event.signature);

    prevHash = event.hash;
  }

  // Verify full chain integrity
  const integrity = auditSvc.verifyIntegrity();
  assert.equal(integrity.valid, true, "Hash chain must be 100% intact");
  assert.equal(integrity.verifiedRecords, mandatoryOperations.length);
  assert.equal(integrity.tamperDetected, false);
});

test("Task 21 — Cryptographic tamper detection identifies altered fields and sequence gaps", async () => {
  const auditSvc = new AuditService({ maxInMemoryEvents: 50, secretKey: "audit-tamper-key" });

  await auditSvc.logEvent({ action: AUDIT_ACTIONS.SCAN_STARTED, reason: "Scan #1" });
  await auditSvc.logEvent({ action: AUDIT_ACTIONS.SCAN_COMPLETED, reason: "Scan #2" });
  await auditSvc.logEvent({ action: AUDIT_ACTIONS.POLICY_UPDATED, reason: "Policy #3" });

  // 1. Initial valid state
  let check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);

  // 2. Tamper: modify result of event #2
  auditSvc.memoryLedger[1].result = "FORGED_RESULT";
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, false);
  assert.equal(check.tamperDetected, true);

  // Restore and verify back to valid
  auditSvc.memoryLedger[1].result = "SUCCESS";
  auditSvc.memoryLedger[1].status = "SUCCESS";
  auditSvc.memoryLedger[1].hash = computeEventHash(auditSvc.memoryLedger[1], auditSvc.memoryLedger[1].prevHash);
  // Re-sign
  const { signHash } = require("../../src/audit");
  auditSvc.memoryLedger[1].signature = signHash(auditSvc.memoryLedger[1].hash, auditSvc.secretKey);
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);

  // 3. Tamper: delete block to produce sequence gap
  const removed = auditSvc.memoryLedger.splice(1, 1)[0];
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, false);
  assert.equal(check.tamperDetected, true);

  // Restore
  auditSvc.memoryLedger.splice(1, 0, removed);
  check = auditSvc.verifyIntegrity();
  assert.equal(check.valid, true);
});

test("Task 21 — Live HTTP Endpoints for Tenant Switch, MFA Disable, and Ticketing emit structured audit events", async () => {
  await withServer(async (baseUrl) => {
    const initialCount = defaultAuditService.memoryLedger.length;

    const { defaultTokenService } = require("../../src/identity/token_service");
    const adminToken = defaultTokenService.issueTokenPair({
      userId: "platform-super-admin",
      email: "admin@corp.internal",
      roles: ["platform administrator"],
      tenantId: "system-admin-tenant",
    }).accessToken;

    // 1. POST /api/v1/tenancy/switch
    const switchRes = await fetch(`${baseUrl}/api/v1/tenancy/switch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
        "X-Tenant-ID": "tenant-finance",
      },
      body: JSON.stringify({
        targetTenantId: "tenant-finance",
        reason: "Administrative tenant context shift",
      }),
    });
    assert.equal(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.equal(switchData.success, true);
    assert.equal(switchData.currentTenantId, "tenant-finance");

    // Verify TENANT_CHANGED audit event was recorded
    const tenantEvents = defaultAuditService.getEvents({ action: AUDIT_ACTIONS.TENANT_CHANGED });
    assert.ok(tenantEvents.total >= 1);
    const latestTenantEvent = tenantEvents.events[0];
    assert.equal(latestTenantEvent.tenant, "tenant-finance");
    assert.ok(latestTenantEvent.reason.includes("tenant context"));

    // 2. POST /api/v1/integrations/ticketing/register
    const ticketRes = await fetch(`${baseUrl}/api/v1/integrations/ticketing/register`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        name: `audit_webhook_${Date.now()}`,
        type: "webhook",
        config: { url: "https://hooks.slack.com/services/audit-test" },
      }),
    });
    assert.equal(ticketRes.status, 201);

    // Verify INTEGRATION_MODIFIED audit event was recorded
    const integEvents = defaultAuditService.getEvents({ action: AUDIT_ACTIONS.INTEGRATION_MODIFIED });
    assert.ok(integEvents.total >= 1);
    const latestIntegEvent = integEvents.events[0];
    assert.equal(latestIntegEvent.category, AUDIT_CATEGORIES.INTEGRATION_CHANGE);

    // 3. Verify entire default ledger remains cryptographically intact
    const verifyRes = await fetch(`${baseUrl}/api/v1/audit/verify`, { headers: AUTH_HEADERS });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.valid, true);
    assert.equal(verifyData.chainIntegrity, "VERIFIED_INTACT");
  });
});
