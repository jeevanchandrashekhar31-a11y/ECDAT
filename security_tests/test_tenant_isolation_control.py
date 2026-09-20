# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Multi-Tenant Isolation Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.identity.multi_tenancy import (
    TenantContext,
    TenantIsolationEnforcer,
    TenantBoundaryViolation,
    TenantScopedDatabase,
)


class TestTenantIsolationControl:
    """
    Security Control: Multi-Tenant Isolation & Cross-Tenant Boundary Enforcement
    Guarantees that tenant ID supplied by client is never trusted over token context.
    """

    @pytest.fixture
    def db(self):
        return TenantScopedDatabase()

    # 1. POSITIVE TEST: Same-tenant queries and inserts succeed
    def test_positive_tenant_isolation(self, db):
        ctx_a = TenantContext(tenant_id="tenant-alpha", user_id="user-1", roles=["analyst"])
        record = db.insert("scans", {"target": "repo-alpha", "finding_count": 5}, ctx_a)

        assert record["tenant_id"] == "tenant-alpha"
        records = db.find("scans", {}, ctx_a)
        assert len(records) == 1
        assert records[0]["target"] == "repo-alpha"

        # Explicit validation when supplied tenant matches context
        res = TenantIsolationEnforcer.validate_request(ctx_a, "tenant-alpha")
        assert res["valid"] is True
        assert res["tenantId"] == "tenant-alpha"

    # 2. NEGATIVE TEST: Disallowed cross-tenant access returns cleanly segregated data
    def test_negative_tenant_isolation(self, db):
        ctx_a = TenantContext(tenant_id="tenant-alpha", user_id="user-1", roles=["analyst"])
        ctx_b = TenantContext(tenant_id="tenant-beta", user_id="user-2", roles=["analyst"])

        db.insert("scans", {"target": "secret-intel-alpha"}, ctx_a)

        # Tenant B queries table and receives zero records from Tenant A
        records_b = db.find("scans", {}, ctx_b)
        assert len(records_b) == 0

    # 3. BOUNDARY TEST: Empty client parameter & case normalization
    def test_boundary_tenant_isolation(self):
        ctx = TenantContext(tenant_id="tenant-gamma", user_id="user-3", roles=["viewer"])

        # Omitted / None client parameter defaults safely to authoritative context
        res_none = TenantIsolationEnforcer.validate_request(ctx, None)
        assert res_none["valid"] is True
        assert res_none["tenantId"] == "tenant-gamma"

        # Case normalization handles mixed case without violation
        res_case = TenantIsolationEnforcer.validate_request(ctx, "TENANT-GAMMA")
        assert res_case["valid"] is True
        assert res_case["tenantId"] == "tenant-gamma"

    # 4. MALICIOUS TEST: Cross-tenant parameter spoofing & horizontal hopping
    def test_malicious_tenant_isolation(self):
        ctx_attacker = TenantContext(tenant_id="tenant-attacker", user_id="mallory", roles=["analyst"])

        # Attacker injects a victim tenant in the query parameter
        with pytest.raises(TenantBoundaryViolation) as exc_info:
            TenantIsolationEnforcer.validate_request(ctx_attacker, "tenant-victim-enterprise")
        assert exc_info.value.code == "TENANT_SPOOFING_VIOLATION"
        assert "does not match authoritative" in str(exc_info.value)

    # 5. REGRESSION TEST: Client-supplied tenant ID can never override token tenant
    def test_regression_tenant_isolation(self, db):
        # Platform admin possesses legitimate cross-tenant authorization
        ctx_admin = TenantContext(tenant_id="system", user_id="superadmin", roles=["platform administrator"], is_platform_admin=True)
        ctx_a = TenantContext(tenant_id="tenant-a", user_id="alice", roles=["developer"])

        db.insert("policies", {"rule": "enforce-tls-1.3"}, ctx_a)

        # Platform admin can inspect all tenants
        admin_records = db.find("policies", {}, ctx_admin)
        assert len(admin_records) == 1

        # Regular user attempt to spoof platform admin tenant is rejected
        fake_admin_ctx = TenantContext(tenant_id="tenant-a", user_id="alice", roles=["developer"], is_platform_admin=False)
        with pytest.raises(TenantBoundaryViolation):
            TenantIsolationEnforcer.validate_request(fake_admin_ctx, "system")


