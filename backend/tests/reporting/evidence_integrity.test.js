const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const {
  buildEvidenceIntegrity,
  validateEvidenceIntegrity,
  ECDAT_VERSION,
  DEFAULT_SCANNER_VERSIONS,
  PROHIBITED_DECEPTIVE_CLAIMS,
} = require("../../src/services/evidence_integrity_service");

const { generateExecutiveReport, generateExecutiveHtmlReport } = require("../../src/services/executive_report_service");
const { generateTechnicalDrillDownReport, generateTechnicalHtmlReport } = require("../../src/services/technical_report_service");
const app = require("../../src/app");

describe("Evidence Integrity & Audit Attestation Subsystem (Phase 26.3)", () => {
  test("Executive reports strictly identify all 6 mandated metadata dimensions", async () => {
    const report = await generateExecutiveReport();
    assert.ok(report.evidence_integrity, "Report must contain evidence_integrity block");

    const integrity = report.evidence_integrity;

    // 1. scan timestamp
    assert.ok(integrity.scan_timestamp, "Must identify scan_timestamp");
    assert.ok(!isNaN(Date.parse(integrity.scan_timestamp)));

    // 2. ECDAT version
    assert.equal(integrity.ecdat_version, ECDAT_VERSION);

    // 3. scanner versions
    assert.ok(integrity.scanner_versions && typeof integrity.scanner_versions === "object");
    assert.ok(integrity.scanner_versions.static_tree_sitter_ast);
    assert.ok(integrity.scanner_versions.ebpf_runtime_tracer);

    // 4. configuration
    assert.ok(integrity.configuration);
    assert.equal(integrity.configuration.config_hash_sha256.length, 64);

    // 5. policy version
    assert.ok(integrity.policy_version);
    assert.ok(integrity.policy_version.version);
    assert.equal(integrity.policy_version.policy_hash_sha256.length, 64);

    // 6. CBOM version
    assert.ok(integrity.cbom_version);
    assert.ok(integrity.cbom_version.spec_version);
    assert.equal(integrity.cbom_version.cbom_sha256.length, 64);

    // Hashes & Fingerprints
    assert.ok(integrity.hashes.report_payload_sha256);
    assert.equal(integrity.hashes.report_payload_sha256.length, 64);
    assert.equal(integrity.hashes.evidence_merkle_root.length, 64);
    assert.ok(integrity.hashes.canonical_fingerprint.startsWith("SHA256:"));
  });

  test("Technical drill-down reports strictly identify all 6 mandated metadata dimensions", async () => {
    const report = await generateTechnicalDrillDownReport({ limit: 5 });
    assert.ok(report.evidence_integrity, "Technical report must contain evidence_integrity block");

    const integrity = report.evidence_integrity;
    assert.ok(integrity.scan_timestamp);
    assert.equal(integrity.ecdat_version, ECDAT_VERSION);
    assert.ok(integrity.scanner_versions.network_tls_prober);
    assert.equal(integrity.configuration.config_hash_sha256.length, 64);
    assert.equal(integrity.policy_version.policy_hash_sha256.length, 64);
    assert.equal(integrity.cbom_version.cbom_sha256.length, 64);
  });

  test("validateEvidenceIntegrity confirms valid executive and technical reports", async () => {
    const execReport = await generateExecutiveReport();
    const execVerdict = validateEvidenceIntegrity(execReport);
    assert.equal(execVerdict.passed, true, `Executive violations: ${execVerdict.violations.join(", ")}`);

    const techReport = await generateTechnicalDrillDownReport();
    const techVerdict = validateEvidenceIntegrity(techReport);
    assert.equal(techVerdict.passed, true, `Technical violations: ${techVerdict.violations.join(", ")}`);
  });

  test("Anti-Deception Rule: Rejects reports claiming independent audit without formal third-party attestation", async () => {
    const report = await generateExecutiveReport();

    // Inject deceptive marketing claim into executive summary
    report.report_metadata.marketing_banner = "This system is officially third-party certified for banking!";

    const verdict = validateEvidenceIntegrity(report);
    assert.equal(verdict.passed, false, "Must fail when deceptive certification claim is present");
    assert.ok(
      verdict.violations.some((v) => v.includes("Deceptive certification claim detected")),
      "Must record deceptive claim violation"
    );
  });

  test("Anti-Deception Rule: Disallows independent_audit_obtained: true without auditor credentials", () => {
    const block = buildEvidenceIntegrity({
      isIndependentlyAudited: true,
      attestationDetails: {}, // missing auditor_identity and accreditation_body
    });

    const fakeReport = {
      evidence_integrity: block,
    };

    const verdict = validateEvidenceIntegrity(fakeReport);
    assert.equal(verdict.passed, false);
    assert.ok(verdict.violations.some((v) => v.includes("auditor_identity")));
    assert.ok(verdict.violations.some((v) => v.includes("accreditation_body")));
  });

  test("HTML reports display Evidence Integrity card and mandatory automated evaluation notice", async () => {
    const execReport = await generateExecutiveReport();
    const execHtml = generateExecutiveHtmlReport(execReport);

    assert.ok(execHtml.includes("EVIDENCE INTEGRITY &amp; PROVENANCE VERIFIED") || execHtml.includes("EVIDENCE INTEGRITY & PROVENANCE VERIFIED"));
    assert.ok(execHtml.includes("Fingerprint:"));
    assert.ok(execHtml.includes("Notice of Automated Evaluation"));
    assert.ok(execHtml.includes("does <u>not</u> constitute an independent third-party audit"));

    const techReport = await generateTechnicalDrillDownReport();
    const techHtml = generateTechnicalHtmlReport(techReport);
    assert.ok(techHtml.includes("EVIDENCE INTEGRITY &amp; PROVENANCE VERIFIED") || techHtml.includes("EVIDENCE INTEGRITY & PROVENANCE VERIFIED"));
    assert.ok(techHtml.includes("Notice of Automated Evaluation"));
  });

  test("POST /api/v1/reports/integrity/verify validates report integrity successfully", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const report = await generateExecutiveReport();
      const res = await fetch(`http://localhost:${port}/api/v1/reports/integrity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "ecdat-demo-admin-key-2026",
        },
        body: JSON.stringify({ report }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.verified, true);
      assert.equal(data.violations.length, 0);
      assert.equal(data.details.ecdat_version, ECDAT_VERSION);
    } finally {
      server.close();
    }
  });

  test("GET /api/v1/reports/integrity/status returns baseline integrity configuration", async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/v1/reports/integrity/status`, {
        headers: {
          "X-API-Key": "ecdat-demo-admin-key-2026",
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ecdat_version, "1.0.0");
      assert.ok(data.scanner_versions.static_tree_sitter_ast);
      assert.equal(data.configuration_hash.length, 64);
      assert.equal(data.policy_hash.length, 64);
      assert.equal(data.independent_attestation.independent_audit_obtained, false);
      assert.equal(data.independent_attestation.certification_status, "UNATTESTED_AUTOMATED_EVALUATION");
    } finally {
      server.close();
    }
  });
});
