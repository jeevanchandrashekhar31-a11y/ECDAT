const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PolicyEngine,
  PolicyValidationError,
  evaluatePolicy,
  evaluateGate,
  checkCiCdGate,
} = require("../../src/policy");

test("Phase 22.1 — Subsystem 6: Deep Policy-as-Code & Quality Gate Tests", async (t) => {
  const engine = new PolicyEngine();

  await t.test("1. Precedence Resolution Matrix: BLOCK > WARN > EXCEPTION > ALLOW", () => {
    const testPolicy = {
      id: "ecdat:policy:precedence-test",
      name: "Precedence Test Policy",
      version: "1.0.0",
      default_action: "ALLOW",
      rules: [
        {
          id: "rule-block-rsa-weak",
          name: "Block Weak RSA",
          category: "key_size",
          action: "BLOCK",
          key_sizes: {
            min_rsa_bits: 2048,
          },
        },
        {
          id: "rule-warn-rsa",
          name: "Warn on Classical RSA",
          category: "algorithm",
          action: "WARN",
          algorithms: {
            require_quantum_resistant: true,
          },
        },
      ],
      exceptions: [
        {
          id: "exc-legacy-app",
          rule_id: "*",
          asset_id: "asset-rsa-1024-excepted",
          approved_by: "sec-team@ecdat.org",
          valid_from: "2026-01-01T00:00:00Z",
          expires_at: "2027-01-01T00:00:00Z",
          status: "APPROVED",
          reason: "Temporary approved exception for legacy migration",
        },
      ],
    };

    const assets = [
      // 1. Matched by BLOCK (weak RSA, no exception) -> BLOCK
      { asset_id: "asset-rsa-512", algorithm: "RSA", key_size: 512, type: "key" },
      // 2. Matched by BLOCK with active exception -> EXCEPTION
      { asset_id: "asset-rsa-1024-excepted", algorithm: "RSA", key_size: 1024, type: "key" },
      // 3. Matched by WARN (RSA 2048) -> WARN
      { asset_id: "asset-rsa-2048", algorithm: "RSA", key_size: 2048, type: "key" },
      // 4. Clean modern asset -> ALLOW
      { asset_id: "asset-aes-256", algorithm: "AES-256-GCM", key_size: 256, type: "cipher" },
    ];

    const evalResult = engine.evaluate(assets, {}, testPolicy);

    const rsa512 = evalResult.assets.find((a) => a.asset_id === "asset-rsa-512");
    assert.equal(rsa512.verdict, "BLOCK");

    const rsaExcepted = evalResult.assets.find((a) => a.asset_id === "asset-rsa-1024-excepted");
    assert.equal(rsaExcepted.verdict, "EXCEPTION");

    const rsa2048 = evalResult.assets.find((a) => a.asset_id === "asset-rsa-2048");
    assert.equal(rsa2048.verdict, "WARN");

    const aes256 = evalResult.assets.find((a) => a.asset_id === "asset-aes-256");
    assert.equal(aes256.verdict, "ALLOW");

    // Aggregate verdict reflects highest precedence (BLOCK)
    assert.equal(evalResult.verdict, "BLOCK");
  });

  await t.test("2. Exception Lifecycles: Active vs Expired vs Future-Effective", () => {
    const lifecyclePolicy = {
      id: "ecdat:policy:exception-lifecycle-test",
      name: "Exception Lifecycle Policy",
      version: "1.0.0",
      default_action: "ALLOW",
      rules: [
        {
          id: "rule-block-sha1",
          name: "Prohibit SHA-1",
          category: "algorithm",
          action: "BLOCK",
          algorithms: {
            prohibited: ["SHA-1"],
          },
        },
      ],
      exceptions: [
        {
          id: "exc-active",
          rule_id: "rule-block-sha1",
          asset_id: "asset-active-exc",
          approved_by: "ciso@corp.internal",
          valid_from: "2026-01-01T00:00:00Z",
          expires_at: "2027-12-31T23:59:59Z",
          status: "APPROVED",
          reason: "Active approved migration window",
        },
        {
          id: "exc-expired",
          rule_id: "rule-block-sha1",
          asset_id: "asset-expired-exc",
          approved_by: "ciso@corp.internal",
          valid_from: "2025-01-01T00:00:00Z",
          expires_at: "2025-12-31T23:59:59Z", // Past date
          status: "APPROVED",
          reason: "Expired grace period",
        },
        {
          id: "exc-future",
          rule_id: "rule-block-sha1",
          asset_id: "asset-future-exc",
          approved_by: "ciso@corp.internal",
          valid_from: "2028-01-01T00:00:00Z", // Future date
          expires_at: "2029-01-01T00:00:00Z",
          status: "APPROVED",
          reason: "Scheduled future transition",
        },
      ],
    };

    const assets = [
      { asset_id: "asset-active-exc", algorithm: "SHA-1", type: "digest" },
      { asset_id: "asset-expired-exc", algorithm: "SHA-1", type: "digest" },
      { asset_id: "asset-future-exc", algorithm: "SHA-1", type: "digest" },
    ];

    const evalResult = engine.evaluate(assets, {}, lifecyclePolicy);

    const activeItem = evalResult.assets.find((a) => a.asset_id === "asset-active-exc");
    assert.equal(activeItem.verdict, "EXCEPTION");

    const expiredItem = evalResult.assets.find((a) => a.asset_id === "asset-expired-exc");
    assert.equal(expiredItem.verdict, "BLOCK"); // Expired -> reverts to BLOCK

    const futureItem = evalResult.assets.find((a) => a.asset_id === "asset-future-exc");
    assert.equal(futureItem.verdict, "BLOCK"); // Not yet active -> reverts to BLOCK
  });

  await t.test("3. Security Protections: Prototype Pollution & Malicious Payloads", () => {
    const maliciousPolicy = {
      id: "ecdat:policy:polluted-policy",
      name: "Polluted Policy",
      version: "1.0.0",
      rules: [],
    };
    Object.defineProperty(maliciousPolicy, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });

    const validation = engine.validatePolicy(maliciousPolicy);
    assert.equal(validation.valid, false);
    assert.ok(
      validation.errors.some((err) =>
        err.toLowerCase().includes("prototype")
      )
    );

    // Verify global Object prototype was not corrupted
    assert.equal(Object.prototype.polluted, undefined);
  });

  await t.test("4. Policy Profile Standards: FIPS, PCI-DSS, and PQC Readiness", () => {
    // Evaluate via default enterprise policy-as-code
    const testAssets = [
      // FIPS / PCI-DSS Prohibited: 3DES
      { asset_id: "legacy-3des", algorithm: "3DES", type: "cipher" },
      // Weak RSA key
      { asset_id: "weak-rsa", algorithm: "RSA", key_size: 1024, type: "key" },
      // Modern Approved
      { asset_id: "modern-aes", algorithm: "AES-256-GCM", key_size: 256, type: "cipher" },
    ];

    const result = engine.evaluate(testAssets);
    assert.ok(result.metrics.counts_by_verdict.BLOCK >= 1);

    const item3des = result.assets.find((a) => a.asset_id === "legacy-3des");
    assert.equal(item3des.verdict, "BLOCK");
  });

  await t.test("5. CI/CD Quality Gate Threshold Evaluations", () => {
    const findings = [
      { id: "f1", severity: "Critical", mosca_status: "CRITICAL_URGENT" },
      { id: "f2", severity: "High", mosca_status: "AT_RISK" },
      { id: "f3", severity: "Medium", mosca_status: "WATCH" },
      { id: "f4", severity: "Low", mosca_status: "SAFE" },
    ];

    // Gate 1: failOnThreshold = 'critical' -> MUST FAIL
    const evalCrit = evaluatePolicy(findings, "standard", "critical");
    assert.equal(evalCrit.passed, false);
    assert.ok(evalCrit.blockingReasons.length > 0);

    // Gate 2: failOnThreshold = 'high' -> MUST FAIL
    const evalHigh = evaluatePolicy(findings, "standard", "high");
    assert.equal(evalHigh.passed, false);

    // Gate 3: failOnThreshold = 'none' -> MUST PASS (monitoring only)
    const evalNone = evaluatePolicy(findings, "standard", "none");
    assert.equal(evalNone.passed, true);
    assert.equal(evalNone.blockingReasons.length, 0);

    // Gate 4: Clean findings with failOnThreshold = 'critical' -> MUST PASS
    const cleanFindings = [
      { id: "c1", severity: "Low", mosca_status: "SAFE" },
    ];
    const evalClean = evaluatePolicy(cleanFindings, "standard", "critical");
    assert.equal(evalClean.passed, true);
  });
});
