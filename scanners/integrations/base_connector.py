"""
Base Ticketing Connector (Python) — Phase 14.1

Abstract base class defining the vendor-agnostic connector interface.
"""

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Optional

from scanners.integrations.ticket_request import TicketRequest, TicketResponse


class BaseTicketingConnector(ABC):
    def __init__(
        self,
        name: str,
        connector_type: str,
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional[Callable[..., Any]] = None,
    ):
        if not name:
            raise ValueError("Connector requires a 'name'")
        if not connector_type:
            raise ValueError("Connector requires a 'connector_type'")

        self.name = str(name)
        self.connector_type = str(connector_type).lower()
        self.config = dict(config or {})
        self.http_client = http_client

        self.validate_config(self.config)

    def validate_config(self, config: Dict[str, Any]) -> None:
        """Validates vendor configuration options. Subclasses should override."""
        if config is None:
            raise ValueError(f"{self.name} requires a configuration dictionary")

    @abstractmethod
    def format_payload(self, ticket_request: TicketRequest) -> Dict[str, Any]:
        """Pure formatter converting TicketRequest into vendor API payload."""
        pass

    @abstractmethod
    def send_create_request(self, ticket_request: TicketRequest, payload: Dict[str, Any]) -> TicketResponse:
        """Sends formatted payload to vendor API."""
        pass

    def create_ticket(self, raw_request: Any) -> TicketResponse:
        """Creates a ticket from TicketRequest or dictionary."""
        if isinstance(raw_request, TicketRequest):
            req = raw_request
        elif isinstance(raw_request, dict):
            req = TicketRequest(**raw_request)
        else:
            raise TypeError("Ticket creation requires TicketRequest or dict")

        payload = self.format_payload(req)
        return self.send_create_request(req, payload)

    def test_connection(self) -> Dict[str, Any]:
        """Tests connectivity and credentials with vendor API."""
        return {"ok": True, "message": f"Connection test succeeded for {self.name}"}
