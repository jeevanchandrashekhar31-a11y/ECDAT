"""
Server-Side Role-Based Access Control (RBAC) & Privilege Hardening (Python) — Phase 15.3

Implements:
- 6 Canonical Enterprise Roles:
  1. platform administrator
  2. security administrator
  3. analyst
  4. developer
  5. auditor
  6. viewer
- Granular permissions model
- Explicit endpoint permission declarations
- Vertical Privilege Escalation (VPE) defense
- Horizontal Privilege Escalation (HPE) / Multi-Tenant Boundary defense
"""

from typing import Any, Dict, List, Optional, Set, Union


class Roles:
    PLATFORM_ADMIN = "platform administrator"
    SECURITY_ADMIN = "security administrator"
    ANALYST = "analyst"
    DEVELOPER = "developer"
    AUDITOR = "auditor"
    VIEWER = "viewer"


ROLE_ALIASES: Dict[str, str] = {
    "platform administrator": Roles.PLATFORM_ADMIN,
    "platform_admin": Roles.PLATFORM_ADMIN,
    "platform-admin": Roles.PLATFORM_ADMIN,
    "platformadmin": Roles.PLATFORM_ADMIN,
    "admin": Roles.PLATFORM_ADMIN,
    "superuser": Roles.PLATFORM_ADMIN,

    "security administrator": Roles.SECURITY_ADMIN,
    "security_admin": Roles.SECURITY_ADMIN,
    "security-admin": Roles.SECURITY_ADMIN,
    "securityadmin": Roles.SECURITY_ADMIN,
    "secops": Roles.SECURITY_ADMIN,
    "security_engineer": Roles.SECURITY_ADMIN,

    "analyst": Roles.ANALYST,
    "threat_analyst": Roles.ANALYST,
    "crypto_analyst": Roles.ANALYST,

    "developer": Roles.DEVELOPER,
    "dev": Roles.DEVELOPER,
    "engineer": Roles.DEVELOPER,
    "devops": Roles.DEVELOPER,

    "auditor": Roles.AUDITOR,
    "compliance": Roles.AUDITOR,
    "compliance_officer": Roles.AUDITOR,

    "viewer": Roles.VIEWER,
    "read_only": Roles.VIEWER,
    "reader": Roles.VIEWER,
}


class Permissions:
    # Platform & Multi-Tenancy Management
    PLATFORM_MANAGE = "platform:manage"
    TENANTS_MANAGE = "tenants:manage"
    SECRETS_ROTATE = "secrets:rotate"
    USERS_MANAGE = "users:manage"

    # Security Policy & Governance
    POLICY_READ = "policy:read"
    POLICY_CREATE = "policy:create"
    POLICY_APPROVE = "policy:approve"
    POLICY_DELETE = "policy:delete"

    # Remediation & Patch Approvals
    REMEDIATION_READ = "remediation:read"
    REMEDIATION_PROPOSE = "remediation:propose"
    REMEDIATION_APPROVE = "remediation:approve"
    REMEDIATION_APPLY = "remediation:apply"

    # Assets & Inventory
    ASSETS_READ = "assets:read"
    ASSETS_WRITE = "assets:write"
    ASSETS_DELETE = "assets:delete"

    # CBOM
    CBOM_READ = "cbom:read"
    CBOM_GENERATE = "cbom:generate"

    # Scans & Findings
    SCANS_READ = "scans:read"
    SCANS_TRIGGER = "scans:trigger"
    SCANS_DELETE = "scans:delete"
    FINDINGS_READ = "findings:read"
    FINDINGS_SUPPRESS = "findings:suppress"
    FINDINGS_EXPORT = "findings:export"

    # Compliance & Cryptographic Audit Ledger
    COMPLIANCE_READ = "compliance:read"
    COMPLIANCE_EXPORT = "compliance:export"
    AUDIT_READ = "audit:read"
    AUDIT_VERIFY = "audit:verify"

    # CI / CD Workflows
    CI_READ = "ci:read"
    CI_EXECUTE = "ci:execute"

    # Integrations (Ticketing, Cloud KMS / HSM)
    TICKETING_READ = "ticketing:read"
    TICKETING_CREATE = "ticketing:create"
    KMS_READ = "kms:read"
    KMS_SYNC = "kms:sync"


