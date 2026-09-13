const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  DiscoveryEngine,
  ScanRequest,
  ScanContext,
  Finding,
  Evidence,
  CryptoAsset,
  AssetRelationship,
  Observation,
  RiskAssessment,
  PolicyEvaluation,
  RemediationPlan,
  RemediationAction,
  ScanResult,
  ScanType,
  ScanStatus,
  SeverityLevel,
  ConfidenceLevel,
  AssetType,
  RelationshipType,
  QuantumRelevance,
  MoscaStatus,
} = require("../../src/domain/contracts");

const { ingestCbomPayload } = require("../../src/ingestion");
const { normalizeObservation } = require("../../src/normalization");
const { correlateAssetsAndFindings } = require("../../src/correlation");
const { assessRisk } = require("../../src/risk");
const { evaluatePolicy } = require("../../src/policy");
const { buildRemediationPlan } = require("../../src/remediation");
const { renderHtmlReport, renderExecutiveSummary } = require("../../src/presentation");

describe("Domain Contracts (Node.js)", () => {
  test("ScanRequest & ScanContext validation and immutability", () => {
    const req = new ScanRequest({
      scanType: ScanType.STATIC,
      target: "/path/to/repo",
      policyProfile: "regulated_bfsi",
      failOn: "critical",
    });

    assert.equal(req.scanType, "static");
    assert.equal(req.target, "/path/to/repo");
    assert.ok(Object.isFrozen(req));

    assert.throws(() => {
      new ScanRequest({});
    }, /ScanRequest requires target/);

    const ctx = new ScanContext({
      scanId: "scan_test_123",
      request: req,
    });

    assert.equal(ctx.scanId, "scan_test_123");
    assert.equal(ctx.isCancelled, false);
    assert.equal(ctx.progressPercent, 0);
  });

  test("Evidence & Observation creation", () => {
    const ev = new Evidence({
      location: "server.js",
      lineNumber: 45,
      snippet: "crypto.createHash('md5')",
      proofType: "source_code",
      confidence: ConfidenceLevel.HIGH,
    });

    assert.equal(ev.location, "server.js");
    assert.equal(ev.lineNumber, 45);
    assert.ok(Object.isFrozen(ev));

    assert.throws(() => {
      new Evidence({});
    }, /Evidence requires a valid location/);

    const obs = new Observation({
      discoveryEngine: "StaticScanEngine",
      target: "server.js",
      rawAlgorithm: "MD5",
      evidence: ev,
    });

    assert.equal(obs.discoveryEngine, "StaticScanEngine");
    assert.equal(obs.rawAlgorithm, "MD5");
    assert.ok(Object.isFrozen(obs));
  });

  test("Finding and CryptoAsset entities", () => {
    const ev = new Evidence({ location: "gateway.example.com:443" });
    const finding = new Finding({
      findingId: "fnd_001",
      assetId: "net:tls:gateway",
      algorithmStandard: "RSA-1024",
      primitiveType: "asymmetric_cipher",
      keySizeBits: 1024,
      severity: SeverityLevel.CRITICAL,
      evidence: ev,
    });

    assert.equal(finding.algorithmStandard, "RSA-1024");
    assert.equal(finding.keySizeBits, 1024);
    assert.equal(finding.severity, "Critical");
    assert.ok(Object.isFrozen(finding));

    const asset = new CryptoAsset({
      assetId: "net:tls:gateway",
      primaryIdentifier: "https://gateway.example.com",
      assetType: AssetType.NETWORK_ENDPOINT,
      highestSeverity: SeverityLevel.CRITICAL,
      atQuantumRisk: true,
      findingsCount: 1,
    });

    assert.equal(asset.assetType, "network_endpoint");
    assert.equal(asset.atQuantumRisk, true);
    assert.ok(Object.isFrozen(asset));
  });

  test("AssetRelationship creation and validation", () => {
    const rel = new AssetRelationship({
      sourceId: "net:tls:gateway",
      targetId: "cert:x509:leaf",
      relationshipType: RelationshipType.SECURES,
    });

    assert.equal(rel.sourceId, "net:tls:gateway");
    assert.equal(rel.targetId, "cert:x509:leaf");
    assert.equal(rel.relationshipType, "secures");
    assert.ok(Object.isFrozen(rel));

    assert.throws(() => {
      new AssetRelationship({ sourceId: "only_source" });
    }, /AssetRelationship requires sourceId and targetId/);
  });

  test("RiskAssessment & PolicyEvaluation", () => {
    const risk = new RiskAssessment({
      classicalSeverity: SeverityLevel.HIGH,
      classicalScore: 8.0,
      quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
      shorVulnerable: true,
      moscaStatus: MoscaStatus.AT_RISK,
      moscaCollapseYear: 2029,
      explainability: ["Vulnerable to Shor algorithm."],
    });

    assert.equal(risk.shorVulnerable, true);
    assert.equal(risk.moscaStatus, "AT_RISK");
    assert.ok(Object.isFrozen(risk));

    const policy = new PolicyEvaluation({
      policyProfile: "regulated_bfsi",
      failOnThreshold: "critical",
      passed: false,
      blockingReasons: ["Critical findings violate BFSI policy."],
    });

    assert.equal(policy.passed, false);
    assert.equal(policy.blockingReasons.length, 1);
    assert.ok(Object.isFrozen(policy));
  });

  test("RemediationAction & RemediationPlan", () => {
    const action = new RemediationAction({
      actionId: "act_001",
      assetId: "net:tls:gateway",
      priority: 1,
      title: "Migrate to ML-KEM-768",
      targetStandard: "ML-KEM-768",
      recommendedYear: 2026,
    });

    assert.equal(action.targetStandard, "ML-KEM-768");
    assert.equal(action.priority, 1);
    assert.ok(Object.isFrozen(action));

    const plan = new RemediationPlan({
      planId: "plan_001",
      scanId: "scan_001",
      actions: [action],
    });

    assert.equal(plan.totalActions, 1);
    assert.equal(plan.actions[0].actionId, "act_001");
    assert.ok(Object.isFrozen(plan));
  });

  test("ScanResult creation and DiscoveryEngine abstract enforcement", async () => {
    assert.throws(() => {
      new DiscoveryEngine();
    }, /Cannot instantiate abstract class DiscoveryEngine directly/);

    class MockEngine extends DiscoveryEngine {
      async scan(request, context) {
        return new ScanResult({
          scanId: context.scanId,
          scanType: request.scanType,
          target: request.target,
          status: ScanStatus.SUCCESS,
          engineName: this.name,
          engineVersion: this.version,
          durationSeconds: 0.05,
        });
      }
    }

    const engine = new MockEngine("MockEngine", "1.0.0");
    const req = new ScanRequest({ target: "test/" });
    const ctx = new ScanContext({ scanId: "scan_mock", request: req });
    const result = await engine.scan(req, ctx);

    assert.equal(result.scanId, "scan_mock");
    assert.equal(result.status, "success");
    assert.equal(result.engineName, "MockEngine");
    assert.ok(Object.isFrozen(result));
  });
});

