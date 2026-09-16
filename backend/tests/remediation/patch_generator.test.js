const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  SafePatchGenerator,
  getDefaultPatchGenerator,
  generatePatch,
  executePreApplicationLifecycle,
  validateSyntax,
} = require("../../src/remediation");

test("Patch Generator - Generates unified diff, explanation, test plan, and validation", () => {
  const source = `
const crypto = require('crypto');

function computeUserHash(password) {
  // Label for md5
  const md5_key = "user_md5";
  return crypto.createHash('md5').update(password).digest('hex');
}
`;

  const patch = generatePatch(source, "auth/hash.js", { targetAlgorithm: "SHA-256" });

  assert.equal(patch.has_changes, true);
  assert.ok(patch.unified_diff.includes("--- a/auth/hash.js"));
  assert.ok(patch.unified_diff.includes("+++ b/auth/hash.js"));
  assert.ok(patch.unified_diff.includes("+  return crypto.createHash('sha256').update(password).digest('hex');"));

  // Verify no blind global replacement of variable
  assert.ok(patch.patched_code.includes('const md5_key = "user_md5";'));

  // Explanation
  assert.ok(patch.explanation.safety_rationale.includes("No blind global string replacement"));
  assert.equal(patch.explanation.total_transformations, 1);

  // Test plan
  assert.ok(Array.isArray(patch.test_plan.unit_tests));
  assert.ok(patch.test_plan.recommended_command.includes("npm test"));

  // Syntax validation
  assert.equal(patch.validation_result.valid, true);
  assert.equal(patch.validation_result.syntax_error, null);
});

test("Patch Generator - Upgrades weak symmetric ciphers and RSA key sizes", () => {
  const cipherSource = `
const crypto = require('crypto');
function encryptData(key, iv, data) {
  return crypto.createCipheriv('des-ede3-cbc', key, iv);
}
`;
  const cipherPatch = generatePatch(cipherSource, "cipher.js");
  assert.ok(cipherPatch.patchedCode || cipherPatch.patched_code);
  const code = cipherPatch.patched_code;
  assert.ok(code.includes("crypto.createCipheriv('aes-256-gcm', key, iv)"));

  const rsaSource = `
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 1024,
});
`;
  const rsaPatch = generatePatch(rsaSource, "keys.js");
  assert.ok(rsaPatch.patched_code.includes("modulusLength: 3072"));
});

test("Patch Generator - Syntax validation detects broken syntax", () => {
  const brokenJs = "function broken( { return 42; }";
  const val = validateSyntax(brokenJs, "javascript");
  assert.equal(val.valid, false);
  assert.ok(val.syntax_error);
});

test("Patch Generator - Pre-application safety lifecycle runs all 6 steps", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecdat_test_patch_"));
  const tempFile = path.join(tempDir, "legacy_service.js");

  const originalContent = `
const crypto = require('crypto');
function getHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}
`;
  fs.writeFileSync(tempFile, originalContent, "utf-8");

  try {
    const patchRes = generatePatch(originalContent, tempFile, { targetAlgorithm: "SHA-256" });
    const safetyCheck = executePreApplicationLifecycle(tempFile, patchRes);

    // 1. Backup created
    assert.equal(safetyCheck.steps.backup.status, "PASSED");
    assert.ok(fs.existsSync(safetyCheck.steps.backup.backup_path));

    // 2. Isolated environment
    assert.equal(safetyCheck.steps.isolated_environment.status, "PASSED");

    // 3. Run tests
    assert.equal(safetyCheck.steps.run_tests.status, "PASSED");

    // 4. Rerun ECDAT
    assert.equal(safetyCheck.steps.rerun_ecdat.status, "PASSED");
    assert.equal(safetyCheck.steps.rerun_ecdat.verdict, "VULNERABILITY_RESOLVED");

    // 5. Rerun security scans
    assert.equal(safetyCheck.steps.rerun_security_scans.status, "PASSED");

    // 6. Compare CBOM
    assert.equal(safetyCheck.steps.compare_cbom.status, "PASSED");

    // Verdict
    assert.equal(safetyCheck.all_passed, true);
    assert.equal(safetyCheck.verdict, "SAFE_TO_APPLY");

    // Clean up backup file
    if (fs.existsSync(safetyCheck.steps.backup.backup_path)) {
      fs.unlinkSync(safetyCheck.steps.backup.backup_path);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