ROLE_PERMISSIONS: Dict[str, Set[str]] = {
    # 1. Platform Administrator: Superuser access across all platform operations
    Roles.PLATFORM_ADMIN: {"*"},

    # 2. Security Administrator: Full authority over policy, remediation approvals, audit, compliance
    Roles.SECURITY_ADMIN: {
        Permissions.POLICY_READ,
        Permissions.POLICY_CREATE,
        Permissions.POLICY_APPROVE,
        Permissions.POLICY_DELETE,
        Permissions.REMEDIATION_READ,
        Permissions.REMEDIATION_PROPOSE,
        Permissions.REMEDIATION_APPROVE,
        Permissions.REMEDIATION_APPLY,
        Permissions.ASSETS_READ,
        Permissions.ASSETS_WRITE,
        Permissions.ASSETS_DELETE,
        Permissions.CBOM_READ,
        Permissions.CBOM_GENERATE,
        Permissions.SCANS_READ,
        Permissions.SCANS_TRIGGER,
        Permissions.SCANS_DELETE,
        Permissions.FINDINGS_READ,
        Permissions.FINDINGS_SUPPRESS,
        Permissions.FINDINGS_EXPORT,
        Permissions.COMPLIANCE_READ,
        Permissions.COMPLIANCE_EXPORT,
        Permissions.AUDIT_READ,
        Permissions.AUDIT_VERIFY,
        Permissions.CI_READ,
        Permissions.CI_EXECUTE,
        Permissions.TICKETING_READ,
        Permissions.TICKETING_CREATE,
        Permissions.KMS_READ,
        Permissions.KMS_SYNC,
        Permissions.USERS_MANAGE,
    },

    # 3. Analyst: Threat modeling, PQC risk analysis, remediation proposal, report export
    Roles.ANALYST: {
        Permissions.ASSETS_READ,
        Permissions.ASSETS_WRITE,
        Permissions.CBOM_READ,
        Permissions.CBOM_GENERATE,
        Permissions.SCANS_READ,
        Permissions.SCANS_TRIGGER,
        Permissions.FINDINGS_READ,
        Permissions.FINDINGS_SUPPRESS,
        Permissions.FINDINGS_EXPORT,
        Permissions.POLICY_READ,
        Permissions.COMPLIANCE_READ,
        Permissions.COMPLIANCE_EXPORT,
        Permissions.REMEDIATION_READ,
        Permissions.REMEDIATION_PROPOSE,
        Permissions.CI_READ,
        Permissions.TICKETING_READ,
        Permissions.TICKETING_CREATE,
        Permissions.KMS_READ,
    },

    # 4. Developer: Code scans, patch proposals, PR verification, assigned finding suppression
    Roles.DEVELOPER: {
        Permissions.ASSETS_READ,
        Permissions.ASSETS_WRITE,
        Permissions.CBOM_READ,
        Permissions.CBOM_GENERATE,
        Permissions.SCANS_READ,
        Permissions.SCANS_TRIGGER,
        Permissions.FINDINGS_READ,
        Permissions.FINDINGS_SUPPRESS,
        Permissions.REMEDIATION_READ,
        Permissions.REMEDIATION_PROPOSE,
        Permissions.CI_READ,
        Permissions.CI_EXECUTE,
        Permissions.TICKETING_READ,
        Permissions.POLICY_READ,
        Permissions.COMPLIANCE_READ,
    },

    # 5. Auditor: Strictly READ-ONLY for audit logs, compliance evidence, policies, findings
    Roles.AUDITOR: {
        Permissions.AUDIT_READ,
        Permissions.AUDIT_VERIFY,
        Permissions.COMPLIANCE_READ,
        Permissions.COMPLIANCE_EXPORT,
        Permissions.POLICY_READ,
        Permissions.FINDINGS_READ,
        Permissions.FINDINGS_EXPORT,
        Permissions.ASSETS_READ,
        Permissions.CBOM_READ,
        Permissions.SCANS_READ,
        Permissions.REMEDIATION_READ,
        Permissions.CI_READ,
        Permissions.TICKETING_READ,
        Permissions.KMS_READ,
    },

    # 6. Viewer: Minimal read-only dashboard access
    Roles.VIEWER: {
        Permissions.ASSETS_READ,
        Permissions.CBOM_READ,
        Permissions.FINDINGS_READ,
        Permissions.SCANS_READ,
        Permissions.COMPLIANCE_READ,
        Permissions.REMEDIATION_READ,
        Permissions.CI_READ,
    },
}

ENDPOINT_PERMISSIONS: Dict[str, str] = {
    # Assets & CBOM
    "GET /api/v1/assets": Permissions.ASSETS_READ,
    "POST /api/v1/assets": Permissions.ASSETS_WRITE,
    "DELETE /api/v1/assets/:id": Permissions.ASSETS_DELETE,
    "GET /api/v1/cboms": Permissions.CBOM_READ,
    "POST /api/v1/cboms": Permissions.CBOM_GENERATE,
    "POST /api/v1/cbom/merge": Permissions.CBOM_GENERATE,

    # Scans & Findings
    "GET /api/v1/scans": Permissions.SCANS_READ,
    "POST /api/v1/scans": Permissions.SCANS_TRIGGER,
    "DELETE /api/v1/scans/:id": Permissions.SCANS_DELETE,
    "GET /api/v1/findings": Permissions.FINDINGS_READ,
    "POST /api/v1/findings/:id/suppress": Permissions.FINDINGS_SUPPRESS,
    "GET /api/v1/findings/export": Permissions.FINDINGS_EXPORT,

    # Policy-as-Code & Governance
    "GET /api/v1/policy": Permissions.POLICY_READ,
    "POST /api/v1/policy": Permissions.POLICY_CREATE,
    "POST /api/v1/policy/approve": Permissions.POLICY_APPROVE,
    "DELETE /api/v1/policy/:id": Permissions.POLICY_DELETE,

    # Remediation & Patch Approvals
    "GET /api/v1/remediation": Permissions.REMEDIATION_READ,
    "POST /api/v1/remediation/plan": Permissions.REMEDIATION_PROPOSE,
    "POST /api/v1/remediation/approve": Permissions.REMEDIATION_APPROVE,
    "POST /api/v1/remediation/apply": Permissions.REMEDIATION_APPLY,

    # Compliance & Audits
    "GET /api/v1/compliance": Permissions.COMPLIANCE_READ,
    "GET /api/v1/compliance/export": Permissions.COMPLIANCE_EXPORT,
    "GET /api/v1/auth/audit": Permissions.AUDIT_READ,

    # CI Workflows & Integrations
    "GET /api/v1/ci": Permissions.CI_READ,
    "POST /api/v1/ci/scan": Permissions.CI_EXECUTE,
    "GET /api/v1/integrations/ticketing": Permissions.TICKETING_READ,
    "POST /api/v1/integrations/ticketing": Permissions.TICKETING_CREATE,
    "GET /api/v1/integrations/kms": Permissions.KMS_READ,
    "POST /api/v1/integrations/kms/sync": Permissions.KMS_SYNC,

    # Platform & Secrets Administration
    "POST /api/v1/auth/secrets/rotate": Permissions.SECRETS_ROTATE,
}


