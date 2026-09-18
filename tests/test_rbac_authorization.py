"""
Tests for Phase 15.3 Server-Side RBAC & Privilege Escalation Defenses (Python)

Covers:
- 6 Canonical Enterprise Roles:
  1. platform administrator
  2. security administrator
  3. analyst
  4. developer
  5. auditor
  6. viewer
- Role normalization and permission evaluation
- Vertical Privilege Escalation (VPE) tests
- Horizontal Privilege Escalation (HPE) / Multi-Tenant Boundary tests
- Endpoint permission declaration completeness
"""

import pytest
from scanners.identity.rbac import (
    Roles,
    Permissions,
    Capabilities,
    AUTHORIZATION_MATRIX,
    ROLE_PERMISSIONS,
    ENDPOINT_PERMISSIONS,
    RBACManager,
)
from scanners.identity.auth_audit import AuthAuditLogger


class TestRbacRolesAndPermissions:
    def test_canonical_roles_defined(self):
        expected_roles = {
            "platform administrator",
            "security administrator",
            "analyst",
            "developer",
            "auditor",
            "viewer",
        }
        actual_roles = {
            Roles.PLATFORM_ADMIN,
            Roles.SECURITY_ADMIN,
            Roles.ANALYST,
            Roles.DEVELOPER,
            Roles.AUDITOR,
            Roles.VIEWER,
        }
        assert actual_roles == expected_roles

    def test_role_normalization_and_aliases(self):
        assert RBACManager.normalize_role("platform_admin") == Roles.PLATFORM_ADMIN
        assert RBACManager.normalize_role("admin") == Roles.PLATFORM_ADMIN
        assert RBACManager.normalize_role("secops") == Roles.SECURITY_ADMIN
        assert RBACManager.normalize_role("security-administrator") == Roles.SECURITY_ADMIN
        assert RBACManager.normalize_role("engineer") == Roles.DEVELOPER
        assert RBACManager.normalize_role("compliance") == Roles.AUDITOR
        assert RBACManager.normalize_role("reader") == Roles.VIEWER
        assert RBACManager.normalize_role("unknown_role") == Roles.VIEWER

    def test_platform_admin_has_full_permissions(self):
        perms = RBACManager.get_user_permissions(Roles.PLATFORM_ADMIN)
        assert Permissions.SECRETS_ROTATE in perms
        assert Permissions.POLICY_APPROVE in perms
        assert Permissions.REMEDIATION_APPLY in perms
        assert Permissions.ASSETS_DELETE in perms
        assert RBACManager.has_permission(Roles.PLATFORM_ADMIN, Permissions.SECRETS_ROTATE) is True

    def test_auditor_is_strictly_read_only(self):
        perms = RBACManager.get_user_permissions(Roles.AUDITOR)
        # Auditor has read & verify permissions
        assert Permissions.AUDIT_READ in perms
        assert Permissions.AUDIT_VERIFY in perms
        assert Permissions.COMPLIANCE_READ in perms
        assert Permissions.FINDINGS_READ in perms
        # Zero mutating permissions
        assert Permissions.ASSETS_WRITE not in perms
        assert Permissions.ASSETS_DELETE not in perms
        assert Permissions.SCANS_TRIGGER not in perms
        assert Permissions.POLICY_CREATE not in perms
        assert Permissions.POLICY_APPROVE not in perms
        assert Permissions.REMEDIATION_PROPOSE not in perms
        assert Permissions.REMEDIATION_APPLY not in perms
        assert Permissions.SECRETS_ROTATE not in perms


