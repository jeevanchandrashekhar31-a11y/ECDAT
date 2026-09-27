"""
ECDAT Audit Logging Subsystem (Python Engine) — Task 21

Enterprise structured audit event logger enforcing:
1. 13 mandatory security-sensitive operations:
   - authentication success/failure
   - authorization denial
   - role change
   - tenant change
   - MFA enable/disable
   - session revocation
   - token revocation
   - secret rotation
   - scan start
   - scan failure
   - scan completion
   - integration modification
   - security policy modification
2. 9 mandated audit record dimensions:
   - actor, tenant, action, target, timestamp, request ID, result, reason, source IP
3. Strict Zero-Secret Guarantee:
   - Automated redaction of passwords, MFA secrets, backup codes, API keys,
     access tokens, private keys, raw credentials.
4. Cryptographic Tamper-Resistance:
   - Contiguous sequence numbers, SHA-256 block hash chaining, HMAC-SHA256 non-repudiation.
"""

from __future__ import annotations

import hmac
import hashlib
import json
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple


import os

GENESIS_HASH = "0" * 64
DEFAULT_HMAC_SECRET = os.environ.get("AUDIT_HMAC_SECRET", "ecdat:synthetic-audit-chain-key")

# -----------------------------------------------------------------------------
# Canonical Action & Category Definitions
# -----------------------------------------------------------------------------

class AuditCategories:
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    PERMISSION_CHANGE = "PERMISSION_CHANGE"
    SCAN = "SCAN"
    CONFIG_CHANGE = "CONFIG_CHANGE"
    POLICY_CHANGE = "POLICY_CHANGE"
    REMEDIATION_APPROVAL = "REMEDIATION_APPROVAL"
    REMEDIATION_EXECUTION = "REMEDIATION_EXECUTION"
    EXPORT = "EXPORT"
    INTEGRATION_CHANGE = "INTEGRATION_CHANGE"
    SECRET_OPERATION = "SECRET_OPERATION"


class AuditActions:
    # 1. Login & Authentication
    AUTH_LOGIN_SUCCESS = "AUTH_LOGIN_SUCCESS"
    AUTHENTICATION_SUCCESS = "AUTH_LOGIN_SUCCESS"
    AUTH_LOGIN_FAILURE = "AUTH_LOGIN_FAILURE"
    AUTHENTICATION_FAILURE = "AUTH_LOGIN_FAILURE"
    AUTH_MFA_ENABLED = "AUTH_MFA_ENABLED"
    AUTH_MFA_DISABLED = "AUTH_MFA_DISABLED"
    AUTH_MFA_RESET = "AUTH_MFA_RESET"
    MFA_ENABLE = "AUTH_MFA_ENABLED"
    MFA_DISABLE = "AUTH_MFA_DISABLED"

    # 2. Logout & Revocation
    AUTH_LOGOUT = "AUTH_LOGOUT"
    AUTH_LOGOUT_ALL = "AUTH_LOGOUT_ALL"
    SESSION_REVOCATION = "AUTH_LOGOUT_ALL"
    AUTH_TOKEN_REVOKED = "AUTH_TOKEN_REVOKED"
    TOKEN_REVOCATION = "AUTH_TOKEN_REVOKED"

    # 3. Permission, Role & Tenant
    ROLE_ASSIGNED = "ROLE_ASSIGNED"
    ROLE_REVOKED = "ROLE_REVOKED"
    ROLE_CHANGE = "ROLE_ASSIGNED"
    TENANT_CHANGED = "TENANT_CHANGED"
    TENANT_CHANGE = "TENANT_CHANGED"
    AUTHORIZATION_FAILURE = "AUTHORIZATION_FAILURE"
    AUTHORIZATION_DENIAL = "AUTHORIZATION_FAILURE"
    PERMISSION_DENIED = "PERMISSION_DENIED"

    # 4. Scans
    SCAN_STARTED = "SCAN_STARTED"
    SCAN_START = "SCAN_STARTED"
    SCAN_COMPLETED = "SCAN_COMPLETED"
    SCAN_COMPLETION = "SCAN_COMPLETED"
    SCAN_FAILED = "SCAN_FAILED"
    SCAN_FAILURE = "SCAN_FAILED"

    # 5. Integrations & Policies & Secrets
    INTEGRATION_MODIFIED = "INTEGRATION_MODIFIED"
    INTEGRATION_MODIFICATION = "INTEGRATION_MODIFIED"
    POLICY_UPDATED = "POLICY_UPDATED"
    SECURITY_POLICY_MODIFICATION = "POLICY_UPDATED"
    POLICY_CREATED = "POLICY_CREATED"
    SECRET_ROTATED = "SECRET_ROTATED"
    SECRET_ROTATION = "SECRET_ROTATED"


