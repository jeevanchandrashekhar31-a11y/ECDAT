const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const {
  generateExecutiveReport,
  validateReportTraceability,
  generateExecutiveHtmlReport,
  createEvidenceReference,
} = require("../../src/services/executive_report_service");

const app = require("../../src/app");

describe("Enterprise Executive Reporting Engine (Phase 26.1)", () => {
  test("Generates comprehensive executive report covering all 9 domains", async () => {
    const report = await generateExecutiveReport({
      policyProfile: "regulated_bfsi",
      scenario: "baseline",
    });

    assert.ok(report.report_metadata, "Report metadata must exist");
    assert.ok(report.report_metadata.report_id.startsWith("exec_rpt_"));
    assert.equal(report.report_metadata.policy_profile, "regulated_bfsi");

    // 1. Total crypto assets
    assert.ok(report.total_crypto_assets.total_count > 0);
    assert.ok(report.total_crypto_assets.by_type);
    assert.ok(Array.isArray(report.total_crypto_assets.evidence_items));

    // 2. Weak & deprecated assets
    assert.ok(report.weak_deprecated_assets.total_weak_count > 0);
    assert.ok(report.weak_deprecated_assets.broken_count >= 1);
    assert.ok(report.weak_deprecated_assets.deprecated_count >= 1);
    assert.ok(Array.isArray(report.weak_deprecated_assets.evidence_items));

    // 3. PQC readiness
    assert.ok(report.pqc_readiness.total_assessed > 0);
    assert.ok(report.pqc_readiness.quantum_vulnerable_count >= 1);
    assert.ok(report.pqc_readiness.hybrid_count >= 1);
    assert.ok(report.pqc_readiness.mosca_calculus);
    assert.equal(report.pqc_readiness.mosca_calculus.quantum_collapse_year, 2033);
    assert.ok(typeof report.pqc_readiness.mosca_calculus.mosca_delta_years === "number");

    // 4. Critical applications
    assert.ok(report.critical_applications.total_critical_applications >= 1);
    assert.ok(Array.isArray(report.critical_applications.applications));
    assert.ok(report.critical_applications.applications[0].evidence_items.length > 0);

    // 5. Certificates
    assert.ok(report.certificates.total_certificates >= 1);
    assert.ok(Array.isArray(report.certificates.evidence_items));
    assert.ok(report.certificates.certificate_details[0].fingerprint.length === 64);

    // 6. Policy violations
    assert.ok(report.policy_violations.total_violations > 0);
    assert.ok(report.policy_violations.by_framework.nist_sp800_131a);
    assert.ok(report.policy_violations.by_framework.pci_dss_v4);

    // 7. Remediation progress
    assert.ok(report.remediation_progress.total_findings > 0);
    assert.ok(report.remediation_progress.remediation_rate_percentage > 0);
    assert.ok(report.remediation_progress.status_counts.verified >= 1);

    // 8. Business ownership
    assert.ok(report.business_ownership.total_owners_count >= 1);
    assert.ok(report.business_ownership.owners.length >= 1);
    assert.ok(report.business_ownership.owners[0].evidence_items.length > 0);

    // 9. Trend over time
    assert.ok(report.trend_over_time.historical_periods.length >= 3);
    assert.equal(report.trend_over_time.velocity_summary.direction, "IMPROVING");

    // Evidence index
    assert.ok(Object.keys(report.evidence_index).length > 0);
  });

  test("Validates 100% evidence traceability across all metrics", async () => {
    const report = await generateExecutiveReport();
    const verdict = validateReportTraceability(report);

    assert.equal(verdict.passed, true, `Violations: ${verdict.violations.join(", ")}`);
    assert.ok(verdict.total_evidence_entries > 0);
  });

  test("Detects metric and evidence discrepancies when artificially injected", async () => {
    const report = await generateExecutiveReport();
    // Artificially modify count without updating evidence
    report.total_crypto_assets.total_count = 9999;

    const verdict = validateReportTraceability(report);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.violations.some((v) => v.includes("total_crypto_assets")));
  });

  test("Generates standalone HTML executive report with dark mode & KPIs", async () => {
    const report = await generateExecutiveReport();
    const html = generateExecutiveHtmlReport(report);

    assert.ok(typeof html === "string");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("ECDAT Executive Cryptographic Report"));
    assert.ok(html.includes("Total Cryptographic Assets"));
    assert.ok(html.includes("Weak &amp; Deprecated") || html.includes("Weak & Deprecated"));
    assert.ok(html.includes("Post-Quantum Migration Readiness"));
    assert.ok(html.includes("evidence-tag"));
  });

  test("GET /api/v1/reports/executive endpoint returns complete report JSON", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/executive`, {
        headers: { "X-API-Key": "ecdat-demo-admin-key-2026" },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.report_metadata);
      assert.ok(data.total_crypto_assets);
      assert.ok(data.weak_deprecated_assets);
      assert.ok(data.pqc_readiness);
      assert.ok(data.evidence_index);
    } finally {
      server.close();
    }
  });

  test("GET /api/v1/reports/executive/html serves presentation HTML", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/executive/html`, {
        headers: { "X-API-Key": "ecdat-demo-admin-key-2026" },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type").includes("text/html"));
      const text = await res.text();
      assert.ok(text.includes("ECDAT Executive Cryptographic Report"));
    } finally {
      server.close();
    }
  });

  test("GET /api/v1/reports/executive/export sends attachment download", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/executive/export`, {
        headers: { "X-API-Key": "ecdat-demo-admin-key-2026" },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-disposition").includes("attachment"));
      const data = await res.json();
      assert.ok(data.report_metadata);
    } finally {
      server.close();
    }
  });
});
