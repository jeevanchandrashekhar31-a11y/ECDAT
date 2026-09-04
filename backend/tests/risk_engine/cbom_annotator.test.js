const test = require("node:test");
const assert = require("node:assert");

const {
  annotateCbom,
  generateSummary,
  generateHtmlReport,
} = require("../../src/risk_engine");

// Sample valid CycloneDX 1.6 CBOM fixture
const sampleCbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "PaymentService",
      version: "2.4.0",
    },
  },
  components: [
    {
      type: "cryptographic-asset",
      name: "TLS 1.0",
      "bom-ref": "net:protocol/tls1.0@api.bank.com:443",
      cryptoProperties: {
        assetType: "protocol",
        protocolProperties: {
          type: "tls",
          version: "TLS 1.0",
          cipherSuites: ["TLS_RSA_WITH_AES_128_CBC_SHA"],
        },
      },
      properties: [{ name: "scanner:origin", value: "network_scanner" }],
      evidence: {
        occurrences: [
          {
            location: "api.bank.com:443",
            additionalContext: "negotiated during handshake",
          },
        ],
      },
    },
    {
      type: "cryptographic-asset",
      name: "RSA-2048",
      "bom-ref": "net:certificate/api.bank.com:443",
      cryptoProperties: {
        assetType: "certificate",
        certificateProperties: {
          subjectName: "CN=api.bank.com",
          issuerName: "CN=Internal CA",
          isExpired: false,
          isSelfSigned: false,
        },
      },
      properties: [
        { name: "ecdat:algorithm", value: "RSA" },
        { name: "ecdat:key_size", value: "2048" },
      ],
    },
    {
      type: "cryptographic-asset",
      name: "MD5",
      "bom-ref": "code:file@src/auth/legacy_token.c:42",
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: {
          parameterSetIdentifier: "128",
        },
      },
      properties: [{ name: "ecdat:algorithm", value: "MD5" }],
    },
  ],
};

test("CBOM Annotator - Enriches CycloneDX 1.6 without mutating core evidence or violating schema", () => {
  const { annotatedBOM, classifiedResults } = annotateCbom(sampleCbom, {
    policyProfile: "public_internet",
    scenario: "baseline",
  });

  // 1. Structure preserved
  assert.strictEqual(annotatedBOM.bomFormat, "CycloneDX");
  assert.strictEqual(annotatedBOM.specVersion, "1.6");
  assert.strictEqual(annotatedBOM.components.length, 3);

  // 2. Metadata properties added
  assert.ok(
    annotatedBOM.metadata.properties.some(
      (p) => p.name === "ecdat:risk:annotated_at",
    ),
  );
  assert.ok(
    annotatedBOM.metadata.properties.some(
      (p) =>
        p.name === "ecdat:risk:policy_profile" && p.value === "public_internet",
    ),
  );

  // 3. Scanner properties and evidence untouched
  const tlsComp = annotatedBOM.components.find((c) => c.name === "TLS 1.0");
  assert.ok(
    tlsComp.properties.some(
      (p) => p.name === "scanner:origin" && p.value === "network_scanner",
    ),
  );
  assert.strictEqual(
    tlsComp.evidence.occurrences[0].location,
    "api.bank.com:443",
  );

  // 4. Risk properties attached cleanly
  assert.ok(
    tlsComp.properties.some(
      (p) => p.name === "ecdat:risk:severity" && p.value === "Critical",
    ),
  );
  assert.ok(
    tlsComp.properties.some(
      (p) => p.name === "ecdat:risk:cicd_pass" && p.value === "false",
    ),
  );

  // 5. Check classified results count
  assert.strictEqual(classifiedResults.length, 3);
});

test("Summary Generator - Produces complete frontend summary schema", () => {
  const summary = generateSummary(sampleCbom, {
    policyProfile: "public_internet",
    scenario: "baseline",
  });

  // Metadata
  assert.strictEqual(summary.report_metadata.policy_profile, "public_internet");
  assert.strictEqual(summary.report_metadata.scenario, "baseline");
  assert.ok(summary.report_metadata.rule_version);

  // Metrics
  assert.strictEqual(summary.metrics.total_findings, 3);
  assert.strictEqual(summary.metrics.total_assets, 3);
  assert.strictEqual(summary.metrics.severity_counts.critical, 2); // TLS 1.0 and MD5
  assert.strictEqual(summary.metrics.overall_cicd_pass, false);

  // Top Risky Assets & Mosca Analysis Table
  assert.ok(summary.top_risky_assets.length > 0);
  assert.ok(summary.mosca_analysis_table.length > 0);
  const rsaRow = summary.mosca_analysis_table.find(
    (r) => r.algorithm === "RSA",
  );
  assert.ok(rsaRow);
  assert.ok(typeof rsaRow.X_shelf_life_years === "number");
  assert.ok(typeof rsaRow.mosca_margin_years === "number");

  // Recommendations
  assert.ok(summary.recommendations.length > 0);
  assert.ok(
    summary.recommendations.some(
      (r) => r.hybrid_transition_recommended === true,
    ),
  );

  // Assumptions
  assert.ok(summary.assumptions.length >= 2);
});

test("HTML Reporter - Generates complete, safe static HTML report", () => {
  const summary = generateSummary(sampleCbom, {
    policyProfile: "public_internet",
    scenario: "baseline",
  });

  const html = generateHtmlReport(summary);

  // Basic HTML structure
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.ok(html.includes("ECDAT Cryptographic Risk Assessment"));

  // Key metrics & sections present
  assert.ok(html.includes("Total Assets"));
  assert.ok(html.includes("Total Findings"));
  assert.ok(html.includes("Critical Findings"));
  assert.ok(html.includes("Top Risky Assets"));
  assert.ok(html.includes("Mosca Theorem Quantum Exposure Table"));
  assert.ok(
    html.includes("Post-Quantum &amp; Classical Migration Recommendations"),
  );
  assert.ok(html.includes("Evaluation Assumptions &amp; Scope"));

  // Verification that secrets are not included
  assert.strictEqual(html.includes("-----BEGIN PRIVATE KEY-----"), false);

  // CI/CD badge
  assert.ok(html.includes("CI/CD FAIL"));
});
