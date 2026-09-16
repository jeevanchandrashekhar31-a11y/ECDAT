const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizeRole,
  hasPermission,
  getUserPermissions,
  requirePermission,
  ENDPOINT_PERMISSIONS,
} = require("../../src/middleware/rbac");
const { defaultTokenService } = require("../../src/identity");

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

test("RBAC - 6 Canonical Enterprise Roles and Alias Normalization", () => {
  const expectedRoles = [
    "platform administrator",
    "security administrator",
    "analyst",
    "developer",
    "auditor",
    "viewer",
  ];
  assert.deepEqual(Object.values(ROLES), expectedRoles);

  assert.equal(normalizeRole("platform_admin"), ROLES.PLATFORM_ADMIN);
  assert.equal(normalizeRole("admin"), ROLES.PLATFORM_ADMIN);
  assert.equal(normalizeRole("secops"), ROLES.SECURITY_ADMIN);
  assert.equal(normalizeRole("security-administrator"), ROLES.SECURITY_ADMIN);
  assert.equal(normalizeRole("engineer"), ROLES.DEVELOPER);
  assert.equal(normalizeRole("compliance"), ROLES.AUDITOR);
  assert.equal(normalizeRole("reader"), ROLES.VIEWER);
  assert.equal(normalizeRole("unknown"), ROLES.VIEWER);
});

test("RBAC - Role Permissions & Auditor Read-Only Invariant", () => {
  // Platform Admin has all permissions
  const adminPerms = getUserPermissions(ROLES.PLATFORM_ADMIN);
  assert.ok(adminPerms.includes(PERMISSIONS.SECRETS_ROTATE));
  assert.ok(adminPerms.includes(PERMISSIONS.POLICY_APPROVE));
  assert.ok(hasPermission([ROLES.PLATFORM_ADMIN], PERMISSIONS.SECRETS_ROTATE));

  // Auditor is strictly read-only
  const auditorPerms = getUserPermissions(ROLES.AUDITOR);
  assert.ok(auditorPerms.includes(PERMISSIONS.AUDIT_READ));
  assert.ok(auditorPerms.includes(PERMISSIONS.AUDIT_VERIFY));
  assert.ok(auditorPerms.includes(PERMISSIONS.COMPLIANCE_READ));
  assert.ok(auditorPerms.includes(PERMISSIONS.FINDINGS_READ));

  assert.equal(auditorPerms.includes(PERMISSIONS.ASSETS_WRITE), false);
  assert.equal(auditorPerms.includes(PERMISSIONS.ASSETS_DELETE), false);
  assert.equal(auditorPerms.includes(PERMISSIONS.SCANS_TRIGGER), false);
  assert.equal(auditorPerms.includes(PERMISSIONS.POLICY_APPROVE), false);
  assert.equal(auditorPerms.includes(PERMISSIONS.REMEDIATION_APPLY), false);
  assert.equal(auditorPerms.includes(PERMISSIONS.SECRETS_ROTATE), false);
});

test("RBAC - Vertical Privilege Escalation (VPE) Defenses", () => {
  // 1. Viewer cannot write or delete assets
  assert.equal(hasPermission([ROLES.VIEWER], PERMISSIONS.ASSETS_WRITE), false);
  assert.equal(hasPermission([ROLES.VIEWER], PERMISSIONS.ASSETS_DELETE), false);
  assert.equal(hasPermission([ROLES.VIEWER], PERMISSIONS.SCANS_TRIGGER), false);

  // 2. Developer cannot approve policies or apply remediation to prod
  assert.equal(hasPermission([ROLES.DEVELOPER], PERMISSIONS.POLICY_APPROVE), false);
  assert.equal(hasPermission([ROLES.DEVELOPER], PERMISSIONS.REMEDIATION_APPLY), false);
  assert.equal(hasPermission([ROLES.DEVELOPER], PERMISSIONS.SECRETS_ROTATE), false);

  // 3. Analyst can propose remediation but CANNOT approve or apply
  assert.equal(hasPermission([ROLES.ANALYST], PERMISSIONS.REMEDIATION_PROPOSE), true);
  assert.equal(hasPermission([ROLES.ANALYST], PERMISSIONS.REMEDIATION_APPROVE), false);
  assert.equal(hasPermission([ROLES.ANALYST], PERMISSIONS.REMEDIATION_APPLY), false);
  assert.equal(hasPermission([ROLES.ANALYST], PERMISSIONS.POLICY_APPROVE), false);

  // 4. Security Admin cannot rotate platform master secrets
  assert.equal(hasPermission([ROLES.SECURITY_ADMIN], PERMISSIONS.SECRETS_ROTATE), false);
});

