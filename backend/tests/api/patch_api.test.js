const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const app = require("../../src/app");
const config = require("../../src/config");

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

test("Patch API - POST /api/v1/remediation/generate-patch creates unified diff and explanation", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      source_code: "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n",
      file_path: "src/crypto/token.js",
      target_algorithm: "SHA-256",
    };

    const res = await fetch(`${baseUrl}/api/v1/remediation/generate-patch`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.has_changes, true);
    assert.ok(data.unified_diff.includes("--- a/src/crypto/token.js"));
    assert.ok(data.unified_diff.includes("+const h = crypto.createHash('sha256').digest();"));
    assert.equal(data.validation_result.valid, true);
    assert.ok(data.explanation.safety_rationale);
    assert.ok(Array.isArray(data.test_plan.unit_tests));
  });
});

test("Patch API - POST /api/v1/remediation/verify-patch executes pre-application safety lifecycle", async () => {
  await withServer(async (baseUrl) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecdat_api_patch_test_"));
    const tempFile = path.join(tempDir, "service.js");
    fs.writeFileSync(tempFile, "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n", "utf-8");

    try {
      const payload = {
        file_path: tempFile,
        source_code: "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n",
        target_algorithm: "SHA-256",
      };

      const res = await fetch(`${baseUrl}/api/v1/remediation/verify-patch`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.verdict, "SAFE_TO_APPLY");
      assert.equal(data.safety_lifecycle.all_passed, true);
      assert.equal(data.safety_lifecycle.steps.backup.status, "PASSED");
      assert.equal(data.safety_lifecycle.steps.isolated_environment.status, "PASSED");
      assert.equal(data.safety_lifecycle.steps.run_tests.status, "PASSED");
      assert.equal(data.safety_lifecycle.steps.rerun_ecdat.verdict, "VULNERABILITY_RESOLVED");
      assert.equal(data.safety_lifecycle.steps.compare_cbom.status, "PASSED");

      // Clean up backup if created
      if (data.safety_lifecycle.steps.backup.backup_path && fs.existsSync(data.safety_lifecycle.steps.backup.backup_path)) {
        fs.unlinkSync(data.safety_lifecycle.steps.backup.backup_path);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

test("Patch API - POST /api/v1/remediation/apply-patch respects DRY RUN mode", async () => {
  await withServer(async (baseUrl) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecdat_api_apply_test_"));
    const tempFile = path.join(tempDir, "service_dry.js");
    const origCode = "const crypto = require('crypto');\nconst h = crypto.createHash('md5').digest();\n";
    fs.writeFileSync(tempFile, origCode, "utf-8");

    try {
      const payload = {
        file_path: tempFile,
        source_code: origCode,
        dry_run: true, // Default to dry run
      };

      const res = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.mode, "DRY_RUN");
      assert.equal(data.is_dry_run, true);

      // Verify file on disk was NOT modified in dry run
      const contentOnDisk = fs.readFileSync(tempFile, "utf-8");
      assert.equal(contentOnDisk, origCode);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
