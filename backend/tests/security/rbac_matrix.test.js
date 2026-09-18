const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const {
  ROLES,
  PERMISSIONS,
  CAPABILITIES,
  AUTHORIZATION_MATRIX,
  evaluateCapability,
  hasPermission,
  getUserPermissions,
} = require("../../src/middleware/rbac");
const { defaultTokenService } = require("../../src/identity");
const { defaultAuditService, AUDIT_STATUSES } = require("../../src/audit");
const { defaultSecretManager } = require("../../src/identity");
const { defaultLocalAuthManager } = require("../../src/identity");

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

test("RBAC Verification — Authoritative Matrix & Permission Enforcement", async (t) => {
  const roles = [
    "anonymous",
    "viewer",
    "analyst",
    "developer",
    "auditor",
    "admin",
    "platform_admin",
  ];
  const capabilities = Object.values(CAPABILITIES);

  // ---------------------------------------------------------------------------
  // 1. Full Matrix Coverage (7 roles x 11 capabilities = 77 cells)
  // ---------------------------------------------------------------------------
  await t.test("1. Comprehensive 77-cell Authorization Matrix evaluation", () => {
    assert.equal(capabilities.length, 11, "Must define all 11 enterprise capabilities");

    for (const cap of capabilities) {
      const capEntry = AUTHORIZATION_MATRIX[cap];
      assert.ok(capEntry, `Matrix entry must exist for capability '${cap}'`);

      for (const role of roles) {
        const expectedValue = capEntry[role];
        assert.ok(expectedValue, `Matrix entry must define value for capability '${cap}' and role '${role}'`);

        const result = evaluateCapability(role, cap, {
          isCrossTenant: false,
          isMasterRotation: false,
          emitAudit: false, // Pure unit evaluation without ledger pollution
        });

        if (expectedValue === "NO") {
          assert.equal(result.allowed, false, `Role '${role}' must be denied capability '${cap}'`);
          const expectedStatus = role === "anonymous" ? 401 : 403;
          assert.equal(result.status, expectedStatus);
        } else if (expectedValue === "scoped") {
          assert.equal(result.allowed, true, `Role '${role}' must have scoped access for capability '${cap}'`);
          assert.equal(result.scope, "tenant");
        } else if (expectedValue === "policy") {
          assert.equal(result.allowed, true, `Role '${role}' must have policy-governed access for capability '${cap}'`);
          assert.equal(result.scope, "policy_governed");
        } else if (expectedValue === "YES") {
          assert.equal(result.allowed, true, `Role '${role}' must have access for capability '${cap}'`);
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Denied Permission Invariant: HTTP 401/403, No Side Effect, Audit Event
  // ---------------------------------------------------------------------------
  await t.test("2. Denied permissions emit HTTP 401/403, have NO side effects, and log AUDIT EVENT", async () => {
    await withServer(async (baseUrl) => {
      const initialKey = defaultSecretManager.getActiveKey("jwt_signing");
      const initialKeyId = initialKey.kid;
      const initialLedgerCount = defaultAuditService.memoryLedger.length;

      // Scenario A: Unauthenticated caller attempting master secrets rotate
      const resAnon = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyType: "jwt_signing" }),
      });

      assert.equal(resAnon.status, 401, "Unauthenticated secret rotation must return 401");
      const anonBody = await resAnon.json();
      assert.equal(anonBody.code, "AUTHENTICATION_REQUIRED");

      // Verify NO side effect on secret key
      const keyAfterAnon = defaultSecretManager.getActiveKey("jwt_signing");
      assert.equal(keyAfterAnon.kid, initialKeyId, "Secret must NOT have rotated on 401 denial");

      // Scenario B: Unprivileged Developer token attempting master secrets rotate
      const devTokens = defaultTokenService.issueTokenPair({
        userId: "usr_dev_alice",
        username: "alice_dev",
        roles: ["developer"],
        tenantId: "tenant-alpha",
      });

      const resDev = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${devTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyType: "jwt_signing" }),
      });

      assert.equal(resDev.status, 403, "Developer secret rotation must return 403");
      const devBody = await resDev.json();
      assert.equal(devBody.code, "INSUFFICIENT_PERMISSIONS");

      // Verify NO side effect
      const keyAfterDev = defaultSecretManager.getActiveKey("jwt_signing");
      assert.equal(keyAfterDev.kid, initialKeyId, "Secret must NOT have rotated on 403 denial");

      // Scenario C: Auditor token attempting master secrets rotate
      const auditorTokens = defaultTokenService.issueTokenPair({
        userId: "usr_auditor_claire",
        username: "claire_auditor",
        roles: ["auditor"],
        tenantId: "tenant-alpha",
      });

      const resAuditor = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auditorTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyType: "jwt_signing" }),
      });

      assert.equal(resAuditor.status, 403, "Auditor secret rotation must return 403");

      // Scenario D: Security Admin attempting master secrets rotate (strictly reserved for Platform Admin)
      const secAdminTokens = defaultTokenService.issueTokenPair({
        userId: "usr_secadmin_bob",
        username: "bob_secops",
        roles: [ROLES.SECURITY_ADMIN],
        tenantId: "tenant-alpha",
      });

      const resSecAdmin = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secAdminTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyType: "jwt_signing" }),
      });

      assert.equal(resSecAdmin.status, 403, "Security Admin secret rotation must return 403");

      // Verify NO side effect
      const keyAfterSecAdmin = defaultSecretManager.getActiveKey("jwt_signing");
      assert.equal(keyAfterSecAdmin.kid, initialKeyId, "Secret must NOT have rotated on SecAdmin 403 denial");

      // Verify AUDIT EVENTS were logged for all denied attempts
      const currentLedger = defaultAuditService.memoryLedger;
      assert.ok(currentLedger.length > initialLedgerCount, "Audit events must be recorded in ledger");

      const deniedEvents = currentLedger.filter((e) => e.status === AUDIT_STATUSES.DENIED);
      assert.ok(deniedEvents.length >= 4, "Must have recorded at least 4 DENIED audit events");

      // Check the latest denied event details
      const recentDenied = deniedEvents[deniedEvents.length - 1];
      assert.equal(recentDenied.status, "DENIED");
      assert.ok(recentDenied.action === "PERMISSION_DENIED" || recentDenied.action === "AUTHORIZATION_FAILURE");

      // Scenario E: Platform Admin token DOES succeed
      const platAdminTokens = defaultTokenService.issueTokenPair({
        userId: "usr_platadmin_root",
        username: "root_platadmin",
        roles: [ROLES.PLATFORM_ADMIN],
        tenantId: "system",
      });

      const resPlatAdmin = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${platAdminTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keyType: "jwt_signing" }),
      });

      assert.equal(resPlatAdmin.status, 200, "Platform Admin secret rotation must return 200");
      const platBody = await resPlatAdmin.json();
      assert.equal(platBody.success, true);
      assert.notEqual(platBody.newKid, initialKeyId, "Secret MUST rotate when authorized by Platform Admin");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. User Management & Vertical Privilege Escalation (VPE)
  // ---------------------------------------------------------------------------
  await t.test("3. User Management permissions, VPE protection, and Side-Effect prevention", async () => {
    await withServer(async (baseUrl) => {
      const initialUsersCount = defaultLocalAuthManager.users.size;

      // 1. Viewer cannot create users
      const viewerTokens = defaultTokenService.issueTokenPair({
        userId: "usr_viewer_vince",
        username: "vince_viewer",
        roles: ["viewer"],
        tenantId: "tenant-alpha",
      });

      const resViewerCreate = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${viewerTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "sneaky_user",
          email: "sneaky@example.com",
          password: "SuperSecretPassword123!",
          roles: ["viewer"],
        }),
      });

      assert.equal(resViewerCreate.status, 403);
      assert.equal(defaultLocalAuthManager.users.size, initialUsersCount, "Zero users must be created on 403");

      // 2. Security Administrator attempting Vertical Privilege Escalation (creating Platform Admin)
      const secAdminTokens = defaultTokenService.issueTokenPair({
        userId: "usr_secadmin_bob",
        username: "bob_secops",
        roles: [ROLES.SECURITY_ADMIN],
        tenantId: "tenant-alpha",
      });

      const resVpeCreate = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secAdminTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "escalated_admin",
          email: "escalated@example.com",
          password: "SuperSecretPassword123!",
          roles: ["platform administrator"],
        }),
      });

      assert.equal(resVpeCreate.status, 403);
      const vpeData = await resVpeCreate.json();
      assert.equal(vpeData.code, "VERTICAL_PRIVILEGE_ESCALATION");
      assert.equal(defaultLocalAuthManager.users.size, initialUsersCount, "Zero users must be created on VPE 403");

      // 3. Security Administrator attempting Horizontal Tenant Violation (creating user in foreign tenant)
      const resHpeCreate = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secAdminTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "foreign_user",
          email: "foreign@example.com",
          password: "SuperSecretPassword123!",
          roles: ["analyst"],
          tenantId: "tenant-foreign-beta",
        }),
      });

      assert.equal(resHpeCreate.status, 403);
      const hpeData = await resHpeCreate.json();
      assert.ok(
        hpeData.code === "HORIZONTAL_TENANT_VIOLATION" || hpeData.code === "TENANT_SPOOFING_VIOLATION",
        `Expected tenant violation code, got: ${hpeData.code}`
      );
      assert.equal(defaultLocalAuthManager.users.size, initialUsersCount, "Zero users must be created on HPE 403");

      // 4. Security Administrator creating user in assigned tenant succeeds
      const resValidCreate = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secAdminTokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "legit_analyst",
          email: "analyst@example.com",
          password: "SuperSecretPassword123!",
          roles: ["analyst"],
        }),
      });

      assert.equal(resValidCreate.status, 201);
      assert.equal(defaultLocalAuthManager.users.size, initialUsersCount + 1, "Exactly one user must be created on valid 201");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Public Authorization Matrix Endpoint (/api/v1/auth/rbac/matrix)
  // ---------------------------------------------------------------------------
  await t.test("4. GET /api/v1/auth/rbac/matrix exposes complete derived matrix", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/auth/rbac/matrix`);
      assert.equal(res.status, 200);
      const data = await res.json();

      assert.ok(Array.isArray(data.capabilities));
      assert.equal(data.capabilities.length, 11);
      assert.ok(Array.isArray(data.roles));
      assert.equal(data.roles.length, 7);
      assert.ok(data.matrix);

      // Verify key matrix definitions
      assert.equal(data.matrix.read_own_data.anonymous, "NO");
      assert.equal(data.matrix.read_own_data.viewer, "YES");
      assert.equal(data.matrix.read_tenant_data.admin, "scoped");
      assert.equal(data.matrix.read_tenant_data.platform_admin, "YES");
      assert.equal(data.matrix.manage_users.auditor, "NO");
      assert.equal(data.matrix.manage_users.admin, "scoped");
      assert.equal(data.matrix.rotate_secrets.admin, "policy");
      assert.equal(data.matrix.rotate_secrets.platform_admin, "YES");
      assert.equal(data.matrix.cross_tenant_access.admin, "NO");
      assert.equal(data.matrix.cross_tenant_access.platform_admin, "YES");
    });
  });
});
