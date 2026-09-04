const test = require("node:test");
const assert = require("node:assert");

const {
  classifyFinding,
  calculateMosca,
  assessFindings,
  Severities,
  MoscaStatus,
  QuantumRelevance,
} = require("../../src/risk_engine");

test("Risk Engine - MD5 is classified as Critical classical risk", () => {
  const result = classifyFinding({
    algorithm: "md5",
    assetType: "file",
    policyProfile: "internal_enterprise",
  });

  assert.strictEqual(result.algorithm, "MD5");
  assert.strictEqual(result.severity, Severities.CRITICAL);
  assert.strictEqual(result.classical_risk, "critical");
  assert.strictEqual(
    result.quantum_relevance,
    QuantumRelevance.GROVER_SENSITIVE,
  );
  assert.ok(result.explanation.includes("MD5"));
  assert.ok(result.recommendation.proposed_option.includes("SHA-256"));
});

test("Risk Engine - SHA-1 is classified as High classical risk", () => {
  const result = classifyFinding({
    algorithm: "SHA1",
    assetType: "file",
    policyProfile: "internal_enterprise",
  });

  assert.strictEqual(result.algorithm, "SHA-1");
  assert.strictEqual(result.severity, Severities.HIGH);
  assert.strictEqual(result.classical_risk, "high");
  assert.ok(result.explanation.includes("SHA-1"));
  assert.ok(
    result.recommendation.recommendation_id === "rec_classical_hash_broken",
  );
});

test("Risk Engine - RSA-1024 is Critical due to weak key size condition", () => {
  const result = classifyFinding({
    algorithm: "rsa",
    keySize: 1024,
    assetType: "certificate",
    policyProfile: "internal_enterprise",
  });

  assert.strictEqual(result.algorithm, "RSA");
  assert.strictEqual(result.key_size, 1024);
  assert.strictEqual(result.severity, Severities.CRITICAL);
  assert.strictEqual(result.classical_risk, "critical");
  assert.strictEqual(
    result.quantum_relevance,
    QuantumRelevance.SHOR_VULNERABLE,
  );
  assert.ok(result.applied_rule_ids.includes("rsa_cond_<_2048"));
});

test("Risk Engine - RSA-2048 is Medium under standard policy but flagged under Regulated BFSI", () => {
  // 1. Standard Enterprise profile (requires 2048)
  const enterpriseResult = classifyFinding({
    algorithm: "RSA-2048",
    assetType: "certificate",
    policyProfile: "internal_enterprise",
    dataSensitivity: "internal",
  });
  assert.strictEqual(enterpriseResult.algorithm, "RSA");
  assert.strictEqual(enterpriseResult.key_size, 2048);
  assert.strictEqual(enterpriseResult.severity, Severities.MEDIUM);

  // 2. Regulated BFSI profile (requires 3072 bits)
  const bfsiResult = classifyFinding({
    algorithm: "RSA-2048",
    assetType: "certificate",
    policyProfile: "regulated_bfsi",
    dataSensitivity: "confidential",
  });
  assert.strictEqual(bfsiResult.key_size, 2048);
  assert.ok(
    bfsiResult.policy_violations.some((v) =>
      v.includes("below profile requirement (3072 bits)"),
    ),
  );
  assert.ok(
    [Severities.HIGH, Severities.CRITICAL].includes(bfsiResult.severity),
  );
});

test("Risk Engine - ECC P-256 evaluates Shor vulnerability with hybrid recommendation", () => {
  const result = classifyFinding({
    algorithm: "prime256v1",
    keySize: 256,
    assetType: "network_session",
    policyProfile: "public_internet",
  });

  assert.strictEqual(result.algorithm, "ECDH");
  assert.strictEqual(result.classical_risk, "none");
  assert.strictEqual(
    result.quantum_relevance,
    QuantumRelevance.SHOR_VULNERABLE,
  );
  assert.ok(result.recommendation.proposed_option.includes("X25519MLKEM768"));
});

test("Risk Engine - AES-128 vs AES-256 Grover quantum security margin", () => {
  const aes128 = classifyFinding({
    algorithm: "AES-128",
    keySize: 128,
    assetType: "stored_encrypted_data",
    dataSensitivity: "confidential",
  });
  assert.strictEqual(aes128.classical_risk, "none");
  assert.strictEqual(
    aes128.quantum_relevance,
    QuantumRelevance.GROVER_SENSITIVE,
  );
  assert.strictEqual(aes128.severity, Severities.LOW);
  assert.ok(aes128.recommendation.proposed_option.includes("AES-256"));

  const aes256 = classifyFinding({
    algorithm: "AES-256",
    keySize: 256,
    assetType: "stored_encrypted_data",
    dataSensitivity: "confidential",
  });
  assert.strictEqual(aes256.classical_risk, "none");
  assert.strictEqual(aes256.severity, Severities.INFORMATIONAL);
});

