const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const {
  buildTechnicalDrillDownItem,
  generateTechnicalDrillDownReport,
  validateTechnicalReportCompleteness,
  generateTechnicalHtmlReport,
} = require("../../src/services/technical_report_service");

const app = require("../../src/app");
const config = require("../../src/config");
if (!config.ECDAT_API_KEY) {
  config.ECDAT_API_KEY = "test-reports-key-32-chars-long-entropy!!";
}

describe("Technical Drill-Down Reporting Engine (Phase 26.2)", () => {
  test("Generates report where every finding satisfies all 12 technical dimensions", async () => {
    const report = await generateTechnicalDrillDownReport({ limit: 10 });

    assert.ok(report.metadata, "Metadata must exist");
    assert.ok(report.metadata.total_findings > 0);
    assert.ok(Array.isArray(report.findings));
    assert.ok(report.findings.length > 0);

    const requiredDimensions = [
      "exact_source_location",
      "scanner",
      "confidence",
      "evidence",
      "algorithm",
      "parameters",
      "dependency",
      "certificate",
      "network_endpoint",
      "runtime_evidence",
      "risk",
      "remediation",
    ];

    for (const item of report.findings) {
      for (const dim of requiredDimensions) {
        assert.ok(
          item[dim] && typeof item[dim] === "object",
          `Finding '${item.finding_id}' must have valid '${dim}' object`
        );
      }

      // 1. Exact Source Location
      assert.ok(item.exact_source_location.file_path);
      assert.ok(Number.isInteger(item.exact_source_location.line_number));

      // 2. Scanner
      assert.ok(item.scanner.scanner_id);
      assert.ok(item.scanner.modality);

      // 3. Confidence
      assert.ok(item.confidence.confidence_level);
      assert.ok(item.confidence.confidence_score > 0);

      // 4. Evidence
      assert.ok(item.evidence.raw_evidence);
      assert.equal(item.evidence.sha256_hash.length, 64);
      assert.equal(item.evidence.redaction_verified, true);

      // 5. Algorithm
      assert.ok(item.algorithm.name);
      assert.ok(item.algorithm.family);
      assert.ok(item.algorithm.oid);

      // 6. Parameters
      assert.ok(item.parameters.key_size_bits > 0);

      // 7. Dependency
      assert.ok(item.dependency.package_name);
      assert.ok(item.dependency.ecosystem);

      // 8. Certificate
      assert.ok(item.certificate.subject_dn);
      assert.equal(item.certificate.fingerprint_sha256.length, 64);

      // 9. Network Endpoint
      assert.ok(item.network_endpoint.hostname);
      assert.equal(item.network_endpoint.port, 443);

      // 10. Runtime Evidence
      assert.equal(item.runtime_evidence.is_runtime_observed, true);
      assert.ok(item.runtime_evidence.process_id > 0);

      // 11. Risk
      assert.ok(["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(item.risk.severity));
      assert.ok(item.risk.risk_score > 0);
      assert.ok(item.risk.cwe_id.startsWith("CWE-"));

      // 12. Remediation
      assert.ok(item.remediation.target_algorithm);
      assert.ok(item.remediation.patch_diff.includes("--- a/"));
    }
  });

  test("Validates 12-dimension completeness successfully", async () => {
    const report = await generateTechnicalDrillDownReport();
    const verdict = validateTechnicalReportCompleteness(report);

    assert.equal(verdict.passed, true, `Violations: ${verdict.violations.join(", ")}`);
    assert.ok(verdict.total_findings_validated > 0);
  });

  test("Catches missing dimensions in validation", () => {
    const corruptedReport = {
      findings: [
        {
          finding_id: "find_bad",
          // missing required dimensions
        },
      ],
    };

    const verdict = validateTechnicalReportCompleteness(corruptedReport);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.violations.length >= 10);
  });

  test("Generates interactive standalone HTML technical report", async () => {
    const report = await generateTechnicalDrillDownReport();
    const html = generateTechnicalHtmlReport(report);

    assert.ok(typeof html === "string");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("ECDAT Technical Drill-Down Report"));
    assert.ok(html.includes("Exact Source Location"));
    assert.ok(html.includes("Scanner &amp; Modality") || html.includes("Scanner & Modality"));
    assert.ok(html.includes("Remediation &amp; Syntactic Patch Diff") || html.includes("Remediation & Syntactic Patch Diff"));
  });

  test("GET /api/v1/reports/technical returns JSON drill-down list", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/technical?limit=5`, {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.metadata);
      assert.ok(Array.isArray(data.findings));
      assert.ok(data.findings.length > 0);
      assert.ok(data.findings[0].exact_source_location);
      assert.ok(data.findings[0].remediation.patch_diff);
    } finally {
      server.close();
    }
  });

  test("GET /api/v1/reports/technical/:findingId returns specific finding drill-down", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/technical/find_rsa_1024_auth`, {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      });

      assert.equal(res.status, 200);
      const item = await res.json();
      assert.equal(item.finding_id, "find_rsa_1024_auth");
      assert.equal(item.algorithm.name, "RSA-1024");
      assert.equal(item.exact_source_location.line_number, 42);
      assert.ok(item.remediation.target_algorithm.includes("ML-KEM") || item.remediation.target_algorithm.includes("RSA-3072"));
    } finally {
      server.close();
    }
  });

  test("GET /api/v1/reports/technical/html serves presentation HTML", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/technical/html`, {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      });

      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type").includes("text/html"));
      const text = await res.text();
      assert.ok(text.includes("ECDAT Technical Drill-Down Report"));
      assert.ok(text.includes("diff-del") || text.includes("patch_diff") || text.includes("--- a/"));
    } finally {
      server.close();
    }
  });
});
