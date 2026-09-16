"""
Authentication Audit Logger (Python) — Phase 14.2

Client-side and scanner authentication audit logger with tamper-evident SHA-256 hash chaining.
"""

from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional
import uuid


class AuthAuditLogger:
    def __init__(self, initial_hash: str = "0" * 64):
        self.events: List[Dict[str, Any]] = []
        self.last_hash = initial_hash

    def sanitize_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        sanitized = {}
        for k, v in metadata.items():
            if any(term in k.lower() for term in ["password", "secret", "token", "auth", "key"]):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, dict):
                sanitized[k] = self.sanitize_metadata(v)
            else:
                sanitized[k] = v
        return sanitized

    def log_event(
        self,
        event_type: str,
        user_id: str = "anonymous",
        provider: str = "unknown",
        ip_address: str = "127.0.0.1",
        status: str = "SUCCESS",
        reason: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        event_id = f"authevt_{uuid.uuid4()}"
        timestamp = datetime.now(timezone.utc).isoformat()
        clean_meta = self.sanitize_metadata(metadata or {})

        prev_hash = self.last_hash
        entry_data = json.dumps({
            "eventId": event_id,
            "eventType": event_type,
            "userId": str(user_id),
            "provider": str(provider),
            "ipAddress": str(ip_address),
            "status": str(status),
            "reason": str(reason),
            "metadata": clean_meta,
            "prevHash": prev_hash,
            "timestamp": timestamp,
        }, sort_keys=True)

        audit_hash = hashlib.sha256(entry_data.encode("utf-8")).hexdigest()
        self.last_hash = audit_hash

        record = {
            "eventId": event_id,
            "eventType": event_type,
            "userId": str(user_id),
            "provider": str(provider),
            "ipAddress": str(ip_address),
            "status": str(status),
            "reason": str(reason),
            "metadata": clean_meta,
            "prevHash": prev_hash,
            "auditHash": audit_hash,
            "timestamp": timestamp,
        }
        self.events.append(record)
        return record

    def verify_chain_integrity(self) -> Dict[str, Any]:
        expected_prev = "0" * 64
        for i, entry in enumerate(self.events):
            if i > 0 and entry["prevHash"] != expected_prev:
                return {"valid": False, "error": f"Chain broken at index {i}", "brokenIndex": i}

            entry_data = json.dumps({
                "eventId": entry["eventId"],
                "eventType": entry["eventType"],
                "userId": entry["userId"],
                "provider": entry["provider"],
                "ipAddress": entry["ipAddress"],
                "status": entry["status"],
                "reason": entry["reason"],
                "metadata": entry["metadata"],
                "prevHash": entry["prevHash"],
                "timestamp": entry["timestamp"],
            }, sort_keys=True)

            recalc = hashlib.sha256(entry_data.encode("utf-8")).hexdigest()
            if recalc != entry["auditHash"]:
                return {"valid": False, "error": f"Hash mismatch at index {i}", "brokenIndex": i}

            expected_prev = entry["auditHash"]

        return {"valid": True, "totalEvents": len(self.events)}
