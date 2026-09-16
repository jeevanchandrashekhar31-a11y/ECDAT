const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  defaultTokenService,
  defaultSecretManager,
  defaultAuthAuditLogger,
  LdapClient,
} = require("../../src/identity");
const { ldapClient } = require("../../src/routes/auth");

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.ECDAT_API_KEY,
};

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

test("Auth API - GET /api/v1/auth/oidc/login returns PKCE auth URL", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/oidc/login?scope=openid email`, {
      method: "GET",
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.authorizationUrl.includes("code_challenge_method=S256"));
    assert.ok(data.state);
    assert.ok(data.codeVerifier);
  });
});

test("Auth API - POST /api/v1/auth/ldap/login authenticates via ephemeral bind and issues short-lived token", async () => {
  // Configure mock directory on router's ldap client
  ldapClient.mockDirectory = {
    "alice_secops": {
      displayName: "Alice SecOps",
      mail: "alice@corp.internal",
      password: "StrongLdapPass2026!",
      memberOf: ["CN=SecOps,OU=Groups,DC=corp,DC=internal"],
    },
  };

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/auth/ldap/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "alice_secops",
        password: "StrongLdapPass2026!",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.userId, "alice_secops");
    assert.deepEqual(data.user.roles, ["secops"]);
    assert.ok(data.tokens.accessToken);
    assert.equal(data.tokens.expiresIn, 900); // 15 min short-lived token

    // Test GET /api/v1/auth/me with Bearer token!
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${data.tokens.accessToken}`,
      },
    });

    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.authenticated, true);
    assert.equal(meData.mode, "jwt");
    assert.equal(meData.user.sub, "alice_secops");
    assert.deepEqual(meData.roles, ["secops"]);
  });
});

test("Auth API - POST /api/v1/auth/token/refresh performs RTR and POST /token/revoke revokes token", async () => {
  const tokenPair = defaultTokenService.issueTokenPair({
    userId: "usr_refresh_test",
    roles: ["developer"],
  });

  await withServer(async (baseUrl) => {
    // 1. Refresh token
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: tokenPair.refreshToken,
      }),
    });

    assert.equal(refreshRes.status, 200);
    const refreshed = await refreshRes.json();
    assert.ok(refreshed.accessToken);
    assert.ok(refreshed.refreshToken);
    assert.notEqual(refreshed.refreshToken, tokenPair.refreshToken);

    // 2. Revoke token
    const revokeRes = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jti: refreshed.jti,
        reason: "User signed out",
      }),
    });

    assert.equal(revokeRes.status, 200);
    const revokeData = await revokeRes.json();
    assert.equal(revokeData.success, true);
  });
});

test("Auth API - POST /api/v1/auth/secrets/rotate rotates keys and GET /audit verifies integrity", async () => {
  await withServer(async (baseUrl) => {
    // Rotate key
    const rotateRes = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        keyType: "jwt_signing",
      }),
    });

    assert.equal(rotateRes.status, 200);
    const rotateData = await rotateRes.json();
    assert.equal(rotateData.success, true);
    assert.ok(rotateData.newKid);

    // Get audit log
    const auditRes = await fetch(`${baseUrl}/api/v1/auth/audit`, {
      method: "GET",
      headers: AUTH_HEADERS,
    });

    assert.equal(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.ok(auditData.totalEvents > 0);
    assert.equal(auditData.chainIntegrity.valid, true);
  });
});
