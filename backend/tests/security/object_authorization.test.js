/**
 * Object-Level Authorization & BOLA/IDOR Security Test Suite (Phase 18 / P1)
 *
 * Mandate:
 * 1. Never rely only on role checks.
 * 2. For every endpoint accepting:
 *    - userId
 *    - tenantId
 *    - scanId
 *    - reportId
 *    - cbomId
 *    - assetId
 *    - projectId
 *    - jobId
 *    - secretId
 *    - integrationId
 *    verify ownership and authorization against authoritative server-side state.
 * 3. Prevent IDOR, BOLA, and cross-tenant object access.
 * 4. Test sequential integer IDs and UUID manipulation.
 * 5. Verify HTTP 401/403, NO side effects, and AUDIT EVENT on every denial.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");

const {
  OBJECT_TYPES,
  defaultObjectStateRegistry,
  resolveObjectState,
  requireObjectAuthorization,
} = require("../../src/security/object_authorization");
const { defaultLocalAuthManager } = require("../../src/identity/password_auth");
const { inMemoryScansStore } = require("../../src/services/cbom_ingestion");
const { defaultTenantJobQueue, TenantContext } = require("../../src/tenancy/tenant_isolation");
const { defaultKmsDiscoveryService, AwsKmsConnector } = require("../../src/integrations/kms");
const { defaultTicketingService, WebhookConnector } = require("../../src/integrations/ticketing");
const { defaultTokenService } = require("../../src/identity/token_service");
const { defaultAuditService } = require("../../src/audit");
const app = require("../../src/app");

function withServer(appInstance, testFn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(appInstance);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await testFn(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("Phase 18.1 — Object-Level Authorization Server-Side State Resolution for all 10 types", async (t) => {
  // Setup test objects across two tenants
  const tenantA = "tenant-alpha";
  const tenantB = "tenant-beta";

  // 1. User
  defaultLocalAuthManager.registerUser({
    username: "alice_state",
    email: "alice@tenant-alpha.com",
    password: "Password123!@#Test",
    roles: ["analyst"],
    tenantId: tenantA,
  });
  const alice = defaultLocalAuthManager.getUser("alice_state");

  defaultLocalAuthManager.registerUser({
    username: "bob_state",
    email: "bob@tenant-beta.com",
    password: "Password123!@#Test",
    roles: ["analyst"],
    tenantId: tenantB,
  });
  const bob = defaultLocalAuthManager.getUser("bob_state");

  // 2. Scan & Asset
  const scanA = {
    id: "scan-seq-001",
    tenantId: tenantA,
    target_name: "Service A",
    top_risky_assets: [
      { asset_id: "asset-seq-001", primary_identifier: "asset-seq-001", ownerId: alice.userId },
    ],
  };
  const scanB = {
    id: "scan-seq-002",
    tenantId: tenantB,
    target_name: "Service B",
    top_risky_assets: [
      { asset_id: "asset-seq-002", primary_identifier: "asset-seq-002", ownerId: bob.userId },
    ],
  };
  inMemoryScansStore.set(scanA.id, scanA);
  inMemoryScansStore.set(scanB.id, scanB);

  // 3. Project, Secret, Report
  defaultObjectStateRegistry.registerProject({ id: "proj-seq-001", tenantId: tenantA, ownerId: alice.userId });
  defaultObjectStateRegistry.registerProject({ id: "proj-seq-002", tenantId: tenantB, ownerId: bob.userId });

  defaultObjectStateRegistry.registerSecret({ id: "sec-seq-001", tenantId: tenantA, ownerId: alice.userId });
  defaultObjectStateRegistry.registerSecret({ id: "sec-seq-002", tenantId: tenantB, ownerId: bob.userId });

  defaultObjectStateRegistry.registerReport({ id: "rep-seq-001", tenantId: tenantA, scanId: scanA.id });
  defaultObjectStateRegistry.registerReport({ id: "rep-seq-002", tenantId: tenantB, scanId: scanB.id });

  // 4. Job
  const jobCtxA = new TenantContext({ tenantId: tenantA, userId: alice.userId, roles: ["analyst"] });
  const jobA = defaultTenantJobQueue.enqueue("pqc_scan_a", { userId: alice.userId }, jobCtxA);

  const jobCtxB = new TenantContext({ tenantId: tenantB, userId: bob.userId, roles: ["analyst"] });
  const jobB = defaultTenantJobQueue.enqueue("pqc_scan_b", { userId: bob.userId }, jobCtxB);

  // 5. Integrations (KMS & Ticketing)
  const kmsA = new AwsKmsConnector({ name: "kms-seq-001", config: { region: "us-east-1" }, readOnly: true });
  kmsA.tenantId = tenantA;
  defaultKmsDiscoveryService.registerConnector(kmsA);

  const kmsB = new AwsKmsConnector({ name: "kms-seq-002", config: { region: "us-east-1" }, readOnly: true });
  kmsB.tenantId = tenantB;
  defaultKmsDiscoveryService.registerConnector(kmsB);

  // Verify resolution for all 10 types
  const typesToTest = [
    { type: OBJECT_TYPES.USER, id: alice.userId, expectedTenant: tenantA },
    { type: OBJECT_TYPES.TENANT, id: tenantA, expectedTenant: tenantA },
    { type: OBJECT_TYPES.SCAN, id: scanA.id, expectedTenant: tenantA },
    { type: OBJECT_TYPES.REPORT, id: "rep-seq-001", expectedTenant: tenantA },
    { type: OBJECT_TYPES.CBOM, id: scanA.id, expectedTenant: tenantA },
    { type: OBJECT_TYPES.ASSET, id: "asset-seq-001", expectedTenant: tenantA },
    { type: OBJECT_TYPES.PROJECT, id: "proj-seq-001", expectedTenant: tenantA },
    { type: OBJECT_TYPES.JOB, id: jobA.jobId, expectedTenant: tenantA },
    { type: OBJECT_TYPES.SECRET, id: "sec-seq-001", expectedTenant: tenantA },
    { type: OBJECT_TYPES.INTEGRATION, id: "kms-seq-001", expectedTenant: tenantA },
  ];

  for (const item of typesToTest) {
    const res = await resolveObjectState(item.type, item.id);
    assert.equal(res.exists, true, `Resource ${item.type}:${item.id} must exist in state`);
    assert.equal(res.object.tenantId, item.expectedTenant, `Resource tenant must match ${item.expectedTenant}`);
  }

  // Non-existent resources must return exists: false
  const notFoundRes = await resolveObjectState(OBJECT_TYPES.SCAN, "non-existent-scan-id");
  assert.equal(notFoundRes.exists, false);
});

test("Phase 18.2 — Sequential Integer ID Manipulation & IDOR Protection", async () => {
  await withServer(app, async (baseUrl) => {
    // Generate credentials
    const tenantA = "tenant-alpha";
    const tenantB = "tenant-beta";

    const aliceUser = defaultLocalAuthManager.getUser("alice_state");
    const { accessToken: tokenAlice } = defaultTokenService.issueTokenPair({
      userId: aliceUser.userId,
      roles: ["analyst"],
      customClaims: { tenantId: tenantA },
    });

    const bobUser = defaultLocalAuthManager.getUser("bob_state");
    const { accessToken: tokenBob } = defaultTokenService.issueTokenPair({
      userId: bobUser.userId,
      roles: ["analyst"],
      customClaims: { tenantId: tenantB },
    });

    // 1. Sequential User ID Access: Alice (tenant A) attempts to access Bob's user profile by sequential ID
    const resIdorUser = await fetch(`${baseUrl}/api/v1/auth/users/${bobUser.userId}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resIdorUser.status, 403, "Cross-tenant sequential user lookup must be rejected with 403");
    const idorUserData = await resIdorUser.json();
    assert.equal(idorUserData.code, "HORIZONTAL_TENANT_VIOLATION");

    // 2. Sequential Non-Existent User ID -> 404
    const resNonExistentUser = await fetch(`${baseUrl}/api/v1/auth/users/user-seq-999999`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resNonExistentUser.status, 404, "Non-existent sequential ID must return 404 Not Found");

    // 3. Legitimate Self-Lookup -> 200 OK
    const resAliceSelf = await fetch(`${baseUrl}/api/v1/auth/users/${aliceUser.userId}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resAliceSelf.status, 200);
    const selfData = await resAliceSelf.json();
    assert.equal(selfData.userId, aliceUser.userId);

    // 4. Sequential Job ID: Alice attempts to access Bob's background job
    const jobsBeta = defaultTenantJobQueue.getJobs(new TenantContext({ tenantId: tenantB, isPlatformAdmin: false }));
    const bobJob = jobsBeta[0];
    assert.ok(bobJob, "Bob must have at least one background job");

    const resIdorJob = await fetch(`${baseUrl}/api/v1/tenancy/jobs/${bobJob.jobId}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resIdorJob.status, 403, "Cross-tenant job lookup must be rejected with 403");
    const idorJobData = await resIdorJob.json();
    assert.equal(idorJobData.code, "HORIZONTAL_TENANT_VIOLATION");

    // 5. Sequential Non-existent Job ID -> 404
    const resNonExistentJob = await fetch(`${baseUrl}/api/v1/tenancy/jobs/job-99999`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resNonExistentJob.status, 404);

    // 6. Sequential Secret ID: Alice attempts to read Bob's secret
    const resIdorSecret = await fetch(`${baseUrl}/api/v1/auth/secrets/sec-seq-002`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resIdorSecret.status, 403, "Cross-tenant secret lookup must be rejected with 403");

    // Alice reading own secret -> 200 OK
    const resAliceSecret = await fetch(`${baseUrl}/api/v1/auth/secrets/sec-seq-001`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resAliceSecret.status, 200);

    // 7. Sequential KMS Integration ID: Alice attempts to read Bob's KMS connector
    const resIdorKms = await fetch(`${baseUrl}/api/v1/integrations/kms/connectors/kms-seq-002`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resIdorKms.status, 403, "Cross-tenant connector access must be rejected with 403");

    // Alice reading own KMS connector -> 200 OK
    const resAliceKms = await fetch(`${baseUrl}/api/v1/integrations/kms/connectors/kms-seq-001`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resAliceKms.status, 200);
  });
});

test("Phase 18.3 — UUID Manipulation & Tampering Defense", async () => {
  await withServer(app, async (baseUrl) => {
    const tenantA = "tenant-alpha";
    const tenantB = "tenant-beta";

    const aliceUser = defaultLocalAuthManager.getUser("alice_state");
    const { accessToken: tokenAlice } = defaultTokenService.issueTokenPair({
      userId: aliceUser.userId,
      roles: ["analyst"],
      customClaims: { tenantId: tenantA },
    });

    // Create resources with genuine UUIDs
    const uuidAlphaJob = "44444444-4444-4444-8444-444444444444";
    const uuidBetaJob = "55555555-5555-4555-8555-555555555555";

    defaultTenantJobQueue.jobs.set(uuidAlphaJob, {
      jobId: uuidAlphaJob,
      tenantId: tenantA,
      status: "COMPLETED",
    });
    defaultTenantJobQueue.jobs.set(uuidBetaJob, {
      jobId: uuidBetaJob,
      tenantId: tenantB,
      status: "COMPLETED",
    });

    // 1. Valid UUID belonging to foreign tenant -> 403
    const resCrossUuid = await fetch(`${baseUrl}/api/v1/tenancy/jobs/${uuidBetaJob}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resCrossUuid.status, 403, "Manipulating UUID to foreign tenant's UUID must yield 403");
    const crossData = await resCrossUuid.json();
    assert.equal(crossData.code, "HORIZONTAL_TENANT_VIOLATION");

    // 2. Manipulated/Forged UUID (bit flipped or random) -> 404
    const forgedUuid = "55555555-5555-4555-8555-555555555556";
    const resForgedUuid = await fetch(`${baseUrl}/api/v1/tenancy/jobs/${forgedUuid}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resForgedUuid.status, 404, "Manipulated non-existent UUID must return 404");

    // 3. Malicious Path Traversal or Injection in UUID param -> 400 Bad Request
    const resMalicious = await fetch(`${baseUrl}/api/v1/tenancy/jobs/..%2F..%2Fetc%2Fpasswd`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.ok(resMalicious.status === 400 || resMalicious.status === 404, "Path traversal in ID must be rejected");

    // 4. Valid Own UUID -> 200 OK
    const resOwnUuid = await fetch(`${baseUrl}/api/v1/tenancy/jobs/${uuidAlphaJob}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resOwnUuid.status, 200);
    const ownData = await resOwnUuid.json();
    assert.equal(ownData.jobId, uuidAlphaJob);
  });
});

test("Phase 18.4 — Zero Side Effects Guarantee on Denied Object Requests", async () => {
  await withServer(app, async (baseUrl) => {
    const tenantA = "tenant-alpha";
    const tenantB = "tenant-beta";

    const aliceUser = defaultLocalAuthManager.getUser("alice_state");
    const { accessToken: tokenAlice } = defaultTokenService.issueTokenPair({
      userId: aliceUser.userId,
      roles: ["admin"],
      customClaims: { tenantId: tenantA },
    });

    const bobUser = defaultLocalAuthManager.getUser("bob_state");

    // Record initial states
    const initialUsersCount = defaultLocalAuthManager.users.size;
    const initialSecretsCount = defaultObjectStateRegistry.secrets.size;
    const initialJobsCount = defaultTenantJobQueue.jobs.size;

    // 1. Attempt unauthorized DELETE on Tenant B's user
    const resDelUser = await fetch(`${baseUrl}/api/v1/auth/users/${bobUser.userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resDelUser.status, 403, "Cross-tenant user deletion must be denied");
    assert.equal(defaultLocalAuthManager.users.size, initialUsersCount, "Users store size MUST NOT change on denial");

    // 2. Attempt unauthorized DELETE on Tenant B's secret
    const resDelSecret = await fetch(`${baseUrl}/api/v1/auth/secrets/sec-seq-002`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resDelSecret.status, 403, "Cross-tenant secret deletion must be denied");
    assert.equal(defaultObjectStateRegistry.secrets.size, initialSecretsCount, "Secrets store size MUST NOT change on denial");

    // 3. Attempt unauthorized DELETE on Tenant B's job
    const jobsBeta = defaultTenantJobQueue.getJobs(new TenantContext({ tenantId: tenantB, isPlatformAdmin: false }));
    const bobJob = jobsBeta[0];
    const resDelJob = await fetch(`${baseUrl}/api/v1/tenancy/jobs/${bobJob.jobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resDelJob.status, 403, "Cross-tenant job cancellation must be denied");
    assert.equal(defaultTenantJobQueue.jobs.size, initialJobsCount, "Jobs queue size MUST NOT change on denial");
  });
});

test("Phase 18.5 — Audit Event Generation on Object-Level Authorization Denials", async () => {
  await withServer(app, async (baseUrl) => {
    const tenantA = "tenant-alpha";
    const tenantB = "tenant-beta";

    const aliceUser = defaultLocalAuthManager.getUser("alice_state");
    const { accessToken: tokenAlice } = defaultTokenService.issueTokenPair({
      userId: aliceUser.userId,
      roles: ["analyst"],
      customClaims: { tenantId: tenantA },
    });

    const bobUser = defaultLocalAuthManager.getUser("bob_state");

    // Capture audit events
    const initialAuditCount = defaultAuditService.events.length;

    // Trigger BOLA denial
    const resDenial = await fetch(`${baseUrl}/api/v1/auth/users/${bobUser.userId}`, {
      headers: { Authorization: `Bearer ${tokenAlice}` },
    });
    assert.equal(resDenial.status, 403);

    const newAuditEvents = defaultAuditService.events.slice(initialAuditCount);
    const denialEvent = newAuditEvents.find(
      (e) => e.action === "TENANT_ISOLATION_VIOLATION" && e.status === "DENIED"
    );

    assert.ok(denialEvent, "Must record TENANT_ISOLATION_VIOLATION audit event with status DENIED");
    assert.equal(denialEvent.actor.id, aliceUser.userId);
    assert.equal(denialEvent.tenantId, tenantA);
    assert.equal(denialEvent.details?.code, "HORIZONTAL_TENANT_VIOLATION");
  });
});
