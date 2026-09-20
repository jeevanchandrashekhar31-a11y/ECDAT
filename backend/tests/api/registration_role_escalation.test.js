/**
 * P0 Security Remediation Regression Test Suite — Phase 2.1 Public Registration Role Escalation
 *
 * Mandate:
 * Public registration MUST NOT allow the client to choose:
 * - roles
 * - tenantId
 * - permissions
 * - privileges
 * - system ownership
 *
 * Required behavior:
 * - Public registration must produce the lowest-privilege account permitted by the product model ("viewer").
 * - Server never trusts req.body.roles, req.body.role, req.body.tenantId for privilege assignment.
 * - Role escalation attempts are rejected (default fail-closed) or safely ignored (forced to viewer).
 * - Legitimate administrator user creation still works via protected workflow:
 *   authenticated administrator -> authorization check -> create user -> assign role -> audit event.
 *
 * Mandatory variations tested:
 * - admin
 * - administrator
 * - platform administrator
 * - superadmin
 * - owner
 * - security_admin
 * - *
 * - ["admin", "viewer"]
 *
 * Acceptance condition:
 * An unauthenticated request can NEVER create an account with privileged permissions.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const { defaultLocalAuthManager, defaultTokenService } = require("../../src/identity");
const { defaultAuditService } = require("../../src/audit");
const { ROLES, PERMISSIONS } = require("../../src/middleware/rbac");

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(resolve);
      } catch (err) {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => reject(err));
      }
    });
  });
}

test("P0 — Anonymous user cannot create administrator account", async () => {
  await withServer(async (baseUrl) => {
    // 1. Array roles: ["admin"]
    const resAdminArray = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_attacker_admin1",
        email: "attacker1@exploit.internal",
        password: "ExploitPassword123!#",
        roles: ["admin"],
      }),
    });

    assert.equal(resAdminArray.status, 400);
    const dataAdminArray = await resAdminArray.json();
    assert.equal(dataAdminArray.error, "PrivilegeEscalationForbidden");
    assert.equal(dataAdminArray.code, "PRIVILEGE_ESCALATION_FORBIDDEN");
    assert.ok(dataAdminArray.violations.some((v) => v.includes("Privileged role assignment attempted")));

    // 2. Singular role: "administrator"
    const resAdminString = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_attacker_admin2",
        email: "attacker2@exploit.internal",
        password: "ExploitPassword123!#",
        role: "administrator",
      }),
    });

    assert.equal(resAdminString.status, 400);
    const dataAdminString = await resAdminString.json();
    assert.equal(dataAdminString.error, "PrivilegeEscalationForbidden");

    // Verify account was NOT created in identity store
    assert.ok(!defaultLocalAuthManager.getUser("anon_attacker_admin1"));
    assert.ok(!defaultLocalAuthManager.getUser("anon_attacker_admin2"));
  });
});

test("P0 — Anonymous user cannot create platform administrator account", async () => {
  await withServer(async (baseUrl) => {
    // Mandated test payload: {"roles": ["platform administrator"]}
    const resPlatformAdmin = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_platform_admin",
        email: "platform_hacker@exploit.internal",
        password: "ExploitPassword123!#",
        roles: ["platform administrator"],
      }),
    });

    assert.equal(resPlatformAdmin.status, 400);
    const dataPlatformAdmin = await resPlatformAdmin.json();
    assert.equal(dataPlatformAdmin.error, "PrivilegeEscalationForbidden");
    assert.equal(dataPlatformAdmin.code, "PRIVILEGE_ESCALATION_FORBIDDEN");

    // Variation: platform_admin underscore
    const resPlatformAdminUnderscore = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_platform_admin_u",
        email: "platform_hacker_u@exploit.internal",
        password: "ExploitPassword123!#",
        roles: ["platform_admin"],
      }),
    });

    assert.equal(resPlatformAdminUnderscore.status, 400);
    assert.ok(!defaultLocalAuthManager.getUser("anon_platform_admin"));
    assert.ok(!defaultLocalAuthManager.getUser("anon_platform_admin_u"));
  });
});

test("P0 — Anonymous user cannot create security administrator account", async () => {
  await withServer(async (baseUrl) => {
    const variations = [
      ["security administrator"],
      ["security_admin"],
      ["secops"],
      ["security-admin"],
    ];

    for (const roles of variations) {
      const username = `anon_secadmin_${roles[0].replace(/[^a-zA-Z0-9]/g, "_")}`;
      const res = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: `${username}@exploit.internal`,
          password: "ExploitPassword123!#",
          roles,
        }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "PrivilegeEscalationForbidden");
      assert.ok(!defaultLocalAuthManager.getUser(username));
    }
  });
});

test("P0 — Anonymous user cannot assign arbitrary permissions, privileges, or system ownership", async () => {
  await withServer(async (baseUrl) => {
    // 1. Arbitrary permissions: ["*"]
    const resWildcardPerms = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_perms_wildcard",
        email: "perms1@exploit.internal",
        password: "ExploitPassword123!#",
        permissions: ["*"],
      }),
    });
    assert.equal(resWildcardPerms.status, 400);
    const dataWildcard = await resWildcardPerms.json();
    assert.equal(dataWildcard.error, "PrivilegeEscalationForbidden");

    // 2. Specific sensitive permissions
    const resSpecificPerms = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_perms_specific",
        email: "perms2@exploit.internal",
        password: "ExploitPassword123!#",
        permissions: ["policy:approve", "secrets:rotate", "users:manage"],
      }),
    });
    assert.equal(resSpecificPerms.status, 400);

    // 3. System ownership / root privileges
    const resOwnership = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_owner_claim",
        email: "owner@exploit.internal",
        password: "ExploitPassword123!#",
        systemOwnership: true,
        privileges: ["root"],
      }),
    });
    assert.equal(resOwnership.status, 400);
    const dataOwnership = await resOwnership.json();
    assert.equal(dataOwnership.error, "PrivilegeEscalationForbidden");
  });
});

test("P0 — Anonymous user cannot select arbitrary tenant", async () => {
  await withServer(async (baseUrl) => {
    const resTenant = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "anon_tenant_hopper",
        email: "hopper@exploit.internal",
        password: "ExploitPassword123!#",
        tenantId: "rogue-enterprise-tenant-8888",
      }),
    });

    // Proves client cannot choose tenant: rejected fail-closed (400 or 403 tenant spoofing block)
    assert.ok(
      resTenant.status === 400 || resTenant.status === 403,
      `Expected HTTP 400 or 403 for unauthorized tenant selection, got ${resTenant.status}`
    );
    assert.ok(!defaultLocalAuthManager.getUser("anon_tenant_hopper"));
  });
});

test("P0 — Role escalation attempts across all required variations are rejected", async () => {
  await withServer(async (baseUrl) => {
    // Mandated variations:
    // admin, administrator, platform administrator, superadmin, owner, security_admin, *, ["admin", "viewer"]
    const variations = [
      { name: "admin_string", payload: { role: "admin" } },
      { name: "admin_array", payload: { roles: ["admin"] } },
      { name: "administrator_string", payload: { role: "administrator" } },
      { name: "administrator_array", payload: { roles: ["administrator"] } },
      { name: "platform_administrator_string", payload: { role: "platform administrator" } },
      { name: "platform_administrator_array", payload: { roles: ["platform administrator"] } },
      { name: "superadmin_string", payload: { role: "superadmin" } },
      { name: "superadmin_array", payload: { roles: ["superadmin"] } },
      { name: "owner_string", payload: { role: "owner" } },
      { name: "owner_array", payload: { roles: ["owner"] } },
      { name: "security_admin_string", payload: { role: "security_admin" } },
      { name: "security_admin_array", payload: { roles: ["security_admin"] } },
      { name: "wildcard_string", payload: { role: "*" } },
      { name: "wildcard_array", payload: { roles: ["*"] } },
      { name: "composite_admin_viewer", payload: { roles: ["admin", "viewer"] } },
    ];

    for (const item of variations) {
      const username = `reject_${item.name}`;
      const res = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: `${username}@corp.internal`,
          password: "Enterprise-Agile-PQC#2026!",
          ...item.payload,
        }),
      });

      assert.equal(
        res.status,
        400,
        `Expected HTTP 400 Bad Request for escalation payload: ${JSON.stringify(item.payload)}`
      );
      const data = await res.json();
      assert.equal(data.error, "PrivilegeEscalationForbidden");
      assert.equal(data.code, "PRIVILEGE_ESCALATION_FORBIDDEN");

      // Verify no account was provisioned
      assert.ok(!defaultLocalAuthManager.getUser(username));
    }
  });
});

test("P0 — Role escalation attempts in safe-ignore mode strictly assign lowest-privilege viewer", async () => {
  await withServer(async (baseUrl) => {
    const variations = [
      { name: "safe_admin", payload: { roles: ["admin"] } },
      { name: "safe_platform_admin", payload: { roles: ["platform administrator"] } },
      { name: "safe_composite", payload: { roles: ["admin", "viewer"] } },
      { name: "safe_perms_and_privs", payload: { roles: ["superuser"], permissions: ["*"], privileges: ["root"] } },
    ];

    for (const item of variations) {
      const username = `safe_${item.name}`;
      const password = "Enterprise-Agile-PQC#2026!";

      // Safe ignore mode requested via query param
      const res = await fetch(`${baseUrl}/api/v1/auth/local/register?safe_ignore=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: `${username}@corp.internal`,
          password,
          ...item.payload,
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.user.username, username);

      // CRITICAL ASSERTION: Server strictly forced role to ["viewer"] and tenant to "default-tenant"
      assert.deepEqual(data.user.roles, ["viewer"]);
      assert.equal(data.user.tenantId, "default-tenant");

      // Authenticate as this user and verify token contains ONLY viewer role
      const resLogin = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(resLogin.status, 200);
      const loginData = await resLogin.json();
      assert.deepEqual(loginData.user.roles, ["viewer"]);

      // Verify identity context /me
      const resMe = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${loginData.accessToken}` },
      });
      assert.equal(resMe.status, 200);
      const meData = await resMe.json();
      assert.equal(meData.role, "viewer");
      assert.deepEqual(meData.roles, ["viewer"]);

      // Verify RBAC permissions: has zero admin privileges
      const resPerms = await fetch(`${baseUrl}/api/v1/auth/rbac/my-permissions`, {
        headers: { Authorization: `Bearer ${loginData.accessToken}` },
      });
      assert.equal(resPerms.status, 200);
      const permsData = await resPerms.json();
      assert.ok(!permsData.permissions.includes("users:manage"));
      assert.ok(!permsData.permissions.includes("secrets:rotate"));
      assert.ok(!permsData.permissions.includes("policy:approve"));
      assert.ok(!permsData.permissions.includes("*"));

      // Verify that this user cannot call protected admin creation endpoint
      const resAdminAttempt = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginData.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "escalated_subuser",
          email: "escalated@corp.internal",
          password: "Enterprise-Agile-PQC#2026!",
          roles: ["admin"],
        }),
      });
      assert.equal(resAdminAttempt.status, 403);
    }
  });
});

test("P0 — Legitimate administrator user creation workflow succeeds with audit ledger event", async () => {
  await withServer(async (baseUrl) => {
    // 1. Anonymous request to admin user creation is rejected (401)
    const resAnon = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "unauth_created_user",
        email: "unauth@corp.internal",
        password: "Enterprise-Agile-PQC#2026!",
        roles: ["security administrator"],
      }),
    });
    assert.equal(resAnon.status, 401);

    // 2. Generate a valid Platform Administrator access token
    const tokenPair = defaultTokenService.issueTokenPair({
      userId: "admin_super_01",
      email: "admin@corp.internal",
      name: "super_admin",
      roles: [ROLES.PLATFORM_ADMIN],
      tenantId: "default-tenant",
    });
    const adminToken = tokenPair.accessToken;

    // 3. Legitimate administrator creates a Security Administrator
    const targetUsername = "legit_secadmin";
    const resLegit = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: targetUsername,
        email: "secadmin@corp.internal",
        password: "Enterprise-Agile-PQC#2026!",
        roles: ["security administrator"],
        tenantId: "default-tenant",
      }),
    });

    assert.equal(resLegit.status, 201);
    const dataLegit = await resLegit.json();
    assert.equal(dataLegit.success, true);
    assert.equal(dataLegit.user.username, targetUsername);
    assert.deepEqual(dataLegit.user.roles, [ROLES.SECURITY_ADMIN]);

    // 4. Verify audit event was emitted to defaultAuditService
    const recentAuditEvents = defaultAuditService.memoryLedger;
    const adminCreationEvent = recentAuditEvents.find(
      (e) =>
        e.action === "ROLE_ASSIGNED" &&
        e.details &&
        e.details.createdUsername === targetUsername &&
        e.details.action === "ADMIN_USER_CREATION"
    );
    assert.ok(adminCreationEvent, "Expected audit event recording admin user creation");
    assert.equal(adminCreationEvent.actor.role, ROLES.PLATFORM_ADMIN);
    assert.deepEqual(adminCreationEvent.details.assignedRoles, [ROLES.SECURITY_ADMIN]);

    // 5. Test Vertical Privilege Escalation Protection:
    // A Security Administrator CANNOT create a Platform Administrator
    const secTokenPair = defaultTokenService.issueTokenPair({
      userId: "secadmin_01",
      email: "secadmin@corp.internal",
      name: "sec_admin",
      roles: [ROLES.SECURITY_ADMIN],
      tenantId: "default-tenant",
    });
    const secAdminToken = secTokenPair.accessToken;

    const resVPE = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secAdminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "vpe_rogue_platform_admin",
        email: "rogue@corp.internal",
        password: "Enterprise-Agile-PQC#2026!",
        roles: ["platform administrator"],
      }),
    });

    assert.equal(resVPE.status, 403);
    const dataVPE = await resVPE.json();
    assert.equal(dataVPE.code, "VERTICAL_PRIVILEGE_ESCALATION");

    // 6. Security Administrator CAN legitimately create an Analyst
    const resAnalyst = await fetch(`${baseUrl}/api/v1/auth/admin/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secAdminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "analyst_colleague",
        email: "analyst@corp.internal",
        password: "Enterprise-Agile-PQC#2026!",
        roles: ["analyst"],
      }),
    });

    assert.equal(resAnalyst.status, 201);
    const dataAnalyst = await resAnalyst.json();
    assert.deepEqual(dataAnalyst.user.roles, [ROLES.ANALYST]);
  });
});

test("Acceptance Condition: An unauthenticated request can NEVER create an account with privileged permissions", async () => {
  await withServer(async (baseUrl) => {
    // Fuzzing matrix of forbidden payloads
    const attackPayloads = [
      { roles: ["admin"] },
      { role: "admin" },
      { roles: ["administrator"] },
      { role: "administrator" },
      { roles: ["platform administrator"] },
      { role: "platform administrator" },
      { roles: ["superadmin"] },
      { role: "superadmin" },
      { roles: ["owner"] },
      { role: "owner" },
      { roles: ["security_admin"] },
      { roles: ["security administrator"] },
      { roles: ["secops"] },
      { roles: ["*"] },
      { roles: ["admin", "viewer"] },
      { roles: ["viewer", "platform administrator"] },
      { permissions: ["*"] },
      { permissions: ["users:manage"] },
      { privileges: ["root"] },
      { systemOwnership: true },
      { isOwner: true },
      { isAdmin: true },
      { tenantId: "isolated_tenant_xyz" },
    ];

    let testIndex = 0;
    for (const attack of attackPayloads) {
      testIndex++;
      const username = `fuzz_attacker_${testIndex}`;
      const res = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: `${username}@attack.internal`,
          password: "Enterprise-Agile-PQC#2026!",
          ...attack,
        }),
      });

      // Must be rejected with 400 or 403
      assert.ok(
        res.status === 400 || res.status === 403,
        `Attack payload ${JSON.stringify(attack)} was not rejected with HTTP 400/403, got ${res.status}`
      );

      // Verify no account exists
      const userRecord = defaultLocalAuthManager.getUser(username);
      assert.ok(!userRecord);
    }
  });
});

test("P0 — Comprehensive Registration Authorization Invariants (7 Mandated Scenarios)", async (t) => {
  await withServer(async (baseUrl) => {
    // 1. Normal registration (both with email and without email)
    await t.test("Scenario 1: Normal registration produces lowest-privilege user in default tenant", async () => {
      // 1a. Normal registration with email
      const res1 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "legit_user_01",
          email: "legit_user_01@example.com",
          password: "LegitimateUserPass2026!",
        }),
      });
      assert.equal(res1.status, 201);
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.user.username, "legit_user_01");
      assert.deepEqual(data1.user.roles, ["viewer"]);
      assert.equal(data1.user.role, "viewer");
      assert.equal(data1.user.tenantId, "default-tenant");

      // 1b. Normal registration with only username and password (email omitted)
      const res1b = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "legit_user_no_email",
          password: "LegitimateUserPass2026!",
        }),
      });
      assert.equal(res1b.status, 201);
      const data1b = await res1b.json();
      assert.equal(data1b.success, true);
      assert.deepEqual(data1b.user.roles, ["viewer"]);
      assert.equal(data1b.user.role, "viewer");
      assert.equal(data1b.user.tenantId, "default-tenant");
    });

    // 2. Registration with role=admin
    await t.test("Scenario 2: Registration with role=admin is rejected or safe-ignored to viewer", async () => {
      // Fail-closed rejection
      const res2 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_role_admin",
          password: "AttackerPassword2026!",
          role: "admin",
        }),
      });
      assert.equal(res2.status, 400);
      assert.ok(!defaultLocalAuthManager.getUser("attacker_role_admin"));

      // Safe-ignore mode produces strictly viewer
      const res2Safe = await fetch(`${baseUrl}/api/v1/auth/local/register?safe_ignore=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "safe_role_admin",
          password: "AttackerPassword2026!",
          role: "admin",
        }),
      });
      assert.equal(res2Safe.status, 201);
      const data2Safe = await res2Safe.json();
      assert.deepEqual(data2Safe.user.roles, ["viewer"]);
      assert.equal(data2Safe.user.role, "viewer");
      assert.notEqual(data2Safe.user.role, "admin");
    });

    // 3. Registration with roles=["admin"]
    await t.test("Scenario 3: Registration with roles=['admin'] is rejected or safe-ignored to viewer", async () => {
      const res3 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_roles_admin",
          password: "AttackerPassword2026!",
          roles: ["admin"],
        }),
      });
      assert.equal(res3.status, 400);
      assert.ok(!defaultLocalAuthManager.getUser("attacker_roles_admin"));
    });

    // 4. Registration with isAdmin=true
    await t.test("Scenario 4: Registration with isAdmin=true is rejected or safe-ignored to viewer", async () => {
      const res4 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_is_admin",
          password: "AttackerPassword2026!",
          isAdmin: true,
        }),
      });
      assert.equal(res4.status, 400);
      assert.ok(!defaultLocalAuthManager.getUser("attacker_is_admin"));
    });

    // 5. Registration with isPlatformAdmin=true
    await t.test("Scenario 5: Registration with isPlatformAdmin=true is rejected or safe-ignored to viewer", async () => {
      const res5 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_is_platform_admin",
          password: "AttackerPassword2026!",
          isPlatformAdmin: true,
        }),
      });
      assert.equal(res5.status, 400);
      assert.ok(!defaultLocalAuthManager.getUser("attacker_is_platform_admin"));
    });

    // 6. Registration with arbitrary tenantId
    await t.test("Scenario 6: Registration with arbitrary tenantId is rejected or safe-ignored to default tenant", async () => {
      const res6 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_arbitrary_tenant",
          password: "AttackerPassword2026!",
          tenantId: "rogue-enterprise-tenant-777",
        }),
      });
      assert.equal(res6.status, 400);
      assert.ok(!defaultLocalAuthManager.getUser("attacker_arbitrary_tenant"));

      // Safe-ignore mode clamps tenant to default-tenant
      const res6Safe = await fetch(`${baseUrl}/api/v1/auth/local/register?safe_ignore=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "safe_arbitrary_tenant",
          password: "AttackerPassword2026!",
          tenantId: "rogue-enterprise-tenant-777",
        }),
      });
      assert.equal(res6Safe.status, 201);
      const data6Safe = await res6Safe.json();
      assert.equal(data6Safe.user.tenantId, "default-tenant");
      assert.notEqual(data6Safe.user.tenantId, "rogue-enterprise-tenant-777");
    });

    // 7. Registration attempting to combine all privilege fields
    await t.test("Scenario 7: Registration combining all privilege fields is rejected", async () => {
      const res7 = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "attacker_combined_exploit",
          password: "AttackerPassword2026!",
          role: "admin",
          roles: ["platform administrator", "admin"],
          isAdmin: true,
          isPlatformAdmin: true,
          tenantId: "evil-foreign-tenant",
          permissions: ["*"],
          privileges: ["root"],
          systemOwnership: true,
        }),
      });
      assert.equal(res7.status, 400);
      const data7 = await res7.json();
      assert.equal(data7.error, "PrivilegeEscalationForbidden");
      assert.ok(data7.violations.length >= 4, "Must identify multiple privilege escalation violations");
      assert.ok(!defaultLocalAuthManager.getUser("attacker_combined_exploit"));
    });
  });
});
