/**
 * Short-Lived Token Service — Phase 14.2
 *
 * Implements short-lived JWT generation, verification, and lifecycle management.
 * Enforces:
 * - Short-lived access tokens (default 15 minutes, max 1 hour)
 * - Refresh Token Rotation (RTR)
 * - Replay & Reuse Detection (revokes token family if old refresh token is reused)
 * - In-memory/persistent token revocation blacklist
 * - Multi-key verification with SecretManager (supports seamless secret rotation)
 * - Audit logging on issuance, refresh, revocation, and replay detection
 */

const crypto = require("crypto");
const { defaultSecretManager } = require("./secret_manager");
const { defaultAuthAuditLogger, AUTH_EVENT_TYPES } = require("./auth_audit");

const DEFAULT_ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const MAX_ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
const DEFAULT_REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

class TokenService {
  constructor(options = {}) {
    this.secretManager = options.secretManager || defaultSecretManager;
    this.auditLogger = options.auditLogger || defaultAuthAuditLogger;
    this.issuer = options.issuer || "https://ecdat.internal/auth";
    this.audience = options.audience || "ecdat-api";
    this.accessTokenTtlSec = Math.min(
      options.accessTokenTtlSec || DEFAULT_ACCESS_TOKEN_TTL_SEC,
      MAX_ACCESS_TOKEN_TTL_SEC
    );
    this.refreshTokenTtlSec = options.refreshTokenTtlSec || DEFAULT_REFRESH_TOKEN_TTL_SEC;

    // Revocation blacklist: Map of jti -> { revokedAt, reason }
    this.revokedTokens = new Map();

    // Global user session revocation: userId -> revokedBeforeTimestamp (seconds)
    this.userRevocations = new Map();

    // Refresh token family store for Refresh Token Rotation (RTR):
    // familyId -> { currentJti, isCompromised, usedJtis: Set<string>, userId }
    this.tokenFamilies = new Map();
  }

