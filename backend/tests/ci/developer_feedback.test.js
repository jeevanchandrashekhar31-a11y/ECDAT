const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { DeveloperFeedbackGenerator } = require("../../src/ci/developer_feedback");
const { DeveloperFeedback } = require("../../src/domain/contracts");
const { NodeCiScanner, CI_EXIT_CODES } = require("../../src/ci/ci_scanner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ecdat-feedback-test-"));
}

test("Developer Feedback - Generates all 9 dimensions with specific cryptographic rationale", () => {
  const finding = {
    rule_id: "ECDAT-STATIC-MD5",
    algorithm: "MD5",
    finding_type: "weak_hash",
    file_path: "src/auth/token.js",
    line_number: 45,
    column_number: 3,
    severity: "critical",
    confidence: "high",
    evidence: "crypto.createHash('md5').update(token).digest('hex');",
  };

  const fb = DeveloperFeedbackGenerator.generate(finding);

  // 1. Exact location
  assert.equal(fb.exact_location.file_path, "src/auth/token.js");
  assert.equal(fb.exact_location.line_number, 45);
  assert.equal(fb.exact_location.column_number, 3);
  assert.equal(fb.exact_location.formatted, "src/auth/token.js:45:3");

  // 2. Evidence
  assert.ok(fb.evidence.includes("createHash('md5')"));

  // 3. Confidence
  assert.equal(fb.confidence, "HIGH");

  // 4. Severity
  assert.equal(fb.severity, "CRITICAL");

  // 5. Why it matters (strictly avoid generic messages)
  assert.ok(fb.why_it_matters.toLowerCase().includes("collision"));
  assert.ok(!fb.why_it_matters.toLowerCase().includes("crypto is insecure"));

  // 6. Safe fix
  assert.ok(fb.safe_fix.summary.includes("SHA-256"));
  assert.ok(fb.safe_fix.codeExample.includes("sha256"));
  assert.ok(fb.safe_fix.migrationSteps.length >= 2);

  // 7. References
  assert.ok(fb.references.length >= 2);
  assert.ok(fb.references.some((r) => r.includes("NIST") || r.includes("CWE") || r.includes("RFC")));

  // 8. Suppression workflow
  assert.ok(fb.suppression_workflow.inline_comment_syntax.includes("ecdat:suppress"));
  assert.ok(fb.suppression_workflow.policy_exception_api.includes("POST"));

  // 9. Verification command
  assert.ok(fb.verification_command.includes("scanners.ci_scanner"));
  assert.ok(fb.verification_command.includes("src/auth/token.js"));
});

test("Developer Feedback - Validates DeveloperFeedback contract class", () => {
  const contract = new DeveloperFeedback({
    location: { file_path: "app.js", line_number: 1, formatted: "app.js:1:1" },
    evidence: "createHash('md5')",
    confidence: "HIGH",
    severity: "CRITICAL",
    whyItMatters: "MD5 is vulnerable to collision attacks.",
    safeFix: { summary: "Use SHA-256." },
    references: ["NIST SP 800-131A"],
    suppressionWorkflow: { syntax: "// ecdat:suppress" },
    verificationCommand: "npm test",
  });

  assert.equal(contract.whyItMatters, "MD5 is vulnerable to collision attacks.");
  assert.equal(contract.confidence, "HIGH");
  assert.equal(contract.severity, "CRITICAL");
  assert.ok(Object.isFrozen(contract));
});

test("Developer Feedback - Detects inline suppression comments in files", () => {
  const code = `
// ecdat:suppress ECDAT-STATIC-MD5 reason="Legacy telemetry checksum only"
const hash = crypto.createHash('md5').digest('hex');
`;
  const supp = DeveloperFeedbackGenerator.checkInlineSuppression(
    code,
    3,
    "ECDAT-STATIC-MD5",
    "MD5",
    "weak_hash"
  );
  assert.equal(supp.isSuppressed, true);
  assert.equal(supp.reason, "Legacy telemetry checksum only");
});

test("Developer Feedback - Suppressed findings do not fail CI gate", async () => {
  const dir = makeTempDir();
  const code = `
// ecdat:suppress ECDAT-STATIC-MD5 reason="Acceptable non-security checksum"
const hash = crypto.createHash('md5').digest('hex');
`;
  fs.writeFileSync(path.join(dir, "suppressed.js"), code, "utf-8");

  const scanner = new NodeCiScanner({
    targetDir: dir,
    failOn: "critical",
  });

  const result = await scanner.runScan();

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].is_suppressed, true);
  assert.equal(result.findings[0].suppression_reason, "Acceptable non-security checksum");

  // Gate passes because finding is suppressed!
  assert.equal(result.exitCode, CI_EXIT_CODES.PASS);
  assert.equal(result.gatePassed, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("Developer Feedback - Renders terminal and markdown cards cleanly", () => {
  const finding = {
    rule_id: "ECDAT-STATIC-DES",
    algorithm: "DES",
    finding_type: "weak_cipher",
    file_path: "src/crypto.js",
    line_number: 10,
    severity: "critical",
    confidence: "high",
    evidence: "createCipheriv('des-cbc', key, iv)",
  };

  const fb = DeveloperFeedbackGenerator.generate(finding);
  const term = DeveloperFeedbackGenerator.renderTerminalCard(fb);
  assert.ok(term.includes("Location:     src/crypto.js:10:1"));
  assert.ok(term.includes("Why It Matters"));
  assert.ok(term.includes("Safe Fix"));

  const md = DeveloperFeedbackGenerator.renderMarkdown(fb);
  assert.ok(md.includes("### [CRITICAL]"));
  assert.ok(md.includes("#### Safe Fix"));
});