test("RBAC - Middleware rejects Vertical and Horizontal privilege escalation", () => {
  const middleware = requirePermission(PERMISSIONS.POLICY_APPROVE);

  // 1. Unauthenticated request rejected with 401
  let status1 = null;
  let json1 = null;
  const res1 = {
    status: (s) => { status1 = s; return res1; },
    json: (j) => { json1 = j; return res1; },
  };
  middleware({ auth: { authenticated: false } }, res1, () => {});
  assert.equal(status1, 401);
  assert.equal(json1.error, "Unauthorized");

  // 2. Vertical escalation: Developer attempting policy:approve rejected with 403
  let status2 = null;
  let json2 = null;
  const res2 = {
    status: (s) => { status2 = s; return res2; },
    json: (j) => { json2 = j; return res2; },
  };
  middleware(
    {
      auth: { authenticated: true, roles: [ROLES.DEVELOPER] },
      user: { tenantId: "tenant-a" },
    },
    res2,
    () => {}
  );
  assert.equal(status2, 403);
  assert.equal(json2.code, "INSUFFICIENT_PERMISSIONS");

  // 3. Horizontal escalation: Security Admin in tenant-a attempting cross-tenant access to tenant-b
  const secMiddleware = requirePermission(PERMISSIONS.POLICY_READ);
  let status3 = null;
  let json3 = null;
  const res3 = {
    status: (s) => { status3 = s; return res3; },
    json: (j) => { json3 = j; return res3; },
  };
  secMiddleware(
    {
      auth: { authenticated: true, roles: [ROLES.SECURITY_ADMIN] },
      user: { tenantId: "tenant-a" },
      params: { tenantId: "tenant-b" },
    },
    res3,
    () => {}
  );
  assert.equal(status3, 403);
  assert.equal(json3.code, "HORIZONTAL_TENANT_VIOLATION");
});

test("RBAC API - Endpoint permission declarations & catalog endpoint", async () => {
  await withServer(async (baseUrl) => {
    // 1. Fetch RBAC catalog
    const res = await fetch(`${baseUrl}/api/v1/auth/rbac/catalog`);
    assert.equal(res.status, 200);
    const catalog = await res.json();

    assert.equal(catalog.roles.length, 6);
    assert.ok(catalog.roles.includes("platform administrator"));
    assert.ok(catalog.roles.includes("security administrator"));
    assert.ok(catalog.roles.includes("analyst"));
    assert.ok(catalog.roles.includes("developer"));
    assert.ok(catalog.roles.includes("auditor"));
    assert.ok(catalog.roles.includes("viewer"));

    assert.ok(catalog.endpointDeclarations["POST /api/v1/auth/secrets/rotate"]);
    assert.equal(catalog.endpointDeclarations["POST /api/v1/auth/secrets/rotate"], PERMISSIONS.SECRETS_ROTATE);

    // 2. Vertical Escalation API Test: Developer token attempting secrets rotate
    const devTokenPair = defaultTokenService.issueTokenPair({
      userId: "usr_dev_bob",
      roles: ["developer"],
    });

    const resDevRotate = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devTokenPair.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keyType: "jwt_signing" }),
    });
    assert.equal(resDevRotate.status, 403);
    const devRotateData = await resDevRotate.json();
    assert.equal(devRotateData.code, "INSUFFICIENT_PERMISSIONS");
    assert.equal(devRotateData.requiredPermission, PERMISSIONS.SECRETS_ROTATE);

    // 3. Platform Admin token attempting secrets rotate succeeds
    const adminTokenPair = defaultTokenService.issueTokenPair({
      userId: "usr_admin_alice",
      roles: [ROLES.PLATFORM_ADMIN],
    });

    const resAdminRotate = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminTokenPair.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keyType: "jwt_signing" }),
    });
    assert.equal(resAdminRotate.status, 200);
    const adminRotateData = await resAdminRotate.json();
    assert.equal(adminRotateData.success, true);
    assert.ok(adminRotateData.newKid);

    // 4. Horizontal Escalation API Test: Check endpoint with cross-tenant target
    const resHpeCheck = await fetch(`${baseUrl}/api/v1/auth/rbac/check`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devTokenPair.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        permission: "assets:read",
        targetTenantId: "other-tenant-corp",
      }),
    });
    assert.equal(resHpeCheck.status, 403);
    const hpeData = await resHpeCheck.json();
    assert.equal(hpeData.code, "HORIZONTAL_TENANT_VIOLATION");
  });
});