  /**
   * Generates a signed JWT with key ID (kid) header.
   */
  signJwt(payload, secretKey, kid, algorithm = "HS256") {
    const header = {
      alg: algorithm,
      typ: "JWT",
      kid,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
      .createHmac("sha256", secretKey)
      .update(signingInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    return `${signingInput}.${signature}`;
  }

  /**
   * Issues a short-lived access token and rotating refresh token.
   */
  issueTokenPair({
    userId,
    email = "",
    name = "",
    roles = ["viewer"],
    provider = "oidc",
    customClaims = {},
    familyId = null,
  }) {
    const now = Math.floor(Date.now() / 1000);
    const activeKey = this.secretManager.getActiveKey("jwt_signing");

    // 1. Access Token (Short-Lived: 15 minutes)
    const accessJti = `acc_${crypto.randomUUID()}`;
    const accessPayload = {
      sub: String(userId),
      email: String(email),
      name: String(name),
      roles: Array.isArray(roles) ? [...roles] : [String(roles)],
      tenantId: (customClaims && customClaims.tenantId) || "default-tenant",
      provider: String(provider),
      jti: accessJti,
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      nbf: now,
      exp: now + this.accessTokenTtlSec,
      token_type: "access",
      ...customClaims,
    };

    const accessToken = this.signJwt(accessPayload, activeKey.secret, activeKey.kid, activeKey.algorithm);

    // 2. Refresh Token with Rotation Tracking
    const refreshJti = `ref_${crypto.randomUUID()}`;
    const finalFamilyId = familyId || `fam_${crypto.randomUUID()}`;

    const refreshPayload = {
      sub: String(userId),
      jti: refreshJti,
      family_id: finalFamilyId,
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      exp: now + this.refreshTokenTtlSec,
      token_type: "refresh",
    };

    const refreshToken = this.signJwt(refreshPayload, activeKey.secret, activeKey.kid, activeKey.algorithm);

    // Register token family for Refresh Token Rotation
    if (!this.tokenFamilies.has(finalFamilyId)) {
      this.tokenFamilies.set(finalFamilyId, {
        currentJti: refreshJti,
        usedJtis: new Set(),
        userId,
        isCompromised: false,
      });
    } else {
      const family = this.tokenFamilies.get(finalFamilyId);
      family.currentJti = refreshJti;
    }

    this.auditLogger.logEvent({
      eventType: AUTH_EVENT_TYPES.TOKEN_ISSUED,
      userId,
      provider,
      status: "SUCCESS",
      metadata: {
        accessJti,
        refreshJti,
        familyId: finalFamilyId,
        expiresInSec: this.accessTokenTtlSec,
        kid: activeKey.kid,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.accessTokenTtlSec,
      jti: accessJti,
      familyId: finalFamilyId,
    };
  }

  /**
   * Verifies and decodes a JWT token. Checks expiration, blacklist, and rotating keys.
   */
  verifyToken(tokenString, expectedType = "access", options = {}) {
    if (!tokenString || typeof tokenString !== "string") {
      throw new Error("Missing or invalid token string");
    }

    const parts = tokenString.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed JWT token");
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(base64UrlDecode(headerB64));
    const payload = JSON.parse(base64UrlDecode(payloadB64));

    // 1. Check token revocation blacklist (unless specifically checking reuse during refresh)
    if (!options.skipRevocationCheck && payload.jti && this.isTokenRevoked(payload.jti)) {
      throw new Error("Token has been revoked");
    }

    // 1.1 Check global user session revocation
    if (!options.skipRevocationCheck && payload.sub && this.isUserSessionRevoked(payload.sub, payload.iat)) {
      throw new Error("User session revoked via global logout");
    }

    // 2. Check token type
    if (expectedType && payload.token_type !== expectedType) {
      throw new Error(`Invalid token type '${payload.token_type}'. Expected '${expectedType}'`);
    }

    // 3. Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) {
      throw new Error("Token has expired");
    }
    if (payload.nbf && now < payload.nbf) {
      throw new Error("Token not yet valid");
    }

    // 4. Verify signature using secret manager (checks active key or retiring keys in grace period)
    const kid = header.kid;
    let keyEntry = kid ? this.secretManager.getKeyByKid(kid, "jwt_signing") : null;
    if (!keyEntry) {
      // Fallback: try active key
      keyEntry = this.secretManager.getActiveKey("jwt_signing");
    }

    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto
      .createHmac("sha256", keyEntry.secret)
      .update(signingInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (!crypto.timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expectedSig))) {
      throw new Error("Invalid token signature");
    }

    return payload;
  }

  /**
   * Rotates a refresh token (RTR). Detects token reuse/replay and revokes the family if detected!
   */
  refreshToken(refreshTokenString, options = {}) {
    const payload = this.verifyToken(refreshTokenString, "refresh", { skipRevocationCheck: true });
    const { jti, family_id, sub } = payload;

    const family = this.tokenFamilies.get(family_id);
    if (!family) {
      throw new Error("Invalid or expired refresh token family");
    }

    // REUSE DETECTION: If this JTI was already used or family compromised, someone is replaying a stolen refresh token!
    if (family.usedJtis.has(jti) || family.isCompromised) {
      family.isCompromised = true;
      // Revoke all tokens in family
      this.revokeToken(jti, "Token family compromised by replay attempt");
      if (family.currentJti) {
        this.revokeToken(family.currentJti, "Family compromised");
      }

      this.auditLogger.logEvent({
        eventType: AUTH_EVENT_TYPES.SUSPICIOUS_REPLAY_DETECTED,
        userId: sub,
        provider: "token_service",
        status: "BLOCKED",
        reason: `Reused refresh token detected for jti '${jti}'. Entire family '${family_id}' revoked!`,
        metadata: { familyId: family_id, attemptedJti: jti },
      });

      throw new Error("Security Alert: Token reuse detected. Session terminated.");
    }

    if (this.isTokenRevoked(jti)) {
      throw new Error("Token has been revoked");
    }

    // Mark current JTI as used
    family.usedJtis.add(jti);
    this.revokeToken(jti, "Rotated to new refresh token");

    // Re-issue new token pair under the same family
    const newPair = this.issueTokenPair({
      userId: sub,
      email: options.email || payload.email,
      name: options.name || payload.name,
      roles: options.roles || payload.roles || ["viewer"],
      provider: options.provider || "oidc",
      familyId: family_id,
    });

    this.auditLogger.logEvent({
      eventType: AUTH_EVENT_TYPES.TOKEN_REFRESHED,
      userId: sub,
      provider: "token_service",
      status: "SUCCESS",
      metadata: { familyId: family_id, oldJti: jti, newJti: newPair.jti },
    });

    return newPair;
  }

  /**
   * Revokes a token by JTI.
   */
  revokeToken(jti, reason = "Explicit revocation") {
    if (!jti) return;
    this.revokedTokens.set(jti, {
      revokedAt: new Date().toISOString(),
      reason,
    });
  }

  /**
   * Revokes all active sessions and tokens for a given user immediately.
   */
  revokeAllUserSessions(userId, reason = "Global user logout") {
    if (!userId) return;
    const now = Math.floor(Date.now() / 1000);
    this.userRevocations.set(String(userId), now);

    this.auditLogger.logEvent({
      eventType: AUTH_EVENT_TYPES.LOGOUT,
      userId: String(userId),
      provider: "token_service",
      status: "SUCCESS",
      reason: `All active sessions revoked: ${reason}`,
      metadata: { revokedBefore: now },
    });
  }

  isUserSessionRevoked(userId, tokenIat) {
    if (!userId || !tokenIat) return false;
    const revokedBefore = this.userRevocations.get(String(userId));
    if (revokedBefore && tokenIat <= revokedBefore) {
      return true;
    }
    return false;
  }

  isTokenRevoked(jti) {
    return this.revokedTokens.has(jti);
  }
}

// Global default singleton instance
const defaultTokenService = new TokenService();

module.exports = {
  TokenService,
  defaultTokenService,
  DEFAULT_ACCESS_TOKEN_TTL_SEC,
  MAX_ACCESS_TOKEN_TTL_SEC,
  base64UrlEncode,
  base64UrlDecode,
};
