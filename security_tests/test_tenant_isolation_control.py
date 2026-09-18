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
