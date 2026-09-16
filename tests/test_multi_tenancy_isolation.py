"""
Explicit Cross-Tenant Attack Tests (Python) — Phase 15.4

Verifies tenant isolation at every layer:
1. API Layer: Client-supplied tenant ID spoofing rejection
2. Database Layer: Row-level query isolation and cross-tenant IDOR defense
3. Object Storage Layer: Path traversal and cross-tenant prefix escape defense
4. Background Jobs Layer: Tenant execution confinement
5. Caches Layer: Cross-tenant cache poisoning and leakage defense
6. Queues Layer: Message channel partitioning
7. Exports Layer: Zero cross-tenant data leakage in SARIF and CBOM
8. Logs & Audit Layer: Cryptographic ledger isolation
"""

import pytest
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


class TestApiLayerTenantSpoofing:
    def test_client_supplied_tenant_id_never_trusted(self):
        # Authoritative token has tenant-alpha
        auth_ctx = TenantContext(tenant_id="tenant-alpha", user_id="user-1", roles=["developer"])

        # Client attempts to spoof tenant-beta via parameter
        with pytest.raises(TenantBoundaryViolation) as exc:
            TenantIsolationEnforcer.validate_request(auth_ctx, client_supplied_tenant_id="tenant-beta")
        assert exc.value.code == "TENANT_SPOOFING_VIOLATION"
        assert "does not match authoritative token tenant" in str(exc.value)

    def test_matching_tenant_id_passes(self):
        auth_ctx = TenantContext(tenant_id="tenant-alpha", user_id="user-1", roles=["developer"])
        res = TenantIsolationEnforcer.validate_request(auth_ctx, client_supplied_tenant_id="tenant-alpha")
        assert res["valid"] is True
        assert res["tenantId"] == "tenant-alpha"

    def test_omitted_tenant_id_inherits_authoritative_tenant(self):
        auth_ctx = TenantContext(tenant_id="tenant-alpha", user_id="user-1", roles=["developer"])
        res = TenantIsolationEnforcer.validate_request(auth_ctx, client_supplied_tenant_id=None)
        assert res["valid"] is True
        assert res["tenantId"] == "tenant-alpha"

    def test_platform_admin_can_manage_across_tenants(self):
        admin_ctx = TenantContext(tenant_id="platform-root", user_id="root-admin", roles=["platform administrator"], is_platform_admin=True)
        res = TenantIsolationEnforcer.validate_request(admin_ctx, client_supplied_tenant_id="tenant-customer-x")
        assert res["valid"] is True


class TestDatabaseLayerCrossTenantIsolation:
    def test_cross_tenant_idor_reads_blocked(self):
        db = TenantScopedDatabase()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Tenant Alpha inserts sensitive cryptographic asset
        asset = db.insert("assets", {"name": "Alpha Banking Core Key", "algorithm": "RSA-4096"}, ctx_alpha)
        alpha_id = asset["id"]

        # Tenant Alpha can find it
        assert db.find_by_id("assets", alpha_id, ctx_alpha) is not None

        # Attack: Tenant Beta attempts to read Alpha's asset directly by ID (IDOR)
        beta_attempt = db.find_by_id("assets", alpha_id, ctx_beta)
        assert beta_attempt is None, "Tenant Beta should never see Tenant Alpha's asset!"

        # Attack: Tenant Beta queries all assets
        beta_all = db.find("assets", {}, ctx_beta)
        assert len(beta_all) == 0

    def test_cross_tenant_mutation_and_deletion_blocked(self):
        db = TenantScopedDatabase()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        asset = db.insert("assets", {"name": "Alpha Production Database"}, ctx_alpha)
        alpha_id = asset["id"]

        # Attack: Tenant Beta attempts to update Tenant Alpha's record
        with pytest.raises(TenantBoundaryViolation):
            db.update("assets", alpha_id, {"name": "Hacked by Beta"}, ctx_beta)

        # Record remains untampered in Tenant Alpha
        original = db.find_by_id("assets", alpha_id, ctx_alpha)
        assert original["name"] == "Alpha Production Database"

        # Attack: Tenant Beta attempts to delete Tenant Alpha's record
        with pytest.raises(TenantBoundaryViolation):
            db.delete("assets", alpha_id, ctx_beta)

        assert db.find_by_id("assets", alpha_id, ctx_alpha) is not None


class TestObjectStorageLayerPathTraversalAttack:
    def test_storage_prefix_confinement(self):
        storage = TenantScopedObjectStorage(base_prefix="/storage")
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Alpha uploads CBOM
        storage.put_object("cboms/system_cbom.json", '{"components": []}', ctx_alpha)

        # Alpha can read own object
        item = storage.get_object("cboms/system_cbom.json", ctx_alpha)
        assert item["data"] == '{"components": []}'

        # Attack: Beta tries to read Alpha's CBOM with same relative key
        with pytest.raises(TenantBoundaryViolation):
            storage.get_object("cboms/system_cbom.json", ctx_beta)

    def test_path_traversal_cross_tenant_escape_blocked(self):
        storage = TenantScopedObjectStorage(base_prefix="/storage")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Attack: Beta tries directory traversal to escape into tenant-alpha's storage
        malicious_keys = [
            "../../tenant-alpha/cboms/system_cbom.json",
            "../tenant-alpha/secret.key",
            "/storage/tenant-alpha/cboms/system_cbom.json",
            "..\\tenant-alpha\\cbom.json",
            "cboms/../../../etc/passwd",
        ]

        for bad_key in malicious_keys:
            with pytest.raises(TenantPathTraversalError):
                storage.get_object(bad_key, ctx_beta)

            with pytest.raises(TenantPathTraversalError):
                storage.put_object(bad_key, "malicious data", ctx_beta)


