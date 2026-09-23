/**
 * Phase 4 Security Regression Suite: Remediation / File-System Security
 *
 * Verifies fixes for:
 * - P0-07: Remediation actor role cannot be client-spoofed via headers.
 * - P0-08: Remediation verification strictly requires explicit verification_results (no default to success).
 * - P0-09: Remediation patch path is confined to designated workspace roots and rejects path traversal.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

const remediationRouter = require("../../src/routes/remediation");
const { getDefaultApprovalEngine, ApprovalWorkflowError } = require("../../src/remediation");
const { defaultTokenService } = require("../../src/identity/token_service");

describe("Phase 4: Remediation / File-System Security", () => {
  function createTestApp(userOrAuth) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      if (userOrAuth?.user) req.user = userOrAuth.user;
      if (userOrAuth?.auth) req.auth = userOrAuth.auth;
      next();
    });
    app.use("/api/v1/remediation", remediationRouter);
    return app;
  }

  describe("P0-07: Actor Role Spoofing Prevention", () => {
    test("JWT viewer cannot elevate role via X-Actor-Role header", async () => {
      const viewerUser = {
        sub: "user-alice",
        username: "alice",
        role: "viewer",
        roles: ["viewer"],
      };

      const app = createTestApp({ user: viewerUser, auth: { authenticated: true, role: "viewer" } });
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/approvals/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Actor-Role": "admin",
            "X-Actor-Username": "admin_impersonator",
          },
          body: JSON.stringify({
            title: "Malicious Patch",
            category: "algorithm migration",
            environment: "production",
          }),
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        // Proposer must be alice (viewer), not admin_impersonator (admin)
        assert.strictEqual(data.proposer.username, "alice");
        assert.strictEqual(data.proposer.role, "viewer");
      } finally {
        await new Promise((r) => server.close(r));
      }
    });

    test("Unauthenticated caller passing X-Actor-Role: admin is treated as viewer", async () => {
      const app = createTestApp(null);
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/approvals/propose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Actor-Role": "admin",
            "X-Actor-Username": "admin",
          },
          body: JSON.stringify({
            title: "Anonymous Proposal",
            category: "algorithm migration",
            environment: "production",
          }),
        });

        assert.strictEqual(res.status, 201);
        const data = await res.json();
        assert.strictEqual(data.proposer.username, "anonymous");
        assert.strictEqual(data.proposer.role, "viewer");
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });

  describe("P0-08: Verification Fail-Closed (No Default Success)", () => {
    test("POST /approvals/:approvalId/verify rejects omitted verification_results with 400", async () => {
      const engine = getDefaultApprovalEngine();
      const proposal = await engine.proposeRemediation(
        { title: "Test Fix", category: "ciphersuite modernization", environment: "staging" },
        { username: "dev1", role: "developer" }
      );
      await engine.reviewRemediation(proposal.approval_id, { username: "rev1", role: "reviewer" });
      await engine.approveRemediation(proposal.approval_id, { username: "adm1", role: "admin" });
      await engine.applyRemediation(proposal.approval_id, { username: "dep1", role: "deployer" });

      const app = createTestApp({ auth: { authenticated: true, role: "admin" } });
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;

      try {
        // Send request WITHOUT verification_results
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/approvals/${proposal.approval_id}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        assert.strictEqual(res.status, 400, "Must return 400 when verification_results is omitted");
        const data = await res.json();
        assert.strictEqual(data.code, "MISSING_VERIFICATION_RESULTS");
      } finally {
        await new Promise((r) => server.close(r));
      }
    });

    test("verifyRemediation throws ApprovalWorkflowError when results are missing", async () => {
      const engine = getDefaultApprovalEngine();
      const proposal = await engine.proposeRemediation(
        { title: "Unit Test Verification", category: "ciphersuite modernization", environment: "staging" },
        { username: "dev2", role: "developer" }
      );
      await engine.reviewRemediation(proposal.approval_id, { username: "rev2", role: "reviewer" });
      await engine.approveRemediation(proposal.approval_id, { username: "adm2", role: "admin" });
      await engine.applyRemediation(proposal.approval_id, { username: "dep2", role: "deployer" });

      await assert.rejects(
        async () => {
          await engine.verifyRemediation(proposal.approval_id, { username: "ver1", role: "verifier" });
        },
        /verificationResults/
      );
    });
  });

  describe("P0-09: Remediation Path Confinement & Traversal Defense", () => {
    test("POST /apply-patch rejects path traversal sequence ../../etc/passwd", async () => {
      const app = createTestApp({ auth: { authenticated: true, role: "admin" } });
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/apply-patch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_path: "../../../etc/passwd",
            source_code: "const h = crypto.createHash('md5');",
            dry_run: true,
          }),
        });

        assert.strictEqual(res.status, 400, "Path traversal attempt must be rejected with 400");
        const data = await res.json();
        assert.strictEqual(data.code, "PATH_CONFINEMENT_VIOLATION");
      } finally {
        await new Promise((r) => server.close(r));
      }
    });

    test("POST /apply-patch rejects forbidden system paths", async () => {
      const app = createTestApp({ auth: { authenticated: true, role: "admin" } });
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      const port = server.address().port;

      try {
        const forbiddenPath = process.platform === "win32" ? "C:\\Windows\\System32\\calc.exe" : "/etc/shadow";
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/apply-patch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_path: forbiddenPath,
            source_code: "const h = crypto.createHash('md5');",
            dry_run: true,
          }),
        });

        assert.strictEqual(res.status, 400, "Forbidden system directory must be rejected with 400");
        const data = await res.json();
        assert.strictEqual(data.code, "PATH_CONFINEMENT_VIOLATION");
      } finally {
        await new Promise((r) => server.close(r));
      }
    });
  });
});
