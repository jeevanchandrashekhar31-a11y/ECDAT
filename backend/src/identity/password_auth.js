/**
 * Secure Password Policy & Local Authentication Manager — Phase 15.2
 *
 * Implements:
 * - NIST SP 800-63B compliant password policy
 * - Modern memory-hard key derivation via scrypt (RFC 7914)
 * - Timing-safe password verification
 * - Brute-force protection & account lockout
 * - In-memory/persisted credential store with failed attempt counters
 */

const crypto = require("crypto");
const { defaultAuthAuditLogger, AUTH_EVENT_TYPES } = require("./auth_audit");

// Extended event types
const EXTENDED_AUTH_EVENT_TYPES = {
  ...AUTH_EVENT_TYPES,
  AUTH_ACCOUNT_LOCKED: "AUTH_ACCOUNT_LOCKED",
  AUTH_MFA_CHALLENGE: "AUTH_MFA_CHALLENGE",
  AUTH_MFA_SUCCESS: "AUTH_MFA_SUCCESS",
  AUTH_MFA_FAILURE: "AUTH_MFA_FAILURE",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
};

// Common weak / dictionary passwords to prohibit
const COMMON_PASSWORDS_BLACKLIST = new Set([
  "password123!",
  "password1234",
  "admin2026!#",
  "welcome12345",
  "qwerty123456",
  "letmein2026!",
  "iloveyou1234",
  "changeme1234",
  "enterprise123",
  "secret123456",
]);

class PasswordPolicyError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.name = "PasswordPolicyError";
    this.violations = violations;
  }
}

class AccountLockedError extends Error {
  constructor(message, unlockTime = null) {
    super(message);
    this.name = "AccountLockedError";
    this.unlockTime = unlockTime;
  }
}

class PasswordPolicy {
  /**
   * @param {Object} [options]
   * @param {number} [options.minLength=12] - Minimum 12 characters (NIST SP 800-63B)
   * @param {number} [options.maxLength=128]
   * @param {boolean} [options.requireUppercase=true]
   * @param {boolean} [options.requireLowercase=true]
   * @param {boolean} [options.requireNumbers=true]
   * @param {boolean} [options.requireSpecial=true]
   */
  constructor({
    minLength = 12,
    maxLength = 128,
    requireUppercase = true,
    requireLowercase = true,
    requireNumbers = true,
    requireSpecial = true,
  } = {}) {
    this.minLength = minLength;
    this.maxLength = maxLength;
    this.requireUppercase = requireUppercase;
    this.requireLowercase = requireLowercase;
    this.requireNumbers = requireNumbers;
    this.requireSpecial = requireSpecial;
  }

  /**
   * Validates a password against complexity rules, dictionary blacklist, and user context.
   */
  validate(password, { username = "", email = "" } = {}) {
    const violations = [];

    if (!password || typeof password !== "string") {
      throw new PasswordPolicyError("Password must be a non-empty string", ["missing_password"]);
    }

    if (password.length < this.minLength) {
      violations.push(`Password must be at least ${this.minLength} characters long`);
    }

    if (password.length > this.maxLength) {
      violations.push(`Password must not exceed ${this.maxLength} characters`);
    }

    if (this.requireUppercase && !/[A-Z]/.test(password)) {
      violations.push("Password must contain at least one uppercase letter (A-Z)");
    }

    if (this.requireLowercase && !/[a-z]/.test(password)) {
      violations.push("Password must contain at least one lowercase letter (a-z)");
    }

    if (this.requireNumbers && !/[0-9]/.test(password)) {
      violations.push("Password must contain at least one numeral (0-9)");
    }

    if (this.requireSpecial && !/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) {
      violations.push("Password must contain at least one special character");
    }

    // Check against common blacklist
    const normalized = password.toLowerCase();
    if (COMMON_PASSWORDS_BLACKLIST.has(normalized)) {
      violations.push("Password matches a known vulnerable or common dictionary password");
    }

    // Disallow username / email substring
    if (username && username.length >= 4 && normalized.includes(username.toLowerCase())) {
      violations.push("Password must not contain the username");
    }

    if (email && email.includes("@")) {
      const localPart = email.split("@")[0].toLowerCase();
      if (localPart.length >= 4 && normalized.includes(localPart)) {
        violations.push("Password must not contain the email address local part");
      }
    }

    if (violations.length > 0) {
      throw new PasswordPolicyError("Password does not meet enterprise security requirements", violations);
    }

    return { valid: true };
  }

