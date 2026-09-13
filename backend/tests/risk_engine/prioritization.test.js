const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prioritizeEnterpriseRisk,
  determineRemediationEffort,
  generateWhyNowReasoning,
  generateSummary,
  Severities,
  MoscaStatus,
  RemediationEffort,
} = require("../../src/risk_engine");

test("Prioritization - Top critical assets ranked by priority with Why Now reasoning", () => {
  const findings = [
    {
      asset_id: "edge-tls-1",
      algorithm: "TLS 1.0",
      asset_type: "network_session",
      application: "PaymentGateway",
      business_unit: "Payments",
      is_internet_facing: true,
      risk_score: 95,
      risk_severity: Severities.CRITICAL,
      risk_confidence: "CONFIRMED",
    },
    {
      asset_id: "internal-sha1",
      algorithm: "SHA-1",
      asset_type: "file",
      application: "BatchReports",
      business_unit: "Analytics",
      is_internet_facing: false,
      risk_score: 55,
      risk_severity: Severities.MEDIUM,
      risk_confidence: "HIGH",
    },
    {
      asset_id: "db-rsa-1024",
      algorithm: "RSA-1024",
      asset_type: "stored_encrypted_data",
      application: "CoreLedger",
      business_unit: "Core Banking",
      is_internet_facing: false,
      risk_score: 88,
      risk_severity: Severities.CRITICAL,
      risk_confidence: "HIGH",
      mosca: {
        status: MoscaStatus.CRITICAL_URGENT,
        mosca_margin_years: 2,
        final_values: { X_shelf_life_years: 10, Y_migration_years: 3, Z_quantum_threat_years: 9 },
      },
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);

  // Top critical assets verification
  assert.ok(result.top_critical_assets.length >= 3);
  const top1 = result.top_critical_assets[0];
  assert.equal(top1.asset_id, "edge-tls-1");
  assert.ok(top1.priority_score > result.top_critical_assets[1].priority_score);
  assert.equal(top1.is_internet_facing, true);
  assert.equal(top1.why_now.urgency, "IMMEDIATE");
  assert.ok(top1.why_now.rationale.length > 10);
  assert.ok(top1.why_now.consequences_of_delay.length > 10);
});

test("Prioritization - Business-unit risk aggregates scores and pinpoints high-exposure units", () => {
  const findings = [
    {
      asset_id: "pay-1",
      algorithm: "DES",
      application: "CardProcessor",
      business_unit: "Payments",
      is_internet_facing: true,
      risk_score: 90,
      risk_severity: Severities.CRITICAL,
    },
    {
      asset_id: "pay-2",
      algorithm: "MD5",
      application: "CardToken",
      business_unit: "Payments",
      is_internet_facing: true,
      risk_score: 85,
      risk_severity: Severities.CRITICAL,
    },
    {
      asset_id: "hr-1",
      algorithm: "AES-256",
      application: "Portal",
      business_unit: "HR Systems",
      is_internet_facing: false,
      risk_score: 20,
      risk_severity: Severities.LOW,
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const buRisk = result.business_unit_risk;

  assert.ok(buRisk.length >= 2);
  const paymentsBU = buRisk.find((b) => b.business_unit === "Payments");
  assert.ok(paymentsBU);
  assert.equal(paymentsBU.critical_count, 2);
  assert.equal(paymentsBU.internet_facing_count, 2);
  assert.ok(paymentsBU.composite_risk_score > 80);
  assert.ok(paymentsBU.why_now.includes("Immediate executive attention"));
});

test("Prioritization - Application risk identifies high-risk internet exposed services", () => {
  const findings = [
    {
      asset_id: "svc-1",
      algorithm: "RC4",
      application: "AuthService",
      business_unit: "Security",
      is_internet_facing: true,
      risk_score: 85,
      risk_severity: Severities.CRITICAL,
      dependency_blast_radius: 6,
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const app = result.application_risk.find((a) => a.application === "AuthService");

  assert.ok(app);
  assert.equal(app.is_internet_exposed, true);
  assert.equal(app.dependency_blast_radius, 6);
  assert.ok(app.why_now.includes("Critical internet-facing exposure"));
});

test("Prioritization - Internet-facing risk isolates external attack surface", () => {
  const findings = [
    {
      asset_id: "ext-api",
      algorithm: "TLS 1.0",
      application: "PublicApi",
      is_internet_facing: true,
      risk_score: 90,
      risk_severity: Severities.CRITICAL,
    },
    {
      asset_id: "int-db",
      algorithm: "AES-128",
      application: "InternalDb",
      is_internet_facing: false,
      risk_score: 30,
      risk_severity: Severities.LOW,
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  assert.equal(result.internet_facing_risk.total_exposed_assets, 1);
  assert.equal(result.internet_facing_risk.critical_exposed_count, 1);
  assert.ok(result.internet_facing_risk.why_now.includes("public internet traffic"));
});

test("Prioritization - PQC migration urgency identifies Mosca deficits and HNDL threats", () => {
  const findings = [
    {
      asset_id: "confidential-rsa",
      algorithm: "RSA-2048",
      application: "PatientVault",
      data_sensitivity: "restricted",
      mosca: {
        status: MoscaStatus.CRITICAL_URGENT,
        mosca_margin_years: 4,
        final_values: { X_shelf_life_years: 12, Y_migration_years: 3, Z_quantum_threat_years: 9 },
      },
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const pqc = result.pqc_migration_urgency;

  assert.equal(pqc.critical_urgent_count, 1);
  assert.ok(pqc.why_now.includes("CRITICAL QUANTUM DEFICIT"));
  assert.ok(pqc.assets[0].why_now.includes("Harvest-Now-Decrypt-Later"));
  assert.ok(pqc.assets[0].consequences_of_delay.includes("quantum adversaries"));
});

test("Prioritization - Certificate urgency flags expired and imminent expiration", () => {
  const findings = [
    {
      asset_id: "cert-expired",
      algorithm: "RSA-2048",
      asset_type: "certificate",
      application: "WebPortal",
      certificateProperties: { isExpired: true, daysToExpiry: -2 },
    },
    {
      asset_id: "cert-expiring-soon",
      algorithm: "ECDSA-P256",
      asset_type: "certificate",
      application: "MobileApi",
      certificateProperties: { isExpired: false, daysToExpiry: 5 },
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const certs = result.certificate_urgency;

  assert.equal(certs.expired_count, 1);
  assert.equal(certs.expiring_within_14_days, 1);
  assert.ok(certs.why_now.includes("expired or expiring within 14 days"));
  assert.equal(certs.certificates[0].urgency, "IMMEDIATE");
});

test("Prioritization - Dependency blast radius highlights central high-leverage packages", () => {
  const findings = [
    {
      asset_id: "lib-crypto-core",
      algorithm: "OpenSSL-1.0.1",
      asset_type: "library_presence",
      application: "SharedPlatform",
      dependency_blast_radius: 12,
      reachability: "RUNTIME_CONFIRMED",
    },
    {
      asset_id: "lib-cli-tool",
      algorithm: "CryptoLib",
      asset_type: "library_presence",
      application: "Tool",
      dependency_blast_radius: 1,
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const deps = result.dependency_blast_radius;

  assert.equal(deps.high_blast_count, 1);
  assert.ok(deps.why_now.includes("upstream library updates"));
  assert.ok(deps.components[0].why_now.includes("Shared by 12 service(s)"));
});

test("Prioritization - Remediation effort isolates Quick Wins from Complex PQC migrations", () => {
  const findings = [
    {
      asset_id: "cert-win",
      algorithm: "RSA-2048",
      asset_type: "certificate",
      risk_score: 75,
      certificateProperties: { isExpired: true },
    },
    {
      asset_id: "complex-store",
      algorithm: "DES",
      asset_type: "stored_encrypted_data",
      risk_score: 95,
      mosca: { status: MoscaStatus.CRITICAL_URGENT },
    },
  ];

  const result = prioritizeEnterpriseRisk(findings);
  const effort = result.remediation_effort;

  assert.equal(effort.quick_wins_count, 1);
  assert.equal(effort.quick_wins[0].asset_id, "cert-win");
  assert.ok(effort.effort_breakdown.COMPLEX >= 1);
  assert.ok(effort.why_now.includes("Quick Win"));
});

test("Prioritization - Summary generator embeds complete prioritization insights", () => {
  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    components: [
      {
        "bom-ref": "net:ext:tls10",
        name: "TLS 1.0",
        type: "cryptographic-asset",
        properties: [
          { name: "ecdat:business_unit", value: "Payments" },
          { name: "ecdat:internet_exposed", value: "true" },
        ],
      },
    ],
  };

  const summary = generateSummary(cbom);
  assert.ok(summary.prioritization);
  assert.ok(summary.prioritization.top_critical_assets.length >= 1);
  assert.ok(summary.prioritization.business_unit_risk.length >= 1);
  assert.ok(summary.prioritization.internet_facing_risk.total_exposed_assets >= 1);
  assert.ok(summary.prioritization.remediation_effort.quick_wins_count >= 1);
});
