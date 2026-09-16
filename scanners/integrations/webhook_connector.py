"""
Generic Webhook Ticketing Connector (Python) — Phase 14.1

Implements connector interface for generic webhooks with HMAC-SHA256 signature.
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

from datetime import datetime, timezone
import hashlib
import hmac
import json
from typing import Any, Callable, Dict, Optional
import urllib.request
import urllib.error
import uuid

from scanners.integrations.base_connector import BaseTicketingConnector
from scanners.integrations.ticket_request import TicketRequest, TicketResponse


class WebhookConnector(BaseTicketingConnector):
    def __init__(
        self,
        name: str = "webhook-default",
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        super().__init__(
            name=name,
            connector_type="webhook",
            config=config,
            http_client=http_client,
        )

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if not config.get("url"):
            raise ValueError("Webhook connector requires 'url'")

    @property
    def url(self) -> str:
        return str(self.config.get("url", ""))

    @property
    def secret(self) -> str:
        return str(self.config.get("secret", ""))

    @property
    def max_retries(self) -> int:
        return int(self.config.get("max_retries", 2))

    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        return {
            "event": "ecdat.finding.ticket",
            "eventId": f"evt_{uuid.uuid4()}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "ticket": {
                "asset_id": ticket_request.asset_id,
                "finding_id": ticket_request.finding_id,
                "severity": ticket_request.severity,
                "owner": ticket_request.owner,
                "evidence_link": ticket_request.evidence_link,
                "remediation": ticket_request.remediation,
                "cbom_ref": ticket_request.cbom_ref,
                "risk_score": ticket_request.risk_score,
                "title": ticket_request.title,
                "description": ticket_request.description,
            },
            "metadata": dict(ticket_request.metadata),
        }

    def compute_signature(self, payload_string: str, timestamp: str) -> Optional[str]:
        if not self.secret:
            return None
        mac = hmac.new(
            self.secret.encode("utf-8"),
            f"{timestamp}.{payload_string}".encode("utf-8"),
            hashlib.sha256,
        )
        return f"sha256={mac.hexdigest()}"

    def send_create_request(
        self, ticket_request: TicketRequest, payload: Dict[str, Any]
    ) -> TicketResponse:
        payload_str = json.dumps(payload)
        timestamp = payload.get("timestamp", datetime.now(timezone.utc).isoformat())

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ECDAT-Python-Webhook/1.0",
            "X-ECDAT-Event": payload.get("event", "ecdat.finding.ticket"),
            "X-ECDAT-Event-Id": payload.get("eventId", ""),
            "X-ECDAT-Timestamp": timestamp,
        }
        if self.config.get("headers"):
            headers.update(self.config["headers"])

        signature = self.compute_signature(payload_str, timestamp)
        if signature:
            headers["X-ECDAT-Signature"] = signature

        if self.http_client:
            data = self.http_client(self.url, method="POST", json_payload=payload, headers=headers)
        else:
            req = urllib.request.Request(
                self.url,
                data=payload_str.encode("utf-8"),
                headers=headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_text = e.read().decode("utf-8")
                raise RuntimeError(f"Webhook endpoint returned HTTP {e.code}: {err_text}")

        ticket_id = data.get("ticketId") or data.get("id") or payload.get("eventId")
        ticket_url = data.get("ticketUrl") or data.get("url") or self.url

        return TicketResponse(
            success=True,
            ticket_id=str(ticket_id),
            ticket_url=str(ticket_url),
            connector_type="webhook",
            status=data.get("status", "DISPATCHED"),
            raw_response=data,
        )
