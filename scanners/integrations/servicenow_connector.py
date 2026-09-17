"""
ServiceNow Ticketing Connector (Python) — Phase 14.1

Implements connector interface for ServiceNow Table API.
Includes all 8 mandatory fields:
- asset ID
- finding ID
- severity
- owner
- evidence link
- remediation
- CBOM reference
- risk score
"""

import base64
import json
from typing import Any, Callable, Dict, Optional
import urllib.request
import urllib.error

from scanners.integrations.base_connector import BaseTicketingConnector
from scanners.integrations.ticket_request import TicketRequest, TicketResponse

SERVICENOW_URGENCY_MAP = {
    "CRITICAL": "1",
    "HIGH": "1",
    "MEDIUM": "2",
    "LOW": "3",
    "INFO": "3",
}

SERVICENOW_IMPACT_MAP = {
    "CRITICAL": "1",
    "HIGH": "2",
    "MEDIUM": "2",
    "LOW": "3",
    "INFO": "3",
}


class ServiceNowConnector(BaseTicketingConnector):
    def __init__(
        self,
        name: str = "servicenow-default",
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        super().__init__(
            name=name,
            connector_type="servicenow",
            config=config,
            http_client=http_client,
        )

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if not config.get("instance_url") and not config.get("instanceUrl"):
            raise ValueError("ServiceNow connector requires 'instance_url'")
        if not config.get("username"):
            raise ValueError("ServiceNow connector requires 'username'")
        if not config.get("password"):
            raise ValueError("ServiceNow connector requires 'password'")

    @property
    def normalized_instance_url(self) -> str:
        url = self.config.get("instance_url") or self.config.get("instanceUrl", "")
        return str(url).rstrip("/")

    @property
    def table(self) -> str:
        return self.config.get("table", "incident")

    @property
    def username(self) -> str:
        return self.config.get("username", "")

    @property
    def password(self) -> str:
        return self.config.get("password", "")

    def get_auth_header(self) -> str:
        raw = f"{self.username}:{self.password}".encode("utf-8")
        return f"Basic {base64.b64encode(raw).decode('utf-8')}"

    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        sev = str(ticket_request.severity or "MEDIUM").upper()
        urgency = SERVICENOW_URGENCY_MAP.get(sev, "2")
        impact = SERVICENOW_IMPACT_MAP.get(sev, "2")

        description = "\n".join(
            [
                "ECDAT Cryptographic Security Finding",
                "====================================",
                f"Asset ID:        {ticket_request.asset_id}",
                f"Finding ID:      {ticket_request.finding_id}",
                f"Severity:        {ticket_request.severity}",
                f"Owner:           {ticket_request.owner}",
                f"Evidence Link:   {ticket_request.evidence_link}",
                f"CBOM Reference:  {ticket_request.cbom_ref}",
                f"Risk Score:      {ticket_request.risk_score}",
                "",
                "Remediation Guidance:",
                f"{ticket_request.remediation}",
            ]
        )

        work_notes = "\n".join(
            [
                "[ECDAT Automated Security Alert]",
                f"Evidence: {ticket_request.evidence_link}",
                f"CBOM Reference: {ticket_request.cbom_ref}",
                f"Risk Score: {ticket_request.risk_score}",
                f"Remediation: {ticket_request.remediation}",
            ]
        )

        record = {
            "short_description": ticket_request.title
            or f"[ECDAT {ticket_request.severity}] Finding {ticket_request.finding_id} on {ticket_request.asset_id}",
            "description": description,
            "urgency": urgency,
            "impact": impact,
            "correlation_id": ticket_request.finding_id,
            "correlation_display": "ECDAT",
            "work_notes": work_notes,
            "comments": f"Finding assigned to {ticket_request.owner}.",
        }

        assignment_group = self.config.get("assignment_group") or self.config.get("assignmentGroup")
        if assignment_group:
            record["assignment_group"] = assignment_group

        return record

    def send_create_request(self, ticket_request: TicketRequest, payload: Dict[str, Any]) -> TicketResponse:
        endpoint = f"{self.normalized_instance_url}/api/now/table/{self.table}"

        if self.http_client:
            data = self.http_client(
                endpoint, method="POST", json_payload=payload, headers={"Authorization": self.get_auth_header()}
            )
        else:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": self.get_auth_header(),
                    "Accept": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                raise RuntimeError(f"ServiceNow API error ({e.code}): {err_text}")

        record = data.get("result", {})
        ticket_id = record.get("number") or record.get("sys_id") or "UNKNOWN"
        ticket_url = f"{self.normalized_instance_url}/nav_to.do?uri={self.table}.do?sys_id={record.get('sys_id', '')}"

        return TicketResponse(
            success=True,
            ticket_id=str(ticket_id),
            ticket_url=ticket_url,
            connector_type="servicenow",
            status=record.get("state", "1"),
            raw_response=record,
        )
