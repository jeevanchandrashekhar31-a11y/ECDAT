"""
Jira Ticketing Connector (Python) — Phase 14.1

Implements connector interface for Atlassian Jira Cloud & Server.
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

DEFAULT_PRIORITY_MAP = {
    "CRITICAL": "Highest",
    "HIGH": "High",
    "MEDIUM": "Medium",
    "LOW": "Low",
    "INFO": "Lowest",
    "INFORMATIONAL": "Lowest",
}


class JiraConnector(BaseTicketingConnector):
    def __init__(
        self,
        name: str = "jira-default",
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        super().__init__(
            name=name,
            connector_type="jira",
            config=config,
            http_client=http_client,
        )

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if not config.get("host"):
            raise ValueError("Jira connector requires 'host' URL")
        if not config.get("project_key") and not config.get("projectKey"):
            raise ValueError("Jira connector requires 'project_key'")
        if not config.get("api_token") and not config.get("apiToken"):
            raise ValueError("Jira connector requires 'api_token'")
        if not config.get("username"):
            raise ValueError("Jira connector requires 'username'")

    @property
    def normalized_host(self) -> str:
        return str(self.config.get("host", "")).rstrip("/")

    @property
    def project_key(self) -> str:
        return self.config.get("project_key") or self.config.get("projectKey", "")

    @property
    def api_token(self) -> str:
        return self.config.get("api_token") or self.config.get("apiToken", "")

    @property
    def username(self) -> str:
        return self.config.get("username", "")

    def get_auth_header(self) -> str:
        raw = f"{self.username}:{self.api_token}".encode("utf-8")
        return f"Basic {base64.b64encode(raw).decode('utf-8')}"

    def map_priority(self, severity: str) -> str:
        sev = str(severity or "MEDIUM").upper()
        custom = self.config.get("priority_mapping") or self.config.get("priorityMapping") or {}
        return custom.get(sev, DEFAULT_PRIORITY_MAP.get(sev, "Medium"))

    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        priority = self.map_priority(ticket_request.severity)
        issue_type = self.config.get("issue_type") or self.config.get("issueType") or "Bug"

        description_lines = [
            "h2. ECDAT Cryptographic Finding Details",
            "",
            "||Field||Value||",
            f"|*Asset ID*|{ticket_request.asset_id}|",
            f"|*Finding ID*|{ticket_request.finding_id}|",
            f"|*Severity*|{ticket_request.severity}|",
            f"|*Owner*|{ticket_request.owner}|",
            f"|*Evidence Link*|[{ticket_request.evidence_link}|{ticket_request.evidence_link}]|",
            f"|*CBOM Reference*|{ticket_request.cbom_ref}|",
            f"|*Risk Score*|{ticket_request.risk_score}|",
            "",
            "h3. Remediation Guidance",
            ticket_request.remediation,
            "",
            "----",
            "_Generated automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)_",
        ]

        fields = {
            "project": {"key": self.project_key},
            "summary": ticket_request.title
            or f"[{ticket_request.severity}] Finding: {ticket_request.finding_id} on {ticket_request.asset_id}",
            "description": "\n".join(description_lines),
            "issuetype": {"name": issue_type},
            "priority": {"name": priority},
            "labels": [
                "ecdat",
                "cryptography",
                "security",
                f"sev-{ticket_request.severity.lower()}",
            ],
        }

        custom_fields = self.config.get("custom_fields") or self.config.get("customFields")
        if isinstance(custom_fields, dict):
            fields.update(custom_fields)

        return {"fields": fields}

    def send_create_request(self, ticket_request: TicketRequest, payload: Dict[str, Any]) -> TicketResponse:
        endpoint = f"{self.normalized_host}/rest/api/2/issue"

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
                # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
                with urllib.request.urlopen(req) as resp:  # nosec B310
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                raise RuntimeError(f"Jira API error ({e.code}): {err_text}")

        ticket_key = data.get("key") or data.get("id") or "UNKNOWN"
        ticket_url = f"{self.normalized_host}/browse/{ticket_key}"

        return TicketResponse(
            success=True,
            ticket_id=str(ticket_key),
            ticket_url=ticket_url,
            connector_type="jira",
            status="OPEN",
            raw_response=data,
        )
