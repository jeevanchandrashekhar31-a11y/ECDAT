const test = require("node:test");
const assert = require("node:assert/strict");
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

test("Developer Feedback API - POST /api/v1/ci/feedback returns 9 dimensions and cards", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      findings: [
        {
          rule_id: "ECDAT-STATIC-MD5",
          algorithm: "MD5",
          finding_type: "weak_hash",
          file_path: "src/auth.js",
          line_number: 12,
          evidence: "createHash('md5')",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/v1/ci/feedback`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 1);
    const item = data.feedback[0];

    // All 9 dimensions verified
    assert.equal(item.exact_location.formatted, "src/auth.js:12:1");
    assert.equal(item.evidence, "createHash('md5')");
    assert.equal(item.confidence, "HIGH");
    assert.equal(item.severity, "MEDIUM");
    assert.ok(item.why_it_matters.includes("collision"));
    assert.ok(item.safe_fix.summary.includes("SHA-256"));
    assert.ok(item.references.length >= 2);
    assert.ok(item.suppression_workflow.inline_comment_syntax.includes("ecdat:suppress"));
    assert.ok(item.verification_command.includes("src/auth.js"));

    // Formatted cards
    assert.ok(item.terminal_card.includes("Location:     src/auth.js:12:1"));
    assert.ok(item.markdown_card.includes("### [MEDIUM]"));
  });
});

test("Developer Feedback API - GET /api/v1/ci/rules/:id/guidance returns specific cryptographic guidance", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/ci/rules/DES/guidance`, {
      method: "GET",
      headers: AUTH_HEADERS,
    });

    assert.equal(res.status, 200);
    const guidance = await res.json();
    assert.equal(guidance.rule_id, "DES");
    assert.ok(guidance.why_it_matters.includes("56-bit"));
    assert.ok(guidance.safe_fix.summary.includes("AES-256-GCM"));
    assert.ok(guidance.references.some((r) => r.includes("NIST")));
    assert.ok(guidance.suppression_workflow.inline_example.includes("ecdat:suppress"));
    assert.ok(guidance.markdown_card.includes("Why It Matters"));
  });
});
