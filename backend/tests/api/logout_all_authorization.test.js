/**
 * P0 — LOGOUT-ALL AUTHORIZATION TEST SUITE (Phase 4)
 *
 * Requirements:
 * - Anonymous caller cannot revoke any sessions (returns 401).
 * - Authenticated ordinary user can only revoke own sessions; cannot target another user (returns 403).
 * - Administrator can revoke sessions only according to explicit admin policy:
 *   - Target user must exist (404 for nonexistent).
 *   - User ID must be well-formed (400 for malformed/traversal/XSS).
 *   - Cross-tenant administrator cannot target foreign tenant users (403 HORIZONTAL_TENANT_VIOLATION).
 *   - Tenant administrator cannot target platform administrator (403 VERTICAL_PRIVILEGE_ESCALATION).
 *   - Required for administrative revocation: target user + authorized actor + audit event.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const {
  defaultLocalAuthManager,
  defaultTokenService,
} = require("../../src/identity");
const { defaultAuditService } = require("../../src/audit");

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

test("P0 — Logout-All Authorization: Complete Security Model Verification", async (t) => {
  await withServer(async (baseUrl) => {
    // ------------------------------------------------------------------------
    // SETUP: Seed test users across Tenant A, Tenant B, and System
    // ------------------------------------------------------------------------
    const userA = {
      userId: "usr_alice_tenant_a",
      username: "alice_a",
      email: "alice@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const victimA = {
      userId: "usr_victim_tenant_a",
      username: "victim_a",
      email: "victim@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const userB = {
      userId: "usr_bob_tenant_b",
      username: "bob_b",
      email: "bob@tenantb.corp",
      tenantId: "tenant-b",
      roles: ["viewer"],
    };
    const adminA = {
      userId: "adm_carol_tenant_a",
      username: "carol_a",
      email: "carol@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["security administrator"],
    };
    const adminB = {
      userId: "adm_dave_tenant_b",
      username: "dave_b",
      email: "dave@tenantb.corp",
      tenantId: "tenant-b",
      roles: ["security administrator"],
    };
    const platformAdmin = {
      userId: "adm_platform_global",
      username: "platform_adm",
      email: "platform@system.internal",
      tenantId: "system",
      roles: ["platform administrator"],
    };

    [userA, victimA, userB, adminA, adminB, platformAdmin].forEach((u) => {
      defaultLocalAuthManager.users.set(u.userId, { ...u, mfaEnabled: false });
    });

    const tokenUserA = defaultTokenService.issueTokenPair({
      userId: userA.userId,
      email: userA.email,
      roles: userA.roles,
      customClaims: { tenantId: userA.tenantId },
    }).accessToken;

    const tokenAdminA = defaultTokenService.issueTokenPair({
      userId: adminA.userId,
      email: adminA.email,
      roles: adminA.roles,
      customClaims: { tenantId: adminA.tenantId },
    }).accessToken;

    const tokenAdminB = defaultTokenService.issueTokenPair({
      userId: adminB.userId,
      email: adminB.email,
      roles: adminB.roles,
      customClaims: { tenantId: adminB.tenantId },
    }).accessToken;

    const tokenPlatformAdmin = defaultTokenService.issueTokenPair({
      userId: platformAdmin.userId,
      email: platformAdmin.email,
      roles: platformAdmin.roles,
      customClaims: { tenantId: platformAdmin.tenantId },
    }).accessToken;

    // ========================================================================
    // 1. Anonymous Attacker Tests
    // ========================================================================
    await t.test("Anonymous attacker cannot revoke another user's sessions", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userA.userId }),
      });
      assert.equal(res.status, 401, "Anonymous attacker targeting user must receive 401");
      const data = await res.json();
      assert.equal(data.error, "Unauthorized");
    });

    await t.test("Anonymous caller without body cannot revoke sessions", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(res.status, 401, "Anonymous caller must receive 401");
    });

    // ========================================================================
    // 2. Authenticated Ordinary User Targeting Another User
    // ========================================================================
    await t.test("Authenticated ordinary user targeting user in same tenant is denied", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ userId: victimA.userId }),
      });
      assert.equal(res.status, 403, "Ordinary user targeting peer user must receive 403");
      const data = await res.json();
      assert.equal(data.code, "FORBIDDEN");
    });

    await t.test("Authenticated ordinary user targeting user in foreign tenant is denied", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ userId: userB.userId }),
      });
      assert.equal(res.status, 403, "Ordinary user targeting foreign tenant user must receive 403");
    });

    // ========================================================================
    // 3. Authenticated User Revoking Own Sessions
    // ========================================================================
    await t.test("Authenticated ordinary user can revoke own sessions", async () => {
      const selfTestUser = {
        userId: "usr_self_revoker_99",
        username: "self_revoker",
        email: "self@corp.internal",
        tenantId: "tenant-a",
        roles: ["viewer"],
      };
      defaultLocalAuthManager.users.set(selfTestUser.userId, { ...selfTestUser, mfaEnabled: false });

      const selfToken = defaultTokenService.issueTokenPair({
        userId: selfTestUser.userId,
        email: selfTestUser.email,
        roles: selfTestUser.roles,
        customClaims: { tenantId: selfTestUser.tenantId },
      }).accessToken;

      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${selfToken}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 200, "Ordinary user revoking own sessions must succeed");
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.targetUserId, selfTestUser.userId);
      assert.equal(data.authorizedActor, selfTestUser.userId);

      // Verify session revocation invalidates further operations
      const resSubsequent = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${selfToken}` },
      });
      assert.equal(resSubsequent.status, 401, "Revoked token must be rejected on subsequent requests");
    });

    // ========================================================================
    // 4. Authorized Administrator Revocation Policy & Audit Event
    // ========================================================================
    await t.test("Authorized administrator revokes sessions with target, authorized actor, and audit event", async () => {
      const victimToken = defaultTokenService.issueTokenPair({
        userId: victimA.userId,
        email: victimA.email,
        roles: victimA.roles,
        customClaims: { tenantId: victimA.tenantId },
      }).accessToken;

      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          userId: victimA.userId,
          reason: "Suspected session hijacking incident response",
        }),
      });

      assert.equal(res.status, 200, "Administrator revoking user within tenant must succeed");
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.targetUserId, victimA.userId, "Must record target user");
      assert.equal(data.authorizedActor, adminA.userId, "Must record authorized actor");

      // Verify victim's token is immediately invalidated
      const resCheck = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${victimToken}` },
      });
      assert.equal(resCheck.status, 401, "Victim sessions must be invalidated by administrator revocation");

      // Verify audit event exists in the audit ledger
      const auditResult = defaultAuditService.getEvents({
        tenantId: "tenant-a",
        action: "AUTH_LOGOUT_ALL",
      });
      assert.ok(auditResult.events.length > 0, "Audit event must be recorded for admin revocation");
      const latestRevokeEvent = auditResult.events.find(
        (e) => (e.target?.id === victimA.userId || e.target === victimA.userId) && e.actor?.id === adminA.userId
      );
      assert.ok(latestRevokeEvent, "Audit record must bind target user and authorized actor");
      assert.equal(latestRevokeEvent.status, "SUCCESS");
      assert.equal(latestRevokeEvent.details.administrative, true);
      assert.equal(latestRevokeEvent.details.authorizedActor, adminA.userId);
      assert.equal(latestRevokeEvent.details.targetUserId, victimA.userId);
    });

    // ========================================================================
    // 5. Cross-Tenant Administrator Revocation
    // ========================================================================
    await t.test("Cross-tenant administrator targeting foreign tenant user is rejected", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          userId: userB.userId,
          reason: "Hostile cross-tenant session wipe attempt",
        }),
      });

      assert.equal(res.status, 403, "Cross-tenant admin revocation must return 403");
      const data = await res.json();
      assert.equal(data.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    // ========================================================================
    // 6. Nonexistent User Targeting
    // ========================================================================
    await t.test("Revocation targeting nonexistent user returns 404", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: "usr_nonexistent_identity_404" }),
      });

      assert.equal(res.status, 404, "Targeting non-existent user must return 404");
      const data = await res.json();
      assert.equal(data.error, "NotFound");
    });

    // ========================================================================
    // 7. Malformed User ID Inputs
    // ========================================================================
    await t.test("Revocation with malformed user ID inputs is rejected with 400", async () => {
      const malformedPayloads = [
        "<script>alert('xss')</script>",
        "../../etc/passwd",
        "usr_victim/subpath",
        "   ",
        "",
      ];

      for (const malformedId of malformedPayloads) {
        const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenAdminA}`,
          },
          body: JSON.stringify({ userId: malformedId }),
        });

        assert.equal(
          res.status,
          400,
          `Malformed userId '${malformedId}' must return 400 Bad Request`
        );
        const data = await res.json();
        assert.equal(data.error, "BadRequest");
      }
    });

    // ========================================================================
    // 8. Vertical Privilege Escalation Protection
    // ========================================================================
    await t.test("Tenant administrator cannot revoke platform administrator sessions", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: platformAdmin.userId }),
      });

      assert.equal(res.status, 403, "Tenant admin revoking platform admin must return 403");
      const data = await res.json();
      assert.ok(
        data.code === "VERTICAL_PRIVILEGE_ESCALATION" || data.code === "HORIZONTAL_TENANT_VIOLATION"
      );
    });

    // ========================================================================
    // 9. Platform Administrator Cross-Tenant Governance
    // ========================================================================
    await t.test("Platform administrator can revoke sessions across any tenant with audit trail", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenPlatformAdmin}`,
        },
        body: JSON.stringify({
          userId: userB.userId,
          reason: "Platform security audit compliance revocation",
        }),
      });

      assert.equal(res.status, 200, "Platform admin revoking foreign tenant user must succeed");
      const data = await res.json();
      assert.equal(data.targetUserId, userB.userId);
      assert.equal(data.authorizedActor, platformAdmin.userId);
    });
  });
});
