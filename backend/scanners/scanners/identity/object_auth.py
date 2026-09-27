"""
Enterprise Object-Level Authorization & BOLA/IDOR Defense Module

Mandate (Phase 18 / P1):
1. Do not rely solely on role checks.
2. For every endpoint accepting:
   - userId
   - tenantId
   - scanId
   - reportId
   - cbomId
   - assetId
   - projectId
   - jobId
   - secretId
   - integrationId
   verify ownership and authorization against authoritative server-side state.
3. Prevent IDOR, BOLA, and cross-tenant object access.
4. Detect and defend against sequential ID manipulation and UUID tampering.
5. Guarantee zero side effects on denial and record structured audit events.
"""

from dataclasses import dataclass, field
from enum import Enum
import re
from typing import Any, Dict, List, Optional
import uuid


class ObjectTypes(str, Enum):
    USER = "userId"
    TENANT = "tenantId"
    SCAN = "scanId"
    REPORT = "reportId"
    CBOM = "cbomId"
    ASSET = "assetId"
    PROJECT = "projectId"
    JOB = "jobId"
    SECRET = "secretId"
    INTEGRATION = "integrationId"


@dataclass
class CallerContext:
    user_id: str
    tenant_id: str
    roles: List[str] = field(default_factory=lambda: ["viewer"])
    is_platform_admin: bool = False

    @property
    def is_tenant_admin(self) -> bool:
        if self.is_platform_admin:
            return True
        admin_roles = {"admin", "security admin", "security administrator", "secops", "platform administrator"}
        return any(r.lower() in admin_roles for r in self.roles)


@dataclass
class ServerResource:
    id: str
    object_type: ObjectTypes
    tenant_id: str
    owner_id: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)


class ObjectAuthorizationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 403, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


UUID_REGEX = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def is_valid_uuid(val: str) -> bool:
    """Checks whether a string matches RFC 4122 UUID syntax."""
    if not isinstance(val, str):
        return False
    return bool(UUID_REGEX.match(val.strip()))


def sanitize_object_id(raw_id: Any) -> Optional[str]:
    """Sanitizes object ID, rejecting path traversal or null byte injection."""
    if raw_id is None:
        return None
    s = str(raw_id).strip()
    if not s or "\0" in s or ".." in s:
        return None
    return s


class ObjectStateRegistry:
    """In-memory authoritative state registry for multi-tenant server objects."""

    def __init__(self):
        # (object_type, object_id) -> ServerResource
        self._resources: Dict[tuple, ServerResource] = {}

    def register(
        self,
        object_type: ObjectTypes,
        resource_id: str,
        tenant_id: str,
        owner_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> ServerResource:
        clean_id = str(resource_id).strip()
        res = ServerResource(
            id=clean_id,
            object_type=object_type,
            tenant_id=tenant_id,
            owner_id=owner_id,
            data=data or {},
        )
        self._resources[(object_type, clean_id)] = res
        return res

    def get(self, object_type: ObjectTypes, resource_id: str) -> Optional[ServerResource]:
        clean_id = sanitize_object_id(resource_id)
        if not clean_id:
            return None
        return self._resources.get((object_type, clean_id))

    def remove(self, object_type: ObjectTypes, resource_id: str) -> bool:
        clean_id = sanitize_object_id(resource_id)
        if not clean_id:
            return False
        return self._resources.pop((object_type, clean_id), None) is not None

    def clear(self):
        self._resources.clear()


default_object_registry = ObjectStateRegistry()


def verify_object_authorization(
    caller: CallerContext,
    object_type: ObjectTypes,
    object_id: str,
    registry: Optional[ObjectStateRegistry] = None,
    audit_logger: Optional[Any] = None,
    require_individual_ownership: bool = False,
) -> Dict[str, Any]:
    """
    Evaluates object-level authorization against authoritative server-side state.

    Guarantees:
    - Zero side effects on failure.
    - Emits structured audit events for security logging.
    - Rejects cross-tenant access with 403 HORIZONTAL_TENANT_VIOLATION.
    - Rejects unowned resource mutations with 403 OBJECT_AUTHORIZATION_FAILED.
    - Rejects non-existent resources with 404 NotFound.
    """
    clean_id = sanitize_object_id(object_id)
    if not clean_id:
        return {
            "allowed": False,
            "status_code": 400,
            "code": "BAD_REQUEST",
            "reason": f"Invalid identifier for '{object_type.value}'",
        }

    reg = registry or default_object_registry

    # 1. Server-Side State Resolution
    resource = reg.get(object_type, clean_id)
    if not resource:
        return {
            "allowed": False,
            "status_code": 404,
            "code": "NOT_FOUND",
            "reason": f"{object_type.value} '{clean_id}' not found in server-side state",
        }

    # 2. Horizontal Multi-Tenancy Boundary Check
    if not caller.is_platform_admin and resource.tenant_id != caller.tenant_id:
        event = {
            "action": "TENANT_ISOLATION_VIOLATION",
            "status": "DENIED",
            "category": "PERMISSION_CHANGE",
            "severity": "CRITICAL",
            "actor": {
                "id": caller.user_id,
                "role": caller.roles[0] if caller.roles else "viewer",
                "tenantId": caller.tenant_id,
            },
            "target": {"type": object_type.value, "id": clean_id},
            "details": {
                "code": "HORIZONTAL_TENANT_VIOLATION",
                "objectType": object_type.value,
                "objectId": clean_id,
                "callerTenant": caller.tenant_id,
                "targetTenant": resource.tenant_id,
                "reason": f"Cross-tenant access blocked: caller in '{caller.tenant_id}' cannot access '{resource.tenant_id}' resource",
            },
        }
        if audit_logger:
            audit_logger.log_event(event)

        return {
            "allowed": False,
            "status_code": 403,
            "code": "HORIZONTAL_TENANT_VIOLATION",
            "reason": f"Cannot access {object_type.value} belonging to foreign tenant '{resource.tenant_id}'",
            "audit_event": event,
        }

    # 3. Individual Object Ownership (IDOR / BOLA) Check
    must_check_ownership = (
        require_individual_ownership
        or object_type == ObjectTypes.USER
        or (resource.owner_id and not caller.is_platform_admin)
    )

    if must_check_ownership and resource.owner_id:
        is_owner = caller.user_id == resource.owner_id
        is_admin_same_tenant = caller.is_tenant_admin and resource.tenant_id == caller.tenant_id

        if not is_owner and not is_admin_same_tenant and not caller.is_platform_admin:
            event = {
                "action": "OBJECT_OWNERSHIP_VIOLATION",
                "status": "DENIED",
                "category": "PERMISSION_CHANGE",
                "severity": "CRITICAL",
                "actor": {
                    "id": caller.user_id,
                    "role": caller.roles[0] if caller.roles else "viewer",
                    "tenantId": caller.tenant_id,
                },
                "target": {"type": object_type.value, "id": clean_id},
                "details": {
                    "code": "OBJECT_AUTHORIZATION_FAILED",
                    "objectType": object_type.value,
                    "objectId": clean_id,
                    "ownerId": resource.owner_id,
                    "callerId": caller.user_id,
                    "reason": f"Object ownership check failed: caller '{caller.user_id}' does not own {object_type.value}",
                },
            }
            if audit_logger:
                audit_logger.log_event(event)

            return {
                "allowed": False,
                "status_code": 403,
                "code": "OBJECT_AUTHORIZATION_FAILED",
                "reason": f"You do not have authorization to access or mutate this {object_type.value}",
                "audit_event": event,
            }

    return {
        "allowed": True,
        "status_code": 200,
        "resource": resource,
    }
