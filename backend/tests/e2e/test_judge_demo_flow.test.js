const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.NODE_ENV = "development";
process.env.AUTH_MODE = "demo";
process.env.ECDAT_REMEDIATION_WORKSPACE = process.cwd();
process.env.ECDAT_API_KEY = "test-api-key-must-be-32-chars-long-strictly-valid";

const config = require("../../src/config");
config.AUTH_MODE = "demo";

const app = require("../../src/app");
const { clearScans, inMemoryScansStore } = require("../../src/services/cbom_ingestion");
const { getDefaultApprovalEngine } = require("../../src/remediation");

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("PHASE 4 E2E - Full Judge Demo Story Flow against Real Backend", async () => {
  await withServer(async (baseUrl) => {
    // ------------------------------------------------------------------------
    // Step 0: Verify AUTH_MODE=production guard blocks demo login
    // ------------------------------------------------------------------------
    config.AUTH_MODE = "production";
    const prodRejectRes = await fetch(`${baseUrl}/api/v1/auth/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "analyst" }),
    });
    assert.equal(prodRejectRes.status, 403, "Production auth mode must reject demo login with 403 Forbidden");
    const prodRejectData = await prodRejectRes.json();
    assert.equal(prodRejectData.code, "DEMO_MODE_DISABLED");

    // Enable explicit Demo Mode for the judge path
    config.AUTH_MODE = "demo";

    // ------------------------------------------------------------------------
    // Step 1: 1-Click Demo Login as Developer (Proposer Persona)
    // ------------------------------------------------------------------------
    // Login with seed: false to start with an authentically empty evaluation-tenant
    const demoLoginRes = await fetch(`${baseUrl}/api/v1/auth/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "analyst", seed: false }),
    });
    assert.equal(demoLoginRes.status, 200, "Demo login must succeed with 200 OK");
    const devAuth = await demoLoginRes.json();
    const setCookie = demoLoginRes.headers.getSetCookie ? demoLoginRes.headers.getSetCookie().join('; ') : (demoLoginRes.headers.get('set-cookie') || '');
    assert.ok(setCookie.includes('ecdat_access_token='), "Must issue valid access token cookie");
    assert.equal(devAuth.demoMode, true, "Must flag demoMode: true");
    assert.equal(devAuth.user.tenantId, "evaluation-tenant", "Must be strictly scoped to evaluation-tenant");
    assert.equal(devAuth.user.isPlatformAdmin, false, "Must never self-elevate to platform admin");
    assert.equal(devAuth.user.username, "evaluation-analyst");
    assert.deepEqual(devAuth.user.roles, ["analyst"]);

    const devHeaders = {
      "Content-Type": "application/json",
      "Cookie": setCookie,
      "x-csrf-token": devAuth.csrfToken,
    };

    // Ensure demo tenant starts genuinely empty
    await fetch(`${baseUrl}/api/v1/auth/demo/reset`, {
      method: "POST",
      headers: devHeaders,
    });

    // ------------------------------------------------------------------------
    // Step 2: Dashboard Loads & Reflects Genuinely Empty Demo Tenant
    // ------------------------------------------------------------------------
    const emptyDashRes = await fetch(`${baseUrl}/api/v1/dashboard/views`, {
      headers: devHeaders,
    });
    assert.equal(emptyDashRes.status, 200);
    const emptyDashData = await emptyDashRes.json();
    assert.equal(
      emptyDashData.views.executive_overview.total_assets,
      0,
      "Empty demo tenant must report 0 assets before scan"
    );
    assert.equal(
      emptyDashData.views.executive_overview.total_findings,
      0,
      "Empty demo tenant must report 0 findings before scan"
    );

    const emptyFindingsRes = await fetch(`${baseUrl}/api/v1/findings`, {
      headers: devHeaders,
    });
    assert.equal(emptyFindingsRes.status, 200);
    const emptyFindingsData = await emptyFindingsRes.json();
    assert.equal(emptyFindingsData.total, 0, "Empty demo tenant findings count must be 0");
    assert.deepEqual(emptyFindingsData.findings, [], "Findings list must be empty before scan");

    // Verify Tenant Isolation: demo user cannot access foreign tenant data
    const idorRes = await fetch(`${baseUrl}/api/v1/findings?scanId=scan_foreign_tenant_xyz`, {
      headers: {
        ...devHeaders,
        "x-tenant-id": "tenant-b", // Spoofed tenant header
      },
    });
    // Either 403 Forbidden due to tenant spoofing or 200 with 0 findings (isolated)
    assert.ok(
      idorRes.status === 403 || (idorRes.status === 200 && (await idorRes.json()).total === 0),
      "Demo user must be confined to evaluation-tenant"
    );

    // ------------------------------------------------------------------------
    // Step 3: Start Scan (Ingest Synthetic Cryptographic Dataset for Demo)
    // ------------------------------------------------------------------------
    const scanSeedRes = await fetch(`${baseUrl}/api/v1/auth/demo/seed`, {
      method: "POST",
      headers: devHeaders,
    });
    assert.equal(scanSeedRes.status, 200, "Demo scan seed must succeed with 200 OK");
    const scanSeedData = await scanSeedRes.json();
    assert.ok(scanSeedData.scan_id, "Must return valid scan_id");
    const demoScanId = scanSeedData.scan_id;

    // ------------------------------------------------------------------------
    // Step 4: Findings Appear in Demo Tenant
    // ------------------------------------------------------------------------
    const populatedFindingsRes = await fetch(`${baseUrl}/api/v1/findings?scanId=${demoScanId}`, {
      headers: devHeaders,
    });
    assert.equal(populatedFindingsRes.status, 200);
    const populatedFindingsData = await populatedFindingsRes.json();
    assert.ok(populatedFindingsData.total > 0, "Findings must appear after running scan");
    assert.ok(populatedFindingsData.findings.length > 0);

    // ------------------------------------------------------------------------
    // Step 5: Select a Finding & Verify CBOM and PQC Assessment Details
    // ------------------------------------------------------------------------
    const vulnerableFinding = populatedFindingsData.findings.find(
      (f) => String(f.algorithm || "").toUpperCase().includes("RSA") ||
             String(f.algorithm || "").toUpperCase().includes("3DES") ||
             f.severity === "Critical" || f.severity === "High"
    ) || populatedFindingsData.findings[0];

    assert.ok(vulnerableFinding, "Must identify vulnerable finding for remediation");

    // Fetch individual finding by ID
    const singleFindingRes = await fetch(`${baseUrl}/api/v1/findings/${vulnerableFinding.id}`, {
      headers: devHeaders,
    });
    assert.equal(singleFindingRes.status, 200);
    const singleFindingData = await singleFindingRes.json();
    assert.equal(singleFindingData.finding_id || singleFindingData.id, vulnerableFinding.id);
    assert.ok(singleFindingData.algorithm, "Must contain algorithm property");
    assert.ok(singleFindingData.risk_assessment?.mosca_status || singleFindingData.mosca_status, "Must contain Mosca assessment");

    // Inspect CBOM report view
    const cbomReportRes = await fetch(`${baseUrl}/api/v1/reports/cbom/${demoScanId}?type=annotated`, {
      headers: devHeaders,
    });
    assert.equal(cbomReportRes.status, 200);
    const cbomReportData = await cbomReportRes.json();
    assert.equal(cbomReportData.bomFormat, "CycloneDX");
    assert.equal(cbomReportData.specVersion, "1.6");
    assert.ok(Array.isArray(cbomReportData.components), "CBOM must contain components array");

    // ------------------------------------------------------------------------
    // Step 6: Propose Remediation Plan (as Developer Persona)
    // ------------------------------------------------------------------------
    const proposePayload = {
      title: `Migrate ${vulnerableFinding.algorithm} to NIST FIPS 203 PQC Standard`,
      description: "Automated cryptographic patch replacing quantum-vulnerable primitive with ML-KEM-768.",
      category: "algorithm migration",
      environment: "production",
      finding_id: vulnerableFinding.id,
      affected_asset: vulnerableFinding.location || "src/auth/token_signer.c",
      target_standard: "NIST FIPS 203 (ML-KEM-768)",
      patch_diff: `--- a/service.c\n+++ b/service.c\n@@ -42,3 +42,3 @@\n-RSA_generate_key(1024)\n+OQS_KEM_ml_kem_768_new()`,
      test_plan: "Execute NIST PQC KAT (Known Answer Test) vectors and inter-service handshake benchmarks.",
      rollback_plan: "Automated Blue/Green container rollback if p99 handshake latency > 25ms.",
      comments: "Proposed by Demo Developer for judicial evaluation.",
    };

    const proposeRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/propose`, {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify(proposePayload),
    });
    assert.equal(proposeRes.status, 201, "Remediation proposal must be created with 201");
    const proposal = await proposeRes.json();
    assert.equal(proposal.state, "PROPOSED");
    assert.equal(proposal.proposer.username, "evaluation-analyst");
    const approvalId = proposal.approval_id;

    // ------------------------------------------------------------------------
    // Step 7: Review Remediation Plan (as Peer Reviewer Persona)
    // ------------------------------------------------------------------------
    const reviewerLoginRes = await fetch(`${baseUrl}/api/v1/auth/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "reviewer" }),
    });
    assert.equal(reviewerLoginRes.status, 200);
    const reviewerAuth = await reviewerLoginRes.json();
    const reviewerCookie = reviewerLoginRes.headers.getSetCookie ? reviewerLoginRes.headers.getSetCookie().join('; ') : (reviewerLoginRes.headers.get('set-cookie') || '');
    const reviewerHeaders = {
      "Content-Type": "application/json",
      "Cookie": reviewerCookie,
      "x-csrf-token": reviewerAuth.csrfToken,
    };

    const reviewRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/review`, {
      method: "POST",
      headers: reviewerHeaders,
      body: JSON.stringify({ comments: "Technical impact analysis and KAT test vectors peer-reviewed." }),
    });
    assert.equal(reviewRes.status, 200, "Review must succeed with 200 OK");
    const reviewedData = await reviewRes.json();
    assert.equal(reviewedData.state, "REVIEWED");
    assert.equal(reviewedData.approval.metadata.reviewer.username, "evaluation-analyst");

    // ------------------------------------------------------------------------
    // Step 8: Four-Eyes Principle Enforcement Check
    // (Proposer 'evaluation-analyst' MUST BE REJECTED if attempting to approve)
    // ------------------------------------------------------------------------
    const selfApproveRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: devHeaders, // Caller is evaluation-analyst (proposer)
      body: JSON.stringify({ comments: "Attempting self-approval" }),
    });
    assert.equal(
      selfApproveRes.status,
      403,
      "Real backend must reject self-approval with 403 Forbidden (Four-Eyes Principle)"
    );
    const selfApproveErr = await selfApproveRes.json();
    assert.ok(
      selfApproveErr.message.includes("Four-Eyes") || selfApproveErr.error.includes("Forbidden"),
      "Error message must specify Four-Eyes violation or lack of authorization"
    );

    // ------------------------------------------------------------------------
    // Step 9: Approve Remediation (as Security Lead Persona)
    // ------------------------------------------------------------------------
    const secLeadLoginRes = await fetch(`${baseUrl}/api/v1/auth/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "approver" }),
    });
    assert.equal(secLeadLoginRes.status, 200);
    const secLeadAuth = await secLeadLoginRes.json();
    const secLeadCookie = secLeadLoginRes.headers.getSetCookie ? secLeadLoginRes.headers.getSetCookie().join('; ') : (secLeadLoginRes.headers.get('set-cookie') || '');
    const secLeadHeaders = {
      "Content-Type": "application/json",
      "Cookie": secLeadCookie,
      "x-csrf-token": secLeadAuth.csrfToken,
    };

    const approveRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: secLeadHeaders,
      body: JSON.stringify({ comments: "Four-Eyes compliance verified. Cryptographic migration approved for execution." }),
    });
    assert.equal(approveRes.status, 200, "Security Lead approval must succeed with 200 OK");
    const approvedData = await approveRes.json();
    assert.equal(approvedData.state, "APPROVED");
    assert.equal(approvedData.approval.metadata.approver.username, "evaluation-approver");

    // ------------------------------------------------------------------------
    // Step 10: Apply Remediation Patch (APPROVED ➔ APPLIED)
    // ------------------------------------------------------------------------
    const applyRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/apply`, {
      method: "POST",
      headers: secLeadHeaders,
    });
    assert.equal(applyRes.status, 200, "Apply must succeed with 200 OK");
    const appliedData = await applyRes.json();
    assert.equal(appliedData.state, "APPLIED");
    assert.equal(appliedData.approval.metadata.deployer.username, "evaluation-approver");

    // ------------------------------------------------------------------------
    // Step 11: Cryptographic Verification (APPLIED ➔ VERIFIED)
    // ------------------------------------------------------------------------
    // Absent verification evidence fails validation
    const invalidVerifyRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: secLeadHeaders,
      body: JSON.stringify({}), // Missing verification_results
    });
    assert.equal(invalidVerifyRes.status, 400, "Missing verification evidence must be rejected with 400");

    // Real verification results payload
    const verificationPayload = {
      verification_results: {
        tests_passed: true,
        finding_resolved: true,
        post_remediation_rescan_id: `rescan_${Date.now()}`,
        nist_kat_vectors: "PASSED",
        quantum_safety_confirmed: true,
        algorithm_standard: "NIST FIPS 203 ML-KEM-768",
      },
    };

    const verifyRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}/verify`, {
      method: "POST",
      headers: secLeadHeaders,
      body: JSON.stringify(verificationPayload),
    });
    assert.equal(verifyRes.status, 200, "Verification must succeed with 200 OK");
    const verifiedData = await verifyRes.json();
    assert.equal(verifiedData.state, "VERIFIED");

    // ------------------------------------------------------------------------
    // Step 12: UI / API Reflects Real Verified Result & State Hash Chain
    // ------------------------------------------------------------------------
    const finalRecordRes = await fetch(`${baseUrl}/api/v1/remediation/approvals/${approvalId}`, {
      headers: secLeadHeaders,
    });
    assert.equal(finalRecordRes.status, 200);
    const finalData = await finalRecordRes.json();

    assert.equal(finalData.approval.state, "VERIFIED");
    assert.equal(finalData.approval.metadata.verifier.username, "evaluation-approver");
    assert.equal(finalData.approval.metadata.verifier.verification_results.tests_passed, true);
    assert.equal(finalData.chain_verification.valid, true, "Cryptographic hash chain must be valid");
    assert.equal(finalData.chain_verification.total_events, 5, "Must record all 5 lifecycle transitions");
    assert.equal(finalData.approval.audit_history.length, 5);

    const states = finalData.approval.audit_history.map((e) => e.to_state);
    assert.deepEqual(states, ["PROPOSED", "REVIEWED", "APPROVED", "APPLIED", "VERIFIED"]);
  });
});
