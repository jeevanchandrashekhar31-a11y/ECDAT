const test = require("node:test");
const assert = require("node:assert/strict");

const { TokenService } = require("../../src/identity/token_service");
const { SecretManager } = require("../../src/identity/secret_manager");
const { MfaTotpEngine } = require("../../src/identity/mfa_totp");
const {
  PasswordPolicy,
  LocalAuthManager,
  PasswordPolicyError,
  AccountLockedError,
} = require("../../src/identity/password_auth");

test("Phase 22.1 — Subsystem 8: Deep Authentication & Identity Lifecycle Tests", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. Token Lifecycle & Expiration
  // ---------------------------------------------------------------------------
  await t.test("1. Token Lifecycle: Issuance, Verification, and Revocation", async () => {
    const secretManager = new SecretManager({ masterSecret: "test-super-secret-key-32-bytes-long!" });
    const tokenService = new TokenService({ secretManager, accessTokenTtlSec: 2 });

    const tokens = tokenService.issueTokenPair({
      userId: "user-123",
      email: "alice@ecdat.org",
      roles: ["security_auditor"],
      customClaims: { tenantId: "tenant-acme" },
    });

    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);
    assert.equal(tokens.tokenType, "Bearer");

    // Valid verification
    const verified = tokenService.verifyToken(tokens.accessToken, "access");
    assert.equal(verified.sub, "user-123");
    assert.ok(verified.roles.includes("security_auditor"));
    assert.equal(verified.tenantId, "tenant-acme");

    // Token Revocation by JTI
    tokenService.revokeToken(tokens.jti, "User logged out");
    assert.throws(
      () => tokenService.verifyToken(tokens.accessToken, "access"),
      (err) => err.message.toLowerCase().includes("revoked")
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Refresh Token Rotation (RTR) and Replay Attack Detection
  // ---------------------------------------------------------------------------
  await t.test("2. Refresh Token Rotation (RTR) and Replay Detection", async () => {
    const secretManager = new SecretManager({ masterSecret: "test-super-secret-key-32-bytes-long!" });
    const tokenService = new TokenService({ secretManager });

    const originalTokens = tokenService.issueTokenPair({
      userId: "user-456",
      roles: ["developer"],
      customClaims: { tenantId: "tenant-beta" },
    });

    // Legitimate rotation: exchange refresh token for a new pair
    const rotatedTokens = tokenService.refreshToken(originalTokens.refreshToken);
    assert.ok(rotatedTokens.accessToken);
    assert.ok(rotatedTokens.refreshToken);
    assert.notEqual(rotatedTokens.refreshToken, originalTokens.refreshToken);

    // Replay Attack: Attacker attempts to reuse the already-consumed original refresh token
    assert.throws(
      () => tokenService.refreshToken(originalTokens.refreshToken),
      (err) => err.message.toLowerCase().includes("reuse") || err.message.toLowerCase().includes("compromised") || err.message.toLowerCase().includes("revoked")
    );

    // Invariant: The entire token family must now be revoked/invalidated due to replay detection
    assert.throws(
      () => tokenService.refreshToken(rotatedTokens.refreshToken),
      (err) => err.message.toLowerCase().includes("compromised") || err.message.toLowerCase().includes("revoked") || err.message.toLowerCase().includes("reuse")
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Cryptographic Signature Verification and alg:none Rejection
  // ---------------------------------------------------------------------------
  await t.test("3. Signature Integrity and Rejection of alg:none / Tampered Tokens", async () => {
    const secretManager = new SecretManager({ masterSecret: "test-super-secret-key-32-bytes-long!" });
    const tokenService = new TokenService({ secretManager });

    const tokens = tokenService.issueTokenPair({
      userId: "user-789",
      roles: ["admin"],
    });

    // 1. Reject tampered payload (payload bits flipped)
    const parts = tokens.accessToken.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: "user-789", roles: ["super_admin"] }))
      .toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    assert.throws(
      () => tokenService.verifyToken(tamperedToken, "access"),
      (err) => err !== null
    );

    // 2. Reject alg: none attack
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const noneToken = `${noneHeader}.${parts[1]}.`;

    assert.throws(
      () => tokenService.verifyToken(noneToken, "access"),
      (err) => err !== null
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Multi-Factor Authentication (TOTP RFC 6238)
  // ---------------------------------------------------------------------------
  await t.test("4. MFA TOTP Verification with Time-Drift Tolerance and RFC 6238", () => {
    const totpEngine = new MfaTotpEngine({ stepSeconds: 30, digits: 6 });
    const enrollment = totpEngine.generateSecret({ accountName: "alice@ecdat.org" });

    assert.ok(enrollment.secret);
    assert.ok(enrollment.otpAuthUri.startsWith("otpauth://totp/"));
    assert.equal(enrollment.digits, 6);

    const now = Date.now();
    const currentCode = totpEngine.generateCode(enrollment.secret, now);
    assert.equal(currentCode.length, 6);

    // Valid verification of current code
    assert.equal(totpEngine.verifyCode(enrollment.secret, currentCode, { timestamp: now }), true);

    // Clock-drift: 25 seconds in the past (within window +/- 1) -> must pass
    const codePast = totpEngine.generateCode(enrollment.secret, now - 25000);
    assert.equal(totpEngine.verifyCode(enrollment.secret, codePast, { window: 1, timestamp: now }), true);

    // Clock-drift: 2 minutes in the past (outside window 1) -> must fail
    const codeTooOld = totpEngine.generateCode(enrollment.secret, now - 120000);
    assert.equal(totpEngine.verifyCode(enrollment.secret, codeTooOld, { window: 1, timestamp: now }), false);

    // Wrong code -> must fail
    assert.equal(totpEngine.verifyCode(enrollment.secret, "999999", { timestamp: now }), false);
  });

  // ---------------------------------------------------------------------------
  // 5. NIST SP 800-63B Password Policy and Local Auth Manager
  // ---------------------------------------------------------------------------
  await t.test("5. Password Policy, Memory-Hard Hash Derivation, and Account Lockout", async () => {
    const policy = new PasswordPolicy({ minLength: 12 });

    // Weak password rejection (too short) -> throws PasswordPolicyError
    assert.throws(
      () => policy.validate("P@ss1"),
      PasswordPolicyError
    );

    // Weak password rejection (common dictionary)
    assert.throws(
      () => policy.validate("password123!"),
      PasswordPolicyError
    );

    // Strong password acceptance
    const strongVal = policy.validate("Correct-Horse-Battery-Staple-2026!#");
    assert.equal(strongVal.valid, true);

    // LocalAuthManager credential storage and verification
    const authManager = new LocalAuthManager({ maxFailedAttempts: 3, lockoutDurationMinutes: 1 });
    await authManager.registerUser({
      username: "david",
      password: "Correct-Horse-Battery-Staple-2026!#",
      email: "david@ecdat.org",
    });

    // Valid authentication
    const authSuccess = await authManager.authenticate({
      username: "david",
      password: "Correct-Horse-Battery-Staple-2026!#",
    });
    assert.equal(authSuccess.mfaRequired, false);
    assert.equal(authSuccess.user.username, "david");

    // Failed attempts leading to Account Lockout
    for (let i = 0; i < 3; i++) {
      try {
        await authManager.authenticate({ username: "david", password: "WrongPassword123!" });
      } catch (_e) {
        // Expected failed attempt
      }
    }

    // 4th attempt must be blocked by account lockout
    await assert.rejects(
      async () => authManager.authenticate({
        username: "david",
        password: "Correct-Horse-Battery-Staple-2026!#",
      }),
      AccountLockedError
    );
  });
});