  /**
   * Cryptographically hashes a password using memory-hard scrypt (RFC 7914).
   * Format: $scrypt$N=16384,r=8,p=1$<salt_hex>$<hash_hex>
   */
  hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const N = 16384;
    const r = 8;
    const p = 1;
    const keyLen = 64;

    const hash = crypto.scryptSync(password, salt, keyLen, { N, r, p });
    return `$scrypt$N=${N},r=${r},p=${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
  }

  /**
   * Verifies a password against a stored scrypt hash using timing-safe comparison.
   */
  verifyPassword(password, storedHash) {
    if (!password || !storedHash || typeof storedHash !== "string") return false;

    try {
      const parts = storedHash.split("$");
      // Format: ["", "scrypt", "N=16384,r=8,p=1", "<salt>", "<hash>"]
      if (parts.length !== 5 || parts[1] !== "scrypt") {
        return false;
      }

      const params = parts[2].split(",").reduce((acc, curr) => {
        const [k, v] = curr.split("=");
        acc[k] = parseInt(v, 10);
        return acc;
      }, {});

      const salt = Buffer.from(parts[3], "hex");
      const expectedHash = Buffer.from(parts[4], "hex");

      const derived = crypto.scryptSync(password, salt, expectedHash.length, {
        N: params.N || 16384,
        r: params.r || 8,
        p: params.p || 1,
      });

      return crypto.timingSafeEqual(derived, expectedHash);
    } catch {
      return false;
    }
  }
}

class LocalAuthManager {
  /**
   * @param {Object} [options]
   * @param {PasswordPolicy} [options.policy]
   * @param {number} [options.maxFailedAttempts=5] - Consecutive failed attempts before lockout
   * @param {number} [options.lockoutDurationMs=15*60*1000] - 15 minutes lockout duration
   * @param {Object} [options.auditLogger]
   */
  constructor({
    policy = new PasswordPolicy(),
    maxFailedAttempts = 5,
    lockoutDurationMs = 15 * 60 * 1000,
    auditLogger = defaultAuthAuditLogger,
  } = {}) {
    this.policy = policy;
    this.maxFailedAttempts = maxFailedAttempts;
    this.lockoutDurationMs = lockoutDurationMs;
    this.auditLogger = auditLogger;

    // In-memory store: username -> userRecord
    this.users = new Map();
  }

  /**
   * Registers a local user with strict password validation and scrypt hashing.
   */
  registerUser({
    username,
    email,
    password,
    roles = ["viewer"],
    tenantId = "default-tenant",
  }) {
    if (!username || typeof username !== "string") {
      throw new Error("Username is required");
    }
    if (!email || typeof email !== "string") {
      throw new Error("Email is required");
    }

    const normUser = username.trim().toLowerCase();
    if (this.users.has(normUser)) {
      throw new Error(`Username '${username}' already exists`);
    }

    // 1. Enforce password policy
    this.policy.validate(password, { username: normUser, email });

    // 2. Hash password with scrypt
    const passwordHash = this.policy.hashPassword(password);
    const userId = `usr_${crypto.randomUUID()}`;

    const userRecord = {
      userId,
      username: normUser,
      email: email.trim().toLowerCase(),
      passwordHash,
      roles: Array.isArray(roles) ? [...roles] : [roles],
      tenantId,
      failedAttempts: 0,
      lockedUntil: null,
      mfaEnabled: false,
      mfaSecret: null,
      backupCodeHashes: [],
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };

    this.users.set(normUser, userRecord);
    return {
      userId: userRecord.userId,
      username: userRecord.username,
      email: userRecord.email,
      roles: userRecord.roles,
      tenantId: userRecord.tenantId,
    };
  }

  /**
   * Authenticates user credentials with brute-force protection and lockout.
   */
  authenticate({ username, password, ip = "127.0.0.1" }) {
    const normUser = String(username || "").trim().toLowerCase();
    const user = this.users.get(normUser);

    if (!user) {
      // Execute dummy scrypt hash to prevent timing attack on user enumeration
      crypto.scryptSync("dummy_password_timing", Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex"), 64, {
        N: 1024,
        r: 8,
        p: 1,
      });

      this.auditLogger.logEvent({
        eventType: AUTH_EVENT_TYPES.AUTH_FAILURE,
        userId: normUser || "unknown",
        provider: "local_auth",
        status: "FAILURE",
        reason: "Invalid username or password",
        ipAddress: ip,
      });

      throw new Error("Invalid username or password");
    }

    // Check account lockout
    const now = Date.now();
    if (user.lockedUntil && now < user.lockedUntil) {
      const remainingSec = Math.ceil((user.lockedUntil - now) / 1000);
      throw new AccountLockedError(
        `Account is locked due to too many failed attempts. Please retry in ${remainingSec} seconds.`,
        new Date(user.lockedUntil).toISOString()
      );
    }

    // Reset lock if lockout duration expired
    if (user.lockedUntil && now >= user.lockedUntil) {
      user.lockedUntil = null;
      user.failedAttempts = 0;
    }

    // Verify password
    const valid = this.policy.verifyPassword(password, user.passwordHash);

    if (!valid) {
      user.failedAttempts += 1;

      if (user.failedAttempts >= this.maxFailedAttempts) {
        user.lockedUntil = Date.now() + this.lockoutDurationMs;

        this.auditLogger.logEvent({
          eventType: EXTENDED_AUTH_EVENT_TYPES.AUTH_ACCOUNT_LOCKED,
          userId: user.userId,
          provider: "local_auth",
          status: "BLOCKED",
          reason: `Account locked for ${this.lockoutDurationMs / 1000}s after ${user.failedAttempts} consecutive failed attempts`,
          ipAddress: ip,
        });

        throw new AccountLockedError(
          `Account locked after ${this.maxFailedAttempts} failed attempts. Lockout period: 15 minutes.`,
          new Date(user.lockedUntil).toISOString()
        );
      }

      this.auditLogger.logEvent({
        eventType: AUTH_EVENT_TYPES.AUTH_FAILURE,
        userId: user.userId,
        provider: "local_auth",
        status: "FAILURE",
        reason: `Invalid password. Attempt ${user.failedAttempts} of ${this.maxFailedAttempts}`,
        ipAddress: ip,
      });

      throw new Error("Invalid username or password");
    }

    // Success: reset failures
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date().toISOString();

    // Check if MFA is required
    if (user.mfaEnabled) {
      const mfaToken = crypto.randomBytes(32).toString("hex");
      user.pendingMfaToken = mfaToken;
      user.pendingMfaExpiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

      this.auditLogger.logEvent({
        eventType: EXTENDED_AUTH_EVENT_TYPES.AUTH_MFA_CHALLENGE,
        userId: user.userId,
        provider: "local_auth",
        status: "CHALLENGE",
        ipAddress: ip,
      });

      return {
        mfaRequired: true,
        mfaToken,
        userId: user.userId,
        username: user.username,
      };
    }

    this.auditLogger.logEvent({
      eventType: AUTH_EVENT_TYPES.AUTH_SUCCESS,
      userId: user.userId,
      provider: "local_auth",
      status: "SUCCESS",
      ipAddress: ip,
    });

    return {
      mfaRequired: false,
      user: {
        userId: user.userId,
        username: user.username,
        email: user.email,
        roles: user.roles,
        tenantId: user.tenantId,
      },
    };
  }

  getUser(usernameOrId) {
    const norm = String(usernameOrId).toLowerCase();
    for (const u of this.users.values()) {
      if (u.username === norm || u.userId === usernameOrId) {
        return u;
      }
    }
    return null;
  }

  verifyPassword(user, candidatePassword) {
    if (!user || !user.passwordHash || !candidatePassword) return false;
    return this.policy.verifyPassword(candidatePassword, user.passwordHash);
  }
}

const defaultLocalAuthManager = new LocalAuthManager();

module.exports = {
  PasswordPolicy,
  PasswordPolicyError,
  AccountLockedError,
  LocalAuthManager,
  defaultLocalAuthManager,
  EXTENDED_AUTH_EVENT_TYPES,
  COMMON_PASSWORDS_BLACKLIST,
};