class TestVerticalPrivilegeEscalation:
    def test_viewer_escalation_blocked(self):
        # Viewer attempting write, trigger, or approve operations
        forbidden_permissions = [
            Permissions.ASSETS_WRITE,
            Permissions.ASSETS_DELETE,
            Permissions.SCANS_TRIGGER,
            Permissions.POLICY_APPROVE,
            Permissions.REMEDIATION_APPLY,
            Permissions.SECRETS_ROTATE,
        ]
        for perm in forbidden_permissions:
            res = RBACManager.verify_authorization([Roles.VIEWER], perm)
            assert res["allowed"] is False
            assert res["code"] == "INSUFFICIENT_PERMISSIONS"

    def test_developer_escalation_blocked(self):
        # Developer attempting admin approvals or secrets rotation
        forbidden_permissions = [
            Permissions.POLICY_APPROVE,
            Permissions.POLICY_DELETE,
            Permissions.REMEDIATION_APPROVE,
            Permissions.REMEDIATION_APPLY,
            Permissions.SECRETS_ROTATE,
            Permissions.ASSETS_DELETE,
        ]
        for perm in forbidden_permissions:
            res = RBACManager.verify_authorization([Roles.DEVELOPER], perm)
            assert res["allowed"] is False
            assert res["code"] == "INSUFFICIENT_PERMISSIONS"

    def test_analyst_escalation_blocked(self):
        # Analyst can propose but cannot approve/apply remediation or rotate secrets
        assert RBACManager.has_permission(Roles.ANALYST, Permissions.REMEDIATION_PROPOSE) is True

        forbidden_permissions = [
            Permissions.POLICY_APPROVE,
            Permissions.POLICY_DELETE,
            Permissions.REMEDIATION_APPROVE,
            Permissions.REMEDIATION_APPLY,
            Permissions.SECRETS_ROTATE,
            Permissions.ASSETS_DELETE,
        ]
        for perm in forbidden_permissions:
            res = RBACManager.verify_authorization([Roles.ANALYST], perm)
            assert res["allowed"] is False
            assert res["code"] == "INSUFFICIENT_PERMISSIONS"

    def test_security_admin_cannot_rotate_platform_secrets(self):
        # Secrets rotation is strictly reserved for Platform Administrator
        res = RBACManager.verify_authorization([Roles.SECURITY_ADMIN], Permissions.SECRETS_ROTATE)
        assert res["allowed"] is False
        assert res["code"] == "INSUFFICIENT_PERMISSIONS"


class TestHorizontalPrivilegeEscalation:
    def test_cross_tenant_access_blocked(self):
        # Developer in tenant-alpha attempting to access tenant-beta
        res = RBACManager.verify_authorization(
            user_roles=[Roles.DEVELOPER],
            required_permission=Permissions.ASSETS_READ,
            user_tenant="tenant-alpha",
            target_tenant="tenant-beta",
        )
        assert res["allowed"] is False
        assert res["code"] == "HORIZONTAL_TENANT_VIOLATION"
        assert "Cross-tenant access violation" in res["reason"]

    def test_platform_admin_cross_tenant_allowed(self):
        # Platform Administrator can manage across tenants
        res = RBACManager.verify_authorization(
            user_roles=[Roles.PLATFORM_ADMIN],
            required_permission=Permissions.ASSETS_READ,
            user_tenant="tenant-alpha",
            target_tenant="tenant-beta",
        )
        assert res["allowed"] is True

    def test_cross_user_ownership_modification_blocked(self):
        # Developer A attempting to modify a resource owned by Developer B
        res = RBACManager.verify_authorization(
            user_roles=[Roles.DEVELOPER],
            required_permission=Permissions.REMEDIATION_PROPOSE,
            user_tenant="tenant-alpha",
            target_tenant="tenant-alpha",
            user_id="usr_alice",
            target_owner_id="usr_bob",
        )
        assert res["allowed"] is False
        assert res["code"] == "HORIZONTAL_OWNER_VIOLATION"
        assert "Object ownership violation" in res["reason"]

    def test_same_user_ownership_modification_allowed(self):
        res = RBACManager.verify_authorization(
            user_roles=[Roles.DEVELOPER],
            required_permission=Permissions.REMEDIATION_PROPOSE,
            user_tenant="tenant-alpha",
            target_tenant="tenant-alpha",
            user_id="usr_alice",
            target_owner_id="usr_alice",
        )
        assert res["allowed"] is True


