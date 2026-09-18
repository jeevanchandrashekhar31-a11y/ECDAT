# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Authorization & RBAC Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.identity.rbac import (
    RBACManager,
    Roles,
    Permissions,
    Capabilities,
    ENDPOINT_PERMISSIONS,
    AUTHORIZATION_MATRIX,
)


class TestAuthorizationControl:
    """
    Security Control: Role-Based Access Control (RBAC) & Endpoint Authorization
    Guarantees least privilege, prevents horizontal & vertical privilege escalation.
    """

    @pytest.fixture
    def rbac(self):
        return RBACManager()

    # 1. POSITIVE TEST: Authorized roles succeed with granted permissions
    def test_positive_authorization(self, rbac):
        # Platform admin possesses full administrative capabilities
        res = rbac.verify_authorization(
            user_roles=["platform_admin"],
            required_permission=Permissions.POLICY_CREATE,
            user_tenant="tenant-1",
            target_tenant="tenant-1",
        )
        assert res["allowed"] is True

        # Analyst possesses read and scan permissions
        assert rbac.has_permission(Roles.ANALYST, Permissions.FINDINGS_READ) is True
        assert rbac.has_permission(Roles.ANALYST, Permissions.SCANS_READ) is True

    # 2. NEGATIVE TEST: Unauthenticated or unprivileged caller denied access cleanly
    def test_negative_authorization(self, rbac):
        # Anonymous / unauthenticated caller
        res = rbac.verify_authorization(
            user_roles=[],
            required_permission=Permissions.SCANS_TRIGGER,
        )
        assert res["allowed"] is False
        assert res["code"] == "INSUFFICIENT_PERMISSIONS"

        # Viewer role cannot delete assets or create policies
        assert rbac.has_permission(Roles.VIEWER, Permissions.ASSETS_DELETE) is False
        assert rbac.has_permission(Roles.VIEWER, Permissions.POLICY_CREATE) is False

    # 3. BOUNDARY TEST: Role normalization & edge conditions
    def test_boundary_authorization(self, rbac):
        # Mixed casing and whitespace normalization
        norm1 = rbac.normalize_role("  SECURITY-ADMIN  ")
        assert norm1 == Roles.SECURITY_ADMIN

        norm2 = rbac.normalize_role("DEVELOPER")
        assert norm2 == Roles.DEVELOPER

        # Unknown / unrecognized role falls back to viewer
        assert rbac.normalize_role("unknown_custom_role") == Roles.VIEWER
        assert rbac.normalize_role("") == Roles.VIEWER
        assert rbac.normalize_role(None) == Roles.VIEWER

    # 4. MALICIOUS TEST: Vertical privilege escalation & unauthorized override attempts
    def test_malicious_authorization(self, rbac):
        # Hostile viewer attempting to invoke user management or secret rotation
        res_manage = rbac.verify_authorization(
            user_roles=["viewer"],
            required_permission=Permissions.USERS_MANAGE,
            user_tenant="t-1",
            target_tenant="t-1",
        )
        assert res_manage["allowed"] is False

        res_secrets = rbac.verify_authorization(
            user_roles=["viewer"],
            required_permission=Permissions.SECRETS_ROTATE,
            user_tenant="t-1",
            target_tenant="t-1",
        )
        assert res_secrets["allowed"] is False

        # Endpoint authorization check for sensitive API via ENDPOINT_PERMISSIONS mapping
        admin_endpoint = "POST /api/v1/auth/secrets/rotate"
        required_perm = ENDPOINT_PERMISSIONS[admin_endpoint]
        assert rbac.has_permission("viewer", required_perm) is False
        assert rbac.has_permission("developer", required_perm) is False
        assert rbac.has_permission("platform_admin", required_perm) is True

    # 5. REGRESSION TEST: Role hierarchy enforcement prevents privilege bypass
    def test_regression_authorization(self, rbac):
        # Standard analyst cannot cross tenant boundaries
        res_cross = rbac.verify_authorization(
            user_roles=["analyst"],
            required_permission=Permissions.ASSETS_READ,
            user_tenant="tenant-alpha",
            target_tenant="tenant-beta",
        )
        assert res_cross["allowed"] is False
        assert res_cross["code"] == "HORIZONTAL_TENANT_VIOLATION"
        assert "Cross-tenant access violation" in res_cross["reason"]