class TestCacheLayerIsolation:
    def test_cross_tenant_cache_poisoning_blocked(self):
        cache = TenantScopedCache()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Alpha caches risk score
        cache.set("risk_score", 98.5, 300, ctx_alpha)

        # Beta checks same key
        assert cache.get("risk_score", ctx_beta) is None

        # Beta sets their own risk score
        cache.set("risk_score", 12.0, 300, ctx_beta)

        # Both remain completely isolated
        assert cache.get("risk_score", ctx_alpha) == 98.5
        assert cache.get("risk_score", ctx_beta) == 12.0

    def test_cross_tenant_cache_flush_blocked(self):
        cache = TenantScopedCache()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        cache.set("k1", "v_alpha", 300, ctx_alpha)
        cache.set("k2", "v_beta", 300, ctx_beta)

        # Beta flushes their cache
        evicted = cache.flush(ctx_beta)
        assert evicted == 1

        # Beta's key is gone, Alpha's key remains intact
        assert cache.get("k2", ctx_beta) is None
        assert cache.get("k1", ctx_alpha) == "v_alpha"


class TestBackgroundJobsAndQueuesIsolation:
    def test_job_execution_tenant_confinement(self):
        queue = TenantScopedJobQueue()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        job = queue.enqueue("scan_repo", {"repo": "internal-core"}, ctx_alpha)
        job_id = job["job_id"]

        # Worker captures executed tenant
        executed_tenant = []

        def worker_task(payload, worker_ctx):
            executed_tenant.append(worker_ctx.tenant_id)
            return {"status": "scanned", "tenant": worker_ctx.tenant_id}

        queue.execute_worker(job_id, worker_task)

        assert executed_tenant == ["tenant-alpha"]

        # Beta cannot list Alpha's jobs
        beta_jobs = queue.get_jobs(ctx_beta)
        assert len(beta_jobs) == 0

    def test_queue_channel_partitioning(self):
        queue = TenantScopedQueue()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Alpha publishes message
        queue.publish("alerts", {"alert": "MD5 detected"}, ctx_alpha)

        # Beta consumes on same logical channel name -> gets nothing
        consumed_beta = queue.consume("alerts", ctx_beta)
        assert consumed_beta is None

        # Alpha consumes -> receives their message
        consumed_alpha = queue.consume("alerts", ctx_alpha)
        assert consumed_alpha is not None
        assert consumed_alpha["payload"]["alert"] == "MD5 detected"


class TestExportsAndAuditIsolation:
    def test_exports_zero_cross_tenant_leakage(self):
        db = TenantScopedDatabase()
        storage = TenantScopedObjectStorage()
        engine = TenantScopedExportEngine(db, storage)

        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        # Populate findings for Alpha and Beta
        db.insert("findings", {"message": "Alpha Finding #1", "rule_id": "PQC-001"}, ctx_alpha)
        db.insert("findings", {"message": "Alpha Finding #2", "rule_id": "PQC-002"}, ctx_alpha)
        db.insert("findings", {"message": "Beta Sensitive Secret Finding", "rule_id": "BETA-999"}, ctx_beta)

        # Alpha exports SARIF
        alpha_export = engine.export_sarif(ctx_alpha)
        assert alpha_export["total_findings"] == 2
        messages = [r["message"]["text"] for r in alpha_export["sarif"]["runs"][0]["results"]]
        assert "Alpha Finding #1" in messages
        assert "Alpha Finding #2" in messages
        assert "Beta Sensitive Secret Finding" not in messages, "Cross-tenant leakage detected in SARIF export!"

    def test_audit_logs_zero_cross_tenant_visibility(self):
        logger = TenantScopedAuditLogger()
        ctx_alpha = TenantContext(tenant_id="tenant-alpha")
        ctx_beta = TenantContext(tenant_id="tenant-beta")

        logger.log_event("AUTH_SUCCESS", userId="alice", context=ctx_alpha)
        logger.log_event("KEY_ROTATION", userId="bob", context=ctx_beta)

        # Alpha queries recent events
        alpha_events = logger.get_recent_events(50, ctx_alpha)
        assert len(alpha_events) == 1
        assert alpha_events[0]["userId"] == "alice"

        # Beta queries recent events
        beta_events = logger.get_recent_events(50, ctx_beta)
        assert len(beta_events) == 1
        assert beta_events[0]["userId"] == "bob"

        # Both chains verify independently
        assert logger.verify_tenant_chain(ctx_alpha) is True
        assert logger.verify_tenant_chain(ctx_beta) is True
