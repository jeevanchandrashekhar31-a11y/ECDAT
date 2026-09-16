const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PasswordPolicy,
  PasswordPolicyError,
  AccountLockedError,
  LocalAuthManager,
  MfaTotpEngine,
  base32Encode,
  base32Decode,
  TokenService,
  SecretManager,
} = require("../../src/identity");

test("PasswordPolicy - NIST SP 800-63B validation and blacklist checks", () => {
  const policy = new PasswordPolicy({ minLength: 12 });

  // Valid password
  const validRes = policy.validate("Enterprise-Agile-PQC#2026!");
  assert.equal(validRes.valid, true);

  // Too short (< 12 chars)
  assert.throws(
    () => policy.validate("Short1!Aa"),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("at least 12"))
  );

  // Missing special characters
  assert.throws(
    () => policy.validate("NoSpecialChars123456"),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("special character"))
  );

  // Missing numbers
  assert.throws(
    () => policy.validate("NoNumbersHere!@#ABCdef"),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("numeral"))
  );

  // Common dictionary blacklist
  assert.throws(
    () => policy.validate("password123!"),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("vulnerable or common dictionary"))
  );

  // Contains username
  assert.throws(
    () => policy.validate("SecretAdmin12345!#", { username: "admin" }),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("username"))
  );

  // Contains email localpart
  assert.throws(
    () => policy.validate("SecretCharlie1234!#", { email: "charlie@enterprise.internal" }),
    (err) => err instanceof PasswordPolicyError && err.violations.some((v) => v.includes("email address local part"))
  );
});

test("PasswordPolicy - Memory-hard scrypt hashing & timing-safe verification", () => {
  const policy = new PasswordPolicy();
  const password = "Quantum-Safe-Passphrase#2026";
  const hash = policy.hashPassword(password);

  assert.ok(hash.startsWith("$scrypt$N=16384,r=8,p=1$"));
  assert.equal(policy.verifyPassword(password, hash), true);
  assert.equal(policy.verifyPassword("WrongPassword123!", hash), false);
  assert.equal(policy.verifyPassword("", hash), false);
  assert.equal(policy.verifyPassword(password, "invalid_hash_string"), false);
});

test("LocalAuthManager - Registration, authentication, and brute-force lockout", () => {
  const authMgr = new LocalAuthManager({
    maxFailedAttempts: 3,
    lockoutDurationMs: 60 * 1000,
  });

  // 1. User Registration
  const registered = authMgr.registerUser({
    username: "dev_dave",
    email: "dave@enterprise.internal",
    password: "Correct-Horse-Battery-2026!",
    roles: ["developer"],
  });
  assert.equal(registered.username, "dev_dave");
  assert.deepEqual(registered.roles, ["developer"]);

  // Duplicate registration rejected
  assert.throws(
    () =>
      authMgr.registerUser({
        username: "dev_dave",
        email: "dave2@corp.internal",
        password: "Other-Pass-2026!",
      }),
    /already exists/
  );

  // 2. Successful Login
  const success = authMgr.authenticate({ username: "dev_dave", password: "Correct-Horse-Battery-2026!" });
  assert.equal(success.mfaRequired, false);
  assert.equal(success.user.username, "dev_dave");

  // 3. Brute Force Protection (3 failed attempts -> AccountLockedError)
  assert.throws(() => authMgr.authenticate({ username: "dev_dave", password: "BadPassword1!" }), /Invalid username/);
  assert.throws(() => authMgr.authenticate({ username: "dev_dave", password: "BadPassword2!" }), /Invalid username/);

  // 3rd failure locks the account
  assert.throws(
    () => authMgr.authenticate({ username: "dev_dave", password: "BadPassword3!" }),
    (err) => err instanceof AccountLockedError && err.message.includes("Account locked after 3 failed attempts")
  );

  // Even correct password is now blocked until lockout expires
  assert.throws(
    () => authMgr.authenticate({ username: "dev_dave", password: "Correct-Horse-Battery-2026!" }),
    (err) => err instanceof AccountLockedError
  );

  // Unknown username fails gracefully
  assert.throws(
    () => authMgr.authenticate({ username: "unknown_user", password: "AnyPassword123!" }),
    /Invalid username/
  );
});

test("MfaTotpEngine - RFC 6238 TOTP, Base32, and Single-Use Backup Codes", () => {
  const mfa = new MfaTotpEngine({ stepSeconds: 30, digits: 6, algorithm: "sha1" });

  // 1. Base32 Roundtrip
  const testBuf = Buffer.from("ECDAT-SECURITY-2026");
  const b32 = base32Encode(testBuf);
  const decoded = base32Decode(b32);
  assert.deepEqual(decoded, testBuf);

  // 2. Secret Generation & otpauth URI
  const setup = mfa.generateSecret({ accountName: "dave@enterprise.internal" });
  assert.ok(setup.secret.length >= 16);
  assert.ok(setup.otpAuthUri.includes("otpauth://totp/ECDAT:dave%40enterprise.internal"));

  // 3. TOTP Generation & Verification
  const now = Date.now();
  const code = mfa.generateCode(setup.secret, now);
  assert.equal(code.length, 6);
  assert.ok(/^\d{6}$/.test(code));

  assert.equal(mfa.verifyCode(setup.secret, code, { window: 1, timestamp: now }), true);
  assert.equal(mfa.verifyCode(setup.secret, "000000", { window: 1, timestamp: now }), false);

  // Window tolerance (+- 1 step)
  assert.equal(mfa.verifyCode(setup.secret, code, { window: 1, timestamp: now + 28 * 1000 }), true);

  // 4. Single-Use Backup Codes
  const { plainCodes, hashedCodes } = mfa.generateBackupCodes(4);
  assert.equal(plainCodes.length, 4);
  assert.equal(hashedCodes.length, 4);

  const testCode = plainCodes[0];
  const firstUse = mfa.verifyAndConsumeBackupCode(testCode, hashedCodes);
  assert.equal(firstUse.valid, true);
  assert.equal(firstUse.remainingHashes.length, 3);

  // Second use of consumed backup code fails
  const secondUse = mfa.verifyAndConsumeBackupCode(testCode, firstUse.remainingHashes);
  assert.equal(secondUse.valid, false);
  assert.equal(secondUse.remainingHashes.length, 3);
});

test("TokenService - Global multi-device session revocation invalidates prior tokens", () => {
  const secretMgr = new SecretManager({ initialSecret: "test-secret-key-123456" });
  const tokenService = new TokenService({ secretManager: secretMgr });

  const tokenPair1 = tokenService.issueTokenPair({
    userId: "usr_multi_device_user",
    roles: ["analyst"],
  });

  // Token is valid initially
  const payloadBefore = tokenService.verifyToken(tokenPair1.accessToken, "access");
  assert.equal(payloadBefore.sub, "usr_multi_device_user");

  // Global logout / revocation across all devices
  tokenService.revokeAllUserSessions("usr_multi_device_user", "User initiated global logout");

  // Token issued prior to revocation cutoff is rejected
  assert.throws(
    () => tokenService.verifyToken(tokenPair1.accessToken, "access"),
    /revoked via global logout/
  );
});