test("Risk Engine - TLS 1.0 (Critical) vs TLS 1.2 vs TLS 1.3", () => {
  const tls10 = classifyFinding({
    algorithm: "TLS 1.0",
    assetType: "network_session",
    policyProfile: "public_internet",
  });
  assert.strictEqual(tls10.severity, Severities.CRITICAL);
  assert.strictEqual(tls10.cicd_pass, false);

  const tls12 = classifyFinding({
    algorithm: "TLS 1.2",
    assetType: "network_session",
    policyProfile: "public_internet",
  });
  assert.strictEqual(tls12.classical_risk, "low");
  assert.strictEqual(tls12.cicd_pass, true);

  const tls13 = classifyFinding({
    algorithm: "TLS 1.3",
    assetType: "network_session",
    policyProfile: "public_internet",
  });
  assert.strictEqual(tls13.classical_risk, "none");
  assert.strictEqual(tls13.cicd_pass, true);
});

test("Risk Engine - Self-signed certificate in Public Internet vs Internal Enterprise", () => {
  // Public Internet: Strictly forbidden -> High/Critical severity, CI/CD fails
  const publicCert = classifyFinding({
    algorithm: "RSA",
    keySize: 2048,
    assetType: "certificate",
    policyProfile: "public_internet",
    certificateProperties: { isSelfSigned: true, isExpired: false },
  });
  assert.ok(
    publicCert.policy_violations.some((v) => v.includes("strictly prohibited")),
  );
  assert.strictEqual(publicCert.cicd_pass, false);

  // Internal Enterprise: Acceptable under documented internal exception -> Medium
  const internalCert = classifyFinding({
    algorithm: "RSA",
    keySize: 2048,
    assetType: "certificate",
    policyProfile: "internal_enterprise",
    certificateProperties: { isSelfSigned: true, isExpired: false },
  });
  assert.ok(
    internalCert.policy_violations.some((v) =>
      v.includes("acceptable under documented internal exception"),
    ),
  );
  assert.strictEqual(internalCert.severity, Severities.MEDIUM);
});

test("Risk Engine - High sensitivity vs Low sensitivity Mosca calculation", () => {
  // Public data (X = 0) -> SAFE
  const publicMosca = calculateMosca({
    assetType: "stored_encrypted_data",
    dataSensitivity: "public",
    businessCriticality: "low",
    scenario: "baseline",
  });
  assert.strictEqual(publicMosca.final_values.X_shelf_life_years, 0);
  assert.strictEqual(publicMosca.status, MoscaStatus.SAFE);

  // Restricted data with long shelf life (X = 37.5) on Shor-vulnerable key -> CRITICAL_URGENT
  const restrictedMosca = calculateMosca({
    assetType: "stored_encrypted_data",
    dataSensitivity: "restricted",
    businessCriticality: "critical",
    scenario: "baseline",
    quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
  });
  assert.ok(restrictedMosca.final_values.X_shelf_life_years >= 30);
  assert.ok(restrictedMosca.mosca_margin_years > 2.5);
  assert.strictEqual(restrictedMosca.status, MoscaStatus.CRITICAL_URGENT);
});

test("Risk Engine - Mosca Safe, Watch, and At-Risk boundaries", () => {
  // Safe: Transient network session with optimistic timeline
  const safeCase = calculateMosca({
    assetType: "network_session",
    dataSensitivity: "internal",
    businessCriticality: "low",
    scenario: "optimistic",
    quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
  });
  assert.strictEqual(safeCase.status, MoscaStatus.SAFE);

  // Watch: Margin approaching 0
  const watchCase = calculateMosca({
    assetType: "certificate",
    dataSensitivity: "internal",
    businessCriticality: "high",
    scenario: "baseline",
    quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
  });
  assert.ok([MoscaStatus.WATCH, MoscaStatus.SAFE].includes(watchCase.status));

  // At Risk: Conservative scenario with long migration
  const atRiskCase = calculateMosca({
    assetType: "stored_encrypted_data",
    dataSensitivity: "confidential",
    businessCriticality: "high",
    scenario: "conservative",
    quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
  });
  assert.ok(
    [MoscaStatus.AT_RISK, MoscaStatus.CRITICAL_URGENT].includes(
      atRiskCase.status,
    ),
  );
});

test("Risk Engine - Correlated findings deduplication per asset", () => {
  const serverFindings = [
    {
      assetId: "srv-prod-01:443",
      algorithm: "TLS 1.0",
      assetType: "network_session",
    },
    {
      assetId: "srv-prod-01:443",
      algorithm: "RSA",
      keySize: 1024,
      assetType: "certificate",
    },
    {
      assetId: "srv-prod-01:443",
      algorithm: "AES-128",
      keySize: 128,
      assetType: "network_session",
    },
  ];

  const assessment = assessFindings(serverFindings, {
    policyProfile: "public_internet",
  });

  // 3 individual findings preserved
  assert.strictEqual(assessment.findings.length, 3);
  // Grouped to 1 distinct asset
  assert.strictEqual(assessment.assets.length, 1);
  assert.strictEqual(assessment.assets[0].asset_id, "srv-prod-01:443");
  assert.strictEqual(
    assessment.assets[0].highest_severity,
    Severities.CRITICAL,
  );
  assert.strictEqual(assessment.metrics.total_assets, 1);
  assert.strictEqual(assessment.metrics.overall_cicd_pass, false);
});