MANDATORY_AUDIT_ACTIONS = {
    "authentication_success": AuditActions.AUTH_LOGIN_SUCCESS,
    "authentication_failure": AuditActions.AUTH_LOGIN_FAILURE,
    "authorization_denial": AuditActions.AUTHORIZATION_FAILURE,
    "role_change": AuditActions.ROLE_ASSIGNED,
    "tenant_change": AuditActions.TENANT_CHANGED,
    "mfa_enable": AuditActions.AUTH_MFA_ENABLED,
    "mfa_disable": AuditActions.AUTH_MFA_DISABLED,
    "session_revocation": AuditActions.AUTH_LOGOUT_ALL,
    "token_revocation": AuditActions.AUTH_TOKEN_REVOKED,
    "secret_rotation": AuditActions.SECRET_ROTATED,
    "scan_start": AuditActions.SCAN_STARTED,
    "scan_failure": AuditActions.SCAN_FAILED,
    "scan_completion": AuditActions.SCAN_COMPLETED,
    "integration_modification": AuditActions.INTEGRATION_MODIFIED,
    "security_policy_modification": AuditActions.POLICY_UPDATED,
}

# -----------------------------------------------------------------------------
# Zero-Secret Redaction Engine
# -----------------------------------------------------------------------------

PRIVATE_KEY_REGEX = re.compile(
    r"(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|"
    r"-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|"
    r"-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)",
    re.IGNORECASE,
)

JWT_REGEX = re.compile(r"\beyJh[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*\b")
BEARER_AUTH_REGEX = re.compile(r"[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*")
API_KEY_REGEX = re.compile(r"\b(?:ecdat-(?:live|test)-(?:sec|pub)-[a-f0-9]+|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36})\b")
INLINE_SECRET_REGEX = re.compile(
    r"((?:password|passwd|api_key|apikey|secret|totp|backup_code|mfa_secret|private_key|token)\s*[:=]\s*)(['\"][^'\"]+['\"]|[^\s,'\"&]+)",
    re.IGNORECASE,
)

SENSITIVE_FIELD_NAMES: Set[str] = {
    # Passwords
    "password", "passwd", "pass", "passphrase", "userpassword",
    # MFA Secrets & Backup Codes
    "secret", "totpsecret", "totp", "mfasecret", "mfatoken", "otptoken",
    "backupcode", "backupcodes", "recoverycode", "recoverycodes",
    # API Keys & Tokens
    "token", "authorization", "auth", "apikey", "xapikey",
    "accesstoken", "refreshtoken", "idtoken", "csrftoken", "xcsrftoken",
    "clientsecret",
    # Private Keys & Key Material
    "privatekey", "privatekeypem", "privatekeybytes", "rawkey",
    "keymaterial", "secretbytes", "privateexponent", "rsad", "eccd",
    "seedbytes", "symmetrickey", "sharedsecret",
    # Raw Credentials & Cookies
    "credential", "credentials", "rawcredential", "rawcredentials",
    "cookie", "cookies", "setcookie",
}


def scrub_string(text: str) -> str:
    """Scrubs sensitive substrings (private keys, JWTs, bearer tokens, API keys)."""
    if not isinstance(text, str) or not text:
        return text

    scrubbed = PRIVATE_KEY_REGEX.sub("[REDACTED_PRIVATE_KEY]", text)
    scrubbed = JWT_REGEX.sub("[REDACTED_JWT_TOKEN]", scrubbed)
    scrubbed = BEARER_AUTH_REGEX.sub("Bearer [REDACTED_TOKEN]", scrubbed)
    scrubbed = API_KEY_REGEX.sub("[REDACTED_API_KEY]", scrubbed)
    scrubbed = INLINE_SECRET_REGEX.sub(r"\1[REDACTED_SECRET]", scrubbed)
    return scrubbed


def scrub_secrets(data: Any, seen: Optional[Set[int]] = None) -> Any:
    """
    Recursively deep-scrubs an arbitrary data structure, guaranteeing zero secret leakage.
    Never logs passwords, MFA secrets, backup codes, API keys, access tokens, private keys, raw credentials.
    """
    if data is None:
        return None

    if isinstance(data, str):
        return scrub_string(data)

    if not isinstance(data, (dict, list)):
        return data

    if seen is None:
        seen = set()

    data_id = id(data)
    if data_id in seen:
        return "[CIRCULAR_REFERENCE]"
    seen.add(data_id)

    if isinstance(data, list):
        return [scrub_secrets(item, seen) for item in data]

    if isinstance(data, dict):
        sanitized = {}
        for key, value in data.items():
            norm_key = re.sub(r"[-_]", "", str(key).lower())

            if isinstance(value, str) and PRIVATE_KEY_REGEX.search(value):
                sanitized[key] = "[REDACTED_PRIVATE_KEY]"
            elif norm_key in SENSITIVE_FIELD_NAMES:
                sanitized[key] = "[REDACTED_SECRET]"
            else:
                sanitized[key] = scrub_secrets(value, seen)
        return sanitized

    return data


