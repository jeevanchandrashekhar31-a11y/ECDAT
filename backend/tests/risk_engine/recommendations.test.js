const test = require("node:test");
const assert = require("node:assert");

const { classifyFinding } = require("../../src/risk_engine");

test("PQC Recommendations - Every AT_RISK or CRITICAL_URGENT finding receives a recommendation", () => {
  const atRiskFinding = classifyFinding({
    algorithm: "RSA",
    keySize: 2048,
    assetType: "stored_encrypted_data",
    dataSensitivity: "restricted",
    businessCriticality: "critical",
    scenario: "conservative",
  });

  assert.ok(
    atRiskFinding.mosca.status === "CRITICAL_URGENT" ||
      atRiskFinding.mosca.status === "AT_RISK",
  );
  assert.ok(atRiskFinding.recommendation, "Recommendation must exist");
  assert.ok(
    atRiskFinding.recommendation.priority === "critical" ||
      atRiskFinding.recommendation.priority === "high",
  );
  assert.ok(atRiskFinding.recommendation.recommended_target);
  assert.ok(atRiskFinding.recommendation.classical_remediation);
  assert.ok(atRiskFinding.recommendation.pqc_migration);
  assert.strictEqual(atRiskFinding.recommendation.benchmark_available, false);
  assert.strictEqual(
    atRiskFinding.recommendation.performance_measurement_mode,
    "qualitative_estimated",
  );
});

test("PQC Recommendations - Classical-only weaknesses receive classical remediation", () => {
  const md5Finding = classifyFinding({
    algorithm: "MD5",
    assetType: "file",
  });

  assert.strictEqual(md5Finding.classical_risk, "critical");
  const rec = md5Finding.recommendation;
  assert.ok(rec.classical_remediation.includes("SHA-256"));
  assert.ok(rec.pqc_migration.includes("Classical algorithm vulnerability"));
  assert.strictEqual(rec.hybrid_transition_recommended, false);
});

test("PQC Recommendations - Asset Context: TLS Endpoint with Hybrid KEX", () => {
  const tlsFinding = classifyFinding({
    algorithm: "ECDH",
    keySize: 256,
    assetType: "network_session",
    protocolProperties: { tlsVersion: "TLS 1.3" },
  });

  const rec = tlsFinding.recommendation;
  assert.strictEqual(rec.hybrid_transition_recommended, true);
  assert.ok(rec.recommended_target.includes("X25519MLKEM768"));
  assert.ok(rec.current_state.includes("ECDH"));
  assert.ok(
    ["minor", "negligible", "low_to_medium"].includes(rec.latency_impact),
  );
});

test("PQC Recommendations - Asset Context: Hardcoded Private Key", () => {
  const hardcodedKey = classifyFinding({
    algorithm: "RSA",
    keySize: 2048,
    assetType: "hardcoded_private_key",
    dataSensitivity: "confidential",
  });

  const rec = hardcodedKey.recommendation;
  assert.ok(rec.classical_remediation.includes("revoke and purge"));
  assert.ok(rec.current_state.includes("hardcoded private key"));
  assert.strictEqual(rec.benchmark_available, false);
});

test("PQC Recommendations - Asset Context: Certificate and Signing", () => {
  const certFinding = classifyFinding({
    algorithm: "RSA",
    keySize: 2048,
    assetType: "certificate",
    certificateProperties: { isSelfSigned: false, isExpired: false },
  });

  const rec = certFinding.recommendation;
  assert.strictEqual(rec.hybrid_transition_recommended, true);
  assert.ok(rec.classical_remediation.includes("RSA-3072"));
  assert.ok(
    rec.pqc_migration.includes("ML-DSA") ||
      rec.pqc_migration.includes("ML-KEM"),
  );
  assert.ok(
    rec.references.some((r) => r.includes("FIPS 204") || r.includes("IETF")),
  );
});

test("PQC Recommendations - Asset Context: Container and Library Inventory", () => {
  const libFinding = classifyFinding({
    algorithm: "OpenSSL",
    assetType: "library_presence",
    evidenceType: "package_inventory",
  });

  const rec = libFinding.recommendation;
  assert.strictEqual(rec.hybrid_transition_recommended, true);
  assert.ok(rec.pqc_migration.includes("OpenSSL 3.2+"));
  assert.ok(rec.current_state.includes("library presence"));
});

test("PQC Recommendations - Asset Context: SSH Endpoint", () => {
  const sshFinding = classifyFinding({
    algorithm: "Diffie-Hellman",
    assetType: "network_session",
    protocol: "SSH",
    evidenceContext: "SSH server negotiated diffie-hellman-group14-sha1",
  });

  const rec = sshFinding.recommendation;
  assert.strictEqual(rec.hybrid_transition_recommended, true);
  assert.ok(
    rec.recommended_target.includes("sntrup761x25519") ||
      rec.recommended_target.includes("mlkem768x25519"),
  );
  assert.strictEqual(rec.migration_complexity, "low");
});

test("PQC Recommendations - Asset Context: Stored Encrypted Data", () => {
  const storedDataFinding = classifyFinding({
    algorithm: "AES",
    keySize: 128,
    assetType: "stored_encrypted_data",
    dataSensitivity: "restricted",
  });

  const rec = storedDataFinding.recommendation;
  assert.ok(
    rec.recommended_target.includes("ML-KEM") ||
      rec.recommended_target.includes("AES-256"),
  );
  assert.ok(
    rec.pqc_migration.includes("DEKs") || rec.pqc_migration.includes("AES-256"),
  );
});
