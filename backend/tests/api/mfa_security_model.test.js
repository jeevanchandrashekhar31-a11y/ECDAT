/**
 * P0 — MFA SECURITY MODEL TEST SUITE (Phase 6)
 *
 * Requirements:
 * - MFA enrollment must be bound to authenticated identity.
 * - Server NEVER trusts req.body.userId or req.body.username as identity proof.
 * - Re-authentication required where appropriate (re-configuring existing MFA).
 * - Proof of possession strictly required to enable MFA (valid TOTP code).
 * - Secrets and backup codes are NEVER logged in audit ledger.
 * - Backup codes are stored hashed (SHA-256) and are strictly single-use.
 * - Another user's MFA cannot be configured by manipulating userId (account takeover defense).
 * - Cross-tenant MFA manipulation is strictly denied (403 HORIZONTAL_TENANT_VIOLATION).
 * - Vertical privilege escalation (tenant admin targeting platform admin) is denied (403 VERTICAL_PRIVILEGE_ESCALATION).
 * - MFA reset / recovery requires equivalent security strength (proof of possession or admin authority).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const {
  defaultLocalAuthManager,
  defaultTokenService,
  defaultMfaEngine,
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

test("P0 — MFA Security Model: Complete Account Takeover & Lifecycle Verification", async (t) => {
  await withServer(async (baseUrl) => {
    // ------------------------------------------------------------------------
    // SETUP: Seed test personas across Tenant A, Tenant B, and System
    // ------------------------------------------------------------------------
    const userA = {
      userId: "usr_alice_mfa_a",
      username: "alice_mfa",
      email: "alice@tenanta.corp",
      password: "Enterprise-PQC-Defender#2026!",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const victimA = {
      userId: "usr_victim_mfa_a",
      username: "victim_mfa",
      email: "victim@tenanta.corp",
      password: "Enterprise-PQC-Guardian#2026!",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const userB = {
      userId: "usr_bob_mfa_b",
      username: "bob_mfa",
      email: "bob@tenantb.corp",
      password: "Enterprise-PQC-Sentinel#2026!",
      tenantId: "tenant-b",
      roles: ["viewer"],
    };
    const adminA = {
      userId: "adm_carol_mfa_a",
      username: "carol_mfa_admin",
      email: "carol@tenanta.corp",
      password: "Enterprise-PQC-Security#2026!",
      tenantId: "tenant-a",
      roles: ["security administrator"],
    };
    const platformAdmin = {
      userId: "adm_platform_mfa_global",
      username: "platform_mfa_adm",
      email: "global@ecdat.internal",
      password: "Enterprise-PQC-Superuser#2026!",
      tenantId: "system",
      roles: ["platform administrator"],
    };

    [userA, victimA, userB, adminA, platformAdmin].forEach((u) => {
      defaultLocalAuthManager.registerUser({
        username: u.username,
        email: u.email,
        password: u.password,
        roles: u.roles,
        tenantId: u.tenantId,
      });
      // Ensure specific user ID mapping
      const seeded = defaultLocalAuthManager.getUser(u.username);
      seeded.userId = u.userId;
      seeded.mfaEnabled = false;
      defaultLocalAuthManager.users.set(u.userId, seeded);
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

    const tokenPlatformAdmin = defaultTokenService.issueTokenPair({
      userId: platformAdmin.userId,
      email: platformAdmin.email,
      roles: platformAdmin.roles,
      customClaims: { tenantId: platformAdmin.tenantId },
    }).accessToken;

    // ========================================================================
    // 1. Anonymous Caller Defenses
    // ========================================================================
    await t.test("Anonymous caller cannot initialize MFA setup or enable", async () => {
      const resSetup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: victimA.userId }),
      });
      assert.equal(resSetup.status, 401, "Anonymous caller calling /mfa/setup must receive 401");

      const resEnable = await fetch(`${baseUrl}/api/v1/auth/mfa/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: victimA.userId, code: "123456" }),
      });
      assert.equal(resEnable.status, 401, "Anonymous caller calling /mfa/enable must receive 401");
    });

    // ========================================================================
    // 2. Account Takeover via Manipulated userId / username (Same Tenant)
    // ========================================================================
    await t.test("Ordinary user cannot configure another user's MFA by manipulating userId or username", async () => {
      // Attacker Alice supplies victim's userId
      const resAttackById = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ userId: victimA.userId }),
      });
      assert.equal(resAttackById.status, 403, "Manipulating target userId must be rejected with 403");
      const dataId = await resAttackById.json();
      assert.equal(dataId.code, "FORBIDDEN");

      // Attacker Alice supplies victim's username
      const resAttackByName = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ username: victimA.username }),
      });
      assert.equal(resAttackByName.status, 403, "Manipulating target username must be rejected with 403");
    });

    // ========================================================================
    // 3. Cross-Tenant Account Takeover Attempt
    // ========================================================================
    await t.test("Cross-tenant user cannot configure foreign tenant user MFA", async () => {
      const resCrossSetup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ username: userB.username }),
      });
      assert.equal(resCrossSetup.status, 403, "Cross-tenant MFA setup must return 403");
      const data = await resCrossSetup.json();
      assert.equal(data.code, "HORIZONTAL_TENANT_VIOLATION");
    });

    // ========================================================================
    // 4. Vertical Privilege Takeover Attempt
    // ========================================================================
    await t.test("Tenant administrator cannot configure platform administrator MFA", async () => {
      const resVertical = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: platformAdmin.userId }),
      });
      assert.equal(resVertical.status, 403, "Tenant admin targeting platform admin must return 403");
      const data = await resVertical.json();
      assert.ok(
        data.code === "VERTICAL_PRIVILEGE_ESCALATION" || data.code === "HORIZONTAL_TENANT_VIOLATION"
      );
    });

    // ========================================================================
    // 5. Legitimate MFA Enrollment Lifecycle & Proof of Possession
    // ========================================================================
    let plainSecret = null;
    let backupCodesList = null;

    await t.test("Legitimate MFA enrollment lifecycle with proof of possession and zero-secret logging", async () => {
      // Step A: Setup - generate secret and backup codes
      const resSetup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({}),
      });

      assert.equal(resSetup.status, 200, "MFA setup for authenticated caller must succeed");
      const setupData = await resSetup.json();
      assert.ok(setupData.secret, "Must return TOTP secret to caller");
      assert.ok(setupData.otpAuthUri, "Must return otpAuthUri");
      assert.ok(Array.isArray(setupData.backupCodes), "Must return plain backup codes to user");
      assert.equal(setupData.backupCodes.length, 8);

      plainSecret = setupData.secret;
      backupCodesList = setupData.backupCodes;

      // Invariant: Verify server stores backup codes hashed in user state (SHA-256), NOT plain text
      const userObj = defaultLocalAuthManager.getUser(userA.userId);
      assert.equal(userObj.mfaEnabled, false, "MFA must not be enabled until proof of possession is verified");
      assert.ok(Array.isArray(userObj.pendingBackupHashes), "Must store backup code hashes");
      assert.ok(!userObj.pendingBackupHashes.includes(backupCodesList[0]), "Must NOT store plaintext backup codes");

      // Invariant: Verify secrets and backup codes are NEVER logged in audit ledger
      const auditEvents = defaultAuditService.getEvents({
        tenantId: "tenant-a",
        action: "AUTH_MFA_SETUP_INITIATED",
      });
      assert.ok(auditEvents.events.length > 0, "MFA setup must emit audit record");
      const setupLog = auditEvents.events.find((e) => e.target?.id === userA.userId);
      assert.ok(setupLog, "Audit log for user MFA setup must exist");
      const serializedAudit = JSON.stringify(setupLog);
      assert.equal(serializedAudit.includes(plainSecret), false, "MFA secret must NEVER appear in audit logs");
      backupCodesList.forEach((code) => {
        assert.equal(serializedAudit.includes(code), false, "Backup codes must NEVER appear in audit logs");
      });

      // Step B: Proof of possession - invalid TOTP code is rejected
      const resBadCode = await fetch(`${baseUrl}/api/v1/auth/mfa/enable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ code: "000000" }),
      });
      assert.equal(resBadCode.status, 400, "Invalid TOTP code must be rejected");

      // Step C: Proof of possession - valid TOTP code enables MFA
      const validCode = defaultMfaEngine.generateCode(plainSecret);
      const resEnable = await fetch(`${baseUrl}/api/v1/auth/mfa/enable`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ code: validCode }),
      });
      assert.equal(resEnable.status, 200, "Valid TOTP code enables MFA");
      const enableData = await resEnable.json();
      assert.equal(enableData.mfaEnabled, true);

      // Verify server state
      assert.equal(userObj.mfaEnabled, true);
      assert.equal(userObj.mfaSecret, plainSecret);
      assert.ok(Array.isArray(userObj.backupCodeHashes));
      assert.equal(userObj.backupCodeHashes.length, 8);
    });

    // ========================================================================
    // 6. Re-authentication Requirement on Reconfiguration
    // ========================================================================
    await t.test("Re-configuring already enabled MFA requires reauthentication proof", async () => {
      // User A attempts to call /mfa/setup without password or current TOTP
      const resUnverified = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resUnverified.status, 403, "Reconfiguring MFA without reauthentication must return 403");
      const unverifiedData = await resUnverified.json();
      assert.equal(unverifiedData.code, "REAUTHENTICATION_REQUIRED");

      // User A calls /mfa/setup with valid current TOTP -> succeeds
      const currentCode = defaultMfaEngine.generateCode(plainSecret);
      const resVerified = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ currentTotp: currentCode }),
      });
      assert.equal(resVerified.status, 200, "Reconfiguration with valid proof must succeed");
    });

    // ========================================================================
    // 7. Single-Use Backup Code Invariant
    // ========================================================================
    await t.test("Backup codes are strictly single-use and invalid on second attempt", async () => {
      const firstBackupCode = backupCodesList[0];

      // Simulate second-factor challenge during login
      const userObj = defaultLocalAuthManager.getUser(userA.userId);
      const mfaChallengeToken = `mfa_token_${Date.now()}`;
      userObj.pendingMfaToken = mfaChallengeToken;
      userObj.pendingMfaExpiresAt = Date.now() + 300000;

      // First use of backup code -> succeeds
      const resFirstUse = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaToken: mfaChallengeToken,
          code: firstBackupCode,
          isBackupCode: true,
        }),
      });
      assert.equal(resFirstUse.status, 200, "First use of valid backup code must succeed");
      const firstData = await resFirstUse.json();
      assert.ok(firstData.accessToken, "Must issue token pair");

      // Verify remaining backup code count decreased
      assert.equal(userObj.backupCodeHashes.length, 7, "Consumed backup code must be removed from stored hashes");

      // Simulate a new challenge and attempt to replay the consumed backup code
      const secondChallengeToken = `mfa_token_replay_${Date.now()}`;
      userObj.pendingMfaToken = secondChallengeToken;
      userObj.pendingMfaExpiresAt = Date.now() + 300000;

      const resReplay = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaToken: secondChallengeToken,
          code: firstBackupCode,
          isBackupCode: true,
        }),
      });
      assert.equal(resReplay.status, 401, "Replaying a consumed backup code must be rejected");
    });

    // ========================================================================
    // 8. Secure MFA Reset / Recovery Lifecycle
    // ========================================================================
    await t.test("MFA reset / recovery requires proof of possession or admin authority with audit trail", async () => {
      // A. Anonymous caller cannot reset MFA
      const resAnonReset = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userA.userId }),
      });
      assert.equal(resAnonReset.status, 401, "Anonymous reset must return 401");

      // B. Ordinary user cannot reset another user's MFA
      const resPeerReset = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ userId: victimA.userId }),
      });
      assert.equal(resPeerReset.status, 403, "Ordinary user resetting another user MFA must return 403");

      // C. Cross-tenant admin cannot reset foreign tenant user MFA
      const resCrossAdminReset = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: userB.userId }),
      });
      assert.equal(resCrossAdminReset.status, 403, "Cross-tenant admin MFA reset must return 403");

      // D. User resetting own MFA requires proof of possession (password or backup code)
      const resSelfResetNoProof = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resSelfResetNoProof.status, 403, "Self MFA reset without proof must return 403");
      const proofErr = await resSelfResetNoProof.json();
      assert.equal(proofErr.code, "REAUTHENTICATION_REQUIRED");

      // E. User resetting own MFA with valid password succeeds
      const resSelfResetValid = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ password: userA.password }),
      });
      assert.equal(resSelfResetValid.status, 200, "Self MFA reset with valid password must succeed");
      const resetData = await resSelfResetValid.json();
      assert.equal(resetData.mfaEnabled, false);

      const userObj = defaultLocalAuthManager.getUser(userA.userId);
      assert.equal(userObj.mfaEnabled, false);
      assert.equal(userObj.mfaSecret, undefined);
      assert.equal(userObj.backupCodeHashes.length, 0);

      // F. Authorized administrator resetting tenant user's MFA with audit event
      const resAdminReset = await fetch(`${baseUrl}/api/v1/auth/mfa/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({
          userId: victimA.userId,
          reason: "User lost device; identity verified at service desk",
        }),
      });
      assert.equal(resAdminReset.status, 200, "Admin resetting tenant user MFA must succeed");

      // Verify audit trail for reset
      const resetAudit = defaultAuditService.getEvents({
        tenantId: "tenant-a",
        action: "AUTH_MFA_RESET",
      });
      assert.ok(resetAudit.events.length > 0, "Audit event must be logged for MFA reset");
      const adminResetLog = resetAudit.events.find(
        (e) => e.target?.id === victimA.userId && e.actor?.id === adminA.userId
      );
      assert.ok(adminResetLog, "Admin reset audit log must bind target and actor");
    });
  });
});
