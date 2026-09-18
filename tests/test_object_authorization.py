"""
Tests for Object-Level Authorization, BOLA, IDOR, Sequential ID Manipulation, and UUID Tampering.

Phase 18 (P1):
- Server-side state verification across all 10 object types:
  userId, tenantId, scanId, reportId, cbomId, assetId, projectId, jobId, secretId, integrationId.
- Rejection of cross-tenant object access with 403 HORIZONTAL_TENANT_VIOLATION.
- Rejection of individual object ownership violations with 403 OBJECT_AUTHORIZATION_FAILED.
- Rejection of non-existent sequential IDs and UUIDs with 404.
- Rejection of path traversal in IDs.
- Zero side effects on denial.
- Audit event logging with status DENIED.
"""

import pytest
import uuid
from scanners.identity.object_auth import (
    ObjectTypes,
    CallerContext,
    ObjectStateRegistry,
    verify_object_authorization,
    is_valid_uuid,
    sanitize_object_id,
)


class MockAuditLogger:
    def __init__(self):
        self.events = []

    def log_event(self, event):
        self.events.append(event)


@pytest.fixture
def mock_audit():
    return MockAuditLogger()


@pytest.fixture
def test_registry():
    registry = ObjectStateRegistry()

    # 1. User
    registry.register(ObjectTypes.USER, "usr_alpha_1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.USER, "usr_beta_1", "tenant-beta", owner_id="usr_beta_1")

    # 2. Tenant
    registry.register(ObjectTypes.TENANT, "tenant-alpha", "tenant-alpha")
    registry.register(ObjectTypes.TENANT, "tenant-beta", "tenant-beta")

    # 3. Scan
    registry.register(ObjectTypes.SCAN, "scan-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.SCAN, "scan-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 4. Report
    registry.register(ObjectTypes.REPORT, "rep-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.REPORT, "rep-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 5. CBOM
    registry.register(ObjectTypes.CBOM, "cbom-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.CBOM, "cbom-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 6. Asset
    registry.register(ObjectTypes.ASSET, "asset-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.ASSET, "asset-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 7. Project
    registry.register(ObjectTypes.PROJECT, "proj-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.PROJECT, "proj-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 8. Job
    registry.register(ObjectTypes.JOB, "job-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.JOB, "job-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 9. Secret
    registry.register(ObjectTypes.SECRET, "sec-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.SECRET, "sec-seq-2", "tenant-beta", owner_id="usr_beta_1")

    # 10. Integration
    registry.register(ObjectTypes.INTEGRATION, "int-seq-1", "tenant-alpha", owner_id="usr_alpha_1")
    registry.register(ObjectTypes.INTEGRATION, "int-seq-2", "tenant-beta", owner_id="usr_beta_1")

    return registry


def test_server_state_verification_all_10_types(test_registry, mock_audit):
    caller_alpha = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    ids_tenant_a = {
        ObjectTypes.USER: "usr_alpha_1",
        ObjectTypes.TENANT: "tenant-alpha",
        ObjectTypes.SCAN: "scan-seq-1",
        ObjectTypes.REPORT: "rep-seq-1",
        ObjectTypes.CBOM: "cbom-seq-1",
        ObjectTypes.ASSET: "asset-seq-1",
        ObjectTypes.PROJECT: "proj-seq-1",
        ObjectTypes.JOB: "job-seq-1",
        ObjectTypes.SECRET: "sec-seq-1",
        ObjectTypes.INTEGRATION: "int-seq-1",
    }

    # All 10 object types belonging to tenant-alpha must be accessible to caller_alpha
    for obj_type in ObjectTypes:
        seq_id = ids_tenant_a[obj_type]
        res = verify_object_authorization(caller_alpha, obj_type, seq_id, test_registry, mock_audit)
        assert res["allowed"] is True, f"Legitimate access to {obj_type.value} must be granted"
        assert res["status_code"] == 200


def test_cross_tenant_access_blocked_all_10_types(test_registry, mock_audit):
    caller_alpha = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    ids_tenant_b = {
        ObjectTypes.USER: "usr_beta_1",
        ObjectTypes.TENANT: "tenant-beta",
        ObjectTypes.SCAN: "scan-seq-2",
        ObjectTypes.REPORT: "rep-seq-2",
        ObjectTypes.CBOM: "cbom-seq-2",
        ObjectTypes.ASSET: "asset-seq-2",
        ObjectTypes.PROJECT: "proj-seq-2",
        ObjectTypes.JOB: "job-seq-2",
        ObjectTypes.SECRET: "sec-seq-2",
        ObjectTypes.INTEGRATION: "int-seq-2",
    }

    # All 10 object types belonging to tenant-beta must be blocked for caller_alpha
    for obj_type in ObjectTypes:
        foreign_id = ids_tenant_b[obj_type]
        res = verify_object_authorization(caller_alpha, obj_type, foreign_id, test_registry, mock_audit)
        assert res["allowed"] is False, f"Cross-tenant access to {obj_type.value} must be denied"
        assert res["status_code"] == 403
        assert res["code"] == "HORIZONTAL_TENANT_VIOLATION"

    # Audit events must be recorded for each denial
    assert len(mock_audit.events) == 10
    for ev in mock_audit.events:
        assert ev["status"] == "DENIED"
        assert ev["action"] == "TENANT_ISOLATION_VIOLATION"
        assert ev["actor"]["tenantId"] == "tenant-alpha"


def test_sequential_id_manipulation_defense(test_registry, mock_audit):
    caller_alpha = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    # 1. Attacker increments ID: scan-seq-1 -> scan-seq-2 (belongs to Tenant B)
    res_b = verify_object_authorization(caller_alpha, ObjectTypes.SCAN, "scan-seq-2", test_registry, mock_audit)
    assert res_b["allowed"] is False
    assert res_b["status_code"] == 403
    assert res_b["code"] == "HORIZONTAL_TENANT_VIOLATION"

    # 2. Attacker probes non-existent sequential ID: scan-seq-999
    res_404 = verify_object_authorization(caller_alpha, ObjectTypes.SCAN, "scan-seq-999", test_registry, mock_audit)
    assert res_404["allowed"] is False
    assert res_404["status_code"] == 404
    assert res_404["code"] == "NOT_FOUND"


def test_uuid_manipulation_defense(test_registry, mock_audit):
    caller_alpha = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    uuid_alpha = str(uuid.uuid4())
    uuid_beta = str(uuid.uuid4())
    forged_uuid = str(uuid.uuid4())

    test_registry.register(ObjectTypes.JOB, uuid_alpha, "tenant-alpha", owner_id="usr_alpha_1")
    test_registry.register(ObjectTypes.JOB, uuid_beta, "tenant-beta", owner_id="usr_beta_1")

    # Valid own UUID -> 200
    res_own = verify_object_authorization(caller_alpha, ObjectTypes.JOB, uuid_alpha, test_registry, mock_audit)
    assert res_own["allowed"] is True
    assert res_own["status_code"] == 200

    # Foreign tenant UUID -> 403
    res_cross = verify_object_authorization(caller_alpha, ObjectTypes.JOB, uuid_beta, test_registry, mock_audit)
    assert res_cross["allowed"] is False
    assert res_cross["status_code"] == 403
    assert res_cross["code"] == "HORIZONTAL_TENANT_VIOLATION"

    # Non-existent UUID -> 404
    res_nonexistent = verify_object_authorization(caller_alpha, ObjectTypes.JOB, forged_uuid, test_registry, mock_audit)
    assert res_nonexistent["allowed"] is False
    assert res_nonexistent["status_code"] == 404
    assert res_nonexistent["code"] == "NOT_FOUND"


def test_uuid_syntax_validation():
    assert is_valid_uuid("c9a646d3-9c61-4cc9-bc77-9878140be0a5") is True
    assert is_valid_uuid("00000000-0000-4000-8000-000000000000") is True
    assert is_valid_uuid("not-a-uuid") is False
    assert is_valid_uuid("12345") is False
    assert is_valid_uuid("../../etc/passwd") is False


def test_path_traversal_sanitization(test_registry, mock_audit):
    caller_alpha = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    assert sanitize_object_id("../../etc/passwd") is None
    assert sanitize_object_id("scan-001\0nullbyte") is None
    assert sanitize_object_id("   valid-id   ") == "valid-id"

    # Injected ID rejected with 400
    res = verify_object_authorization(caller_alpha, ObjectTypes.SCAN, "../../etc/passwd", test_registry, mock_audit)
    assert res["allowed"] is False
    assert res["status_code"] == 400


def test_object_ownership_idor_defense(test_registry, mock_audit):
    # Two users in the SAME tenant: Alice and Charlie
    test_registry.register(ObjectTypes.SECRET, "sec-private-alice", "tenant-alpha", owner_id="usr_alpha_1")
    test_registry.register(ObjectTypes.SECRET, "sec-private-charlie", "tenant-alpha", owner_id="usr_charlie_1")

    caller_alice = CallerContext(user_id="usr_alpha_1", tenant_id="tenant-alpha", roles=["analyst"])

    # Alice accessing Charlie's private secret in the same tenant must be blocked (IDOR)
    res = verify_object_authorization(
        caller_alice,
        ObjectTypes.SECRET,
        "sec-private-charlie",
        test_registry,
        mock_audit,
        require_individual_ownership=True,
    )
    assert res["allowed"] is False
    assert res["status_code"] == 403
    assert res["code"] == "OBJECT_AUTHORIZATION_FAILED"

    # Audit event logged
    denial = [e for e in mock_audit.events if e["action"] == "OBJECT_OWNERSHIP_VIOLATION"]
    assert len(denial) == 1
    assert denial[0]["actor"]["id"] == "usr_alpha_1"
    assert denial[0]["details"]["ownerId"] == "usr_charlie_1"


def test_platform_admin_bypass(test_registry, mock_audit):
    caller_super = CallerContext(user_id="super_admin", tenant_id="system", roles=["platform_admin"], is_platform_admin=True)

    # Platform admin can access objects across all tenants
    res_a = verify_object_authorization(caller_super, ObjectTypes.SCAN, "scan-seq-1", test_registry, mock_audit)
    assert res_a["allowed"] is True

    res_b = verify_object_authorization(caller_super, ObjectTypes.SCAN, "scan-seq-2", test_registry, mock_audit)
    assert res_b["allowed"] is True
