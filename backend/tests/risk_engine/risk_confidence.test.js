const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyFinding,
  generateSummary,
  annotateCbom,
  evaluateGate,
  Severities,
  RiskConfidence,
} = require("../../src/risk_engine");

test("Risk Confidence - Separates Critical severity from Low confidence for uncertain detections", () => {
  // MD5 detected via simple regex pattern / package inventory
  const result = classifyFinding({
    algorithm: "MD5",
    assetType: "file",
    evidenceType: "regex_pattern",
    evidenceConfidence: "low",
  });

  // Severity must remain Critical (broken crypto)
  assert.equal(result.severity, Severities.CRITICAL);
  assert.equal(result.risk_severity, Severities.CRITICAL);

  // Confidence must be explicitly LOW / uncertain
  assert.equal(result.risk_confidence, RiskConfidence.LOW);
  assert.equal(result.is_uncertain_detection, true);
  assert.ok(result.confidence_score <= 0.5);
  assert.ok(result.action_guidance.includes("Verify actively"));
});

test("Risk Confidence - AST verification yields High severity with High confidence", () => {
  // SHA-1 detected via AST direct call
  const result = classifyFinding({
    algorithm: "SHA-1",
    assetType: "file",
    evidenceType: "ast_visitor",
    reachability: "DIRECT_API_CALL",
  });

  assert.equal(result.severity, Severities.HIGH);
  assert.equal(result.risk_severity, Severities.HIGH);
  assert.equal(result.risk_confidence, RiskConfidence.HIGH);
  assert.equal(result.is_uncertain_detection, false);
  assert.ok(result.confidence_score >= 0.8);
  assert.ok(result.action_guidance.includes("Verified detection"));
});

test("Risk Confidence - Runtime confirmed detection yields Confirmed confidence", () => {
  const result = classifyFinding({
    algorithm: "DES",
    assetType: "network_session",
    reachability: "RUNTIME_CONFIRMED",
  });

  assert.equal(result.severity, Severities.CRITICAL);
  assert.equal(result.risk_confidence, RiskConfidence.CONFIRMED);
  assert.equal(result.is_uncertain_detection, false);
  assert.equal(result.confidence_score, 1.0);
});

test("Risk Confidence - Package inventory yields Low confidence to avoid treating presence as fact", () => {
  const result = classifyFinding({
    algorithm: "DES",
    assetType: "library_presence",
    evidenceType: "package_inventory",
  });

  assert.equal(result.risk_confidence, RiskConfidence.LOW);
  assert.equal(result.is_uncertain_detection, true);
  assert.ok(result.confidence_rationale.includes("package inventory"));
});

test("Risk Confidence - CI/CD gate with minConfidence excludes uncertain detections from failing build", () => {
  // Scenario: 1 Critical finding with LOW confidence (e.g. uncertain regex)
  const uncertainFinding = classifyFinding({
    algorithm: "MD5",
    assetType: "file",
    evidenceType: "heuristic_regex",
    evidenceConfidence: "low",
  });

  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    components: [
      {
        "bom-ref": "comp-regex-md5",
        name: "MD5",
        type: "cryptographic-asset",
        properties: [
          { name: "ecdat:evidence_type", value: "heuristic_regex" },
          { name: "ecdat:confidence", value: "low" },
        ],
      },
    ],
  };

  const summary = generateSummary(cbom);

  // Verification 1: Summary metrics capture confidence matrix & uncertain detections count
  assert.equal(summary.metrics.severity_counts.critical, 1);
  assert.equal(summary.metrics.confidence_counts.low, 1);
  assert.equal(summary.metrics.confidence_matrix.critical.low, 1);
  assert.equal(summary.metrics.uncertain_detections_count, 1);

  // Verification 2: Gate evaluation with default (any) will match and fail
  const gateAny = evaluateGate(summary, "critical", { minConfidence: "any" });
  assert.equal(gateAny.matched, true);

  // Verification 3: Gate evaluation with minConfidence: "high" ignores the low-confidence detection
  const gateHigh = evaluateGate(summary, "critical", { minConfidence: "high" });
  assert.equal(gateHigh.matched, false);
  assert.equal(gateHigh.counts.critical, 0);
  assert.equal(gateHigh.counts.uncertainCritical, 1);
  assert.ok(gateHigh.reason.includes("uncertain finding(s) excluded from gate enforcement"));
});

test("Risk Confidence - CBOM annotator preserves both risk_severity and risk_confidence in properties", () => {
  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    components: [
      {
        "bom-ref": "cert-1",
        name: "RSA",
        type: "cryptographic-asset",
        properties: [
          { name: "ecdat:key_size", value: "1024" },
          { name: "ecdat:evidence_type", value: "ast_call_graph" },
          { name: "ecdat:confidence", value: "high" },
        ],
      },
    ],
  };

  const { annotatedBOM } = annotateCbom(cbom);
  const comp = annotatedBOM.components[0];
  const props = comp.properties;

  const propMap = Object.fromEntries(props.map((p) => [p.name, p.value]));
  assert.equal(propMap["ecdat:risk:risk_severity"], "Critical");
  assert.equal(propMap["ecdat:risk:risk_confidence"], "HIGH");
  assert.equal(propMap["ecdat:risk:is_uncertain_detection"], "false");
});
