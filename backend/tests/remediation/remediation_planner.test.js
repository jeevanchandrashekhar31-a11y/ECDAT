const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RemediationPlanner,
  getDefaultRemediationPlanner,
  planFindingRemediation,
  planRemediations,
} = require("../../src/remediation");

test("Remediation Planner - Defaults strictly to DRY RUN", () => {
  const finding = {
    id: "fnd-1",
    algorithm: "MD5",
    severity: "HIGH",
    file: "auth/tokens.js",
  };

  const plan = planRemediations([finding]);
  assert.equal(plan.mode, "DRY_RUN");
  assert.equal(plan.is_dry_run, true);
  assert.equal(plan.summary.default_mode, "DRY_RUN");

  const item = plan.remediations[0];
  assert.equal(item.dry_run.mode, "DRY_RUN");
  assert.equal(item.dry_run.is_dry_run, true);
  assert.ok(item.dry_run.safety_guarantee.includes("No files, certificates, or runtime configurations were modified"));
});

test("Remediation Planner - Generates all 10 required dimensions for every finding", () => {
  const finding = {
    id: "fnd-pqc-tls",
    title: "Classical TLS Key Exchange",
    algorithm: "ECDH",
    primitiveType: "key_exchange",
    severity: "HIGH",
    confidence: "HIGH",
    analysisSource: "ast",
    evidence: {
      location: "nginx/conf.d/api.conf",
      lineNumber: 14,
    },
  };
  const asset = {
    assetId: "asset-edge-gateway",
    name: "Edge API Gateway",
    assetType: "network_session",
    is_internet_facing: true,
    environment: "production",
    business_unit: "core-banking",
  };

  const item = planFindingRemediation(finding, { asset });

  // 1. Finding
  assert.ok(item.finding);
  assert.equal(item.finding.id, "fnd-pqc-tls");
  assert.equal(item.finding.severity, "HIGH");

  // 2. Why it matters
  assert.ok(item.why_it_matters);
  assert.ok(item.why_it_matters.summary);
  assert.ok(Array.isArray(item.why_it_matters.detailed_reasons));
  assert.ok(item.why_it_matters.detailed_reasons.length >= 1);

  // 3. Affected asset
  assert.ok(item.affected_asset);
  assert.equal(item.affected_asset.asset_id, "asset-edge-gateway");
  assert.equal(item.affected_asset.is_internet_facing, true);
  assert.equal(item.affected_asset.environment, "production");

  // 4. Recommended remediation
  assert.ok(item.recommended_remediation);
  assert.ok(item.recommended_remediation.action_type);
  assert.ok(item.recommended_remediation.summary);
  assert.ok(item.recommended_remediation.steps.length >= 2);

  // 5. Migration options
  assert.ok(Array.isArray(item.migration_options));
  assert.ok(item.migration_options.length >= 3);
  const types = item.migration_options.map((o) => o.type);
  assert.ok(types.some((t) => t.includes("PQC")));
  assert.ok(types.includes("COMPENSATING_CONTROL"));

  // 6. Expected impact
  assert.ok(item.expected_impact);
  assert.ok(item.expected_impact.blast_radius);
  assert.ok(item.expected_impact.latency_impact);
  assert.ok(item.expected_impact.downtime_requirement);

  // 7. Dependencies
  assert.ok(item.dependencies);
  assert.ok(Array.isArray(item.dependencies.required_libraries));
  assert.ok(Array.isArray(item.dependencies.minimum_runtime_versions));

  // 8. Testing plan
  assert.ok(item.testing_plan);
  assert.ok(Array.isArray(item.testing_plan.stages));
  assert.ok(item.testing_plan.stages.length >= 3);

  // 9. Rollback plan
  assert.ok(item.rollback_plan);
  assert.equal(item.rollback_plan.zero_downtime_guaranteed, true);
  assert.ok(Array.isArray(item.rollback_plan.step_by_step_procedure));

  // 10. Confidence
  assert.ok(item.confidence);
  assert.ok(["CONFIRMED", "HIGH", "MEDIUM", "LOW"].includes(item.confidence.level));
  assert.ok(item.confidence.score >= 0.5);
});

test("Remediation Planner - Remediates classical weak algorithms (MD5, 3DES, TLS 1.0)", () => {
  const md5Finding = { algorithm: "MD5", severity: "HIGH" };
  const md5Plan = planFindingRemediation(md5Finding);
  assert.ok(md5Plan.why_it_matters.summary.toLowerCase().includes("collision"));
  assert.ok(md5Plan.recommended_remediation.summary.includes("SHA-256"));

  const desFinding = { algorithm: "3DES", severity: "CRITICAL" };
  const desPlan = planFindingRemediation(desFinding);
  assert.ok(desPlan.recommended_remediation.summary.includes("AES-256-GCM"));

  const tls10Finding = { algorithm: "TLS 1.0", severity: "CRITICAL" };
  const tlsPlan = planFindingRemediation(tls10Finding);
  assert.equal(tlsPlan.recommended_remediation.action_type, "CONFIG_UPDATE");
});

test("Remediation Planner - Zero secret leakage and cryptographic redaction", () => {
  const rawSecret = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
  const leakedFinding = {
    id: "fnd-leak",
    algorithm: "RSA",
    private_key: rawSecret,
    evidence: {
      location: "certs/private.pem",
      password: "SuperSecretPassword123!",
    },
  };

  const plan = planFindingRemediation(leakedFinding);
  const jsonStr = JSON.stringify(plan);

  assert.ok(!jsonStr.includes(rawSecret));
  assert.ok(!jsonStr.includes("SuperSecretPassword123!"));
  assert.ok(jsonStr.includes("[REDACTED_SECRET SHA256:"));
});

test("Remediation Planner - Supports CycloneDX CBOM format and explicit apply mode", () => {
  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [
      {
        name: "RC4 Cipher Suite",
        "bom-ref": "comp-rc4",
        cryptoProperties: {
          assetType: "algorithm",
          algorithmProperties: { name: "RC4" },
        },
      },
    ],
  };

  const plan = planRemediations(cbom, { dryRun: false });
  assert.equal(plan.mode, "APPLY");
  assert.equal(plan.is_dry_run, false);
  assert.equal(plan.summary.total_actionable_findings, 1);
  assert.equal(plan.remediations[0].dry_run.mode, "LIVE_APPLY");
  assert.ok(plan.plan_digest);
});
