const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { NodeCiScanner, CI_EXIT_CODES } = require("../../src/ci/ci_scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ecdat-ci-test-"));
}

test("CI Scanner - Clean repo exits with code 0 (PASS)", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, "clean.js"),
    "const crypto = require('crypto');\nconst hash = crypto.createHash('sha256').digest('hex');\n",
    "utf-8"
  );

  const scanner = new NodeCiScanner({
    targetDir: dir,
    failOn: "critical",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.PASS);
  assert.equal(result.exitCode, 0);
  assert.equal(result.complete, true);
  assert.equal(result.vulnerabilitiesConflated, false);
  assert.equal(result.gatePassed, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI Scanner - Vulnerable repo exceeding fail-on exits with code 1 (POLICY_SECURITY_FAILURE)", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, "vuln.js"),
    "const crypto = require('crypto');\nconst hash = crypto.createHash('md5').digest('hex');\n",
    "utf-8"
  );

  const scanner = new NodeCiScanner({
    targetDir: dir,
    failOn: "critical",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.POLICY_SECURITY_FAILURE);
  assert.equal(result.exitCode, 1);
  assert.equal(result.complete, true);
  assert.equal(result.gatePassed, false);
  assert.ok(result.gateViolations.length >= 1);
  assert.equal(result.vulnerabilitiesConflated, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI Scanner - Scanner error exits strictly with code 2 and does NOT conflate with clean scan", async () => {
  const dir = makeTempDir();
  const scanner = new NodeCiScanner({
    targetDir: dir,
    failOn: "critical",
  });

  // Force an engine crash during scanning
  scanner._scanStaticContent = () => {
    throw new Error("Simulated unhandled scanner exception");
  };

  fs.writeFileSync(path.join(dir, "dummy.js"), "console.log('test');", "utf-8");

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.SCANNER_ERROR);
  assert.equal(result.exitCode, 2);
  assert.equal(result.complete, false);
  assert.equal(result.vulnerabilitiesConflated, false);
  assert.equal(result.gatePassed, false);
  assert.equal(result.summary.status, "SCANNER_ERROR");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI Scanner - Invalid configuration exits with code 3 (INVALID_CONFIG)", async () => {
  const scanner = new NodeCiScanner({
    targetDir: "non_existent_folder_abc_123",
    failOn: "critical",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.INVALID_CONFIG);
  assert.equal(result.exitCode, 3);
  assert.equal(result.complete, false);
  assert.equal(result.vulnerabilitiesConflated, false);
  assert.ok(result.errors.length >= 1);
});

test("CI Scanner - Secret scanning detects and redacts hardcoded secrets", async () => {
  const dir = makeTempDir();
  const secretContent = `
const secret_key = "0123456789abcdef0123456789abcdef";
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0YpW3...FAKE_PRIVATE_KEY...
-----END RSA PRIVATE KEY-----
`;
  fs.writeFileSync(path.join(dir, "secrets.js"), secretContent, "utf-8");

  const scanner = new NodeCiScanner({
    targetDir: dir,
    scanSecrets: true,
    failOn: "none",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.PASS);

  const secretFindings = result.findings.filter((f) => f.category === "secret");
  assert.ok(secretFindings.length >= 1);
  for (const sf of secretFindings) {
    assert.equal(sf.finding_type, "hardcoded_key");
    assert.ok(sf.fingerprint.startsWith("sha256:"));
    // Zero secret leakage check
    assert.ok(!sf.evidence.includes("FAKE_PRIVATE_KEY"));
    assert.ok(sf.evidence.includes("[REDACTED_"));
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI Scanner - Pull request scan isolates changed files", async () => {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, "unchanged_vuln.js"),
    "const hash = crypto.createHash('md5');",
    "utf-8"
  );
  fs.writeFileSync(
    path.join(dir, "pr_changed_safe.js"),
    "const hash = crypto.createHash('sha256');",
    "utf-8"
  );

  const scanner = new NodeCiScanner({
    targetDir: dir,
    changedFiles: ["pr_changed_safe.js"],
    failOn: "critical",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.PASS);
  assert.equal(result.scanMode, "pull_request");
  assert.equal(result.totalFilesScanned, 1);
  assert.equal(result.findings.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("CI Scanner - Generates valid SARIF and CBOM outputs", async () => {
  const dir = makeTempDir();
  const sarifPath = path.join(dir, "artifacts", "report.sarif");
  const cbomPath = path.join(dir, "artifacts", "report.cbom.json");

  fs.writeFileSync(
    path.join(dir, "test.js"),
    "const hash = crypto.createHash('md5');",
    "utf-8"
  );

  const scanner = new NodeCiScanner({
    targetDir: dir,
    outputSarif: sarifPath,
    outputCbom: cbomPath,
    failOn: "none",
  });

  const result = await scanner.runScan();
  assert.equal(result.exitCode, CI_EXIT_CODES.PASS);

  assert.ok(fs.existsSync(sarifPath));
  assert.ok(fs.existsSync(cbomPath));

  const sarifData = JSON.parse(fs.readFileSync(sarifPath, "utf-8"));
  assert.equal(sarifData.version, "2.1.0");
  assert.ok(sarifData.runs[0].results.length >= 1);

  const cbomData = JSON.parse(fs.readFileSync(cbomPath, "utf-8"));
  assert.equal(cbomData.bomFormat, "CycloneDX");
  assert.ok(cbomData.components.length >= 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
