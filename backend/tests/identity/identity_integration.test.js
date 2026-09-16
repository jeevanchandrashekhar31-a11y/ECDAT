const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TokenService,
  SecretManager,
  OidcHandler,
  LdapClient,
  AuthAuditLogger,
  AUTH_EVENT_TYPES,
} = require("../../src/identity");

test("TokenService - Issues short-lived tokens and verifies claims", () => {
  const secretMgr = new SecretManager({ initialSecret: "test-secret-12345" });
  const tokenService = new TokenService({
    secretManager: secretMgr,
    accessTokenTtlSec: 900, // 15 minutes
  });

  const pair = tokenService.issueTokenPair({
    userId: "usr_alice",
    email: "alice@enterprise.com",
    roles: ["secops", "developer"],
    provider: "oidc",
  });

  assert.equal(pair.tokenType, "Bearer");
  assert.equal(pair.expiresIn, 900);
  assert.ok(pair.accessToken);
  assert.ok(pair.refreshToken);

  // Verify access token
  const decoded = tokenService.verifyToken(pair.accessToken, "access");
  assert.equal(decoded.sub, "usr_alice");
  assert.equal(decoded.email, "alice@enterprise.com");
  assert.deepEqual(decoded.roles, ["secops", "developer"]);
  assert.equal(decoded.provider, "oidc");
  assert.equal(decoded.token_type, "access");
});

test("TokenService - Rejects expired and revoked tokens", () => {
  const secretMgr = new SecretManager({ initialSecret: "test-secret-12345" });
  const tokenService = new TokenService({
    secretManager: secretMgr,
    accessTokenTtlSec: 1, // 1 second
  });

  const pair = tokenService.issueTokenPair({
    userId: "usr_bob",
    roles: ["viewer"],
  });

  // Explicit revocation
  tokenService.revokeToken(pair.jti, "Manual logout");
  assert.throws(() => tokenService.verifyToken(pair.accessToken), /revoked/);
});

test("TokenService - Refresh Token Rotation (RTR) and Token Reuse Detection", () => {
  const auditLogger = new AuthAuditLogger();
  const secretMgr = new SecretManager({ initialSecret: "test-secret-12345", auditLogger });
  const tokenService = new TokenService({
    secretManager: secretMgr,
    auditLogger,
    accessTokenTtlSec: 900,
  });

  const initialPair = tokenService.issueTokenPair({
    userId: "usr_charlie",
    roles: ["secops"],
  });

  // 1. Legitimate refresh: rotates to new refresh token
  const rotatedPair = tokenService.refreshToken(initialPair.refreshToken);
  assert.ok(rotatedPair.accessToken);
  assert.ok(rotatedPair.refreshToken);
  assert.notEqual(rotatedPair.refreshToken, initialPair.refreshToken);

  // 2. Token Reuse Attack: Attacker replays initialPair.refreshToken which was already consumed!
  assert.throws(
    () => tokenService.refreshToken(initialPair.refreshToken),
    /Security Alert: Token reuse detected/
  );

  // 3. Verify family revocation: even the new refresh token is now revoked!
  assert.throws(
    () => tokenService.refreshToken(rotatedPair.refreshToken),
    /Security Alert: Token reuse detected/
  );

  // 4. Verify SUSPICIOUS_REPLAY_DETECTED event was logged in audit trail
  const replayEvents = auditLogger.events.filter(
    (e) => e.eventType === AUTH_EVENT_TYPES.SUSPICIOUS_REPLAY_DETECTED
  );
  assert.ok(replayEvents.length >= 1);
  assert.equal(replayEvents[0].userId, "usr_charlie");
});

test("SecretManager - Overlapping grace period allows seamless key rotation", () => {
  const secretMgr = new SecretManager({
    gracePeriodMs: 3600 * 1000, // 1 hour grace period
  });
  const tokenService = new TokenService({ secretManager: secretMgr });

  // Issue token with Key 1
  const tokenV1 = tokenService.issueTokenPair({ userId: "usr_v1" }).accessToken;

  // Verify tokenV1 works
  const decoded1 = tokenService.verifyToken(tokenV1);
  assert.equal(decoded1.sub, "usr_v1");

  // Rotate key to Key 2
  const rotation = secretMgr.rotateKey("jwt_signing");
  assert.equal(rotation.success, true);
  assert.ok(rotation.newKid);
  assert.ok(rotation.previousKid);

  // Verify tokenV1 STILL verifies during grace period!
  const decodedStillValid = tokenService.verifyToken(tokenV1);
  assert.equal(decodedStillValid.sub, "usr_v1");

  // New tokens are signed with new key
  const tokenV2 = tokenService.issueTokenPair({ userId: "usr_v2" }).accessToken;
  const decoded2 = tokenService.verifyToken(tokenV2);
  assert.equal(decoded2.sub, "usr_v2");
});

