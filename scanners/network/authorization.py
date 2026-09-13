"""
ECDAT Network Target Scope Authorization & Audit Logger (Phase 5.1)
Enforces:
- Explicit authorization for target scope (hostnames, wildcards, CIDR subnets, ports)
- Scope validity window / expiration
- Structured audit logging for every scan authorization check and attempt
"""

import fnmatch
import ipaddress
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Set, List, Optional, Dict, Any, Tuple

logger = logging.getLogger("ECDAT.NetworkAudit")


class ScopeAuthorizationError(PermissionError):
    """Raised when a scan target is outside the explicitly authorized target scope."""
    pass


@dataclass
class TargetScope:
    scope_id: str = field(default_factory=lambda: f"scope-{uuid.uuid4().hex[:8]}")
    authorized_by: str = "security-admin"
    allowed_hostnames: Set[str] = field(default_factory=set)  # Exact or *.example.com
    allowed_subnets: List[str] = field(default_factory=list)   # CIDR strings e.g. 93.184.216.0/24
    allowed_ports: Set[int] = field(default_factory=lambda: {443, 8443, 22, 636, 993, 995, 465})
    allow_private_ips: bool = False
    valid_until: Optional[str] = None  # ISO 8601 timestamp
    purpose: str = "Authorized cryptographic inventory assessment"

    def is_expired(self) -> bool:
        if not self.valid_until:
            return False
        try:
            exp = datetime.fromisoformat(self.valid_until.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) > exp
        except Exception:
            return True

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TargetScope":
        allowed_ports = set(data.get("allowed_ports", [443, 8443, 22, 636, 993, 995, 465]))
        allowed_hostnames = set(data.get("allowed_hostnames", []))
        allowed_subnets = list(data.get("allowed_subnets", []))
        return cls(
            scope_id=data.get("scope_id", f"scope-{uuid.uuid4().hex[:8]}"),
            authorized_by=data.get("authorized_by", "security-admin"),
            allowed_hostnames=allowed_hostnames,
            allowed_subnets=allowed_subnets,
            allowed_ports=allowed_ports,
            allow_private_ips=bool(data.get("allow_private_ips", False)),
            valid_until=data.get("valid_until"),
            purpose=data.get("purpose", "Authorized cryptographic inventory assessment"),
        )

    @classmethod
    def from_file(cls, file_path: str | Path) -> "TargetScope":
        path = Path(file_path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)


@dataclass
class AuditRecord:
    audit_id: str
    timestamp: str
    target_supplied: str
    hostname: str
    port: int
    resolved_ip: Optional[str]
    authorized: bool
    authorized_by: Optional[str]
    scope_id: Optional[str]
    reason: str
    security_flags: List[str] = field(default_factory=list)


class AuditLogger:
    """
    Records immutable audit entries for network scan authorization and execution.
    """

    def __init__(self, audit_file_path: Optional[str] = None):
        self.audit_file_path = Path(audit_file_path) if audit_file_path else None
        self.records: List[AuditRecord] = []

    def record(
        self,
        target_supplied: str,
        hostname: str,
        port: int,
        resolved_ip: Optional[str],
        authorized: bool,
        scope: Optional[TargetScope],
        reason: str,
        security_flags: Optional[List[str]] = None,
    ) -> AuditRecord:
        record = AuditRecord(
            audit_id=f"audit-{uuid.uuid4().hex[:12]}",
            timestamp=datetime.now(timezone.utc).isoformat(),
            target_supplied=target_supplied,
            hostname=hostname,
            port=port,
            resolved_ip=resolved_ip,
            authorized=authorized,
            authorized_by=scope.authorized_by if scope else None,
            scope_id=scope.scope_id if scope else None,
            reason=reason,
            security_flags=security_flags or [],
        )
        self.records.append(record)

        log_level = logging.INFO if authorized else logging.WARNING
        logger.log(
            log_level,
            f"NETWORK AUDIT: [{record.audit_id}] target='{target_supplied}' authorized={authorized} "
            f"scope='{record.scope_id}' reason='{reason}'",
        )

        if self.audit_file_path:
            try:
                self.audit_file_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.audit_file_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(record.__dict__) + "\n")
            except Exception as e:
                logger.error(f"Failed to write audit record to file: {e}")

        return record


