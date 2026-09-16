/**
 * Phase 22.1 Subsystem 10: Remediation & Safe Patching Deep Test Suite
 *
 * Tests:
 * 1. 10-dimension remediation planning & migration alternatives (PQC, Hybrid, Classical, Compensating).
 * 2. Why-it-matters cryptanalysis derivation (MD5, 3DES, RC4, Shor's RSA, Mosca timeline, HNDL).
 * 3. Safe patch generation with AST/context awareness, unified diffs, syntax validation.
 * 4. Pre-application safety lifecycle (sandboxing, CBOM diff, test verification).
 * 5. Human approval workflow state machine (PROPOSED -> REVIEWED -> APPROVED -> APPLIED -> VERIFIED).
 * 6. Four-Eyes principle, RBAC enforcement, sensitive operational categories, chained audit hashes.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  RemediationPlanner,
  getDefaultRemediationPlanner,
  planFindingRemediation,
  planRemediations,
  deriveWhyItMatters,
  deriveRecommendedRemediation,
  buildMigrationOptions,
  deriveConfidence,
  deriveTestingPlan,
  deriveRollbackPlan,
  SafePatchGenerator,
  getDefaultPatchGenerator,
  generatePatch,
  executePreApplicationLifecycle,
  validateSyntax,
  createUnifiedDiff,
  ApprovalState,
  SENSITIVE_APPROVAL_CATEGORIES,
  ApprovalWorkflowError,
  ApprovalWorkflowEngine,
  normalizeCategory,
  requiresExplicitApproval,
} = require("../../src/remediation");

describe("Phase 22.1 — Subsystem 10: Remediation & Migration Planning", () => {
  describe("Cryptographic Explanations & Migration Options", () => {
    it("should derive accurate why-it-matters cryptanalysis across classical and quantum threats", () => {
      // MD5 finding
      const md5Finding = { algorithm: "MD5", severity: "HIGH" };
      const md5Why = deriveWhyItMatters(md5Finding);
      assert.match(md5Why.summary, /collision attack/i);

      // 3DES finding
      const desWhy = deriveWhyItMatters({ algorithm: "3DES", severity: "MEDIUM" });
      assert.ok(desWhy.detailed_reasons.some((r) => r.includes("Sweet32")));

      // RC4 finding
      const rc4Why = deriveWhyItMatters({ algorithm: "RC4", severity: "HIGH" });
      assert.ok(rc4Why.detailed_reasons.some((r) => r.includes("keystream biases")));

      // RSA-1024 finding with Mosca urgent and internet exposure
      const rsaFinding = {
        algorithm: "RSA",
        key_size: 1024,
        is_internet_facing: true,
        mosca_status: "CRITICAL_URGENT",
      };
      const rsaAsset = {
        algorithm: "RSA",
        key_size: 1024,
        is_internet_facing: true,
        mosca: { status: "CRITICAL_URGENT" },
      };
      const rsaWhy = deriveWhyItMatters(rsaFinding, rsaAsset);

      assert.ok(rsaWhy.detailed_reasons.some((r) => r.includes("RSA-1024")));
      assert.ok(rsaWhy.detailed_reasons.some((r) => r.includes("Shor's algorithm")));
      assert.ok(rsaWhy.detailed_reasons.some((r) => r.includes("Harvest-Now-Decrypt-Later")));
      assert.ok(rsaWhy.detailed_reasons.some((r) => r.includes("Mosca inequality deficit")));
    });

    it("should generate comprehensive 4-tiered migration options for asymmetric algorithms", () => {
      const finding = {
        id: "fnd_rsa_1",
        algorithm: "RSA",
        key_size: 2048,
        category: "asymmetric_encryption",
      };
      const options = buildMigrationOptions(finding, { is_internet_facing: true });

      assert.ok(options.primary_pqc, "Must offer Primary PQC migration");
      assert.match(options.primary_pqc.target_standard, /ML-KEM|FIPS 203/i);

      assert.ok(options.hybrid_transition, "Must offer Hybrid option for transitional backwards compatibility");
      assert.match(options.hybrid_transition.composite_scheme, /X25519\+ML-KEM|RSA\+ML-KEM/i);

      assert.ok(options.classical_hardening, "Must provide classical hardening baseline");
      assert.ok(options.compensating_controls, "Must specify compensating security perimeter controls");
    });

    it("should compute confidence scores based on evidence precision and asset context", () => {
      const highEvidenceFinding = {
        algorithm: "MD5",
        evidence: { location: "src/crypto.js", lineNumber: 42, snippet: "crypto.createHash('md5')" },
      };
      const confHigh = deriveConfidence(highEvidenceFinding, { assetId: "ast_1" }, { score: 90 });
      assert.equal(confHigh.confidence_level, "HIGH");
      assert.ok(confHigh.confidence_score >= 80);

      const vagueFinding = {
        algorithm: "Unknown",
        evidence: null,
      };
      const confLow = deriveConfidence(vagueFinding, {}, { score: 20 });
      assert.ok(confLow.confidence_score < 75);
    });

    it("should build end-to-end remediation plans defaulting to DRY RUN safety mode", () => {
      const planner = getDefaultRemediationPlanner();

      const cbomMock = {
        components: [
          {
            "bom-ref": "pkg-legacy-hash",
            name: "md5-hasher",
            cryptoProperties: {
              assetType: "algorithm",
              algorithmProperties: { name: "MD5" },
            },
          },
          {
            "bom-ref": "pkg-tls-server",
            name: "web-server",
            cryptoProperties: {
              assetType: "protocol",
              algorithmProperties: { name: "TLS 1.0" },
            },
          },
        ],
      };

      const plan = planner.planRemediations(cbomMock);
      assert.equal(plan.mode, "DRY_RUN");
      assert.equal(plan.is_dry_run, true);
      assert.equal(plan.remediations.length, 2);
      assert.ok(plan.plan_digest, "Plan must contain SHA-256 integrity digest");

      for (const item of plan.remediations) {
        assert.ok(item.why_it_matters);
        assert.ok(item.recommended_remediation);
        assert.ok(item.migration_options);
        assert.ok(item.expected_impact);
        assert.ok(item.dependencies);
        assert.ok(item.testing_plan);
        assert.ok(item.rollback_plan);
        assert.ok(item.dry_run.simulated);
      }
    });
  });

  describe("Safe Patch Generation & Pre-Application Lifecycle", () => {
    it("should transform JavaScript crypto call sites contextually and produce valid unified diffs", () => {
      const originalJs = [
        'const crypto = require("crypto");',
        'function hashPayload(data) {',
        '  return crypto.createHash("md5").update(data).digest("hex");',
        '}',
      ].join("\n");

      const patchResult = generatePatch(originalJs, "src/hasher.js", { targetAlgorithm: "SHA-256" });

      assert.equal(patchResult.syntax_validation.valid, true);
      assert.match(patchResult.patched_code, /crypto\.createHash\("sha256"\)/i);
      assert.notEqual(patchResult.unified_diff, "");
      assert.match(patchResult.unified_diff, /--- a\/src\/hasher\.js/);
      assert.match(patchResult.unified_diff, /\+\+\+ b\/src\/hasher\.js/);
      assert.match(patchResult.unified_diff, /-  return crypto\.createHash\("md5"\)/);
      assert.match(patchResult.unified_diff, /\+  return crypto\.createHash\("sha256"\)/);
    });

    it("should transform Python hashlib call sites and update import statements", () => {
      const originalPy = [
        "import hashlib",
        "from hashlib import md5",
        "def compute_hash(buf):",
        "    h = hashlib.md5(buf)",
        "    return h.hexdigest()",
      ].join("\n");

      const patchResult = generatePatch(originalPy, "hasher.py", { targetAlgorithm: "SHA-256" });

      assert.match(patchResult.patched_code, /from hashlib import sha256/);
      assert.match(patchResult.patched_code, /hashlib\.sha256\(buf\)/);
      assert.ok(patchResult.explanation.transformations.length >= 2);
    });

    it("should validate syntax and catch malformed syntax before deployment", () => {
      const validCode = "function test() { return 42; }";
      const invalidCode = "function test() { return 42; "; // syntax error

      const valOk = validateSyntax(validCode, "javascript");
      assert.equal(valOk.valid, true);
      assert.equal(valOk.syntax_error, null);

      const valErr = validateSyntax(invalidCode, "javascript");
      assert.equal(valErr.valid, false);
      assert.ok(valErr.syntax_error);
    });

    it("should execute the complete pre-application safety lifecycle in an isolated sandbox", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecdat_remediation_test_"));
      const targetFile = path.join(tmpDir, "service_crypto.js");

      try {
        const sourceCode = [
          'const crypto = require("crypto");',
          'function getHash(val) {',
          '  return crypto.createHash("sha1").update(val).digest("hex");',
          '}',
          "module.exports = { getHash };",
        ].join("\n");

        fs.writeFileSync(targetFile, sourceCode, "utf-8");

        const patchResult = generatePatch(sourceCode, targetFile, { targetAlgorithm: "SHA-256" });
        const lifecycle = executePreApplicationLifecycle(targetFile, patchResult);

        assert.equal(lifecycle.all_passed, true);
        assert.equal(lifecycle.verdict, "SAFE_TO_APPLY");
        assert.equal(lifecycle.steps.backup.status, "PASSED");
        assert.equal(lifecycle.steps.isolated_environment.status, "PASSED");
        assert.equal(lifecycle.steps.run_tests.status, "PASSED");
        assert.equal(lifecycle.steps.rerun_ecdat.status, "PASSED");
        assert.equal(lifecycle.steps.rerun_security_scans.status, "PASSED");
        assert.equal(lifecycle.steps.compare_cbom.status, "PASSED");

        // Clean up backup file created by lifecycle
        if (lifecycle.steps.backup.backup_path && fs.existsSync(lifecycle.steps.backup.backup_path)) {
          fs.unlinkSync(lifecycle.steps.backup.backup_path);
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Human Approval Workflow & State Machine", () => {
    let engine;

    beforeEach(() => {
      engine = new ApprovalWorkflowEngine();
    });

    it("should accurately identify sensitive categories requiring explicit approval", () => {
      assert.equal(requiresExplicitApproval("KEY_CERT_ROTATION"), true);
      assert.equal(requiresExplicitApproval("prod_config_change"), true);
      assert.equal(requiresExplicitApproval("algorithm_migration"), true);
      assert.equal(requiresExplicitApproval("dependency_upgrade"), true);
      assert.equal(requiresExplicitApproval("network_change"), true);
      assert.equal(requiresExplicitApproval("infrastructure_change"), true);

      // Non-sensitive dev config
      assert.equal(requiresExplicitApproval("DOC_UPDATE", "development"), false);
      assert.equal(requiresExplicitApproval("TEST_FIXTURE_TWEAK", "development"), false);
    });

    it("should progress through standard 5-state lifecycle: PROPOSED -> REVIEWED -> APPROVED -> APPLIED -> VERIFIED", () => {
      const proposal = engine.proposeRemediation(
        {
          title: "Migrate Payment Vault RSA-1024 to ML-KEM-768",
          category: "ALGORITHM_MIGRATION",
          environment: "production",
        },
        { username: "crypto_engineer", role: "developer" }
      );

      assert.equal(proposal.state, ApprovalState.PROPOSED);
      assert.equal(proposal.requires_explicit_approval, true);

      // Review
      const reviewed = engine.reviewRemediation(
        proposal.approval_id,
        { username: "sec_reviewer", role: "reviewer" },
        "Implementation reviewed against NIST SP 800-208"
      );
      assert.equal(reviewed.state, ApprovalState.REVIEWED);

      // Approve
      const approved = engine.approveRemediation(
        proposal.approval_id,
        { username: "ciso_officer", role: "ciso" },
        "Approved for Q3 staged rollout"
      );
      assert.equal(approved.state, ApprovalState.APPROVED);

      // Apply
      const applied = engine.applyRemediation(
        proposal.approval_id,
        { username: "cd_pipeline", role: "deployer" }
      );
      assert.equal(applied.state, ApprovalState.APPLIED);

      // Verify
      const verified = engine.verifyRemediation(
        proposal.approval_id,
        { username: "ecdat_scanner", role: "verifier" },
        { tests_passed: true, finding_resolved: true }
      );
      assert.equal(verified.state, ApprovalState.VERIFIED);
      assert.equal(verified.audit_history.length, 5);
    });

    it("should strictly enforce Four-Eyes principle: Proposer cannot approve their own change", () => {
      const proposal = engine.proposeRemediation(
        {
          title: "Rotate API Gateway TLS Certs",
          category: "KEY_CERT_ROTATION",
        },
        { username: "lead_dev", role: "admin" } // Even if proposer has admin role
      );

      engine.reviewRemediation(proposal.approval_id, { username: "reviewer_1", role: "reviewer" });

      assert.throws(
        () => {
          engine.approveRemediation(
            proposal.approval_id,
            { username: "lead_dev", role: "admin" } // Self-approval attempt
          );
        },
        (err) => {
          assert.ok(err instanceof ApprovalWorkflowError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Four-Eyes Governance Violation/i);
          return true;
        }
      );
    });

    it("should enforce RBAC authorization for remediation approvers", () => {
      const proposal = engine.proposeRemediation(
        {
          title: "Upgrade OpenSSL Dependency",
          category: "DEPENDENCY_UPGRADE",
        },
        { username: "dev_junior", role: "developer" }
      );

      engine.reviewRemediation(proposal.approval_id, { username: "dev_senior", role: "reviewer" });

      // Unauthorized role attempt
      assert.throws(
        () => {
          engine.approveRemediation(
            proposal.approval_id,
            { username: "contractor_bob", role: "guest_contractor" }
          );
        },
        (err) => {
          assert.ok(err instanceof ApprovalWorkflowError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /not authorized to approve/i);
          return true;
        }
      );
    });

    it("should refuse application of sensitive remediations without prior APPROVED state", () => {
      const proposal = engine.proposeRemediation(
        {
          title: "Bypass Approval Test",
          category: "ALGORITHM_MIGRATION",
          environment: "production",
        },
        { username: "dev_rogue", role: "developer" }
      );

      // Attempting to apply from PROPOSED state directly
      assert.throws(
        () => {
          engine.applyRemediation(proposal.approval_id, { username: "pipeline", role: "deployer" });
        },
        (err) => {
          assert.ok(err instanceof ApprovalWorkflowError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Explicit Human Approval Required/i);
          return true;
        }
      );
    });

    it("should maintain a cryptographically chained SHA-256 audit trail across all transitions", () => {
      const proposal = engine.proposeRemediation(
        { title: "Audit Integrity Test", category: "PROD_CONFIG_CHANGE" },
        { username: "user_a", role: "developer" }
      );

      engine.reviewRemediation(proposal.approval_id, { username: "user_b", role: "reviewer" });
      engine.approveRemediation(proposal.approval_id, { username: "user_c", role: "security_lead" });
      engine.applyRemediation(proposal.approval_id, { username: "user_d", role: "deployer" });
      const final = engine.verifyRemediation(proposal.approval_id, { username: "user_e", role: "verifier" });

      const history = final.audit_history;
      assert.equal(history.length, 5);

      // Every transition has a non-empty SHA-256 hash
      for (const entry of history) {
        assert.ok(entry.hash);
        assert.equal(entry.hash.length, 64);
      }

      // Final state hash matches last audit event hash
      assert.equal(final.current_state_hash, history[history.length - 1].hash);
    });

    it("should support safe rollback to ROLLED_BACK state if post-application issues arise", () => {
      const proposal = engine.proposeRemediation(
        { title: "Failed Rollout Test", category: "NETWORK_CHANGE" },
        { username: "net_admin", role: "developer" }
      );

      engine.reviewRemediation(proposal.approval_id, { username: "rev_net", role: "reviewer" });
      engine.approveRemediation(proposal.approval_id, { username: "sec_lead", role: "security_lead" });
      engine.applyRemediation(proposal.approval_id, { username: "cd_bot", role: "deployer" });

      // Verification fails -> trigger rollback
      const rolledBack = engine.rollbackRemediation(
        proposal.approval_id,
        { username: "incident_commander", role: "secops" },
        "Latency regression detected; rolling back cipher suite configuration."
      );

      assert.equal(rolledBack.state, ApprovalState.ROLLED_BACK);
      assert.equal(rolledBack.rollback.rolled_back_by, "incident_commander");
    });
  });
});
