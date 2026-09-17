"""
GitLab Issues Ticketing Connector (Python) — Phase 14.1

Implements connector interface for GitLab REST API v4 Issues.
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

import json
from typing import Any, Callable, Dict, Optional
import urllib.parse
import urllib.request
import urllib.error

from scanners.integrations.base_connector import BaseTicketingConnector
from scanners.integrations.ticket_request import TicketRequest, TicketResponse


class GitLabIssuesConnector(BaseTicketingConnector):
    def __init__(
        self,
        name: str = "gitlab-issues-default",
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        super().__init__(
            name=name,
            connector_type="gitlab",
            config=config,
            http_client=http_client,
        )

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if not config.get("project_id") and not config.get("projectId"):
            raise ValueError("GitLab connector requires 'project_id'")
        if not config.get("token"):
            raise ValueError("GitLab connector requires personal/project access 'token'")

    @property
    def base_url(self) -> str:
        url = self.config.get("base_url") or self.config.get("baseUrl") or "https://gitlab.com/api/v4"
        return str(url).rstrip("/")

    @property
    def project_id(self) -> str:
        pid = self.config.get("project_id") or self.config.get("projectId")
        return urllib.parse.quote_plus(str(pid))

    @property
    def token(self) -> str:
        return self.config.get("token", "")

    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        sev = str(ticket_request.severity or "MEDIUM").upper()

        description = "\n".join(
            [
                "## 🦊 ECDAT Cryptographic Vulnerability Finding",
                "",
                "| Field | Value |",
                "|---|---|",
                f"| **Asset ID** | `{ticket_request.asset_id}` |",
                f"| **Finding ID** | `{ticket_request.finding_id}` |",
                f"| **Severity** | **`{sev}`** |",
                f"| **Owner** | `{ticket_request.owner}` |",
                f"| **Evidence Link** | [Inspect Evidence]({ticket_request.evidence_link}) |",
                f"| **CBOM Reference** | `{ticket_request.cbom_ref}` |",
                f"| **Risk Score** | **`{ticket_request.risk_score}`** |",
                "",
                "### 🔧 Remediation Guidance",
                ticket_request.remediation,
                "",
                "/confidential",
                "---",
                "*Reported automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)*",
            ]
        )

        labels = [
            "security",
            "cryptography",
            sev.lower(),
            "ecdat",
        ]

        payload = {
            "title": ticket_request.title
            or f"[ECDAT {sev}] Finding {ticket_request.finding_id} on {ticket_request.asset_id}",
            "description": description,
            "labels": ",".join(labels),
            "confidential": bool(self.config.get("confidential", True)),
            "weight": int(round(ticket_request.risk_score)),
        }

        return payload

    def send_create_request(self, ticket_request: TicketRequest, payload: Dict[str, Any]) -> TicketResponse:
        endpoint = f"{self.base_url}/projects/{self.project_id}/issues"

        if self.http_client:
            data = self.http_client(
                endpoint, method="POST", json_payload=payload, headers={"PRIVATE-TOKEN": self.token}
            )
        else:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "PRIVATE-TOKEN": self.token,
                    "Accept": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                raise RuntimeError(f"GitLab API error ({e.code}): {err_text}")

        ticket_id = f"#{data.get('iid') or data.get('id')}"
        ticket_url = data.get("web_url", "")

        return TicketResponse(
            success=True,
            ticket_id=ticket_id,
            ticket_url=ticket_url,
            connector_type="gitlab",
            status=data.get("state", "opened"),
            raw_response=data,
        )