class TargetScopeAuthorizer:
    """
    Validates that each requested scan target strictly resides within an authorized scope.
    """

    def __init__(self, default_scope: Optional[TargetScope] = None, audit_logger: Optional[AuditLogger] = None):
        self.scope = default_scope
        self.audit_logger = audit_logger or AuditLogger()

    def set_scope(self, scope: TargetScope):
        self.scope = scope

    def authorize(
        self,
        target_supplied: str,
        hostname: str,
        port: int,
        resolved_ip: Optional[str] = None,
        record_audit: bool = True,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Validates whether target is explicitly authorized.
        Returns: (is_authorized, reason, audit_id)
        Raises: ScopeAuthorizationError if unauthorized
        """

        if not self.scope:
            reason = "No target authorization scope provided. Scanning is restricted to authorized targets only."
            rec = self.audit_logger.record(target_supplied, hostname, port, resolved_ip, False, None, reason)
            raise ScopeAuthorizationError(reason)

        if self.scope.is_expired():
            reason = f"Target scope '{self.scope.scope_id}' expired on {self.scope.valid_until}."
            rec = self.audit_logger.record(target_supplied, hostname, port, resolved_ip, False, self.scope, reason)
            raise ScopeAuthorizationError(reason)

        # 1. Port validation
        if port not in self.scope.allowed_ports:
            reason = f"Port {port} is not permitted in authorized scope '{self.scope.scope_id}' (allowed: {sorted(list(self.scope.allowed_ports))})."
            rec = self.audit_logger.record(target_supplied, hostname, port, resolved_ip, False, self.scope, reason)
            raise ScopeAuthorizationError(reason)

        # 2. Hostname validation
        hostname_matched = False
        clean_host = hostname.lower()
        for pattern in self.scope.allowed_hostnames:
            pat_lower = pattern.lower()
            if fnmatch.fnmatch(clean_host, pat_lower) or clean_host == pat_lower:
                hostname_matched = True
                break

        # 3. IP Subnet validation (if resolved_ip or hostname is an IP)
        ip_matched = False
        ip_to_check = resolved_ip
        if not ip_to_check:
            try:
                ipaddress.ip_address(hostname)
                ip_to_check = hostname
            except ValueError:
                pass

        if ip_to_check and self.scope.allowed_subnets:
            try:
                ip_obj = ipaddress.ip_address(ip_to_check)
                for subnet_str in self.scope.allowed_subnets:
                    net = ipaddress.ip_network(subnet_str, strict=False)
                    if ip_obj in net:
                        ip_matched = True
                        break
            except Exception:
                pass

        # Target must match either allowed hostname or allowed subnet
        if not hostname_matched and not ip_matched:
            reason = (
                f"Target '{hostname}' does not match authorized scope '{self.scope.scope_id}' "
                f"(hostnames: {sorted(list(self.scope.allowed_hostnames))}, subnets: {self.scope.allowed_subnets})."
            )
            rec = self.audit_logger.record(target_supplied, hostname, port, resolved_ip, False, self.scope, reason)
            raise ScopeAuthorizationError(reason)

        # 4. Check private IP restriction on scope
        if resolved_ip:
            try:
                ip_obj = ipaddress.ip_address(resolved_ip)
                if ip_obj.is_private and not self.scope.allow_private_ips:
                    reason = (
                        f"Target resolved to private IP '{resolved_ip}', but scope '{self.scope.scope_id}' "
                        "disallows private network scanning."
                    )
                    rec = self.audit_logger.record(
                        target_supplied, hostname, port, resolved_ip, False, self.scope, reason, ["PRIVATE_IP_UNAUTHORIZED"]
                    )
                    raise ScopeAuthorizationError(reason)
            except ValueError:
                pass


        reason = f"Target '{hostname}:{port}' successfully authorized under scope '{self.scope.scope_id}'."
        audit_id = None
        if record_audit:
            rec = self.audit_logger.record(target_supplied, hostname, port, resolved_ip, True, self.scope, reason)
            audit_id = rec.audit_id
        return True, reason, audit_id

