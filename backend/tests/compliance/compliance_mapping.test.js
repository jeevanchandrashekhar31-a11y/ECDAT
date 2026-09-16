const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ComplianceMapper,
  NON_CERTIFICATION_DISCLAIMER,
  SUPPORT_LEVELS,
  sanitizeEvidenceData,
  redactSecretString,
  getDefaultComplianceMapper,
  assessCompliance,
} = require("../../src/compliance");

test("Compliance Mapping - Loads catalog with valid standards and disclaimer", () => {
  const mapper = new ComplianceMapper();
  const catalog = mapper.getCatalog();

  assert.ok(Array.isArray(catalog.standards));
  assert.ok(catalog.standards.length >= 5);
  assert.equal(catalog.disclaimer, NON_CERTIFICATION_DISCLAIMER);
});

test("Compliance Mapping - Lists standards and retrieves specific standard by ID", () => {
  const mapper = getDefaultComplianceMapper();
  const standards = mapper.listStandards();

  assert.ok(standards.length >= 5);
  const ids = standards.map((s) => s.id);
  assert.ok(ids.includes("nist_sp_800_53_r5"));
  assert.ok(ids.includes("nist_cnsa_2_0"));
  assert.ok(ids.includes("pci_dss_v4"));
  assert.ok(ids.includes("nist_sp_800_131a_r2"));
  assert.ok(ids.includes("iso_iec_27001_2022"));

  const nist53 = mapper.getStandard("nist_sp_800_53_r5");
  assert.ok(nist53);
  assert.equal(nist53.id, "nist_sp_800_53_r5");
  assert.ok(nist53.controls.length >= 6);

  const nonExistent = mapper.getStandard("unknown_standard_999");
  assert.equal(nonExistent, null);
});

test("Compliance Mapping - Strictly adheres to allowed support level enum", () => {
  const mapper = new ComplianceMapper();
  const catalog = mapper.getCatalog();
  const validSet = new Set(SUPPORT_LEVELS);

  for (const std of catalog.standards) {
    for (const ctrl of std.controls) {
      assert.ok(
        validSet.has(ctrl.support_level),
        `Invalid support level '${ctrl.support_level}' in control ${ctrl.control_id}`,
      );
    }
  }
});

test("Compliance Mapping - Non-certification disclaimer and certification_claimed=false", () => {
  const mapper = new ComplianceMapper();
  const dummyAssets = [
    { name: "test-cipher", algorithm: "AES-256-GCM", key_size: 256, asset_type: "cipher" },
  ];

  const report = mapper.assess(dummyAssets);
  assert.equal(report.disclaimer, NON_CERTIFICATION_DISCLAIMER);
  assert.equal(report.certification_claimed, false);
  assert.ok(report.evidence_digest);
  assert.equal(report.evidence_digest.length, 64);
});

test("Compliance Mapping - Zero secret leakage and cryptographic redaction", () => {
  const rawKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y3...\n-----END RSA PRIVATE KEY-----";
  const rawAsset = {
    name: "payment_signing_key",
    private_key: rawKey,
    nested: {
      password: "SuperSecretPassword123!",
      api_key: "api-secret-1234567890abcdef",
    },
    algorithm: "RSA",
  };

  const sanitized = sanitizeEvidenceData(rawAsset);

  assert.ok(!JSON.stringify(sanitized).includes(rawKey));
  assert.ok(!JSON.stringify(sanitized).includes("SuperSecretPassword123!"));
  assert.ok(sanitized.private_key.startsWith("[REDACTED_SECRET SHA256:"));
  assert.ok(sanitized.nested.password.startsWith("[REDACTED_SECRET SHA256:"));
});

test("Compliance Mapping - Evaluates compliant vs non-compliant controls", () => {
  const mapper = new ComplianceMapper();

  // Compliant assets
  const compliantAssets = [
    {
      id: "tls-asset",
      name: "Gateway TLS",
      asset_type: "protocol",
      protocol: "TLS 1.3",
      cipher_suite: "TLS_AES_256_GCM_SHA384",
    },
    {
      id: "aes-asset",
      name: "Storage Encryption Key",
      asset_type: "cipher",
      algorithm: "AES-256",
      key_size: 256,
    },
  ];

  const okReport = mapper.assess(compliantAssets, ["pci_dss_v4"]);
  const pciStd = okReport.standards.find((s) => s.standard_id === "pci_dss_v4");
  const req421 = pciStd.controls.find((c) => c.control_id === "Req 4.2.1");
  assert.equal(req421.compliant, true);
  assert.ok(req421.evidence_count > 0);

  // Non-compliant assets
  const nonCompliantAssets = [
    {
      id: "legacy-tls",
      name: "Old Internal Service",
      asset_type: "protocol",
      protocol: "TLS 1.0",
      cipher_suite: "TLS_RSA_WITH_RC4_128_SHA",
    },
  ];

  const badReport = mapper.assess(nonCompliantAssets, ["pci_dss_v4"]);
  const badPci = badReport.standards.find((s) => s.standard_id === "pci_dss_v4");
  const badReq421 = badPci.controls.find((c) => c.control_id === "Req 4.2.1");
  assert.equal(badReq421.compliant, false);
  assert.ok(badReq421.gaps.length > 0);
});

test("Compliance Mapping - Out of scope controls mapped to NOT SUPPORTED", () => {
  const mapper = new ComplianceMapper();
  const report = mapper.assess([], ["pci_dss_v4"]);
  const pciStd = report.standards.find((s) => s.standard_id === "pci_dss_v4");
  const req91 = pciStd.controls.find((c) => c.control_id === "Req 9.1");

  assert.equal(req91.support_level, "NOT SUPPORTED");
  assert.equal(req91.verdict, "NOT_APPLICABLE_OUT_OF_SCOPE");
  assert.equal(req91.compliant, null);
  assert.ok(req91.manual_audit_guidance);
});

test("Compliance Mapping - CycloneDX CBOM format and standalone assessCompliance helper", () => {
  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    components: [
      {
        name: "AES-256 Component",
        cryptoProperties: {
          assetType: "algorithm",
          algorithmProperties: {
            name: "AES",
            parameterSetIdentifier: "256",
          },
        },
      },
    ],
  };

  const report = assessCompliance(cbom);
  assert.ok(report.summary.total_standards_assessed >= 5);
  assert.equal(report.certification_claimed, false);
  assert.ok(report.evidence_digest);
});
