# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Resource Governance & DoS Prevention Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import pytest
from scanners.common.resource_governance import (
    ResourceQuotaGovernor,
    ResourceQuotas,
    ConcurrencyQuotaExceededError,
    QueueDepthExceededError,
    ExpensiveScanComplexityError,
)


class TestResourceGovernanceControl:
    """
    Security Control: Multi-Tenant Resource Governance & DoS Defense
    Guarantees fair-sharing, prevents resource exhaustion, and caps concurrency / queue depths.
    """

    @pytest.fixture
    def governor(self):
        quotas = ResourceQuotas(
            max_concurrency_per_tenant=2,
            max_concurrency_system=5,
            max_queue_depth_per_tenant=10,
            max_queue_depth_system=20,
            max_directory_depth=10,
        )
        return ResourceQuotaGovernor(quotas=quotas)

    # 1. POSITIVE TEST: Normal concurrency acquisition and release succeeds
    def test_positive_resource_governance(self, governor):
        assert governor.acquire_concurrency("tenant-1", "scan-001") is True
        assert governor.get_active_count("tenant-1") == 1
        assert governor.get_active_count() == 1

        governor.release_concurrency("tenant-1", "scan-001")
        assert governor.get_active_count("tenant-1") == 0
        assert governor.get_active_count() == 0

    # 2. NEGATIVE TEST: Excessive queue depth rejected with QueueDepthExceededError
    def test_negative_resource_governance(self, governor):
        with pytest.raises(QueueDepthExceededError) as exc_info:
            governor.check_queue_depth(
                tenant_id="tenant-1",
                current_tenant_depth=11,  # Limit is 10
                current_system_depth=5,
            )
        assert "queue depth" in str(exc_info.value).lower()

    # 3. BOUNDARY TEST: Concurrency exact boundary (limit of 2 per tenant)
    def test_boundary_resource_governance(self, governor):
        # Slot 1: OK
        assert governor.acquire_concurrency("tenant-2", "scan-a") is True
        # Slot 2 (exact limit): OK
        assert governor.acquire_concurrency("tenant-2", "scan-b") is True

        assert governor.get_active_count("tenant-2") == 2

        # Cleanup
        governor.release_concurrency("tenant-2", "scan-a")
        governor.release_concurrency("tenant-2", "scan-b")

    # 4. MALICIOUS TEST: Concurrency flooding attack blocked with ConcurrencyQuotaExceededError
    def test_malicious_resource_governance(self, governor):
        governor.acquire_concurrency("tenant-attacker", "flood-1")
        governor.acquire_concurrency("tenant-attacker", "flood-2")

        # 3rd scan attempts to exceed tenant quota of 2
        with pytest.raises(ConcurrencyQuotaExceededError) as exc_info:
            governor.acquire_concurrency("tenant-attacker", "flood-3")
        assert "concurrency quota" in str(exc_info.value).lower()

        # Cleanup
        governor.release_concurrency("tenant-attacker", "flood-1")
        governor.release_concurrency("tenant-attacker", "flood-2")

    # 5. REGRESSION TEST: System-wide concurrency ceiling enforces multi-tenant defense
    def test_regression_resource_governance(self, governor):
        # Fill system capacity across multiple distinct tenants (system limit is 5)
        governor.acquire_concurrency("tenant-a", "s-1")
        governor.acquire_concurrency("tenant-a", "s-2")
        governor.acquire_concurrency("tenant-b", "s-3")
        governor.acquire_concurrency("tenant-b", "s-4")
        governor.acquire_concurrency("tenant-c", "s-5")

        assert governor.get_active_count() == 5

        # Tenant D attempts to acquire when system is at full capacity (5 of 5)
        with pytest.raises(ConcurrencyQuotaExceededError) as exc_info:
            governor.acquire_concurrency("tenant-d", "s-6")
        assert "system-wide" in str(exc_info.value).lower()

        # Cleanup
        governor.release_concurrency("tenant-a", "s-1")
        governor.release_concurrency("tenant-a", "s-2")
        governor.release_concurrency("tenant-b", "s-3")
        governor.release_concurrency("tenant-b", "s-4")
        governor.release_concurrency("tenant-c", "s-5")
