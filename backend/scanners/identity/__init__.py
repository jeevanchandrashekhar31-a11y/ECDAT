"""
Enterprise Identity, Authentication & RBAC Module — Phase 14.2, 15.2 & 15.3
"""

from scanners.identity.token_verifier import TokenVerifier
from scanners.identity.auth_audit import AuthAuditLogger
from scanners.identity.password_policy import (
    PasswordPolicy,
    PasswordPolicyError,
    AccountLockedError,
    LocalAuthManager,
    COMMON_PASSWORDS_BLACKLIST,
)
from scanners.identity.totp_mfa import (
    MfaTotpEngine,
    base32_encode,
    base32_decode,
)
from scanners.identity.cookie_session import (
    CookieSecurityValidator,
    CSRF_HEADER_NAME,
    CSRF_COOKIE_NAME,
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
)
from scanners.identity.rbac import (
    Roles,
    Permissions,
    ROLE_PERMISSIONS,
    ENDPOINT_PERMISSIONS,
    RBACManager,
)
from scanners.identity.multi_tenancy import (
    TenantBoundaryViolation,
    TenantPathTraversalError,
    TenantContext,
    TenantIsolationEnforcer,
    TenantScopedDatabase,
    TenantScopedObjectStorage,
    TenantScopedCache,
    TenantScopedJobQueue,
    TenantScopedQueue,
    TenantScopedExportEngine,
    TenantScopedAuditLogger,
)

__all__ = [
    "TokenVerifier",
    "AuthAuditLogger",
    "PasswordPolicy",
    "PasswordPolicyError",
    "AccountLockedError",
    "LocalAuthManager",
    "COMMON_PASSWORDS_BLACKLIST",
    "MfaTotpEngine",
    "base32_encode",
    "base32_decode",
    "CookieSecurityValidator",
    "CSRF_HEADER_NAME",
    "CSRF_COOKIE_NAME",
    "ACCESS_COOKIE_NAME",
    "REFRESH_COOKIE_NAME",
    "Roles",
    "Permissions",
    "ROLE_PERMISSIONS",
    "ENDPOINT_PERMISSIONS",
    "RBACManager",
    "TenantBoundaryViolation",
    "TenantPathTraversalError",
    "TenantContext",
    "TenantIsolationEnforcer",
    "TenantScopedDatabase",
    "TenantScopedObjectStorage",
    "TenantScopedCache",
    "TenantScopedJobQueue",
    "TenantScopedQueue",
    "TenantScopedExportEngine",
    "TenantScopedAuditLogger",
]
