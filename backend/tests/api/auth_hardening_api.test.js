const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const { defaultLocalAuthManager, defaultMfaEngine, defaultTokenService } = require("../../src/identity");
const { parseCookies } = require("../../src/middleware/cookie_csrf");

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

test("Auth Hardening API - Registration enforces NIST SP 800-63B password policy", async () => {
  await withServer(async (baseUrl) => {
    // 1. Weak password rejected with policy violations
    const resWeak = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "weak_user",
        email: "weak@corp.internal",
        password: "weak",
      }),
    });

    assert.equal(resWeak.status, 400);
    const dataWeak = await resWeak.json();
    assert.equal(dataWeak.error, "PasswordPolicyViolation");
    assert.ok(Array.isArray(dataWeak.violations));
    assert.ok(dataWeak.violations.some((v) => v.includes("at least 12 characters")));

    // 2. Strong password accepted
    // Per Rule 4 & Phase 2.1 P0 Remediation, public registration MUST NOT allow client-chosen
    // roles (e.g. "secops"). Public registration strictly assigns the lowest-privilege account ("viewer").
    const resStrong = await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "strong_user",
        email: "strong@corp.internal",
        password: "Enterprise-Agile-PQC#2026!",
      }),
    });

    assert.equal(resStrong.status, 201);
    const dataStrong = await resStrong.json();
    assert.equal(dataStrong.success, true);
    assert.equal(dataStrong.user.username, "strong_user");
    assert.deepEqual(dataStrong.user.roles, ["viewer"]);
  });
});

test("Auth Hardening API - Login, brute-force lockout, and credential reset", async () => {
  await withServer(async (baseUrl) => {
    const testUser = "lockout_user";
    const testPass = "Safe-Password-Testing#2026!";

    // Register user
    await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: testUser,
        email: "lockout@corp.internal",
        password: testPass,
      }),
    });

    // 1. Successful login
    const resLogin = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: testUser, password: testPass }),
    });
    assert.equal(resLogin.status, 200);
    const loginData = await resLogin.json();
    assert.ok(loginData.accessToken);
    assert.ok(loginData.refreshToken);
    assert.equal(loginData.tokenType, "Bearer");

    // 2. Trigger consecutive failures for lockout (5 failures)
    for (let i = 1; i <= 4; i++) {
      const resBad = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testUser, password: `WrongAttempt_${i}!` }),
      });
      assert.equal(resBad.status, 401);
    }

    // 5th failure triggers 423 AccountLocked
    const resLocked = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: testUser, password: "FinalWrongAttempt!" }),
    });
    assert.equal(resLocked.status, 423);
    const lockedData = await resLocked.json();
    assert.equal(lockedData.error, "AccountLocked");
    assert.ok(lockedData.unlockTime);
  });
});

