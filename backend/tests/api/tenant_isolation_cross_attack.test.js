/**
 * Automated Cross-Tenant Attack & Tenant Isolation Regression Test Suite — Phase 3, 4, 5, 6
 *
 * Mandate:
 * A user belonging to Tenant A must NEVER:
 * 1. read tenant B data (scans, cboms, assets, findings)
 * 2. modify tenant B data (assets, findings)
 * 3. delete tenant B data (assets, scans)
 * 4. scan tenant B resources (scans bound to own tenant, spoofing rejected)
 * 5. retrieve tenant B CBOMs
 * 6. retrieve tenant B reports
 * 7. retrieve tenant B secrets
 * 8. revoke tenant B sessions
 * 9. manipulate tenant B MFA
 * 10. access tenant B audit logs
 *
 * Personas:
 * - User A -> Tenant A ("viewer")
 * - User B -> Tenant B ("viewer")
 * - Administrator A -> Tenant A ("security administrator")
 * - Administrator B -> Tenant B ("security administrator")
 * - Platform administrator -> Global scope ("platform administrator")
 * - Anonymous user -> No tenant scope
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const { defaultLocalAuthManager, defaultTokenService, defaultMfaEngine } = require("../../src/identity");
const { cbomIngestionService } = require("../../src/services/cbom_ingestion");
const { defaultKmsDiscoveryService, AwsKmsConnector } = require("../../src/integrations/kms");
const { defaultAuditService } = require("../../src/audit");
const { TenantContext } = require("../../src/tenancy");

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(resolve);
      } catch (err) {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => reject(err));
      }
    });
  });
}

const sampleCbomA = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: "urn:uuid:tenant-a-scan-001",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { name: "Tenant-A-App", type: "application" },
  },
  components: [
    {
      type: "cryptographic-asset",
      name: "tenant_a_rsa_key",
      "bom-ref": "ref_tenant_a_rsa",
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: {
          variant: "RSA",
          keyLength: 2048,
        },
      },
    },
  ],
};

const sampleCbomB = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: "urn:uuid:tenant-b-scan-002",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { name: "Tenant-B-App", type: "application" },
  },
  components: [
    {
      type: "cryptographic-asset",
      name: "tenant_b_aes_secret",
      "bom-ref": "ref_tenant_b_aes",
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: {
          variant: "AES-GCM",
          keyLength: 256,
        },
      },
    },
  ],
};

test("Phase 3 & 4 & 5 & 6 — Full Tenant Isolation and Authorization Attack Verification", async () => {
  await withServer(async (baseUrl) => {
    // ------------------------------------------------------------------------
    // SETUP: Seed Personas & Tokens
    // ------------------------------------------------------------------------
    const userA = {
      userId: "usr_alice_a",
      username: "alice_a",
      email: "alice@tenant-a.corp",
      tenantId: "tenant-a",
      roles: ["viewer"],
    };
    const userB = {
      userId: "usr_bob_b",
      username: "bob_b",
      email: "bob@tenant-b.corp",
      tenantId: "tenant-b",
      roles: ["viewer"],
    };
    const adminA = {
      userId: "adm_carol_a",
      username: "carol_a",
      email: "carol@tenant-a.corp",
      tenantId: "tenant-a",
      roles: ["security administrator"],
    };
    const adminB = {
      userId: "adm_dave_b",
      username: "dave_b",
      email: "dave@tenant-b.corp",
      tenantId: "tenant-b",
      roles: ["security administrator"],
    };
    const platformAdmin = {
      userId: "platform_sec_admin",
      username: "super_admin",
      email: "admin@ecdat.internal",
      tenantId: "system",
      roles: ["platform administrator"],
    };

    [userA, userB, adminA, adminB, platformAdmin].forEach((u) => {
      defaultLocalAuthManager.users.set(u.userId, { ...u, mfaEnabled: false });
    });

    const tokenUserA = defaultTokenService.issueTokenPair({
      userId: userA.userId,
      email: userA.email,
      roles: userA.roles,
      customClaims: { tenantId: userA.tenantId },
    }).accessToken;

    const tokenUserB = defaultTokenService.issueTokenPair({
      userId: userB.userId,
      email: userB.email,
      roles: userB.roles,
      customClaims: { tenantId: userB.tenantId },
    }).accessToken;

    const tokenAdminA = defaultTokenService.issueTokenPair({
      userId: adminA.userId,
      email: adminA.email,
      roles: adminA.roles,
      customClaims: { tenantId: adminA.tenantId },
    }).accessToken;

    const tokenAdminB = defaultTokenService.issueTokenPair({
      userId: adminB.userId,
      email: adminB.email,
      roles: adminB.roles,
      customClaims: { tenantId: adminB.tenantId },
    }).accessToken;

    const tokenPlatformAdmin = defaultTokenService.issueTokenPair({
      userId: platformAdmin.userId,
      email: platformAdmin.email,
      roles: platformAdmin.roles,
      customClaims: { tenantId: platformAdmin.tenantId },
    }).accessToken;

    // ------------------------------------------------------------------------
    // SETUP: Seed Tenant A and Tenant B scans & assets
    // ------------------------------------------------------------------------
    const scanA = await cbomIngestionService.ingestCbom(sampleCbomA, {
      scanName: "Alpha Production Scan",
      scannerType: "static",
      tenantContext: new TenantContext({ tenantId: "tenant-a", userId: adminA.userId }),
    });

    const scanB = await cbomIngestionService.ingestCbom(sampleCbomB, {
      scanName: "Beta Production Scan",
      scannerType: "static",
      tenantContext: new TenantContext({ tenantId: "tenant-b", userId: adminB.userId }),
    });

    // Seed assets into scans
    scanA.top_risky_assets = [
      {
        asset_id: "asset_alpha_101",
        primary_identifier: "alpha-primary-key",
        highest_severity: "High",
        tenantId: "tenant-a",
      },
    ];

    scanB.top_risky_assets = [
      {
        asset_id: "asset_beta_202",
        primary_identifier: "beta-secret-key",
        highest_severity: "Critical",
        tenantId: "tenant-b",
      },
    ];

    // Seed KMS Connector for Tenant B
    const bConnector = new AwsKmsConnector({
      name: "tenant-b-kms-hsm",
      config: { region: "us-east-1" },
      readOnly: true,
    });
    bConnector.tenantId = "tenant-b";
    defaultKmsDiscoveryService.registerConnector(bConnector);

    // ========================================================================
    // 1. READ TENANT B DATA: User A & Admin A must NEVER read Tenant B scans
    // ========================================================================
    {
      // A. User A querying all scans -> Tenant B scan must NOT be present
      const resScansUserA = await fetch(`${baseUrl}/api/v1/scans`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resScansUserA.status, 200);
      const dataScansUserA = await resScansUserA.json();
      const hasTenantBScan = dataScansUserA.scans.some((s) => s.id === scanB.id || s.tenantId === "tenant-b");
      assert.equal(hasTenantBScan, false, "User A must not see Tenant B scans in listing");

      // B. User A querying Tenant B scan directly by ID -> 404 Not Found
      const resScanBDirect = await fetch(`${baseUrl}/api/v1/scans/${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resScanBDirect.status, 404, "User A must receive 404 when directly fetching Tenant B scan");

      // C. Admin A querying Tenant B scan directly by ID -> 404 Not Found
      const resAdminAScanB = await fetch(`${baseUrl}/api/v1/scans/${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenAdminA}` },
      });
      assert.equal(resAdminAScanB.status, 404, "Admin A must receive 404 when directly fetching Tenant B scan");

      // D. User A querying assets -> Tenant B assets must NOT be present
      const resAssetsUserA = await fetch(`${baseUrl}/api/v1/assets`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resAssetsUserA.status, 200);
      const assetsDataA = await resAssetsUserA.json();
      const hasAssetB = assetsDataA.assets.some((a) => a.asset_id === "asset_beta_202");
      assert.equal(hasAssetB, false, "User A must not see Tenant B asset in asset list");

      // E. User A querying Tenant B asset directly by ID -> 404 Not Found
      const resAssetBDirect = await fetch(`${baseUrl}/api/v1/assets/asset_beta_202`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resAssetBDirect.status, 404, "User A must receive 404 when fetching Tenant B asset");
    }

    // ========================================================================
    // 2. MODIFY TENANT B DATA: User A & Admin A must NEVER modify Tenant B data
    // ========================================================================
    {
      // User A attempting to modify Tenant B asset -> 403 Forbidden
      const resPutAsset = await fetch(`${baseUrl}/api/v1/assets/asset_beta_202`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ business_criticality: "critical_tampered" }),
      });
      assert.equal(resPutAsset.status, 403, "User A modifying Tenant B asset must be rejected with 403");
      const errPut = await resPutAsset.json();
      assert.equal(errPut.code, "HORIZONTAL_TENANT_VIOLATION");

      // Admin A attempting to modify Tenant B asset -> 403 Forbidden
      const resAdminPutAsset = await fetch(`${baseUrl}/api/v1/assets/asset_beta_202`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ business_criticality: "critical_tampered" }),
      });
      assert.equal(resAdminPutAsset.status, 403, "Admin A modifying Tenant B asset must be rejected with 403");
    }

    // ========================================================================
    // 3. DELETE TENANT B DATA: User A & Admin A must NEVER delete Tenant B data
    // ========================================================================
    {
      // User A attempting to delete Tenant B asset -> 403 Forbidden
      const resDelAsset = await fetch(`${baseUrl}/api/v1/assets/asset_beta_202`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resDelAsset.status, 403, "User A deleting Tenant B asset must be rejected with 403");

      // Admin A attempting to delete Tenant B scan -> 403 Forbidden
      const resDelScan = await fetch(`${baseUrl}/api/v1/scans/${scanB.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenAdminA}` },
      });
      assert.equal(resDelScan.status, 403, "Admin A deleting Tenant B scan must be rejected with 403");
      const errDelScan = await resDelScan.json();
      assert.equal(errDelScan.code, "HORIZONTAL_TENANT_VIOLATION");
    }

    // ========================================================================
    // 4. SCAN TENANT B RESOURCES: Client-supplied tenant ID spoofing rejected
    // ========================================================================
    {
      // User A attempting to spoof Tenant B during static scan -> 403 TENANT_SPOOFING_VIOLATION
      const resSpoofScan = await fetch(`${baseUrl}/scan/static?tenantId=tenant-b`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ target: "https://github.com/example/repo.git" }),
      });
      assert.equal(resSpoofScan.status, 403, "Tenant spoofing in query param must be rejected with 403");
      const errSpoof = await resSpoofScan.json();
      assert.equal(errSpoof.code, "TENANT_SPOOFING_VIOLATION");

      // Header-based tenant spoofing attempt -> 403
      const resHeaderSpoof = await fetch(`${baseUrl}/api/v1/scans`, {
        headers: {
          Authorization: `Bearer ${tokenUserA}`,
          "X-Tenant-ID": "tenant-b",
        },
      });
      assert.equal(resHeaderSpoof.status, 403, "Header-based tenant spoofing must be rejected with 403");
    }

    // ========================================================================
    // 5. RETRIEVE TENANT B CBOMS: User A & Admin A must NEVER retrieve Tenant B CBOMs
    // ========================================================================
    {
      // User A requesting Tenant B CBOM via /api/v1/cboms/:id -> 404
      const resCbomUserA = await fetch(`${baseUrl}/api/v1/cboms/${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resCbomUserA.status, 404, "User A retrieving Tenant B CBOM must receive 404");

      // User A requesting Tenant B CBOM via /api/v1/reports/cbom/:id -> 404
      const resReportCbomA = await fetch(`${baseUrl}/api/v1/reports/cbom/${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resReportCbomA.status, 404, "User A retrieving Tenant B report CBOM must receive 404");
    }

    // ========================================================================
    // 6. RETRIEVE TENANT B REPORTS: User A & Admin A must NEVER retrieve Tenant B reports
    // ========================================================================
    {
      // User A requesting executive report for Tenant B scan -> 404
      const resExecReportA = await fetch(`${baseUrl}/api/v1/reports/executive?scanId=${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resExecReportA.status, 404, "User A retrieving Tenant B executive report must receive 404");

      // Admin A requesting technical report for Tenant B scan -> 404
      const resTechReportA = await fetch(`${baseUrl}/api/v1/reports/technical?scanId=${scanB.id}`, {
        headers: { Authorization: `Bearer ${tokenAdminA}` },
      });
      assert.equal(resTechReportA.status, 404, "Admin A retrieving Tenant B technical report must receive 404");
    }

    // ========================================================================
    // 7. RETRIEVE TENANT B SECRETS: User A & Admin A must NEVER retrieve Tenant B secrets
    // ========================================================================
    {
      // User A listing KMS connectors -> Tenant B connector must be filtered out
      const resKmsUserA = await fetch(`${baseUrl}/api/v1/integrations/kms/connectors`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resKmsUserA.status, 200);
      const kmsDataA = await resKmsUserA.json();
      const hasTenantBConnector = kmsDataA.connectors.some((c) => c.name === "tenant-b-kms-hsm");
      assert.equal(hasTenantBConnector, false, "User A must not see Tenant B KMS connectors");
    }

    // ========================================================================
    // 8. REVOKE TENANT B SESSIONS: User A / Admin A cannot revoke Tenant B sessions
    // ========================================================================
    {
      // A. Anonymous attacker attempting session revocation -> 401 Unauthorized
      const resAnonLogoutAll = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userB.userId }),
      });
      assert.equal(resAnonLogoutAll.status, 401, "Anonymous caller revoking sessions must return 401");

      // B. User A (viewer) targeting another user (User B) -> 403 Forbidden
      const resUserATargetingB = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ userId: userB.userId }),
      });
      assert.equal(resUserATargetingB.status, 403, "User A targeting User B must return 403");

      // C. Admin A (Tenant A administrator) targeting User B (Tenant B) -> 403 HORIZONTAL_TENANT_VIOLATION
      const resAdminATargetingB = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: userB.userId }),
      });
      assert.equal(resAdminATargetingB.status, 403, "Admin A targeting User B across tenants must return 403");
      const errAdminA = await resAdminATargetingB.json();
      assert.equal(errAdminA.code, "HORIZONTAL_TENANT_VIOLATION");

      // D. Malformed user ID -> 400 Bad Request
      const resMalformedId = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: "<script>alert(1)</script>" }),
      });
      assert.equal(resMalformedId.status, 400, "Malformed user ID must return 400");

      // E. Nonexistent user ID -> 404 Not Found
      const resNonexistentUser = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: "usr_nonexistent_9999" }),
      });
      assert.equal(resNonexistentUser.status, 404, "Nonexistent target user must return 404");

      // F. Authorized administrator revoking user within same tenant -> 200 OK
      const victimUserA = {
        userId: "usr_victim_a",
        username: "victim_a",
        email: "victim@tenant-a.corp",
        tenantId: "tenant-a",
        roles: ["viewer"],
      };
      defaultLocalAuthManager.users.set(victimUserA.userId, { ...victimUserA, mfaEnabled: false });

      const resAdminARevokesOwnTenant = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ userId: victimUserA.userId, reason: "Security posture reset" }),
      });
      assert.equal(resAdminARevokesOwnTenant.status, 200, "Admin A revoking victimUserA within Tenant A must succeed");

      // G. Authenticated user revoking own sessions -> 200 OK
      const selfRevokeUser = {
        userId: "usr_self_revoke",
        username: "self_revoker",
        email: "self@tenant-a.corp",
        tenantId: "tenant-a",
        roles: ["viewer"],
      };
      defaultLocalAuthManager.users.set(selfRevokeUser.userId, { ...selfRevokeUser, mfaEnabled: false });
      const tokenSelfRevoke = defaultTokenService.issueTokenPair({
        userId: selfRevokeUser.userId,
        email: selfRevokeUser.email,
        roles: selfRevokeUser.roles,
        customClaims: { tenantId: selfRevokeUser.tenantId },
      }).accessToken;

      const resUserASelfRevoke = await fetch(`${baseUrl}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenSelfRevoke}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resUserASelfRevoke.status, 200, "User revoking own sessions must succeed");
    }

    // ========================================================================
    // 9. MANIPULATE TENANT B MFA: User A / Admin A cannot manipulate Tenant B MFA
    // ========================================================================
    {
      // A. Anonymous caller attempting MFA setup on tenant user -> 401
      const resAnonMfaSetup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userB.username }),
      });
      assert.equal(resAnonMfaSetup.status, 401, "Anonymous caller manipulating MFA must return 401");

      // B. User A attempting MFA setup on User B (cross-tenant) -> 403 HORIZONTAL_TENANT_VIOLATION
      const resUserAMfaB = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ username: userB.username }),
      });
      assert.equal(resUserAMfaB.status, 403, "User A manipulating User B MFA must return 403");
      const errMfaB = await resUserAMfaB.json();
      assert.equal(errMfaB.code, "HORIZONTAL_TENANT_VIOLATION");

      // C. Admin A attempting MFA setup on User B (cross-tenant admin) -> 403 HORIZONTAL_TENANT_VIOLATION
      const resAdminAMfaB = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenAdminA}`,
        },
        body: JSON.stringify({ username: userB.username }),
      });
      assert.equal(resAdminAMfaB.status, 403, "Admin A manipulating User B MFA must return 403");

      // D. User A configuring MFA for own account -> 200 OK
      const resUserASelfMfa = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resUserASelfMfa.status, 200, "User A configuring own MFA must succeed");
    }

    // ========================================================================
    // 10. ACCESS TENANT B AUDIT LOGS: User A & Admin A cannot access Tenant B audit
    // ========================================================================
    {
      // Log test audit events in Tenant A and Tenant B
      await defaultAuditService.logEvent({
        category: "AUTHENTICATION",
        action: "TEST_EVENT_A",
        actor: { id: userA.userId, role: "viewer" },
        tenantId: "tenant-a",
        status: "SUCCESS",
      });

      await defaultAuditService.logEvent({
        category: "AUTHENTICATION",
        action: "TEST_EVENT_B",
        actor: { id: userB.userId, role: "viewer" },
        tenantId: "tenant-b",
        status: "SUCCESS",
      });

      // A. Anonymous caller querying audit log -> 401
      const resAnonAudit = await fetch(`${baseUrl}/api/v1/audit/events`, {
        headers: {},
      });
      assert.equal(resAnonAudit.status, 401, "Anonymous caller accessing audit must return 401");

      // B. User A attempting to query Tenant B audit events -> 403 HORIZONTAL_TENANT_VIOLATION
      const resUserAAuditSpoof = await fetch(`${baseUrl}/api/v1/audit/events?tenantId=tenant-b`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resUserAAuditSpoof.status, 403, "User A requesting Tenant B audit logs must return 403");

      // C. User A querying audit events -> strictly filtered to Tenant A
      const resUserAAudit = await fetch(`${baseUrl}/api/v1/audit/events`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resUserAAudit.status, 200);
      const auditDataA = await resUserAAudit.json();
      const hasTenantBEvent = auditDataA.events.some((e) => e.tenantId === "tenant-b");
      assert.equal(hasTenantBEvent, false, "User A must never receive Tenant B audit events");

      // D. User A querying auth audit log -> strictly filtered to Tenant A
      const resUserAAuthAudit = await fetch(`${baseUrl}/api/v1/auth/audit`, {
        headers: { Authorization: `Bearer ${tokenUserA}` },
      });
      assert.equal(resUserAAuthAudit.status, 200);
      const authAuditDataA = await resUserAAuthAudit.json();
      const hasTenantBAuthEvent = authAuditDataA.events.some((e) => e.tenantId === "tenant-b");
      assert.equal(hasTenantBAuthEvent, false, "User A must never receive Tenant B auth audit events");
    }

    // ========================================================================
    // 11. TOKEN REVOCATION AUTHORIZATION (Phase 5)
    // ========================================================================
    {
      const tokenPairB = defaultTokenService.issueTokenPair({
        userId: userB.userId,
        email: userB.email,
        roles: userB.roles,
        customClaims: { tenantId: userB.tenantId },
      });

      // A. Anonymous caller attempting token revocation -> 401
      const resAnonTokenRevoke = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jti: tokenPairB.jti }),
      });
      assert.equal(resAnonTokenRevoke.status, 401, "Anonymous token revocation must return 401");

      // B. User A attempting to revoke User B's token -> 403 HORIZONTAL_TENANT_VIOLATION
      const resUserATokenRevoke = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ jti: tokenPairB.jti }),
      });
      assert.equal(resUserATokenRevoke.status, 403, "User A revoking User B token must return 403");
      const errRevoke = await resUserATokenRevoke.json();
      assert.equal(errRevoke.code, "HORIZONTAL_TENANT_VIOLATION");

      // C. Arbitrary non-existent JTI submission -> 404 Not Found
      const resArbitraryJti = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserA}`,
        },
        body: JSON.stringify({ jti: "acc_arbitrary_fake_jti_123" }),
      });
      assert.equal(resArbitraryJti.status, 404, "Arbitrary JTI submission must return 404");

      // D. User B revoking own token -> 200 OK
      const resUserBRevokeOwn = await fetch(`${baseUrl}/api/v1/auth/token/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenUserB}`,
        },
        body: JSON.stringify({ jti: tokenPairB.jti }),
      });
      assert.equal(resUserBRevokeOwn.status, 200, "User B revoking own token must succeed");
    }

    // ========================================================================
    // 12. PLATFORM ADMINISTRATOR & ANONYMOUS BOUNDARY CHECKS
    // ========================================================================
    {
      // Platform administrator has global access across all tenants
      const resPlatformScans = await fetch(`${baseUrl}/api/v1/scans`, {
        headers: { Authorization: `Bearer ${tokenPlatformAdmin}` },
      });
      assert.equal(resPlatformScans.status, 200);
      const platformScans = await resPlatformScans.json();
      const hasA = platformScans.scans.some((s) => s.id === scanA.id);
      const hasB = platformScans.scans.some((s) => s.id === scanB.id);
      assert.equal(hasA && hasB, true, "Platform admin must have global visibility across Tenant A and Tenant B");

      // Anonymous user has no tenant scope and cannot access protected routes
      const resAnonScans = await fetch(`${baseUrl}/api/v1/scans`);
      assert.equal(resAnonScans.status, 200);
      const anonScans = await resAnonScans.json();
      assert.equal(anonScans.scans.length, 0, "Anonymous user with no tenant scope must receive 0 scans");
    }
  });
});
