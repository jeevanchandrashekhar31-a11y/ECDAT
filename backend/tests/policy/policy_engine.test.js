const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PolicyEngine,
  PolicyValidationError,
  DEFAULT_POLICY_PATH,
} = require("../../src/policy/policy_engine");

test("PolicyEngine - Schema validation accepts valid enterprise policy", () => {
  const engine = new PolicyEngine();
  const policy = engine.loadPolicy(DEFAULT_POLICY_PATH);
  assert.equal(policy.id, "ecdat:policy:enterprise-master-v1");
  assert.ok(policy.rules.length >= 5);
});

test("PolicyEngine - Schema validation rejects malformed policy", () => {
  const engine = new PolicyEngine();
  const badPolicy = { id: "incomplete-policy" };
  const validation = engine.validatePolicy(badPolicy);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});

test("PolicyEngine - Evaluates prohibited algorithms (MD5, SHA-1)", () => {
  const engine = new PolicyEngine();
  const assets = [
    { asset_id: "vuln-md5", algorithm: "MD5", type: "digest" },
    { asset_id: "vuln-sha1", algorithm: "SHA-1", type: "digest" },
    { asset_id: "clean-aes", algorithm: "AES-256-GCM", type: "cipher" },
  ];

  const result = engine.evaluate(assets);
  assert.equal(result.verdict, "BLOCK");
  assert.equal(result.metrics.counts_by_verdict.BLOCK, 2);
  assert.equal(result.metrics.counts_by_verdict.ALLOW, 1);

  const md5Result = result.assets.find((a) => a.asset_id === "vuln-md5");
  assert.equal(md5Result.verdict, "BLOCK");
  assert.ok(
    md5Result.rule_results[0].reasons[0].toLowerCase().includes("prohibited"),
  );
});

test("PolicyEngine - Evaluates RSA key size constraints", () => {
  const engine = new PolicyEngine();
  const assets = [
    {
      asset_id: "weak-rsa",
      algorithm: "RSA",
      key_size: 1024,
      type: "key",
      environment: "production",
    },
    {
      asset_id: "strong-rsa",
      algorithm: "RSA",
      key_size: 2048,
      type: "key",
      environment: "production",
      is_quantum_safe: true,
      is_hybrid: true,
    },
  ];

  const result = engine.evaluate(assets);
  const weak = result.assets.find((a) => a.asset_id === "weak-rsa");
  const strong = result.assets.find((a) => a.asset_id === "strong-rsa");

  assert.equal(weak.verdict, "BLOCK");
  assert.ok(
    weak.rule_results[0].reasons[0].toLowerCase().includes("below minimum"),
  );
  assert.equal(strong.verdict, "ALLOW");
});

test("PolicyEngine - Evaluates protocol versions and cipher suites", () => {
  const engine = new PolicyEngine();
  const assets = [
    {
      asset_id: "insecure-tls",
      protocol: "TLS 1.0",
      type: "protocol",
      environment: "production",
    },
    {
      asset_id: "modern-tls",
      protocol: "TLS 1.3",
      cipher_suite: "TLS_AES_256_GCM_SHA384",
      type: "protocol",
      environment: "production",
    },
  ];

  const result = engine.evaluate(assets);
  const insecure = result.assets.find((a) => a.asset_id === "insecure-tls");
  const modern = result.assets.find((a) => a.asset_id === "modern-tls");

  assert.equal(insecure.verdict, "BLOCK");
  assert.equal(modern.verdict, "ALLOW");
});

test("PolicyEngine - Evaluates self-signed certificates and max validity", () => {
  const engine = new PolicyEngine();
  const assets = [
    {
      asset_id: "self-signed",
      type: "certificate",
      is_self_signed: true,
      environment: "production",
    },
    {
      asset_id: "ca-signed",
      type: "certificate",
      is_self_signed: false,
      validity_days: 200,
      has_ct_logs: true,
      environment: "production",
      is_quantum_safe: true,
    },
  ];

  const result = engine.evaluate(assets);
  const selfSigned = result.assets.find((a) => a.asset_id === "self-signed");
  const caSigned = result.assets.find((a) => a.asset_id === "ca-signed");

  assert.equal(selfSigned.verdict, "BLOCK");
  assert.equal(caSigned.verdict, "ALLOW");
});

test("PolicyEngine - Active exception converts BLOCK to EXCEPTION verdict", () => {
  const engine = new PolicyEngine();
  const exceptedAsset = [
    {
      asset_id: "legacy-mainframe-connector",
      name: "IBM Mainframe Connector",
      algorithm: "RSA",
      key_size: 1024,
      environment: "production",
      application: "core-banking",
      business_unit: "retail_banking",
      type: "key",
    },
  ];

  const result = engine.evaluate(exceptedAsset, {
    evaluation_date: "2026-06-01T00:00:00Z",
  });
  assert.equal(result.verdict, "EXCEPTION");
  assert.equal(result.passed, true);
  assert.ok(result.applied_exceptions.length >= 1);
  assert.ok(
    result.applied_exceptions.some(
      (e) => e.exception_id === "EXC-2026-LEGACY-MAINFRAME-001",
    ),
  );
});

test("PolicyEngine - Expired exception fails to override violation", () => {
  const engine = new PolicyEngine();
  const expiredAsset = [
    {
      asset_id: "historical-checksum-archive",
      algorithm: "MD5",
      type: "digest",
      environment: "production",
      application: "doc-archive",
      business_unit: "operations",
    },
  ];

  const result = engine.evaluate(expiredAsset, {
    evaluation_date: "2026-06-01T00:00:00Z",
  });
  assert.equal(result.verdict, "BLOCK");
  assert.equal(result.passed, false);
  assert.ok(result.expired_exceptions.length >= 1);
});

test("PolicyEngine - Deadlines escalate from WARN to BLOCK", () => {
  const engine = new PolicyEngine();
  const classicalAsset = [
    {
      asset_id: "classical-key",
      algorithm: "RSA-3072",
      type: "asymmetric_key",
      is_quantum_safe: false,
      is_hybrid: false,
      environment: "production",
    },
  ];

  // In 2027 (before 2030 enforcement date): WARN
  const res2027 = engine.evaluate(classicalAsset, {
    evaluation_date: "2027-01-01T00:00:00Z",
  });
  assert.equal(res2027.verdict, "WARN");
  assert.equal(res2027.passed, true);

  // In 2031 (after 2030 enforcement date): BLOCK
  const res2031 = engine.evaluate(classicalAsset, {
    evaluation_date: "2031-01-01T00:00:00Z",
  });
  assert.equal(res2031.verdict, "BLOCK");
  assert.equal(res2031.passed, false);
});

test("PolicyEngine - Deterministic SHA-256 audit digest reproducibility", () => {
  const engine = new PolicyEngine();
  const assets = [
    { asset_id: "b-asset", algorithm: "SHA-256", type: "digest" },
    { asset_id: "a-asset", algorithm: "MD5", type: "digest" },
  ];
  const context = { evaluation_date: "2026-09-01T12:00:00Z" };

  const res1 = engine.evaluate(assets, context);
  const res2 = engine.evaluate(assets, context);

  assert.equal(res1.audit_digest, res2.audit_digest);
  assert.equal(res1.verdict, res2.verdict);
});
