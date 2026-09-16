"""
Multi-Tenancy Isolation Subsystem (Python) — Phase 15.4

Enforces strict tenant isolation across all 8 enterprise layers:
1. API Layer: Authoritative context, client parameter rejection, spoofing defense
2. Database Layer: Row-level tenant discriminator filtering & mutation guard
3. Object Storage Layer: Sandboxed tenant prefixes & path traversal prevention
4. Background Jobs Layer: Immutable tenant-bound job envelopes & execution context
5. Caches Layer: Tenant-prefixed keyspace partitioning (tenant:{tenant_id}:{key})
6. Queues Layer: Partitioned message channels & tenant-scoped publish/consume
7. Exports Layer: Tenant-filtered SARIF, CBOM, and report generation
8. Logs & Audit Layer: Tenant-scoped audit trails & cryptographic ledger verification

Golden Invariant:
"A tenant ID supplied by a client must never be trusted as authorization."
"""

import hashlib
import json
import os
import posixpath
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Set, Tuple


class TenantBoundaryViolation(Exception):
    def __init__(self, message: str, code: str = "CROSS_TENANT_FORBIDDEN", details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class TenantPathTraversalError(Exception):
    def __init__(self, message: str, code: str = "PATH_TRAVERSAL_DETECTED", details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class TenantContext:
    """
    Immutable representation of an authenticated tenant principal.
    """

    def __init__(
        self,
        tenant_id: str = "default-tenant",
        user_id: str = "anonymous",
        roles: Optional[List[str]] = None,
        is_platform_admin: bool = False,
    ):
        self.tenant_id = str(tenant_id).strip().lower()
        self.user_id = str(user_id)
        self.roles = list(roles or ["viewer"])
        self.is_platform_admin = bool(is_platform_admin)

    @classmethod
    def from_claims(cls, claims: Dict[str, Any]) -> "TenantContext":
        tenant_id = claims.get("tenantId") or claims.get("tenant_id") or "default-tenant"
        user_id = claims.get("sub") or claims.get("userId") or "anonymous"
        roles = claims.get("roles") or (claims.get("role") and [claims.get("role")]) or ["viewer"]
        norm_roles = [r.lower().replace("-", " ").replace("_", " ") for r in roles]
        is_platform_admin = any(r in ("platform administrator", "admin", "platform admin") for r in norm_roles)

        return cls(
            tenant_id=tenant_id,
            user_id=user_id,
            roles=roles,
            is_platform_admin=is_platform_admin,
        )


# ============================================================================
# LAYER 1: API LAYER — TENANT ISOLATION VALIDATOR
# ============================================================================

class TenantIsolationEnforcer:
    """
    Enforces the invariant:
    'A tenant ID supplied by a client must never be trusted as authorization.'
    """

    @staticmethod
    def validate_request(
        authoritative_context: TenantContext,
        client_supplied_tenant_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not client_supplied_tenant_id:
            return {"valid": True, "tenantId": authoritative_context.tenant_id}

        clean_supplied = str(client_supplied_tenant_id).strip().lower()

        if clean_supplied != authoritative_context.tenant_id:
            if not authoritative_context.is_platform_admin:
                raise TenantBoundaryViolation(
                    f"Client-supplied tenant ID '{clean_supplied}' does not match authoritative token tenant '{authoritative_context.tenant_id}'.",
                    code="TENANT_SPOOFING_VIOLATION",
                    details={
                        "authoritativeTenantId": authoritative_context.tenant_id,
                        "suppliedTenantId": clean_supplied,
                    },
                )

        return {"valid": True, "tenantId": authoritative_context.tenant_id}


# ============================================================================
# LAYER 2: DATABASE LAYER — TENANT-SCOPED QUERIES
# ============================================================================

class TenantScopedDatabase:
    def __init__(self):
        self.store: Dict[str, List[Dict[str, Any]]] = {}

    def _ensure_table(self, table_name: str) -> List[Dict[str, Any]]:
        if table_name not in self.store:
            self.store[table_name] = []
        return self.store[table_name]

    def insert(self, table_name: str, record: Dict[str, Any], context: TenantContext) -> Dict[str, Any]:
        table = self._ensure_table(table_name)
        stamped = dict(record)
        stamped["id"] = record.get("id") or f"rec_{uuid.uuid4().hex[:12]}"
        stamped["tenant_id"] = context.tenant_id
        stamped["created_at"] = time.time()
        table.append(stamped)
        return dict(stamped)

    def find(self, table_name: str, query: Optional[Dict[str, Any]], context: TenantContext) -> List[Dict[str, Any]]:
        table = self._ensure_table(table_name)
        query = query or {}
        results = []
        for r in table:
            if not context.is_platform_admin and r.get("tenant_id") != context.tenant_id:
                continue
            match = True
            for k, v in query.items():
                if r.get(k) != v:
                    match = False
                    break
            if match:
                results.append(dict(r))
        return results

    def find_by_id(self, table_name: str, record_id: str, context: TenantContext) -> Optional[Dict[str, Any]]:
        table = self._ensure_table(table_name)
        for r in table:
            if not context.is_platform_admin and r.get("tenant_id") != context.tenant_id:
                continue
            if r.get("id") == record_id:
                return dict(r)
        return None

    def update(self, table_name: str, record_id: str, updates: Dict[str, Any], context: TenantContext) -> Dict[str, Any]:
        table = self._ensure_table(table_name)
        for i, r in enumerate(table):
            if not context.is_platform_admin and r.get("tenant_id") != context.tenant_id:
                continue
            if r.get("id") == record_id:
                safe_updates = dict(updates)
                safe_updates.pop("tenant_id", None)
                safe_updates.pop("tenantId", None)
                table[i].update(safe_updates)
                table[i]["updated_at"] = time.time()
                return dict(table[i])

        raise TenantBoundaryViolation(f"Record '{record_id}' not found in tenant '{context.tenant_id}'")

    def delete(self, table_name: str, record_id: str, context: TenantContext) -> Dict[str, Any]:
        table = self._ensure_table(table_name)
        for i, r in enumerate(table):
            if not context.is_platform_admin and r.get("tenant_id") != context.tenant_id:
                continue
            if r.get("id") == record_id:
                deleted = table.pop(i)
                return dict(deleted)

        raise TenantBoundaryViolation(f"Record '{record_id}' not found in tenant '{context.tenant_id}'")


# ============================================================================
# LAYER 3: OBJECT STORAGE LAYER — TENANT-SCOPED PREFIXES & PATH DEFENSE
# ============================================================================

class TenantScopedObjectStorage:
    def __init__(self, base_prefix: str = "/storage"):
        self.base_prefix = base_prefix
        self.objects: Dict[str, Dict[str, Any]] = {}

    def _sanitize_and_resolve(self, key: str, tenant_id: str) -> str:
        if not key or not isinstance(key, str):
            raise ValueError("Storage key must be a non-empty string")

        if "\0" in key or ".." in key or key.startswith("/") or key.startswith("\\"):
            raise TenantPathTraversalError(f"Path traversal or invalid characters in key: '{key}'")

        tenant_prefix = f"{self.base_prefix}/{tenant_id}/"
        full_path = posixpath.normpath(f"{tenant_prefix}{key}")

        if not full_path.startswith(tenant_prefix):
            raise TenantPathTraversalError(f"Key '{key}' escapes tenant storage boundary '{tenant_prefix}'")

        return full_path

    def put_object(self, key: str, data: Any, context: TenantContext, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        full_key = self._sanitize_and_resolve(key, context.tenant_id)
        self.objects[full_key] = {
            "data": data,
            "metadata": metadata or {},
            "tenant_id": context.tenant_id,
            "updated_at": time.time(),
        }
        return {"key": key, "full_key": full_key, "tenant_id": context.tenant_id}

    def get_object(self, key: str, context: TenantContext) -> Dict[str, Any]:
        full_key = self._sanitize_and_resolve(key, context.tenant_id)
        item = self.objects.get(full_key)

        if not item:
            raise TenantBoundaryViolation(f"Object '{key}' not found in tenant storage '{context.tenant_id}'")

        if not context.is_platform_admin and item["tenant_id"] != context.tenant_id:
            raise TenantBoundaryViolation("Cross-tenant storage access forbidden.")

        return {"key": key, "data": item["data"], "metadata": item["metadata"]}

    def delete_object(self, key: str, context: TenantContext) -> bool:
        full_key = self._sanitize_and_resolve(key, context.tenant_id)
        if full_key not in self.objects:
            raise TenantBoundaryViolation(f"Object '{key}' not found in tenant storage")
        del self.objects[full_key]
        return True

    def list_objects(self, prefix: str = "", context: Optional[TenantContext] = None) -> List[Dict[str, Any]]:
        tenant_id = context.tenant_id if context else "default-tenant"
        tenant_prefix = f"{self.base_prefix}/{tenant_id}/"
        search_prefix = posixpath.normpath(f"{tenant_prefix}{prefix}")

        results = []
        for k, v in self.objects.items():
            if k.startswith(search_prefix):
                if context and (context.is_platform_admin or v["tenant_id"] == context.tenant_id):
                    results.append({"key": k[len(tenant_prefix):], "tenant_id": v["tenant_id"]})
        return results


# ============================================================================
# LAYER 4: BACKGROUND JOBS LAYER — TENANT-BOUND JOB ENVELOPES
# ============================================================================

class TenantScopedJobQueue:
    def __init__(self):
        self.jobs: Dict[str, Dict[str, Any]] = {}

    def enqueue(self, task_name: str, payload: Dict[str, Any], context: TenantContext) -> Dict[str, Any]:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = {
            "job_id": job_id,
            "tenant_id": context.tenant_id,
            "task_name": task_name,
            "payload": payload,
            "status": "QUEUED",
            "enqueued_at": time.time(),
            "result": None,
            "error": None,
        }
        self.jobs[job_id] = job
        return dict(job)

    def execute_worker(self, job_id: str, worker_fn: Callable[[Dict[str, Any], TenantContext], Any]) -> Any:
        job = self.jobs.get(job_id)
        if not job:
            raise ValueError(f"Job '{job_id}' not found")

        worker_context = TenantContext(tenant_id=job["tenant_id"], user_id="system-worker", roles=["secops"])
        job["status"] = "RUNNING"
        try:
            result = worker_fn(job["payload"], worker_context)
            job["status"] = "COMPLETED"
            job["result"] = result
            return result
        except Exception as e:
            job["status"] = "FAILED"
            job["error"] = str(e)
            raise

    def get_jobs(self, context: TenantContext) -> List[Dict[str, Any]]:
        return [
            dict(j)
            for j in self.jobs.values()
            if context.is_platform_admin or j["tenant_id"] == context.tenant_id
        ]


# ============================================================================
# LAYER 5: CACHES LAYER — TENANT-PREFIXED KEYSPACE
# ============================================================================

class TenantScopedCache:
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}

    def _key(self, key: str, tenant_id: str) -> str:
        return f"tenant:{tenant_id}:{key}"

    def get(self, key: str, context: TenantContext) -> Any:
        k = self._key(key, context.tenant_id)
        entry = self.cache.get(k)
        if not entry:
            return None
        if entry["expires_at"] and time.time() > entry["expires_at"]:
            del self.cache[k]
            return None
        return entry["value"]

    def set(self, key: str, value: Any, ttl_sec: int = 300, context: Optional[TenantContext] = None) -> bool:
        tenant_id = context.tenant_id if context else "default-tenant"
        k = self._key(key, tenant_id)
        exp = time.time() + ttl_sec if ttl_sec > 0 else None
        self.cache[k] = {"value": value, "expires_at": exp, "tenant_id": tenant_id}
        return True

    def delete(self, key: str, context: TenantContext) -> bool:
        k = self._key(key, context.tenant_id)
        if k in self.cache:
            del self.cache[k]
            return True
        return False

    def flush(self, context: TenantContext) -> int:
        prefix = f"tenant:{context.tenant_id}:"
        matching = [k for k in self.cache if k.startswith(prefix)]
        for k in matching:
            del self.cache[k]
        return len(matching)


# ============================================================================
# LAYER 6: QUEUES LAYER — PARTITIONED MESSAGE CHANNELS
# ============================================================================

class TenantScopedQueue:
    def __init__(self):
        self.queues: Dict[str, List[Dict[str, Any]]] = {}

    def _channel(self, channel: str, tenant_id: str) -> str:
        return f"queue:{tenant_id}:{channel}"

    def publish(self, channel: str, message: Any, context: TenantContext) -> Dict[str, Any]:
        ch = self._channel(channel, context.tenant_id)
        if ch not in self.queues:
            self.queues[ch] = []
        env = {
            "message_id": f"msg_{uuid.uuid4().hex[:12]}",
            "tenant_id": context.tenant_id,
            "channel": channel,
            "payload": message,
            "timestamp": time.time(),
        }
        self.queues[ch].append(env)
        return env

    def consume(self, channel: str, context: TenantContext) -> Optional[Dict[str, Any]]:
        ch = self._channel(channel, context.tenant_id)
        q = self.queues.get(ch)
        if not q:
            return None
        return q.pop(0)


# ============================================================================
# LAYER 7: EXPORTS LAYER — TENANT-FILTERED REPORT GENERATION
# ============================================================================

class TenantScopedExportEngine:
    def __init__(self, db: Optional[TenantScopedDatabase] = None, storage: Optional[TenantScopedObjectStorage] = None):
        self.db = db or TenantScopedDatabase()
        self.storage = storage or TenantScopedObjectStorage()

    def export_sarif(self, context: TenantContext) -> Dict[str, Any]:
        findings = self.db.find("findings", {}, context)
        sarif = {
            "version": "2.1.0",
            "runs": [
                {
                    "tool": {"driver": {"name": "ECDAT", "version": "1.0.0"}},
                    "properties": {"tenantId": context.tenant_id},
                    "results": [
                        {
                            "ruleId": f.get("rule_id", "PQC-ALGO-001"),
                            "message": {"text": f.get("message", "Finding")},
                            "properties": {"tenantId": context.tenant_id},
                        }
                        for f in findings
                    ],
                }
            ],
        }
        filename = f"sarif_{context.tenant_id}_{int(time.time())}.json"
        self.storage.put_object(f"exports/{filename}", json.dumps(sarif), context)
        return {"filename": filename, "total_findings": len(findings), "tenant_id": context.tenant_id, "sarif": sarif}

    def export_cbom(self, context: TenantContext) -> Dict[str, Any]:
        assets = self.db.find("assets", {}, context)
        cbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "metadata": {"properties": [{"name": "tenantId", "value": context.tenant_id}]},
            "components": [
                {"name": a.get("name", "Asset"), "properties": [{"name": "tenantId", "value": context.tenant_id}]}
                for a in assets
            ],
        }
        filename = f"cbom_{context.tenant_id}_{int(time.time())}.json"
        self.storage.put_object(f"exports/{filename}", json.dumps(cbom), context)
        return {"filename": filename, "total_assets": len(assets), "tenant_id": context.tenant_id, "cbom": cbom}


# ============================================================================
# LAYER 8: LOGS & AUDIT LAYER — TENANT-SCOPED CRYPTOGRAPHIC AUDIT
# ============================================================================

class TenantScopedAuditLogger:
    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self.tenant_last_hashes: Dict[str, str] = {}

    def log_event(
        self,
        event_type: str,
        user_id: str = "anonymous",
        status: str = "SUCCESS",
        reason: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        context: Optional[TenantContext] = None,
        userId: Optional[str] = None,
    ) -> Dict[str, Any]:
        effective_user_id = userId if userId is not None else user_id
        tenant_id = context.tenant_id if context else "default-tenant"
        event_id = f"authevt_{uuid.uuid4().hex[:12]}"
        prev_hash = self.tenant_last_hashes.get(tenant_id, "0" * 64)

        entry_data = json.dumps({
            "eventId": event_id,
            "eventType": event_type,
            "userId": effective_user_id,
            "tenantId": tenant_id,
            "status": status,
            "reason": reason,
            "metadata": metadata or {},
            "prevHash": prev_hash,
        }, sort_keys=True)

        current_hash = hashlib.sha256(entry_data.encode("utf-8")).hexdigest()
        self.tenant_last_hashes[tenant_id] = current_hash

        event_record = {
            "eventId": event_id,
            "eventType": event_type,
            "userId": effective_user_id,
            "tenantId": tenant_id,
            "status": status,
            "reason": reason,
            "metadata": metadata or {},
            "timestamp": time.time(),
            "prevHash": prev_hash,
            "hash": current_hash,
        }
        self.events.append(event_record)
        return event_record

    def get_recent_events(self, limit: int = 50, context: Optional[TenantContext] = None) -> List[Dict[str, Any]]:
        tenant_id = context.tenant_id if context else "default-tenant"
        is_admin = context.is_platform_admin if context else False
        return [
            dict(e) for e in self.events
            if is_admin or e.get("tenantId") == tenant_id
        ][-limit:]

    def verify_tenant_chain(self, context: TenantContext) -> bool:
        tenant_events = [e for e in self.events if e.get("tenantId") == context.tenant_id]
        prev = "0" * 64
        for evt in tenant_events:
            if evt.get("prevHash") != prev:
                return False
            data = json.dumps({
                "eventId": evt["eventId"],
                "eventType": evt["eventType"],
                "userId": evt["userId"],
                "tenantId": evt["tenantId"],
                "status": evt["status"],
                "reason": evt["reason"],
                "metadata": evt.get("metadata", {}),
                "prevHash": prev,
            }, sort_keys=True)
            expected = hashlib.sha256(data.encode("utf-8")).hexdigest()
            if expected != evt["hash"]:
                return False
            prev = evt["hash"]
        return True