test("Auth Hardening API - MFA Setup, TOTP Challenge verification, and Backup Codes", async () => {
  await withServer(async (baseUrl) => {
    const username = "mfa_tester";
    const password = "Quantum-Safe-Passphrase#2026!";

    // Register
    await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email: "mfa@corp.internal",
        password,
      }),
    });

    // Login to obtain authenticated token
    const resPreLogin = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(resPreLogin.status, 200);
    const preLoginData = await resPreLogin.json();
    const token = preLoginData.accessToken;

    // 1. MFA Setup (Authenticated identity bound)
    const resSetup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username }),
    });
    assert.equal(resSetup.status, 200);
    const setupData = await resSetup.json();
    assert.ok(setupData.secret);
    assert.ok(setupData.otpAuthUri);
    assert.equal(setupData.backupCodes.length, 8);

    // 2. MFA Enable with valid TOTP code (Authenticated)
    const validCode = defaultMfaEngine.generateCode(setupData.secret);
    const resEnable = await fetch(`${baseUrl}/api/v1/auth/mfa/enable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ username, code: validCode }),
    });
    assert.equal(resEnable.status, 200);
    const enableData = await resEnable.json();
    assert.equal(enableData.success, true);

    // 3. Login now triggers MFA challenge
    const resChallenge = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(resChallenge.status, 200);
    const challengeData = await resChallenge.json();
    assert.equal(challengeData.mfaRequired, true);
    assert.ok(challengeData.mfaToken);

    // 4. Verify MFA with TOTP code
    const challengeCode = defaultMfaEngine.generateCode(setupData.secret);
    const resVerify = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfaToken: challengeData.mfaToken,
        code: challengeCode,
      }),
    });
    assert.equal(resVerify.status, 200);
    const verifyData = await resVerify.json();
    assert.ok(verifyData.accessToken);
    assert.ok(verifyData.refreshToken);
    assert.equal(verifyData.user.username, username);

    // 5. Login again and verify using single-use backup code
    const resChallenge2 = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const challengeData2 = await resChallenge2.json();

    const backupCodeToUse = setupData.backupCodes[0];
    const resBackupVerify = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfaToken: challengeData2.mfaToken,
        code: backupCodeToUse,
        isBackupCode: true,
      }),
    });
    assert.equal(resBackupVerify.status, 200);
    const backupVerifyData = await resBackupVerify.json();
    assert.ok(backupVerifyData.accessToken);

    // 6. Reusing consumed backup code is rejected
    const resChallenge3 = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const challengeData3 = await resChallenge3.json();

    const resReusedBackup = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfaToken: challengeData3.mfaToken,
        code: backupCodeToUse,
        isBackupCode: true,
      }),
    });
    assert.equal(resReusedBackup.status, 401);
  });
});

test("Auth Hardening API - Secure Cookies, CSRF Double-Submit Protection, and Logout", async () => {
  await withServer(async (baseUrl) => {
    const username = "cookie_tester";
    const password = "Super-Secure-Enterprise#2026!";

    // Register user (public registration assigns lowest-privilege "viewer" per Phase 2.1 P0)
    await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email: "ck_test@corp.internal",
        password,
      }),
    });

    // 1. Cookie login sets HttpOnly, SameSite=Strict cookies
    const resCookieLogin = await fetch(`${baseUrl}/api/v1/auth/cookie/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(resCookieLogin.status, 200);
    const cookieLoginData = await resCookieLogin.json();
    assert.ok(cookieLoginData.csrfToken);

    const setCookieHeaders = resCookieLogin.headers.getSetCookie ? resCookieLogin.headers.getSetCookie() : [resCookieLogin.headers.get("set-cookie")];
    const setCookieStr = setCookieHeaders.join("; ");
    assert.ok(setCookieStr.includes("ecdat_access_token="));
    assert.ok(setCookieStr.includes("HttpOnly"));
    assert.ok(setCookieStr.includes("SameSite=Strict"));
    assert.ok(setCookieStr.includes("ecdat_csrf_token="));

    // Construct ambient cookie header for subsequent browser requests
    const parsedCookies = parseCookies(setCookieStr);
    const cookieHeader = `ecdat_access_token=${parsedCookies.ecdat_access_token}; ecdat_csrf_token=${cookieLoginData.csrfToken}`;

    // 2. State-changing request with cookie auth but MISSING CSRF header -> 403 Forbidden
    const resNoCsrf = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        Origin: "http://localhost:3000",
      },
    });
    assert.equal(resNoCsrf.status, 403);
    const noCsrfData = await resNoCsrf.json();
    assert.equal(noCsrfData.error, "CSRFValidationFailed");

    // 3. State-changing request with cookie auth and WRONG CSRF header -> 403 Forbidden
    const resWrongCsrf = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "x-csrf-token": "wrong_csrf_token_value",
        Origin: "http://localhost:3000",
      },
    });
    assert.equal(resWrongCsrf.status, 403);

    // 4. State-changing request with valid CSRF token in header & cookie -> 200 OK
    const resValidCsrf = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "x-csrf-token": cookieLoginData.csrfToken,
        Origin: "http://localhost:3000",
      },
    });
    assert.equal(resValidCsrf.status, 200);
    const logoutData = await resValidCsrf.json();
    assert.equal(logoutData.success, true);

    // Verify cookies are cleared (Max-Age=0)
    const clearedCookies = resValidCsrf.headers.getSetCookie ? resValidCsrf.headers.getSetCookie() : [resValidCsrf.headers.get("set-cookie")];
    assert.ok(clearedCookies.some((c) => c.includes("Max-Age=0")));
  });
});

test("Auth Hardening API - Multi-Device Global Session Revocation", async () => {
  await withServer(async (baseUrl) => {
    const username = "multidevice_user";
    const password = "Quantum-Agile-Enterprise#2026!";

    // Register user
    await fetch(`${baseUrl}/api/v1/auth/local/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        email: "session_user@corp.internal",
        password,
      }),
    });

    // Device 1 Login
    const resDev1 = await fetch(`${baseUrl}/api/v1/auth/local/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const dev1Data = await resDev1.json();
    const token1 = dev1Data.accessToken;

    // Verify /api/v1/auth/me works on Device 1
    const resMeBefore = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(resMeBefore.status, 200);

    // User performs global logout-all across all devices
    const resLogoutAll = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: dev1Data.user.userId }),
    });
    assert.equal(resLogoutAll.status, 200);

    // Device 1's token is now revoked globally and rejected
    const resMeAfter = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(resMeAfter.status, 401);
  });
});

test("Auth Hardening API - Demo login with existing/stale cookies succeeds without CSRF token error", async () => {
  await withServer(async (baseUrl) => {
    const config = require("../../src/config");
    const prevMode = config.AUTH_MODE;
    config.AUTH_MODE = "demo";
    try {
      // Client sends request to /api/v1/auth/demo/login with an ambient cookie from a previous session
      // but no CSRF header or matching cookie: must succeed (200 OK), not fail with 403 CSRFValidationFailed.
      const resDemo = await fetch(`${baseUrl}/api/v1/auth/demo/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "ecdat_access_token=stale_or_expired_cookie_value; other_cookie=xyz",
          Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ persona: "developer", seed: false }),
      });

      const demoData = await resDemo.json();
      assert.equal(resDemo.status, 200, "Demo login must not be blocked by CSRF middleware when cookies are present");
      assert.ok(demoData.accessToken);
      assert.ok(demoData.csrfToken, "Demo login must issue a fresh CSRF token");
      assert.equal(demoData.user.username, "demo-developer");
      assert.equal(demoData.demoMode, true);
    } finally {
      config.AUTH_MODE = prevMode;
    }
  });
});

