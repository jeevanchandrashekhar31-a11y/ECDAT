"""
Standardized Ticket Request & Response Models — Phase 14.1

Enforces that every ticket creation request contains the 8 mandatory fields:
1. asset ID
2. finding ID
3. severity
4. owner
5. evidence link
6. remediation
7. CBOM reference
8. risk score

Core risk code remains completely decoupled from vendor-specific ticketing APIs.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class TicketRequest:
    asset_id: str
    finding_id: str
    severity: str
    owner: str
    evidence_link: str
    remediation: str
    cbom_ref: str
    risk_score: float
    title: Optional[str] = None
    description: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.asset_id:
            raise ValueError("TicketRequest requires non-empty 'asset_id'")
        if not self.finding_id:
            raise ValueError("TicketRequest requires non-empty 'finding_id'")
        if not self.severity:
            raise ValueError("TicketRequest requires non-empty 'severity'")
        if not self.owner:
            raise ValueError("TicketRequest requires non-empty 'owner'")
        if not self.evidence_link:
            raise ValueError("TicketRequest requires non-empty 'evidence_link'")
        if not self.remediation:
            raise ValueError("TicketRequest requires non-empty 'remediation'")
        if not self.cbom_ref:
            raise ValueError("TicketRequest requires non-empty 'cbom_ref'")
        if self.risk_score is None:
            raise ValueError("TicketRequest requires 'risk_score'")

        # Ensure uppercase severity
        object.__setattr__(self, "severity", str(self.severity).upper())
        object.__setattr__(self, "risk_score", float(self.risk_score))

        if not self.title:
            default_title = f"[{self.severity}] Cryptographic Finding {self.finding_id} on {self.asset_id}"
            object.__setattr__(self, "title", default_title)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset_id": self.asset_id,
            "finding_id": self.finding_id,
            "severity": self.severity,
            "owner": self.owner,
            "evidence_link": self.evidence_link,
            "remediation": self.remediation,
            "cbom_ref": self.cbom_ref,
            "risk_score": self.risk_score,
            "title": self.title,
            "description": self.description,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class TicketResponse:
    success: bool
    ticket_id: str
    ticket_url: str
    connector_type: str
    status: str = "OPEN"
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    raw_response: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "ticket_id": self.ticket_id,
            "ticket_url": self.ticket_url,
            "connector_type": self.connector_type,
            "status": self.status,
            "created_at": self.created_at,
            "raw_response": dict(self.raw_response),
        }