class TestEndpointDeclarations:
    def test_all_declared_endpoints_have_valid_permissions(self):
        assert len(ENDPOINT_PERMISSIONS) >= 15
        for endpoint, perm in ENDPOINT_PERMISSIONS.items():
            assert " " in endpoint, f"Endpoint {endpoint} must specify METHOD PATH"
            assert isinstance(perm, str)
            assert ":" in perm, f"Permission {perm} must follow domain:action format"


class TestAuthoritativeMatrix:
    def test_matrix_dimensions_and_definitions(self):
        capabilities = [
            getattr(Capabilities, attr)
            for attr in dir(Capabilities)
            if not attr.startswith("_") and isinstance(getattr(Capabilities, attr), str)
        ]
        assert len(capabilities) == 11
        roles = ["anonymous", "viewer", "analyst", "developer", "auditor", "admin", "platform_admin"]

        for cap in capabilities:
            assert cap in AUTHORIZATION_MATRIX, f"Missing matrix definition for capability '{cap}'"
            cap_entry = AUTHORIZATION_MATRIX[cap]
            for role in roles:
                assert role in cap_entry, f"Missing role '{role}' in capability '{cap}'"
                expected_val = cap_entry[role]
                assert expected_val in {"YES", "NO", "scoped", "policy"}

    def test_77_cell_matrix_evaluation(self):
        capabilities = [
            getattr(Capabilities, attr)
            for attr in dir(Capabilities)
            if not attr.startswith("_") and isinstance(getattr(Capabilities, attr), str)
        ]
        roles = ["anonymous", "viewer", "analyst", "developer", "auditor", "admin", "platform_admin"]

        for cap in capabilities:
            for role in roles:
                expected_val = AUTHORIZATION_MATRIX[cap][role]
                res = RBACManager.evaluate_capability(role, cap)

                if expected_val == "NO":
                    assert res["allowed"] is False
                    expected_status = 401 if role == "anonymous" else 403
                    assert res["status"] == expected_status
                    assert "audit_event" in res
                    assert res["audit_event"]["status"] == "DENIED"
                elif expected_val == "scoped":
                    assert res["allowed"] is True
                    assert res["scope"] == "tenant"
                elif expected_val == "policy":
                    assert res["allowed"] is True
                    assert res["scope"] == "policy_governed"
                elif expected_val == "YES":
                    assert res["allowed"] is True


class TestDeniedPermissionAuditAndSideEffects:
    def test_audit_event_logged_on_vertical_denial(self):
        audit_logger = AuthAuditLogger()
        res = RBACManager.verify_authorization(
            user_roles=[Roles.VIEWER],
            required_permission=Permissions.SECRETS_ROTATE,
            user_id="usr_viewer_bob",
            audit_logger=audit_logger,
        )

        assert res["allowed"] is False
        assert res["code"] == "INSUFFICIENT_PERMISSIONS"
        assert res["audit_event"]["status"] == "DENIED"

        # Verify audit logger recorded event
        assert len(audit_logger.events) == 1
        entry = audit_logger.events[0]
        assert entry["status"] == "DENIED"
        assert entry["eventType"] == "PERMISSION_DENIED"
        assert entry["userId"] == "usr_viewer_bob"

        # Verify cryptographic tamper chain
        integrity = audit_logger.verify_chain_integrity()
        assert integrity["valid"] is True

    def test_audit_event_logged_on_horizontal_tenant_denial(self):
        audit_logger = AuthAuditLogger()
        res = RBACManager.verify_authorization(
            user_roles=[Roles.SECURITY_ADMIN],
            required_permission=Permissions.ASSETS_READ,
            user_tenant="tenant-alpha",
            target_tenant="tenant-beta",
            user_id="usr_admin_alice",
            audit_logger=audit_logger,
        )

        assert res["allowed"] is False
        assert res["code"] == "HORIZONTAL_TENANT_VIOLATION"
        assert res["audit_event"]["status"] == "DENIED"

        assert len(audit_logger.events) == 1
        entry = audit_logger.events[0]
        assert entry["status"] == "DENIED"
        assert entry["eventType"] == "TENANT_ISOLATION_VIOLATION"
        assert entry["userId"] == "usr_admin_alice"

        integrity = audit_logger.verify_chain_integrity()
        assert integrity["valid"] is True

