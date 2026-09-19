const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const path = require("path");

describe("Feature-Level Parity Audit & 10/10 Certification (Phase 27.1)", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const auditorPath = path.join(repoRoot, "scanners/reporting/parity_auditor.py");

  test("Executes python parity auditor and verifies 10/10 certification verdict", () => {
    const stdout = execFileSync("python", [auditorPath, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const report = JSON.parse(stdout);
    assert.ok(report.audit_summary, "Report must contain audit_summary");

    const summary = report.audit_summary;
    assert.equal(summary.certification_verdict, "ENTERPRISE FEATURE PARITY VERIFIED AGAINST DOCUMENTED BASELINES");
    assert.equal(summary.all_full_parity_claims_verified, true);
    assert.ok(summary.parity_score_out_of_10 >= 9.5);

    // Verify minimum capability numbers
    assert.ok(summary.counts["FULL PARITY"] >= 12);
    assert.ok(summary.counts["ECDAT ADVANTAGE"] >= 3);
  });

  test("Every FULL PARITY item strictly provides source files, tests, demo command, docs, and evidence", () => {
    const stdout = execFileSync("python", [auditorPath, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    const report = JSON.parse(stdout);
    const fullParityItems = report.capabilities.filter(
      (c) => c.capability.status === "FULL PARITY"
    );

    assert.ok(fullParityItems.length >= 12);

    for (const item of fullParityItems) {
      const cap = item.capability;
      assert.ok(cap.source_files.length > 0, `${cap.capability_id} missing source_files`);
      assert.ok(cap.test_files.length > 0, `${cap.capability_id} missing test_files`);
      assert.ok(cap.demo_command && cap.demo_command.length > 0, `${cap.capability_id} missing demo_command`);
      assert.ok(cap.documentation && cap.documentation.length > 0, `${cap.capability_id} missing documentation`);
      assert.ok(cap.evidence && cap.evidence.length > 0, `${cap.capability_id} missing evidence`);
      assert.equal(item.verified, true, `${cap.capability_id} failed disk verification: ${item.missing_items.join(", ")}`);
    }
  });
});
