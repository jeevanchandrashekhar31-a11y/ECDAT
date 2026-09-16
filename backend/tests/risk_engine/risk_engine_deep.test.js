const test = require("node:test");
const assert = require("node:assert");

const {
  classifyFinding,
  calculateMosca,
  calculateMultiFactorRisk,
  assessFindings,
  Severities,
  MoscaStatus,
  QuantumRelevance,
} = require("../../src/risk_engine");

test("Phase 22.1 — Subsystem 5: Deep Risk Engine & Multi-Factor Matrix Tests", async (t) => {
  await t.test("1. Multi-Factor 17-Dimension Risk Calculation and Breakdown", () => {
    const context = {
      algorithm: "RSA-1024",
      keySize: 1024,
      protocol: "TLS",
      tlsVersion: "TLS 1.0",
      certificateProperties: { isExpired: true },
      dataLifetimeYears: 15,
      isInternetExposed: true,
      businessCriticality: "critical",
      assetType: "network_session",
      hasActiveCve: true,
      reachability: "RUNTIME_CONFIRMED",
      dependencyBlastRadius: 15,
      migrationComplexity: "high",
      policyProfile: "regulated_bfsi",
      owner: "unassigned",
      compensatingControls: [],
    };

    const risk = calculateMultiFactorRisk(context);

    assert.ok(typeof risk.score === "number");
    assert.ok(risk.score >= 0 && risk.score <= 100);
    assert.strictEqual(risk.severity, Severities.CRITICAL);
    assert.strictEqual(risk.evaluated_factors_count, 17);

    // Verify key dimension scores
    assert.ok(risk.breakdown.key_strength.weighted_score > 0);
    assert.ok(risk.breakdown.protocol_weakness.weighted_score > 0);
    assert.ok(risk.breakdown.quantum_vulnerability.weighted_score > 0);
    assert.ok(risk.breakdown.reachability.weighted_score > 0);

    // Explainability check
    assert.ok(risk.explanation.includes("Critical"));
    assert.ok(risk.explanation.includes("Primary drivers"));
  });

  await t.test("2. Score Boundary Invariants and Monotonic Severity Tiers", () => {
    const testCases = [
      {
        desc: "Ideal Modern PQC Context (Informational)",
        ctx: {
          algorithm: "ML-KEM-768",
          protocol: "TLS",
          tlsVersion: "TLS 1.3",
          dataLifetimeYears: 1,
          isInternetExposed: false,
          businessCriticality: "low",
          reachability: "CAPABILITY_PRESENT",
          compensatingControls: [
            "hsm_hardware_isolation",
            "waf_active_virtual_patching",
            "ephemeral_session_keys",
          ],
        },
        expectedSeverity: Severities.INFORMATIONAL,
        maxScore: 14,
      },
      {
        desc: "Low-Risk Context (AES-256-CBC)",
        ctx: {
          algorithm: "AES-256-CBC",
          keySize: 256,
          protocol: "TLS",
          tlsVersion: "TLS 1.2",
          cipherSuites: ["TLS_RSA_WITH_AES_256_CBC_SHA"],
          dataLifetimeYears: 7,
          isInternetExposed: false,
          businessCriticality: "medium",
          reachability: "DIRECT_API_CALL",
        },
        expectedSeverity: Severities.LOW,
        minScore: 15,
        maxScore: 34,
      },
      {
        desc: "Medium-Risk Classical Context (RSA-2048)",
        ctx: {
          algorithm: "RSA",
          keySize: 2048,
          protocol: "TLS",
          tlsVersion: "TLS 1.2",
          dataLifetimeYears: 10,
          isInternetExposed: true,
          businessCriticality: "high",
          assetType: "network_session",
          reachability: "DIRECT_API_CALL",
          dependencyBlastRadius: 5,
        },
        expectedSeverity: Severities.MEDIUM,
        minScore: 35,
        maxScore: 54,
      },
      {
        desc: "High-Risk Context (3DES)",
        ctx: {
          algorithm: "3DES",
          keySize: 112,
          protocol: "TLS",
          tlsVersion: "TLS 1.1",
          dataLifetimeYears: 7,
          isInternetExposed: true,
          businessCriticality: "high",
          assetType: "network_session",
          reachability: "DIRECT_API_CALL",
          dependencyBlastRadius: 5,
          migrationComplexity: "high",
          owner: "unassigned",
          hasActiveCve: true,
        },
        expectedSeverity: Severities.HIGH,
        minScore: 55,
        maxScore: 74,
      },
      {
        desc: "Critical-Risk Context (RSA-1024 + TLS 1.0)",
        ctx: {
          algorithm: "RSA-1024",
          keySize: 1024,
          protocol: "TLS",
          tlsVersion: "TLS 1.0",
          certificateProperties: { isExpired: true },
          dataLifetimeYears: 15,
          isInternetExposed: true,
          businessCriticality: "critical",
          assetType: "network_session",
          hasActiveCve: true,
          reachability: "RUNTIME_CONFIRMED",
          dependencyBlastRadius: 15,
          migrationComplexity: "high",
          policyProfile: "regulated_bfsi",
          owner: "unassigned",
        },
        expectedSeverity: Severities.CRITICAL,
        minScore: 75,
        maxScore: 100,
      },
    ];

    for (const tc of testCases) {
      const res = calculateMultiFactorRisk(tc.ctx);
      assert.ok(
        res.score >= 0 && res.score <= 100,
        `Score out of bounds for ${tc.desc}: ${res.score}`
      );
      assert.strictEqual(
        res.severity,
        tc.expectedSeverity,
        `Unexpected severity for ${tc.desc}: expected ${tc.expectedSeverity}, got ${res.severity} (score ${res.score})`
      );
      if (tc.minScore !== undefined) {
        assert.ok(
          res.score >= tc.minScore,
          `Score ${res.score} below min ${tc.minScore} for ${tc.desc}`
        );
      }
      if (tc.maxScore !== undefined) {
        assert.ok(
          res.score <= tc.maxScore,
          `Score ${res.score} above max ${tc.maxScore} for ${tc.desc}`
        );
      }
    }
  });

  await t.test("3. Mosca Calculation Edge Cases and Boundary Conditions", () => {
    // Standard Shor Vulnerable
    const moscaStandard = calculateMosca({
      assetType: "certificate",
      dataSensitivity: "confidential",
      businessCriticality: "high",
      scenario: "baseline",
      quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
    });
    assert.ok(moscaStandard.mosca_total_years > 0);
    assert.ok(typeof moscaStandard.mosca_margin_years === "number");
    assert.ok([MoscaStatus.AT_RISK, MoscaStatus.CRITICAL_URGENT].includes(moscaStandard.status));

    // Custom shelf-life X overrides
    const moscaCustomX = calculateMosca({
      assetType: "network_session",
      dataSensitivity: "internal",
      customX: 25, // Massive 25-year shelf-life (e.g. government/health record)
      customY: 5,
      scenario: "baseline",
      quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
    });
    assert.strictEqual(moscaCustomX.final_values.X_shelf_life_years, 25);
    assert.strictEqual(moscaCustomX.final_values.Y_migration_years, 5);
    assert.strictEqual(moscaCustomX.mosca_total_years, 30);
    assert.strictEqual(moscaCustomX.status, MoscaStatus.CRITICAL_URGENT);

    // Non-Shor Vulnerable (Grover or PQC) -> Must evaluate to SAFE with X=0, Y=0
    const moscaPqc = calculateMosca({
      assetType: "network_session",
      dataSensitivity: "restricted",
      businessCriticality: "critical",
      quantumRelevance: QuantumRelevance.QUANTUM_SAFE,
    });
    assert.strictEqual(moscaPqc.status, MoscaStatus.SAFE);
    assert.strictEqual(moscaPqc.final_values.X_shelf_life_years, 0);
    assert.strictEqual(moscaPqc.final_values.Y_migration_years, 0);
    assert.ok(moscaPqc.explanation.includes("not vulnerable to Shor"));

    // Integrity Only (Signatures) -> HNDL does not compromise past signatures
    const moscaIntegrity = calculateMosca({
      assetType: "certificate",
      dataSensitivity: "confidential",
      isIntegrityOnly: true,
      quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
    });
    assert.ok(moscaIntegrity.final_values.X_shelf_life_years <= 3);

    // Public Data -> X=0
    const moscaPublic = calculateMosca({
      assetType: "network_session",
      dataSensitivity: "public",
      quantumRelevance: QuantumRelevance.SHOR_VULNERABLE,
    });
    assert.strictEqual(moscaPublic.final_values.X_shelf_life_years, 0);
  });

  await t.test("4. PQC Transition Recommendations (Kyber, Dilithium, SPHINCS+)", () => {
    // Shor-vulnerable RSA finding
    const rsaFinding = classifyFinding({
      algorithm: "RSA",
      keySize: 2048,
      assetType: "certificate",
      policyProfile: "internal_enterprise",
    });
    assert.strictEqual(rsaFinding.quantum_relevance, QuantumRelevance.SHOR_VULNERABLE);
    assert.ok(rsaFinding.recommendation);
    assert.ok(
      rsaFinding.recommendation.proposed_option.includes("ML-DSA") ||
        rsaFinding.recommendation.proposed_option.includes("Dilithium") ||
        rsaFinding.recommendation.proposed_option.includes("Hybrid") ||
        rsaFinding.recommendation.proposed_option.includes("PQC")
    );

    // Shor-vulnerable ECDH finding
    const ecdhFinding = classifyFinding({
      algorithm: "ECDH",
      keySize: 256,
      assetType: "network_session",
      policyProfile: "internal_enterprise",
    });
    assert.strictEqual(ecdhFinding.quantum_relevance, QuantumRelevance.SHOR_VULNERABLE);

    // Classical AES-256 finding
    const aesFinding = classifyFinding({
      algorithm: "AES",
      keySize: 256,
      assetType: "file",
      policyProfile: "internal_enterprise",
    });
    assert.strictEqual(aesFinding.quantum_relevance, QuantumRelevance.GROVER_SENSITIVE);
    assert.strictEqual(aesFinding.severity, Severities.INFORMATIONAL);
  });
});
