/**
 * Phase 2 Security Regression Suite: Authentication & Identity Hardening
 *
 * Verifies fixes for:
 * - P0-04: Authentication fail-open prevention when server API key is unconfigured.
 * - P0-05: Open-mode / anonymous identity cannot become admin or platform-admin.
 * - P1-09: MFA, session, token revocation, and recovery flows are strictly authorized.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const { apiKeyAuthMiddleware } = require("../../src/middleware/auth");
const { TenantContext } = require("../../src/tenancy/tenant_isolation");
const { defaultTokenService } = require("../../src/identity/token_service");
const config = require("../../src/config");

describe("Phase 2: Authentication & Identity Hardening", () => {
  describe("P0-04: Fail-Open Prevention", () => {
    test("Unauthenticated write request returns 401 even when server key is unconfigured", async () => {
      const originalKey = config.ECDAT_API_KEY;
      try {
        // Simulate missing server API key
        delete config.ECDAT_API_KEY;

        const app = express();
        app.use(express.json());
        app.use(apiKeyAuthMiddleware);
        app.post("/api/v1/test-write", (req, res) => res.json({ success: true }));

        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/test-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: "payload" }),
          });

          assert.strictEqual(res.status, 401, "Unauthenticated write must return 401 Unauthorized");
          const body = await res.json();
          assert.strictEqual(body.code, "AUTHENTICATION_REQUIRED");
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      } finally {
        config.ECDAT_API_KEY = originalKey;
      }
    });

    test("Unauthenticated scanner request returns 401 even when server key is unconfigured", async () => {
      const originalKey = config.ECDAT_API_KEY;
      try {
        delete config.ECDAT_API_KEY;

        const app = express();
        app.use(express.json());
        app.use(apiKeyAuthMiddleware);
        app.get("/scan/results", (req, res) => res.json({ findings: [] }));

        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        try {
          const res = await fetch(`http://127.0.0.1:${port}/scan/results`);
          assert.strictEqual(res.status, 401, "Unauthenticated scanner route must return 401");
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      } finally {
        config.ECDAT_API_KEY = originalKey;
      }
    });

    test("Valid JWT token succeeds even when server API key is unconfigured", async () => {
      const originalKey = config.ECDAT_API_KEY;
      try {
        delete config.ECDAT_API_KEY;

        const app = express();
        app.use(express.json());
        app.use(apiKeyAuthMiddleware);
        app.post("/api/v1/test-write", (req, res) => {
          res.json({ success: true, user: req.auth.user });
        });

        const server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;

        try {
          const tokenPair = defaultTokenService.issueTokenPair({
            userId: "jwt-user-01",
            email: "jwt-user@example.com",
            roles: ["developer"],
          });

          const res = await fetch(`http://127.0.0.1:${port}/api/v1/test-write`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenPair.accessToken}`,
            },
            body: JSON.stringify({ data: "payload" }),
          });

          assert.strictEqual(res.status, 200, "Valid JWT must be accepted");
          const body = await res.json();
          assert.strictEqual(body.success, true);
          assert.strictEqual(body.user.sub, "jwt-user-01");
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      } finally {
        config.ECDAT_API_KEY = originalKey;
      }
    });
  });

  describe("P0-05: Open-Mode / Anonymous Privilege Escalation Prevention", () => {
    test("TenantContext from open-mode request has anonymous role and isPlatformAdmin=false", () => {
      const fakeReq = {
        auth: { authenticated: false, mode: "open" },
        user: null,
      };

      const ctx = TenantContext.fromRequest(fakeReq);
      assert.strictEqual(ctx.isPlatformAdmin, false, "Open mode must never grant platform admin");
      assert.strictEqual(ctx.roles.includes("admin"), false, "Open mode must never grant admin role");
      assert.strictEqual(ctx.roles.includes("anonymous"), true, "Open mode role must be anonymous");
      assert.strictEqual(ctx.userId, "anonymous");
    });

    test("TenantContext from unauthenticated request has empty/anonymous role and isPlatformAdmin=false", () => {
      const fakeReq = {
        auth: { authenticated: false, role: "anonymous", roles: [] },
        user: null,
      };

      const ctx = TenantContext.fromRequest(fakeReq);
      assert.strictEqual(ctx.isPlatformAdmin, false);
      assert.strictEqual(ctx.roles.includes("admin"), false);
      assert.strictEqual(ctx.userId, "anonymous");
    });
  });

  describe("P1-09: MFA and Token Management Protection", () => {
    test("Anonymous caller cannot invoke MFA setup", async () => {
      const authRoutes = require("../../src/routes/auth");
      const app = express();
      app.use(express.json());
      app.use("/api/v1/auth", authRoutes);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/mfa/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "target-user" }),
        });

        assert.strictEqual(res.status, 401, "Anonymous MFA setup must be rejected with 401");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    test("Anonymous caller cannot revoke tokens", async () => {
      const authRoutes = require("../../src/routes/auth");
      const app = express();
      app.use(express.json());
      app.use("/api/v1/auth", authRoutes);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/token/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jti: "token-to-revoke" }),
        });

        assert.strictEqual(res.status, 401, "Anonymous token revocation must be rejected with 401");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
