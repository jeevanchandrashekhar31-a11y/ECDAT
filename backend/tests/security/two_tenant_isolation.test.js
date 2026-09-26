/**
 * Two-Tenant Isolation & Direct Object Access Security Test Suite
 *
 * P0 SECURITY VALIDATION:
 * 1. Read isolation:
 *    Tenant A (asset-A, finding-A, scan-alpha, project-alpha)
 *    Tenant B (asset-B, finding-B, scan-beta, project-beta)
 *    Tenant A never receives Tenant B data on:
 *    - GET /api/v1/assets
 *    - GET /api/v1/findings
 *    - GET /api/v1/graph
 *    - GET /api/v1/reports/summary
 *    - GET /api/v1/cbom
 *    - GET /api/v1/projects
 *    - GET /api/v1/certificates
 *    - GET /api/v1/remediation/approvals
 *
 * 2. Direct object access:
 *    - /assets/<tenant-B-id>
 *    - /findings/<tenant-B-id>
 *    - /projects/<tenant-B-id>
 *    - /cboms/<tenant-B-id>
 *    - /certificates/<tenant-B-id>
 *    Must return 403 or 404 according to application security design.
 *
 * 3. Mutation authorization:
 *    Tenant A cannot:
 *    - modify Tenant B assets
 *    - delete Tenant B findings
 *    - delete Tenant B assets
 *    - apply remediation to Tenant B projects
 *    - approve Tenant B remediation
 *    - create records under Tenant B
 *    - access Tenant B reports
 *
 * 4. Client-controlled escalation prevention:
 *    - req.body.tenantId
 *    - req.query.tenantId
 *    - req.headers["x-tenant-id"]
 *    Are NEVER trusted as authorization.
 *
 * 5. Platform administrator explicit cross-tenant governance.
 * 6. Anonymous access fail-closed (401).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const { defaultTokenService } = require("../../src/identity");
const { inMemoryScansStore, persistScanToPostgres } = require("../../src/services/cbom_ingestion");
const { db } = require("../../src/db");
const { defaultObjectStateRegistry } = require("../../src/security/object_authorization");
const { globalCertInventory } = require("../../src/domain/certificate_inventory");
const { getDefaultApprovalEngine } = require("../../src/remediation/approval_workflow");
const defaultApprovalWorkflow = getDefaultApprovalEngine();

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

function createToken(userId, roles, tenantId) {
  const tokenPair = defaultTokenService.issueTokenPair({
    userId,
    roles,
    customClaims: { tenantId },
  });
  return tokenPair.accessToken;
}

// Seed fixture data for Tenant A and Tenant B
async function seedTwoTenantsData() {
  // Clear any existing test data
  inMemoryScansStore.clear();
  defaultObjectStateRegistry.clear();
  globalCertInventory.inventory.clear();
  await db("remediations").whereIn("id", ["appr-alpha-001", "appr-beta-001"]).del();

  // Provision Tenant A (tenant-alpha)
  const scanAlpha = {
    id: "scan-alpha-001",
    name: "Alpha Production CBOM",
    tenantId: "tenant-alpha",
    project_id: "project-alpha-001",
    scanner_type: "combined",
    policy_profile: "internal_enterprise",
    scenario: "baseline",
    created_at: new Date().toISOString(),
    metrics: {
      total_assets: 1,
      total_findings: 1,
      assets_at_quantum_risk: 1,
      severity_counts: { critical: 1, high: 0, medium: 0, low: 0, informational: 0 },
      overall_cicd_pass: false,
    },
    top_risky_assets: [
      {
        asset_id: "asset-alpha-001",
        primary_identifier: "asset-alpha-001",
        tenantId: "tenant-alpha",
        asset_type: "cryptographic_asset",
        data_sensitivity: "pci_cardholder",
        business_criticality: "high",
        severity: "Critical",
        mosca_status: "AT_RISK",
        mosca_margin_years: -2,
        cicd_pass: false,
      },
    ],
    classified_findings: [
      {
        id: "finding-alpha-001",
        asset_id: "asset-alpha-001",
        bom_ref: "finding-alpha-001",
        tenantId: "tenant-alpha",
        algorithm: "RSA-1024",
        severity: "Critical",
        classical_risk: "HIGH",
        quantum_relevance: "VULNERABLE",
        mosca: { status: "AT_RISK" },
      },
    ],
    annotated_bom: {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { component: { name: "Tenant-Alpha-App" } },
      components: [{ name: "RSA-1024", type: "cryptographic-asset" }],
    },
  };
  inMemoryScansStore.set(scanAlpha.id, scanAlpha);
  await persistScanToPostgres(scanAlpha, scanAlpha.annotated_bom).catch((err) => { console.error("Alpha Error", err); });

  defaultObjectStateRegistry.registerProject({
    id: "project-alpha-001",
    name: "Project Alpha Gateway",
    tenantId: "tenant-alpha",
    ownerId: "team-alpha@ecdat.io",
    environment: "production",
    status: "active",
  });

  globalCertInventory.addOrUpdateCertificate(
    {
      fingerprint_sha256: "cert-alpha-001",
      subjectName: "CN=alpha.ecdat.io",
      issuerName: "CN=Alpha Intermediate CA",
      algo_family: "RSA",
      key_size: 2048,
    },
    { tenantId: "tenant-alpha", environment: "production" }
  );

  await db("remediations").insert({
    id: "appr-alpha-001",
    state: "PROPOSED",
    finding_id: null,
    tenant_id: "tenant-alpha",
    proposer: "admin-alpha",
    title: "Update CipherSuite",
    audit_history: '[]',
    metadata: '{}'
  });

  // Provision Tenant B (tenant-beta)
  const scanBeta = {
    id: "scan-beta-001",
    name: "Beta Banking CBOM",
    tenantId: "tenant-beta",
    project_id: "project-beta-001",
    scanner_type: "combined",
    policy_profile: "internal_enterprise",
    scenario: "baseline",
    created_at: new Date().toISOString(),
    metrics: {
      total_assets: 1,
      total_findings: 1,
      assets_at_quantum_risk: 1,
      severity_counts: { critical: 1, high: 0, medium: 0, low: 0, informational: 0 },
      overall_cicd_pass: false,
    },
    top_risky_assets: [
      {
        asset_id: "asset-beta-001",
        primary_identifier: "asset-beta-001",
        tenantId: "tenant-beta",
        asset_type: "cryptographic_asset",
        data_sensitivity: "core_banking",
        business_criticality: "critical",
        severity: "Critical",
        mosca_status: "CRITICAL_URGENT",
        mosca_margin_years: -4,
        cicd_pass: false,
      },
    ],
    classified_findings: [
      {
        id: "finding-beta-001",
        asset_id: "asset-beta-001",
        bom_ref: "finding-beta-001",
        tenantId: "tenant-beta",
        algorithm: "3DES",
        severity: "Critical",
        classical_risk: "HIGH",
        quantum_relevance: "VULNERABLE",
        mosca: { status: "CRITICAL_URGENT" },
      },
    ],
    annotated_bom: {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: { component: { name: "Tenant-Beta-App" } },
      components: [{ name: "3DES", type: "cryptographic-asset" }],
    },
  };
  inMemoryScansStore.set(scanBeta.id, scanBeta);
  await persistScanToPostgres(scanBeta, scanBeta.annotated_bom).catch((err) => { console.error("Beta Error", err); });

  defaultObjectStateRegistry.registerProject({
    id: "project-beta-001",
    name: "Project Beta Core Banking",
    tenantId: "tenant-beta",
    ownerId: "team-beta@ecdat.io",
    environment: "production",
    status: "active",
  });

  globalCertInventory.addOrUpdateCertificate(
    {
      fingerprint_sha256: "cert-beta-001",
      subjectName: "CN=beta.ecdat.io",
      issuerName: "CN=Beta Intermediate CA",
      algo_family: "RSA",
      key_size: 4096,
    },
    { tenantId: "tenant-beta", environment: "production" }
  );

  await db("remediations").insert({
    id: "appr-beta-001",
    state: "PROPOSED",
    finding_id: null,
    tenant_id: "tenant-beta",
    proposer: "admin-beta",
    title: "Upgrade RSA",
    audit_history: '[]',
    metadata: '{}'
  });
}

// ============================================================================
// TEST 1: READ ISOLATION (Tenant A must NEVER receive Tenant B data)
// ============================================================================

test("Two-Tenant Security - Tenant A never receives Tenant B data on read endpoints", async () => {
  await seedTwoTenantsData();

  await withServer(async (baseUrl) => {
    const tokenA = createToken("user-alpha", ["developer"], "tenant-alpha");
    const headersA = { Authorization: `Bearer ${tokenA}` };

    // 1. GET /api/v1/assets
    const resAssets = await fetch(`${baseUrl}/api/v1/assets`, { headers: headersA });
    assert.equal(resAssets.status, 200);
    const assetsData = await resAssets.json();
    assert.ok(assetsData.assets.some((a) => a.asset_id === "asset-alpha-001" || a.primary_identifier === "asset-alpha-001"));
    assert.equal(assetsData.assets.some((a) => a.asset_id === "asset-beta-001" || a.primary_identifier === "asset-beta-001"), false);

    // 2. GET /api/v1/findings
    const resFindings = await fetch(`${baseUrl}/api/v1/findings`, { headers: headersA });
    assert.equal(resFindings.status, 200);
    const findingsData = await resFindings.json();
    assert.ok(findingsData.findings.some((f) => f.id === "finding-alpha-001"));
    assert.equal(findingsData.findings.some((f) => f.id === "finding-beta-001"), false);

    // 3. GET /api/v1/graph
    const resGraph = await fetch(`${baseUrl}/api/v1/graph`, { headers: headersA });
    assert.equal(resGraph.status, 200);
    const graphData = await resGraph.json();
    const nodeIds = (graphData.nodes || []).map((n) => n.id);
    assert.equal(nodeIds.some((id) => id.includes("beta")), false);

    // 4. GET /api/v1/cboms (or /cbom)
    const resCbom = await fetch(`${baseUrl}/api/v1/cboms`, { headers: headersA });
    assert.equal(resCbom.status, 200);
    const cbomData = await resCbom.json();
    assert.ok(cbomData.scans.some((s) => s.id === "scan-alpha-001"));
    assert.equal(cbomData.scans.some((s) => s.id === "scan-beta-001"), false);

    // 5. GET /api/v1/projects
    const resProjects = await fetch(`${baseUrl}/api/v1/projects`, { headers: headersA });
    assert.equal(resProjects.status, 200);
    const projectsData = await resProjects.json();
    assert.ok(projectsData.projects.some((p) => p.id === "project-alpha-001"));
    assert.equal(projectsData.projects.some((p) => p.id === "project-beta-001"), false);

    // 6. GET /api/v1/certificates
    const resCerts = await fetch(`${baseUrl}/api/v1/certificates`, { headers: headersA });
    assert.equal(resCerts.status, 200);
    const certsData = await resCerts.json();
    assert.ok(certsData.certificates.some((c) => c.fingerprint_sha256 === "cert-alpha-001"));
    assert.equal(certsData.certificates.some((c) => c.fingerprint_sha256 === "cert-beta-001"), false);

    // 7. GET /api/v1/remediation/approvals
    const resApprovals = await fetch(`${baseUrl}/api/v1/remediation/approvals`, { headers: headersA });
    assert.equal(resApprovals.status, 200);
    const approvalsData = await resApprovals.json();
    assert.ok(approvalsData.approvals.some((a) => a.approval_id === "appr-alpha-001"));
    assert.equal(approvalsData.approvals.some((a) => a.approval_id === "appr-beta-001"), false);
  });
});

// ============================================================================
// TEST 2: DIRECT OBJECT ACCESS (Tenant A accessing Tenant B IDs -> 403 or 404)
// ============================================================================

test("Two-Tenant Security - Direct object access to Tenant B resources returns 403 or 404", async () => {
  await seedTwoTenantsData();

  await withServer(async (baseUrl) => {
    const tokenA = createToken("user-alpha", ["developer"], "tenant-alpha");
    const headersA = { Authorization: `Bearer ${tokenA}` };

    // 1. GET /api/v1/assets/asset-beta-001
    const resAsset = await fetch(`${baseUrl}/api/v1/assets/asset-beta-001`, { headers: headersA });
    assert.ok([403, 404].includes(resAsset.status), `Asset direct object access must return 403 or 404, got ${resAsset.status}`);

    // 2. GET /api/v1/findings/finding-beta-001
    const resFinding = await fetch(`${baseUrl}/api/v1/findings/finding-beta-001`, { headers: headersA });
    assert.ok([403, 404].includes(resFinding.status), `Finding direct object access must return 403 or 404, got ${resFinding.status}`);

    // 3. GET /api/v1/projects/project-beta-001
    const resProject = await fetch(`${baseUrl}/api/v1/projects/project-beta-001`, { headers: headersA });
    assert.ok([403, 404].includes(resProject.status), `Project direct object access must return 403 or 404, got ${resProject.status}`);

    // 4. GET /api/v1/cboms/scan-beta-001
    const resCbom = await fetch(`${baseUrl}/api/v1/cboms/scan-beta-001`, { headers: headersA });
    assert.ok([403, 404].includes(resCbom.status), `CBOM direct object access must return 403 or 404, got ${resCbom.status}`);

    // 5. GET /api/v1/certificates/cert-beta-001
    const resCert = await fetch(`${baseUrl}/api/v1/certificates/cert-beta-001`, { headers: headersA });
    assert.ok([403, 404].includes(resCert.status), `Certificate direct object access must return 403 or 404, got ${resCert.status}`);

    // 6. GET /api/v1/reports/summary?scanId=scan-beta-001
    const resReport = await fetch(`${baseUrl}/api/v1/reports/summary?scanId=scan-beta-001`, { headers: headersA });
    assert.equal(resReport.status, 404, "Foreign scan report must return 404");

    // 7. GET /api/v1/reports/cbom/scan-beta-001
    const resReportCbom = await fetch(`${baseUrl}/api/v1/reports/cbom/scan-beta-001`, { headers: headersA });
    assert.equal(resReportCbom.status, 404, "Foreign CBOM report must return 404");

    // 8. GET /api/v1/remediation/approvals/appr-beta-001
    const resApproval = await fetch(`${baseUrl}/api/v1/remediation/approvals/appr-beta-001`, { headers: headersA });
    assert.equal(resApproval.status, 403, "Foreign remediation approval must return 403");
  });
});

// ============================================================================
// TEST 3: MUTATION AUTHORIZATION (Tenant A cannot mutate Tenant B records)
// ============================================================================

test("Two-Tenant Security - Mutation authorization prevents Tenant A from altering Tenant B data", async () => {
  await seedTwoTenantsData();

  await withServer(async (baseUrl) => {
    // Tenant A admin: has security administrator permissions within tenant-alpha, but NOT platform administrator
    const tokenA = createToken("user-alpha", ["security administrator"], "tenant-alpha");
    const headersA = {
      Authorization: `Bearer ${tokenA}`,
      "Content-Type": "application/json",
    };

    // 1. Tenant A attempts to modify Tenant B asset -> 403
    const resModAsset = await fetch(`${baseUrl}/api/v1/assets/asset-beta-001`, {
      method: "PUT",
      headers: headersA,
      body: JSON.stringify({ business_criticality: "low" }),
    });
    assert.equal(resModAsset.status, 403, "Tenant A modifying Tenant B asset must return 403");

    // 2. Tenant A attempts to delete Tenant B finding -> 403
    const resDelFinding = await fetch(`${baseUrl}/api/v1/findings/finding-beta-001`, {
      method: "DELETE",
      headers: headersA,
    });
    assert.equal(resDelFinding.status, 403, "Tenant A deleting Tenant B finding must return 403");
    const scanB = inMemoryScansStore.get("scan-beta-001");
    assert.ok((scanB.classified_findings || []).some((f) => f.id === "finding-beta-001"), "Tenant B finding must not be deleted");

    // 3. Tenant A attempts to delete Tenant B asset -> 403
    const resDelAsset = await fetch(`${baseUrl}/api/v1/assets/asset-beta-001`, {
      method: "DELETE",
      headers: headersA,
    });
    assert.equal(resDelAsset.status, 403, "Tenant A deleting Tenant B asset must return 403");

    // 4. Tenant A attempts to apply remediation to Tenant B project -> 403
    const resApplyPatch = await fetch(`${baseUrl}/api/v1/remediation/apply-patch`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        project_id: "project-beta-001",
        finding_id: "finding-beta-001",
        target_algorithm: "CRYSTALS-Kyber",
      }),
    });
    assert.equal(resApplyPatch.status, 403, "Applying patch to Tenant B project must return 403");

    // 5. Tenant A attempts to approve Tenant B remediation -> 403
    const resApprove = await fetch(`${baseUrl}/api/v1/remediation/approvals/appr-beta-001/approve`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({ comments: "Illegitimate approval by Tenant A" }),
    });
    assert.equal(resApprove.status, 403, "Approving Tenant B remediation must return 403");

    // 6. Tenant A attempts to create records under Tenant B (client-controlled tenantId in body) -> 403 Forbidden
    const resCreateProjectSpoof = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "Malicious Project Attempt",
        tenantId: "tenant-beta", // Attempting cross-tenant creation
      }),
    });
    assert.equal(resCreateProjectSpoof.status, 403, "Attempting to create records under Tenant B must return 403 Forbidden");

    // 7. Legitimate project creation by Tenant A succeeds and belongs to tenant-alpha
    const resLegitProject = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        name: "Legitimate Alpha Project",
      }),
    });
    assert.equal(resLegitProject.status, 201);
    const createdProject = await resLegitProject.json();
    assert.equal(createdProject.tenantId, "tenant-alpha", "Created project must belong to authenticated tenant-alpha");
  });
});

// ============================================================================
// TEST 4: CLIENT-CONTROLLED TENANT ESCALATION DEFENSE
// ============================================================================

test("Two-Tenant Security - Client-controlled tenant identifiers are rejected as authorization", async () => {
  await seedTwoTenantsData();

  await withServer(async (baseUrl) => {
    const tokenA = createToken("user-alpha", ["developer"], "tenant-alpha");

    // 1. X-Tenant-ID header spoofing attempt
    const resHeader = await fetch(`${baseUrl}/api/v1/assets`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Tenant-ID": "tenant-beta",
      },
    });
    assert.equal(resHeader.status, 403, "X-Tenant-ID header spoofing must be rejected with 403");

    // 2. Query parameter ?tenantId=tenant-beta spoofing attempt on tenancy route
    const resQuery = await fetch(`${baseUrl}/api/v1/tenancy/database/records?tenantId=tenant-beta`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(resQuery.status, 403, "Query parameter tenant spoofing must be rejected with 403");

    // 3. Query parameter ?tenantId=tenant-beta on audit route
    const resAudit = await fetch(`${baseUrl}/api/v1/audit/events?tenantId=tenant-beta`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(resAudit.status, 403, "Query parameter tenant spoofing on audit events must return 403");
  });
});

// ============================================================================
// TEST 5: PLATFORM ADMINISTRATOR EXPLICIT CROSS-TENANT PRIVILEGES
// ============================================================================

test("Two-Tenant Security - Platform administrators have cross-tenant privileges only through explicit authorization check", async () => {
  await seedTwoTenantsData();

  await withServer(async (baseUrl) => {
    // Normal user in tenant-alpha CANNOT view Tenant B project
    const normalToken = createToken("user-alpha", ["developer"], "tenant-alpha");
    const resNormal = await fetch(`${baseUrl}/api/v1/projects/project-beta-001`, {
      headers: { Authorization: `Bearer ${normalToken}` },
    });
    assert.ok([403, 404].includes(resNormal.status));

    // Platform administrator CAN view cross-tenant project
    const adminToken = createToken("platform-superadmin", ["platform administrator"], "ecdat-platform");
    const resAdmin = await fetch(`${baseUrl}/api/v1/projects/project-beta-001`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200, "Platform administrator must have explicit cross-tenant view privilege");
    const projData = await resAdmin.json();
    assert.equal(projData.id, "project-beta-001");
  });
});

// ============================================================================
// TEST 6: FAIL-CLOSED ANONYMOUS ACCESS TO PROTECTED TENANT DATA
// ============================================================================

test("Two-Tenant Security - Anonymous access to tenant-owned data is rejected fail-closed with 401", async () => {
  await withServer(async (baseUrl) => {
    const protectedEndpoints = [
      "/api/v1/assets",
      "/api/v1/findings",
      "/api/v1/graph",
      "/api/v1/reports/summary",
      "/api/v1/cbom",
      "/api/v1/projects",
      "/api/v1/certificates",
      "/api/v1/remediation/approvals",
      "/api/v1/dashboard/summary",
      "/api/v1/dashboard/views",
    ];

    for (const ep of protectedEndpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(
        res.status,
        401,
        `Anonymous access to protected endpoint '${ep}' must return 401, got ${res.status}`
      );
    }
  });
});

test.after(async () => {
  const { db } = require("../../src/db/connection");
  await db.destroy();
});