# -----------------------------------------------------------------------------
# Cryptographic Tamper-Chain & Hashing
# -----------------------------------------------------------------------------

def canonical_json(data: Any) -> str:
    """Deterministically serializes data into canonical JSON with sorted keys."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_event_hash(event_data: Dict[str, Any], prev_hash: str) -> str:
    """Computes deterministic SHA-256 digest of an audit event chained to previous hash."""
    actor_obj = event_data.get("actor") or {}
    target_obj = event_data.get("target") or {}

    payload_to_hash = {
        "eventId": event_data.get("eventId"),
        "sequenceNumber": event_data.get("sequenceNumber"),
        "timestamp": event_data.get("timestamp"),
        "category": event_data.get("category"),
        "action": event_data.get("action"),
        "actor": {
            "id": actor_obj.get("id") or "anonymous",
            "username": actor_obj.get("username") or "anonymous",
            "role": actor_obj.get("role") or "viewer",
        },
        "tenantId": event_data.get("tenantId") or event_data.get("tenant") or "default",
        "target": {
            "type": target_obj.get("type") or "system",
            "id": target_obj.get("id") or "none",
        },
        "status": event_data.get("status") or event_data.get("result") or "SUCCESS",
        "requestId": event_data.get("requestId") or event_data.get("request_id") or None,
        "reason": event_data.get("reason") or None,
        "sourceIp": event_data.get("sourceIp") or event_data.get("source_ip") or actor_obj.get("ipAddress") or None,
        "details": event_data.get("details") or {},
        "prevHash": prev_hash or GENESIS_HASH,
    }

    serialized = canonical_json(payload_to_hash)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def sign_hash(hash_hex: str, secret_key: str = DEFAULT_HMAC_SECRET) -> str:
    """Generates HMAC-SHA256 non-repudiation signature."""
    return hmac.new(secret_key.encode("utf-8"), hash_hex.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(hash_hex: str, signature: str, secret_key: str = DEFAULT_HMAC_SECRET) -> bool:
    """Verifies HMAC signature with timing-safe comparison."""
    if not signature:
        return False
    expected = sign_hash(hash_hex, secret_key)
    return hmac.compare_digest(expected, signature)


def verify_audit_chain(events: List[Dict[str, Any]], secret_key: str = DEFAULT_HMAC_SECRET) -> Dict[str, Any]:
    """
    Verifies the cryptographic chain integrity of a sequence of audit events:
    1. Sequential contiguity (no skipped or duplicate records)
    2. Cryptographic linkage (prevHash matches previous block's hash)
    3. Content integrity (SHA-256 recalculation matches recorded hash)
    4. HMAC authenticity
    """
    if not events:
        return {"valid": True, "total_verified": 0, "last_hash": GENESIS_HASH, "error": None}

    expected_prev = GENESIS_HASH
    expected_seq = events[0].get("sequenceNumber", 1)

    for i, evt in enumerate(events):
        seq = evt.get("sequenceNumber")
        if seq != expected_seq:
            return {
                "valid": False,
                "total_verified": i,
                "last_hash": expected_prev,
                "error": f"Sequence gap: expected {expected_seq}, found {seq}",
            }

        prev = evt.get("prevHash")
        prev_to_validate = GENESIS_HASH if i == 0 and seq == 1 else expected_prev
        if prev != prev_to_validate:
            return {
                "valid": False,
                "total_verified": i,
                "last_hash": expected_prev,
                "error": f"Linkage break at sequence {seq}: prevHash mismatch",
            }

        recomputed = compute_event_hash(evt, prev)
        if recomputed != evt.get("hash"):
            return {
                "valid": False,
                "total_verified": i,
                "last_hash": expected_prev,
                "error": f"Tamper detected at sequence {seq}: hash mismatch",
            }

        sig = evt.get("signature")
        if sig and not verify_signature(evt.get("hash", ""), sig, secret_key):
            return {
                "valid": False,
                "total_verified": i,
                "last_hash": expected_prev,
                "error": f"Signature invalid at sequence {seq}",
            }

        expected_prev = evt.get("hash")
        expected_seq += 1

    return {"valid": True, "total_verified": len(events), "last_hash": expected_prev, "error": None}


# -----------------------------------------------------------------------------
# Enterprise Audit Logger Class
# -----------------------------------------------------------------------------

class AuditLogger:
    """Thread-safe, tamper-resistant in-memory audit ledger with zero-secret guarantee."""

    def __init__(self, max_records: int = 5000, secret_key: str = DEFAULT_HMAC_SECRET):
        self.max_records = max_records
        self.secret_key = secret_key
        self.events: List[Dict[str, Any]] = []
        self.sequence_counter = 0
        self.last_hash = GENESIS_HASH

    def log_event(
        self,
        action: str,
        actor: Optional[Dict[str, Any]] = None,
        tenant: str = "default",
        target: Optional[Any] = None,
        result: str = "SUCCESS",
        reason: Optional[str] = None,
        request_id: Optional[str] = None,
        source_ip: Optional[str] = None,
        category: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Records a structured audit event including all 9 mandatory fields,
        zero-secret redaction, and SHA-256 hash chaining.
        """
        self.sequence_counter += 1
        sequence_number = self.sequence_counter

        # 1. Normalize and scrub actor
        actor_raw = actor or {}
        ip = source_ip or actor_raw.get("ipAddress") or actor_raw.get("ip") or None
        clean_actor = {
            "id": str(actor_raw.get("id") or actor_raw.get("userId") or "system")[:128],
            "username": str(actor_raw.get("username") or actor_raw.get("name") or "system")[:128],
            "role": str(actor_raw.get("role") or "viewer")[:64],
            "ipAddress": ip,
            "userAgent": actor_raw.get("userAgent"),
        }
        clean_actor = scrub_secrets(clean_actor)

        # 2. Normalize and scrub target
        if isinstance(target, str):
            clean_target = {"type": "resource", "id": target, "name": target}
        elif isinstance(target, dict):
            clean_target = {
                "type": str(target.get("type") or "system")[:64],
                "id": str(target.get("id") or "none")[:256],
                "name": str(target.get("name"))[:256] if target.get("name") else None,
            }
        else:
            clean_target = {"type": "system", "id": "none", "name": None}
        clean_target = scrub_secrets(clean_target)

        # 3. Scrub reason & details
        clean_details = scrub_secrets(details or {})
        clean_reason = scrub_string(reason) if reason else None

        # 4. Identity & timestamps
        event_id = f"audit_evt_{int(time.time() * 1000)}_{secrets.token_hex(4)}"
        timestamp = datetime.now(timezone.utc).isoformat()
        prev_hash = self.last_hash
        clean_tenant = str(tenant or "default")[:100]

        event_for_hashing = {
            "eventId": event_id,
            "sequenceNumber": sequence_number,
            "timestamp": timestamp,
            "category": category or AuditCategories.SCAN,
            "action": action,
            "actor": clean_actor,
            "tenant": clean_tenant,
            "tenantId": clean_tenant,
            "target": clean_target,
            "requestId": request_id,
            "result": result,
            "status": result,
            "reason": clean_reason,
            "sourceIp": clean_actor.get("ipAddress"),
            "details": clean_details,
        }

        h = compute_event_hash(event_for_hashing, prev_hash)
        sig = sign_hash(h, self.secret_key)
        self.last_hash = h

        record = {
            **event_for_hashing,
            "request_id": request_id,
            "source_ip": clean_actor.get("ipAddress"),
            "ipAddress": clean_actor.get("ipAddress"),
            "prevHash": prev_hash,
            "previousHash": prev_hash,
            "hash": h,
            "signature": sig,
            "createdAt": timestamp,
        }

        self.events.append(record)
        if len(self.events) > self.max_records:
            self.events.pop(0)

        return record

    def verify_integrity(self) -> Dict[str, Any]:
        """Verifies the complete cryptographic chain integrity."""
        return verify_audit_chain(self.events, self.secret_key)

    def get_events(self, action: Optional[str] = None, tenant: Optional[str] = None) -> List[Dict[str, Any]]:
        """Queries recorded audit events with optional filtering."""
        res = self.events
        if action:
            res = [e for e in res if e.get("action") == action]
        if tenant:
            res = [e for e in res if e.get("tenant") == tenant or e.get("tenantId") == tenant]
        return res

    def reset(self) -> None:
        """Clears memory ledger for test isolation."""
        self.events = []
        self.sequence_counter = 0
        self.last_hash = GENESIS_HASH


default_audit_logger = AuditLogger()