class TestTenantIdorMatrix:
    """
    IDOR & Cross-Tenant Boundary Systematic Attack Matrix (Phase 7).
    Confirms that a normal authenticated user in Tenant A cannot list, read,
    update, delete, scan, remediate, generate reports, access graph, CBOM,
    or audit logs of Tenant B.
    """

    @pytest.fixture(scope="class")
    @classmethod
    def idor_results(cls):
        import json
        import subprocess
        from pathlib import Path

        repo_root = Path(__file__).resolve().parent.parent
        node_script = """
        const app = require('./src/app');
        const { defaultLocalAuthManager, defaultTokenService } = require('./src/identity');
        const { cbomIngestionService } = require('./src/services/cbom_ingestion');
        const { getDefaultApprovalEngine } = require('./src/remediation');
        const { defaultAuditService } = require('./src/audit');
        const { TenantContext } = require('./src/tenancy');

        (async () => {
            // Seed User A (Tenant A) and User B (Tenant B)
            const userA = { userId: 'usr_idor_alice', username: 'alice', email: 'alice@corp.test', tenantId: 'tenant-a', roles: ['viewer'] };
            const userB = { userId: 'usr_idor_bob', username: 'bob', email: 'bob@corp.test', tenantId: 'tenant-b', roles: ['viewer'] };
            defaultLocalAuthManager.users.set(userA.userId, { ...userA, mfaEnabled: false });
            defaultLocalAuthManager.users.set(userB.userId, { ...userB, mfaEnabled: false });

            const tokenA = defaultTokenService.issueTokenPair({
                userId: userA.userId, email: userA.email, roles: userA.roles, customClaims: { tenantId: 'tenant-a' }
            }).accessToken;

            // Seed CBOM & Scans for Tenant A & Tenant B
            const cbomA = {
                bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:tenant-a-scan-701', version: 1,
                metadata: { timestamp: new Date().toISOString(), component: { name: 'AppA', type: 'application' } },
                components: [{ type: 'cryptographic-asset', name: 'keyA', 'bom-ref': 'ref_a_finding', cryptoProperties: { assetType: 'algorithm', algorithmProperties: { variant: 'RSA', keyLength: 2048 } } }]
            };
            const cbomB = {
                bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:tenant-b-scan-702', version: 1,
                metadata: { timestamp: new Date().toISOString(), component: { name: 'AppB', type: 'application' } },
                components: [{ type: 'cryptographic-asset', name: 'keyB', 'bom-ref': 'ref_b_finding', cryptoProperties: { assetType: 'algorithm', algorithmProperties: { variant: 'DES', keyLength: 56 } } }]
            };

            const scanA = await cbomIngestionService.ingestCbom(cbomA, { scanName: 'ScanA', scannerType: 'static', tenantContext: new TenantContext({ tenantId: 'tenant-a' }) });
            const scanB = await cbomIngestionService.ingestCbom(cbomB, { scanName: 'ScanB', scannerType: 'static', tenantContext: new TenantContext({ tenantId: 'tenant-b' }) });

            const findingBId = scanB.classified_findings[0]?.id || scanB.classified_findings[0]?.bom_ref || 'ref_b_finding';

            // Seed Assets
            scanA.top_risky_assets = [{ asset_id: 'asset_a_701', primary_identifier: 'asset-a', highest_severity: 'High', tenantId: 'tenant-a' }];
            scanB.top_risky_assets = [{ asset_id: 'asset_b_702', primary_identifier: 'asset-b', highest_severity: 'Critical', tenantId: 'tenant-b' }];

            // Seed Remediation Proposal in Tenant B
            const engine = getDefaultApprovalEngine();
            const proposalB = engine.proposeRemediation({ title: 'Upgrade B Algorithm', tenantId: 'tenant-b' }, { username: 'bob', role: 'admin' });

            // Seed Audit Events
            await defaultAuditService.logEvent({
                category: 'SECURITY', action: 'TENANT_B_SECRET_EVENT', actor: { id: userB.userId, role: 'viewer' }, tenantId: 'tenant-b', status: 'SUCCESS'
            });

            const server = app.listen(0, async () => {
                const port = server.address().port;
                const baseUrl = 'http://127.0.0.1:' + port;

                const probes = [
                    // 1. List operations with tenantId override
                    { op: 'list', name: 'list_assets_override', method: 'GET', url: baseUrl + '/api/v1/assets?tenantId=tenant-b' },
                    { op: 'list', name: 'list_findings_override', method: 'GET', url: baseUrl + '/api/v1/findings?tenantId=tenant-b' },
                    { op: 'list', name: 'list_scans_override', method: 'GET', url: baseUrl + '/api/v1/scans?tenantId=tenant-b' },
                    { op: 'list', name: 'list_cboms_override', method: 'GET', url: baseUrl + '/api/v1/cboms?tenantId=tenant-b' },

                    // 2. Read operations (direct ID substitution & override)
                    { op: 'read', name: 'read_asset_idor', method: 'GET', url: baseUrl + '/api/v1/assets/asset_b_702' },
                    { op: 'read', name: 'read_asset_override', method: 'GET', url: baseUrl + '/api/v1/assets/asset_b_702?tenantId=tenant-b' },
                    { op: 'read', name: 'read_finding_idor', method: 'GET', url: baseUrl + '/api/v1/findings/' + findingBId },
                    { op: 'read', name: 'read_finding_override', method: 'GET', url: baseUrl + '/api/v1/findings/' + findingBId + '?tenantId=tenant-b' },
                    { op: 'read', name: 'read_scan_idor', method: 'GET', url: baseUrl + '/api/v1/scans/' + scanB.id },
                    { op: 'read', name: 'read_scan_override', method: 'GET', url: baseUrl + '/api/v1/scans/' + scanB.id + '?tenantId=tenant-b' },

                    // 3. Update operations (direct ID substitution & body override)
                    { op: 'update', name: 'update_asset_idor', method: 'PUT', url: baseUrl + '/api/v1/assets/asset_b_702', body: { business_criticality: 'critical' } },
                    { op: 'update', name: 'update_asset_override', method: 'PUT', url: baseUrl + '/api/v1/assets/asset_b_702', body: { tenantId: 'tenant-b' } },

                    // 4. Delete operations (direct ID substitution & override)
                    { op: 'delete', name: 'delete_asset_idor', method: 'DELETE', url: baseUrl + '/api/v1/assets/asset_b_702' },
                    { op: 'delete', name: 'delete_scan_idor', method: 'DELETE', url: baseUrl + '/api/v1/scans/' + scanB.id },

                    // 5. Scan operations (cross-tenant scan)
                    { op: 'scan', name: 'scan_spoof', method: 'POST', url: baseUrl + '/scan/static?tenantId=tenant-b', body: { target: 'https://github.com/repo.git' } },

                    // 6. Remediation operations
                    { op: 'remediation', name: 'remediation_read_idor', method: 'GET', url: baseUrl + '/api/v1/remediation/approvals/' + proposalB.id },
                    { op: 'remediation', name: 'remediation_list_override', method: 'GET', url: baseUrl + '/api/v1/remediation/approvals?tenantId=tenant-b' },
                    { op: 'remediation', name: 'remediation_approve_idor', method: 'POST', url: baseUrl + '/api/v1/remediation/approvals/' + proposalB.id + '/approve' },

                    // 7. Reports operations
                    { op: 'reports', name: 'reports_exec_idor', method: 'GET', url: baseUrl + '/api/v1/reports/executive?scanId=' + scanB.id },
                    { op: 'reports', name: 'reports_exec_override', method: 'GET', url: baseUrl + '/api/v1/reports/executive?tenantId=tenant-b' },
                    { op: 'reports', name: 'reports_tech_idor', method: 'GET', url: baseUrl + '/api/v1/reports/technical?scanId=' + scanB.id },
                    { op: 'reports', name: 'reports_tech_override', method: 'GET', url: baseUrl + '/api/v1/reports/technical?tenantId=tenant-b' },
                    { op: 'reports', name: 'reports_cbom_idor', method: 'GET', url: baseUrl + '/api/v1/reports/cbom/' + scanB.id },

                    // 8. Graph operations
                    { op: 'graph', name: 'graph_override', method: 'GET', url: baseUrl + '/api/v1/graph?tenantId=tenant-b' },
                    { op: 'graph', name: 'graph_idor', method: 'GET', url: baseUrl + '/api/v1/graph?scanId=' + scanB.id },

                    // 9. CBOM operations
                    { op: 'cbom', name: 'cbom_idor', method: 'GET', url: baseUrl + '/api/v1/cboms/' + scanB.id },
                    { op: 'cbom', name: 'cbom_override', method: 'GET', url: baseUrl + '/api/v1/cboms/' + scanB.id + '?tenantId=tenant-b' },

                    // 10. Audit log operations
                    { op: 'audit', name: 'audit_override', method: 'GET', url: baseUrl + '/api/v1/audit/events?tenantId=tenant-b' },
                    { op: 'audit', name: 'auth_audit_override', method: 'GET', url: baseUrl + '/api/v1/auth/audit?tenantId=tenant-b' },
                ];

                const out = {};
                for (const p of probes) {
                    const headers = { 'Authorization': 'Bearer ' + tokenA };
                    if (p.body) headers['Content-Type'] = 'application/json';
                    const res = await fetch(p.url, { method: p.method, headers, body: p.body ? JSON.stringify(p.body) : undefined });
                    out[p.name] = { op: p.op, status: res.status, url: p.url, method: p.method };
                }
                if (typeof server.closeAllConnections === "function") {
                    server.closeAllConnections();
                }
                server.close(() => {
                    console.log(JSON.stringify(out));
                    process.exit(0);
                });
                setTimeout(() => {
                    console.log(JSON.stringify(out));
                    process.exit(0);
                }, 500);
            });
        })();
        """
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(repo_root / "backend"),
            capture_output=True,
            text=True,
            check=True,
        )
        lines = [l for l in proc.stdout.splitlines() if l.startswith("{")]
        return json.loads(lines[-1])

    def test_idor_matrix_list_operations(self, idor_results):
        for name in ["list_assets_override", "list_findings_override", "list_scans_override", "list_cboms_override"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_read_operations(self, idor_results):
        for name in ["read_asset_idor", "read_asset_override", "read_finding_idor", "read_finding_override", "read_scan_idor", "read_scan_override"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_update_operations(self, idor_results):
        for name in ["update_asset_idor", "update_asset_override"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_delete_operations(self, idor_results):
        for name in ["delete_asset_idor", "delete_scan_idor"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_scan_operations(self, idor_results):
        res = idor_results["scan_spoof"]
        assert res["status"] in (403, 404), f"scan_spoof ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_remediation_operations(self, idor_results):
        for name in ["remediation_read_idor", "remediation_list_override", "remediation_approve_idor"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_reports_operations(self, idor_results):
        for name in ["reports_exec_idor", "reports_exec_override", "reports_tech_idor", "reports_tech_override", "reports_cbom_idor"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_cbom_operations(self, idor_results):
        for name in ["cbom_idor", "cbom_override"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_audit_log_operations(self, idor_results):
        for name in ["audit_override", "auth_audit_override"]:
            res = idor_results[name]
            assert res["status"] in (403, 404), f"{name} ({res['method']} {res['url']}) returned {res['status']}"

    def test_idor_matrix_graph_operations(self, idor_results):
        # Override is blocked with 403
        res_override = idor_results["graph_override"]
        assert res_override["status"] in (403, 404), f"graph_override returned {res_override['status']}"

        # IDOR probe: if any operation unexpectedly succeeds (e.g. returns 200), assert and report verbatim
        res_idor = idor_results["graph_idor"]
        assert res_idor["status"] in (403, 404), (
            f"UNEXPECTED SUCCESS (IDOR Vulnerability / Finding): "
            f"Route: {res_idor['method']} {res_idor['url']}, Status: {res_idor['status']} (expected 403 or 404)"
        )