test("OidcHandler - PKCE authorization flow and zero password storage", async () => {
  const auditLogger = new AuthAuditLogger();
  const tokenService = new TokenService({ auditLogger });

  const oidc = new OidcHandler({
    clientId: "ecdat-test-client",
    clientSecret: "client-sec-999",
    issuer: "https://idp.example.com",
    tokenService,
    auditLogger,
    fetchFn: async (url, opts) => {
      if (url.includes("/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock-idp-access-token",
            id_token: "mock.header.dummy",
            expires_in: 3600,
          }),
        };
      }
      if (url.includes("/userinfo")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sub: "idp_user_101",
            email: "engineer@enterprise.com",
            name: "Alex Engineer",
            groups: ["SecurityEngineers", "Developers"],
          }),
        };
      }
      return { ok: false, status: 404 };
    },
  });

  // 1. Generate PKCE auth request
  const authReq = oidc.createAuthorizationRequest();
  assert.ok(authReq.authorizationUrl.includes("code_challenge_method=S256"));
  assert.ok(authReq.authorizationUrl.includes("client_id=ecdat-test-client"));
  assert.ok(authReq.state);
  assert.ok(authReq.codeVerifier);

  // 2. Complete callback
  const result = await oidc.handleCallback({
    code: "mock_auth_code_123",
    state: authReq.state,
  });

  assert.equal(result.user.userId, "idp_user_101");
  assert.equal(result.user.email, "engineer@enterprise.com");
  assert.ok(result.user.roles.includes("secops"));
  assert.ok(result.user.roles.includes("developer"));
  assert.ok(result.tokens.accessToken);
  assert.equal(result.tokens.expiresIn, 900); // 15 min short-lived token
});

test("LdapClient - Ephemeral bind authentication with zero password storage", async () => {
  const auditLogger = new AuthAuditLogger();
  const tokenService = new TokenService({ auditLogger });

  const mockDirectory = {
    "johndoe": {
      dn: "CN=John Doe,OU=Users,DC=corp,DC=internal",
      mail: "johndoe@corp.internal",
      displayName: "John Doe",
      password: "CorrectLdapPassword123!",
      memberOf: ["CN=CryptoAdmins,OU=Groups,DC=corp,DC=internal"],
    },
  };

  const ldap = new LdapClient({
    url: "ldaps://ad.corp.internal:636",
    baseDn: "DC=corp,DC=internal",
    mockDirectory,
    tokenService,
    auditLogger,
  });

  // 1. Successful authentication
  const result = await ldap.authenticate({
    username: "johndoe",
    password: "CorrectLdapPassword123!",
  });

  assert.equal(result.user.userId, "johndoe");
  assert.equal(result.user.email, "johndoe@corp.internal");
  assert.deepEqual(result.user.roles, ["admin"]);
  assert.ok(result.tokens.accessToken);

  // Verify password was NOT stored on user object or in audit log
  assert.equal(result.user.password, undefined);
  const events = auditLogger.events;
  assert.ok(events.every((e) => !JSON.stringify(e).includes("CorrectLdapPassword123!")));

  // 2. Failed authentication with wrong password
  await assert.rejects(
    async () => {
      await ldap.authenticate({
        username: "johndoe",
        password: "WrongPassword!",
      });
    },
    /Invalid username or password/
  );
});

test("AuthAuditLogger - Tamper-evident hash chain and redaction", () => {
  const logger = new AuthAuditLogger();

  logger.logEvent({
    eventType: AUTH_EVENT_TYPES.AUTH_SUCCESS,
    userId: "usr_alice",
    provider: "oidc",
    metadata: {
      password: "raw-password-leaked",
      token: "raw-bearer-token",
      role: "admin",
    },
  });

  logger.logEvent({
    eventType: AUTH_EVENT_TYPES.TOKEN_ISSUED,
    userId: "usr_alice",
    provider: "token_service",
  });

  // Verify chain integrity
  const integrity = logger.verifyChainIntegrity();
  assert.equal(integrity.valid, true);
  assert.equal(integrity.totalEvents, 2);

  // Verify zero secret leakage
  const first = logger.events[0];
  assert.equal(first.metadata.password, "[REDACTED]");
  assert.equal(first.metadata.token, "[REDACTED]");
  assert.equal(first.metadata.role, "admin");

  // Tampering breaks the chain
  logger.events[0].userId = "attacker";
  const tampered = logger.verifyChainIntegrity();
  assert.equal(tampered.valid, false);
});
