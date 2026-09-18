"""
GitHub Issues Ticketing Connector (Python) — Phase 14.1

Implements connector interface for GitHub REST API v3 Issues.
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
import urllib.request
import urllib.error

from scanners.integrations.base_connector import BaseTicketingConnector
from scanners.integrations.ticket_request import TicketRequest, TicketResponse


class GitHubIssuesConnector(BaseTicketingConnector):
    def __init__(
        self,
        name: str = "github-issues-default",
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        super().__init__(
            name=name,
            connector_type="github",
            config=config,
            http_client=http_client,
        )

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if not config.get("repo"):
            raise ValueError("GitHub connector requires 'repo' (owner/repo)")
        if not config.get("token"):
            raise ValueError("GitHub connector requires personal access 'token'")

    @property
    def base_url(self) -> str:
        return str(self.config.get("base_url") or self.config.get("baseUrl") or "https://api.github.com").rstrip("/")

    @property
    def repo(self) -> str:
        return self.config.get("repo", "")

    @property
    def token(self) -> str:
        return self.config.get("token", "")

    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        sev = str(ticket_request.severity or "MEDIUM").upper()

        body = "\n".join(
            [
                "## 🛡️ ECDAT Cryptographic Security Finding",
                "",
                "| Field | Value |",
                "|---|---|",
                f"| **Asset ID** | `{ticket_request.asset_id}` |",
                f"| **Finding ID** | `{ticket_request.finding_id}` |",
                f"| **Severity** | **`{sev}`** |",
                f"| **Owner** | `{ticket_request.owner}` |",
                f"| **Evidence Link** | [Inspect Evidence Source]({ticket_request.evidence_link}) |",
                f"| **CBOM Reference** | `{ticket_request.cbom_ref}` |",
                f"| **Risk Score** | **`{ticket_request.risk_score}`** |",
                "",
                "### 🔧 Remediation Guidance",
                ticket_request.remediation,
                "",
                "---",
                "*Reported automatically by ECDAT (Enterprise Cryptographic Discovery & Agility Toolkit)*",
            ]
        )

        labels = [
            "security",
            "cryptography",
            f"severity:{sev.lower()}",
            "ecdat",
        ]

        payload: Dict[str, Any] = {
            "title": ticket_request.title
            or f"[ECDAT {sev}] Finding {ticket_request.finding_id} on {ticket_request.asset_id}",
            "body": body,
            "labels": labels,
        }

        # If owner is a username without @
        if ticket_request.owner and "@" not in ticket_request.owner and ticket_request.owner.replace("-", "").isalnum():
            payload["assignees"] = [ticket_request.owner]

        return payload

    def send_create_request(self, ticket_request: TicketRequest, payload: Dict[str, Any]) -> TicketResponse:
        endpoint = f"{self.base_url}/repos/{self.repo}/issues"

        if self.http_client:
            data = self.http_client(
                endpoint, method="POST", json_payload=payload, headers={"Authorization": f"Bearer {self.token}"}
            )
        else:
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "ECDAT-Python-Connector",
                },
                method="POST",
            )
            try:
                # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
                with urllib.request.urlopen(req) as resp:  # nosec B310
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                raise RuntimeError(f"GitHub API error ({e.code}): {err_text}")

        ticket_id = f"#{data.get('number')}"
        ticket_url = data.get("html_url", "")

        return TicketResponse(
            success=True,
            ticket_id=ticket_id,
            ticket_url=ticket_url,
            connector_type="github",
            status=data.get("state", "open"),
            raw_response=data,
        )
