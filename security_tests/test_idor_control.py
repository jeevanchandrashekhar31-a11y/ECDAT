# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Object-Level Authorization & IDOR/BOLA Defense Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.identity.object_auth import (
    ObjectTypes,
    CallerContext,
    ObjectStateRegistry,
    verify_object_authorization,
    sanitize_object_id,
)


class TestIDORControl:
    """
    Security Control: Object-Level Authorization (BOLA/IDOR Defense)
    Guarantees that object ownership and tenant scope are validated against server state.
    """

    @pytest.fixture
    def registry(self):
        reg = ObjectStateRegistry()
        reg.register(
            object_type=ObjectTypes.SCAN,
            resource_id="scan-001",
            tenant_id="tenant-alpha",
            owner_id="user-alice",
            data={"target": "repo-alpha"},
        )
        reg.register(
            object_type=ObjectTypes.SCAN,
            resource_id="scan-002",
            tenant_id="tenant-beta",
            owner_id="user-bob",
            data={"target": "repo-beta"},
        )
        return reg

    # 1. POSITIVE TEST: Resource owner accesses own scan object
    def test_positive_idor(self, registry):
        caller_alice = CallerContext(user_id="user-alice", tenant_id="tenant-alpha", roles=["analyst"])
        res = verify_object_authorization(
            caller=caller_alice,
            object_type=ObjectTypes.SCAN,
            object_id="scan-001",
            registry=registry,
            require_individual_ownership=True,
        )
        assert res["allowed"] is True
        assert res["resource"].id == "scan-001"

    # 2. NEGATIVE TEST: Non-existent resource returns 404 NOT_FOUND
    def test_negative_idor(self, registry):
        caller_alice = CallerContext(user_id="user-alice", tenant_id="tenant-alpha", roles=["analyst"])
        res = verify_object_authorization(
            caller=caller_alice,
            object_type=ObjectTypes.SCAN,
            object_id="scan-non-existent-999",
            registry=registry,
        )
        assert res["allowed"] is False
        assert res["status_code"] == 404
        assert res["code"] == "NOT_FOUND"

    # 3. BOUNDARY TEST: Empty, whitespace, or None object IDs return 400 BAD_REQUEST
    def test_boundary_idor(self, registry):
        caller = CallerContext(user_id="user-alice", tenant_id="tenant-alpha", roles=["analyst"])

        # None object ID
        res_none = verify_object_authorization(caller, ObjectTypes.SCAN, None, registry=registry)
        assert res_none["allowed"] is False
        assert res_none["status_code"] == 400

        # Empty string object ID
        res_empty = verify_object_authorization(caller, ObjectTypes.SCAN, "", registry=registry)
        assert res_empty["allowed"] is False
        assert res_empty["status_code"] == 400

        # Sanitizer strips whitespace
        assert sanitize_object_id("   ") is None

    # 4. MALICIOUS TEST: Cross-tenant BOLA and same-tenant non-owner mutation
    def test_malicious_idor(self, registry):
        # Alice (tenant-alpha) attempts to read Bob's scan (tenant-beta)
        caller_alice = CallerContext(user_id="user-alice", tenant_id="tenant-alpha", roles=["analyst"])
        res_cross = verify_object_authorization(
            caller=caller_alice,
            object_type=ObjectTypes.SCAN,
            object_id="scan-002",
            registry=registry,
        )
        assert res_cross["allowed"] is False
        assert res_cross["status_code"] == 403
        assert res_cross["code"] == "HORIZONTAL_TENANT_VIOLATION"

        # Charlie (same tenant as Alice, but not owner) attempts individual ownership mutation
        caller_charlie = CallerContext(user_id="user-charlie", tenant_id="tenant-alpha", roles=["developer"])
        res_unowned = verify_object_authorization(
            caller=caller_charlie,
            object_type=ObjectTypes.SCAN,
            object_id="scan-001",
            registry=registry,
            require_individual_ownership=True,
        )
        assert res_unowned["allowed"] is False
        assert res_unowned["status_code"] == 403
        assert res_unowned["code"] == "OBJECT_AUTHORIZATION_FAILED"

    # 5. REGRESSION TEST: Path traversal & null byte object ID manipulation
    def test_regression_idor(self, registry):
        caller = CallerContext(user_id="user-alice", tenant_id="tenant-alpha", roles=["analyst"])

        # Null byte injection in object ID
        res_null = verify_object_authorization(caller, ObjectTypes.SCAN, "scan-001\x00evil", registry=registry)
        assert res_null["allowed"] is False
        assert res_null["status_code"] == 400

        # Path traversal sequence in object ID
        res_traversal = verify_object_authorization(caller, ObjectTypes.SCAN, "../scan-001", registry=registry)
        assert res_traversal["allowed"] is False
        assert res_traversal["status_code"] == 400