class RBACManager:
    """
    Evaluates role permissions, vertical privilege escalation, and horizontal tenant boundaries.
    """

    @staticmethod
    def normalize_role(role: str) -> str:
        if not role or not isinstance(role, str):
            return Roles.VIEWER
        clean = role.strip().lower().replace("-", " ").replace("_", " ")
        if clean in ROLE_ALIASES:
            return ROLE_ALIASES[clean]
        raw = role.strip().lower()
        if raw in ROLE_ALIASES:
            return ROLE_ALIASES[raw]
        return Roles.VIEWER

    @classmethod
    def get_user_permissions(cls, user_roles: Union[str, List[str]]) -> Set[str]:
        roles_list = [user_roles] if isinstance(user_roles, str) else list(user_roles or [])
        granted: Set[str] = set()

        for r in roles_list:
            canonical = cls.normalize_role(r)
            perms = ROLE_PERMISSIONS.get(canonical, set())
            if "*" in perms:
                # All permissions
                return {
                    getattr(Permissions, attr)
                    for attr in dir(Permissions)
                    if not attr.startswith("_") and isinstance(getattr(Permissions, attr), str)
                }
            granted.update(perms)

        return granted

    @classmethod
    def has_permission(cls, user_roles: Union[str, List[str]], required_permission: str) -> bool:
        if not required_permission:
            return True
        roles_list = [user_roles] if isinstance(user_roles, str) else list(user_roles or [])

        for r in roles_list:
            canonical = cls.normalize_role(r)
            perms = ROLE_PERMISSIONS.get(canonical, set())
            if "*" in perms or required_permission in perms:
                return True

            # Domain wildcard check (e.g. policy:* matches policy:approve)
            domain = required_permission.split(":")[0]
            if f"{domain}:*" in perms:
                return True

        return False

    @classmethod
    def verify_authorization(
        cls,
        user_roles: Union[str, List[str]],
        required_permission: str,
        user_tenant: str = "default-tenant",
        target_tenant: Optional[str] = None,
        user_id: Optional[str] = None,
        target_owner_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validates both vertical and horizontal privilege constraints.
        """
        roles_list = [user_roles] if isinstance(user_roles, str) else list(user_roles or [])

        # 1. Vertical Privilege Escalation Check
        if not cls.has_permission(roles_list, required_permission):
            return {
                "allowed": False,
                "code": "INSUFFICIENT_PERMISSIONS",
                "reason": f"Access denied. User lacks required permission: '{required_permission}'.",
                "requiredPermission": required_permission,
                "userRoles": roles_list,
            }

        # 2. Horizontal Privilege Escalation Check: Multi-tenant boundary
        is_platform_admin = any(cls.normalize_role(r) == Roles.PLATFORM_ADMIN for r in roles_list)
        if not is_platform_admin and target_tenant and target_tenant != user_tenant:
            return {
                "allowed": False,
                "code": "HORIZONTAL_TENANT_VIOLATION",
                "reason": f"Cross-tenant access violation: user tenant '{user_tenant}' cannot access target tenant '{target_tenant}'.",
                "userTenant": user_tenant,
                "targetTenant": target_tenant,
            }

        # 3. Horizontal Privilege Escalation Check: Object ownership boundary
        if target_owner_id and user_id and target_owner_id != user_id:
            is_sec_admin = any(cls.normalize_role(r) == Roles.SECURITY_ADMIN for r in roles_list)
            if not is_platform_admin and not is_sec_admin:
                return {
                    "allowed": False,
                    "code": "HORIZONTAL_OWNER_VIOLATION",
                    "reason": "Object ownership violation: non-admin cannot access/modify resources owned by another user.",
                    "userId": user_id,
                    "targetOwnerId": target_owner_id,
                }

        return {
            "allowed": True,
            "permission": required_permission,
            "userRoles": roles_list,
        }