describe("Domain Boundary Subsystems", () => {
  test("Ingestion boundary sanitizes private keys and validates schema", () => {
    const payload = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        {
          name: "TestComponent",
          type: "application",
          properties: [
            {
              name: "secret",
              value: "-----BEGIN RSA PRIVATE KEY-----\nMIIEfakekeydata\n-----END RSA PRIVATE KEY-----",
            },
          ],
        },
      ],
    };

    const res = ingestCbomPayload(payload);
    assert.equal(res.valid, true);
    assert.ok(res.sanitized.components[0].properties[0].value.includes("[REDACTED_PRIVATE_KEY]"));
  });

  test("Normalization boundary resolves canonical names and asset types", () => {
    const res = normalizeObservation({
      target: "src/crypto.c",
      rawAlgorithm: "md5",
      rawAssetType: "file",
      dataSensitivity: "internal",
      businessCriticality: "high",
      evidenceLocation: "src/crypto.c",
      evidenceSnippet: "MD5_Init(&ctx)",
    });

    assert.equal(res.finding.algorithmStandard, "MD5");
    assert.equal(res.asset.assetType, "file");
    assert.equal(res.asset.businessCriticality, "high");
  });

  test("Correlation boundary establishes AssetRelationships", () => {
    const rawComps = [
      { name: "libA", bom_ref: "ref_A", dependencies: ["ref_B"] },
    ];
    const findings = [
      { asset_id: "asset_01", bom_ref: "ref_A" },
    ];

    const { relationships, assetMap } = correlateAssetsAndFindings(rawComps, findings);
    assert.equal(relationships.length, 2);
    assert.equal(assetMap.get("asset_01").findings.length, 1);
  });

  test("Risk assessment boundary evaluates classical, quantum, and Mosca risks", () => {
    const finding = {
      algorithm: "RSA-1024",
      asset_type: "certificate",
      data_sensitivity: "internal",
      business_criticality: "medium",
    };

    const risk = assessRisk(finding, "regulated_bfsi");
    assert.equal(risk.classicalSeverity, "Critical");
    assert.equal(risk.shorVulnerable, true);
    assert.ok(risk.explainability.length > 0);
  });

  test("Policy boundary evaluates gates", () => {
    const findings = [{ severity: "Critical", algorithm: "MD5" }];
    const evalResult = evaluatePolicy(findings, "standard", "critical");

    assert.equal(evalResult.passed, false);
    assert.ok(evalResult.blockingReasons.length > 0);
  });

  test("Remediation boundary builds structured RemediationPlan", () => {
    const findings = [
      {
        algorithm: "RSA",
        key_size: 1024,
        severity: "Critical",
        asset_id: "asset_rsa",
        bom_ref: "asset_rsa",
        asset_type: "certificate",
      },
    ];

    const plan = buildRemediationPlan("scan_test_plan", findings);
    assert.equal(plan.scanId, "scan_test_plan");
    assert.ok(plan.totalActions >= 1);
    assert.equal(plan.actions[0].assetId, "asset_rsa");
  });

  test("Presentation boundary renders HTML and executive summaries", () => {
    const dummyRecord = {
      id: "scan_pres_test",
      target: "test_target",
      policy_profile: "standard",
      created_at: new Date().toISOString(),
      top_risky_assets: [],
      classified_findings: [],
    };

    const html = renderHtmlReport(dummyRecord);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("ECDAT"));

    const summary = renderExecutiveSummary(dummyRecord);
    assert.ok(summary.metrics);
    assert.equal(summary.scan_id, "scan_pres_test");
  });
});
