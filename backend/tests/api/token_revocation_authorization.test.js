/**
 * P0 — TOKEN REVOCATION AUTHORIZATION REGRESSION TEST SUITE (Phase 5)
 *
 * Requirements:
 * - Anonymous caller cannot revoke tokens (returns 401).
 * - Ordinary user can only revoke their own tokens (returns 200).
 * - Ordinary user cannot revoke another user's token (returns 403 FORBIDDEN).
 * - Cross-tenant caller cannot revoke foreign tenant tokens (returns 403 HORIZONTAL_TENANT_VIOLATION).
 * - Arbitrary unknown JTIs submitted by caller are rejected (returns 404 Not Found) - server NEVER trusts submitted JTI.
 * - Administrator can revoke tokens only according to explicit policy with mandatory audit ledger events.
 * - Tenant administrator cannot revoke platform administrator tokens (returns 403 VERTICAL_PRIVILEGE_ESCALATION).
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

test("P0 — Token Revocation Authorization: Complete Ownership & Policy Verification", async (t) => {
  await withServer(async (baseUrl) => {
    // ------------------------------------------------------------------------
    // SETUP: Seed test personas across Tenant A, Tenant B, and System
    // ------------------------------------------------------------------------
    const userA = {
      userId: "usr_alice_token_a",
      username: "alice_token",
      email: "alice@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const peerUserA = {
      userId: "usr_peer_token_a",
      username: "peer_token",
      email: "peer@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const userB = {
      userId: "usr_bob_token_b",
      username: "bob_token",
      email: "bob@tenantb.corp",
      tenantId: "tenant-b",
      roles: ["viewer"],
    };
    const adminA = {
      userId: "adm_carol_token_a",
      username: "carol_token_admin",
      email: "carol@tenanta.corp",
      tenantId: "tenant-a",
      roles: ["security administrator"],
    };
    const adminB = {
      userId: "adm_dave_token_b",
      username: "dave_token_admin",
      email: "dave@tenantb.corp",
      tenantId: "tenant-b",
      roles: ["security administrator"],
    };
    const platformAdmin = {
      userId: "adm_platform_token_global",
      username: "platform_token_global",
      email: "global@ecdat.internal",
      tenantId: "system",
      roles: ["platform administrator"],
    };

    [userA, peerUserA, userB, adminA, adminB, platformAdmin].forEach((u) => {
      defaultLocalAuthManager.users.set(u.userId, { ...u, mfaEnabled: false });
    });

    // Issue tokens for personas
    const tokenPairA = defaultTokenService.issueTokenPair({
      userId: userA.userId,
      email: userA.email,
      roles: userA.roles,
      customClaims: { tenantId: userA.tenantId },
    });
    const tokenUserA = tokenPairA.accessToken;
    const jtiUserA = tokenPairA.jti;

    const tokenPairPeerA = defaultTokenService.issueTokenPair({
      userId: peerUserA.userId,
      email: peerUserA.email,
      roles: peerUserA.roles,
      customClaims: { tenantId: peerUserA.tenantId },
    });
    const jtiPeerA = tokenPairPeerA.jti;

    const tokenPairB = defaultTokenService.issueTokenPair({
      userId: userB.userId,
      email: userB.email,
      roles: userB.roles,
      customClaims: { tenantId: userB.tenantId },
    });
    const tokenUserB = tokenPairB.accessToken;
    const jtiUserB = tokenPairB.jti;

    const tokenAdminA = defaultTokenService.issueTokenPair({
      userId: adminA.userId,
      email: adminA.email,
      roles: adminA.roles,
      customClaims: { tenantId: adminA.tenantId },
    }).accessToken;

    const tokenPlatformAdmin = defaultTokenService.issueTokenPair({
      userId: platformAdmin.userId,
      email: platformAdmin.email,
      roles: platformAdmin.roles,
      customClaims: { tenantId: platformAdmin.tenantId },
    });
    const jtiPlatform = tokenPlatformAdmin.jti;

    // ========================================================================
    // 1. Anonymous Caller Tests
    // ========================================================================
    await t.test("Anonymous caller attempting to revoke token is denied with 401", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jti: jtiUserA }),
      });
      assert.equal(res.status, 401, "Anonymous caller must receive 401");
      const data = await res.json();
      assert.equal(data.error, "Unauthorized");
    });

    // ========================================================================
    // 2. Ordinary User Revoking Own Token
    // ========================================================================
    await t.test("Ordinary user revoking own token succeeds and invalidates subsequent requests", async () => {
      // Issue a specific token pair for self-revocation test
      const selfTokenPair = defaultTokenService.issueTokenPair({
        userId: userA.userId,
        email: userA.email,
        roles: userA.roles,
        customClaims: { tenantId: userA.tenantId },
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${selfTokenPair.accessToken}`,
        },
        body: JSON.stringify({ jti: selfTokenPair.jti, reason: "Self revocation test" }),
      });

      assert.equal(res.status, 200, "Ordinary user revoking own token must succeed");
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.jti, selfTokenPair.jti);

      // Verify the revoked token cannot access protected endpoints anymore
      const resProtected = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${selfTokenPair.accessToken}` },
      });
      assert.equal(resProtected.status, 401, "Revoked token must be rejected on subsequent API calls");
    });

    // ========================================================================
    // 3. Ordinary User Targeting Another User's Token (Same Tenant)
    // ========================================================================
    await t.test("Ordinary user attempting to revoke peer user's token is denied with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ jti: jtiPeerA }),
      });

      assert.equal(res.status, 403, "Ordinary user revoking peer's token must return 403");
      const data = await res.json();
      assert.equal(data.code, "FORBIDDEN");
    });

    // ========================================================================
    // 4. Ordinary User Targeting Foreign Tenant Token
    // ========================================================================
    await t.test("Ordinary user attempting to revoke foreign tenant token is denied with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ jti: jtiUserB }),
      });

      assert.equal(res.status, 403, "Cross-tenant revocation attempt must return 403");
      const data = await res.json();
      assert.equal(data.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    // ========================================================================
    // 5. Cross-Tenant Administrator Revocation
    // ========================================================================
    await t.test("Cross-tenant administrator attempting to revoke foreign tenant token is denied with 403", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ jti: jtiUserB, reason: "Hostile cross-tenant wipe" }),
      });

      assert.equal(res.status, 403, "Admin revoking foreign tenant token must return 403");
      const data = await res.json();
      assert.equal(data.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    // ========================================================================
    // 6. Arbitrary Unknown JTI Rejection (Never Trust Submitted JTI)
    // ========================================================================
    await t.test("Arbitrary unknown JTI is rejected with 404 - server never trusts submitted JTI", async () => {
      const forgedJtis = [
        "acc_forged_random_string_12345",
        "acc_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "ref_fake_refresh_token_identifier",
      ];

      for (const forgedJti of forgedJtis) {
        const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenUserA}`,
          },
          body: JSON.stringify({ jti: forgedJti }),
        });

        assert.equal(res.status, 404, `Forged JTI '${forgedJti}' must return 404 Not Found`);
        const data = await res.json();
        assert.equal(data.error, "NotFound");
      }
    });

    // ========================================================================
    // 7. Malformed or Empty Payload Validation
    // ========================================================================
    await t.test("Malformed or missing JTI is rejected with 400 Bad Request", async () => {
      const invalidBodies = [
        {},
        { jti: "" },
        { jti: "   " },
        { jti: 12345 },
        { jti: null },
      ];

      for (const body of invalidBodies) {
        const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenUserA}`,
          },
          body: JSON.stringify(body),
        });

        assert.equal(res.status, 400, "Missing or invalid jti must return 400");
      }
    });

    // ========================================================================
    // 8. Vertical Privilege Escalation Protection
    // ========================================================================
    await t.test("Tenant administrator cannot revoke platform administrator token", async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ jti: jtiPlatform }),
      });

      assert.equal(res.status, 403, "Tenant admin revoking platform admin token must return 403");
      const data = await res.json();
      assert.ok(
        data.code === "VERTICAL_PRIVILEGE_ESCALATION" || data.code === "HORIZONTAL_TENANT_VIOLATION"
      );
    });

    // ========================================================================
    // 9. Authorized Administrator Revoking Tenant Token According to Policy
    // ========================================================================
    await t.test("Authorized administrator can revoke token in own tenant with audit trail", async () => {
      const targetTokenPair = defaultTokenService.issueTokenPair({
        userId: peerUserA.userId,
        email: peerUserA.email,
        roles: peerUserA.roles,
        customClaims: { tenantId: peerUserA.tenantId },
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          jti: targetTokenPair.jti,
          reason: "Security audit compliance revocation",
        }),
      });

      assert.equal(res.status, 200, "Admin revoking token within same tenant must succeed");
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.jti, targetTokenPair.jti);
      assert.equal(data.targetUserId, peerUserA.userId);
      assert.equal(data.authorizedActor, adminA.userId);

      // Verify target token is revoked
      const resCheck = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${targetTokenPair.accessToken}` },
      });
      assert.equal(resCheck.status, 401, "Revoked token must be rejected");

      // Verify audit event is logged in the audit ledger
      const auditResult = defaultAuditService.getEvents({
        tenantId: "tenant-a",
        action: "AUTH_TOKEN_REVOKED",
      });
      assert.ok(auditResult.events.length > 0, "Audit event must be logged for token revocation");
      const revokeEvent = auditResult.events.find(
        (e) => (e.target?.id === targetTokenPair.jti || e.target === targetTokenPair.jti) && e.actor?.id === adminA.userId
      );
      assert.ok(revokeEvent, "Audit event must record target JTI and authorized actor");
      assert.equal(revokeEvent.status, "SUCCESS");
      assert.equal(revokeEvent.details.administrative, true);
      assert.equal(revokeEvent.details.targetUserId, peerUserA.userId);
    });

    // ========================================================================
    // 10. Platform Administrator Cross-Tenant Token Revocation
    // ========================================================================
    await t.test("Platform administrator can revoke tokens across any tenant", async () => {
      const targetTokenPair = defaultTokenService.issueTokenPair({
        userId: userB.userId,
        email: userB.email,
        roles: userB.roles,
        customClaims: { tenantId: userB.tenantId },
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenPlatformAdmin.accessToken}`,
        },
        body: JSON.stringify({
          jti: targetTokenPair.jti,
          reason: "Global platform governance revocation",
        }),
      });

      assert.equal(res.status, 200, "Platform admin revoking token in foreign tenant must succeed");
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.jti, targetTokenPair.jti);
      assert.equal(data.targetUserId, userB.userId);
      assert.equal(data.authorizedActor, platformAdmin.userId);
    });
  });
});
