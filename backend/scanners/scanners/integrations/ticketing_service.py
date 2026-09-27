"""
Ticketing Service (Python) — Phase 14.1

Central registry and dispatcher for enterprise ticketing connectors.
Enforces that core risk code is decoupled from vendor implementations.
"""

from typing import Any, Dict, List, Optional

from scanners.integrations.base_connector import BaseTicketingConnector
from scanners.integrations.ticket_request import TicketRequest, TicketResponse


class TicketingService:
    def __init__(self):
        self._connectors: Dict[str, BaseTicketingConnector] = {}

    def register_connector(self, connector: BaseTicketingConnector) -> "TicketingService":
        if not connector or not connector.name:
            raise ValueError("Connector requires a valid name")
        self._connectors[connector.name] = connector
        return self

    def unregister_connector(self, name: str) -> bool:
        return self._connectors.pop(name, None) is not None

    def get_connector(self, name: str) -> Optional[BaseTicketingConnector]:
        return self._connectors.get(name)

    def list_connectors(self) -> List[Dict[str, str]]:
        return [{"name": name, "type": conn.connector_type} for name, conn in self._connectors.items()]

    def format_ticket(self, raw_request: Any, connector_name: str) -> Dict[str, Any]:
        conn = self.get_connector(connector_name)
        if not conn:
            raise KeyError(f"Connector '{connector_name}' is not registered")

        req = raw_request if isinstance(raw_request, TicketRequest) else TicketRequest(**raw_request)
        return {
            "connector_name": connector_name,
            "connector_type": conn.connector_type,
            "payload": conn.format_payload(req),
        }

    def create_ticket(self, raw_request: Any, connector_name: str) -> TicketResponse:
        conn = self.get_connector(connector_name)
        if not conn:
            raise KeyError(f"Connector '{connector_name}' is not registered")

        return conn.create_ticket(raw_request)

    def dispatch_multi(self, raw_request: Any, connector_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        req = raw_request if isinstance(raw_request, TicketRequest) else TicketRequest(**raw_request)

        target_connectors = (
            [self.get_connector(name) for name in connector_names]
            if connector_names
            else list(self._connectors.values())
        )

        if not target_connectors or any(c is None for c in target_connectors):
            raise KeyError("One or more specified connectors were not found or no connectors registered")

        results = []
        for conn in target_connectors:
            assert conn is not None
            try:
                ticket_res = conn.create_ticket(req)
                results.append(
                    {
                        "connector": conn.name,
                        "connector_type": conn.connector_type,
                        "success": True,
                        "ticket": ticket_res.to_dict(),
                    }
                )
            except Exception as e:
                results.append(
                    {
                        "connector": conn.name,
                        "connector_type": conn.connector_type,
                        "success": False,
                        "error": str(e),
                    }
                )
        return results

    def batch_create_from_findings(
        self,
        findings: List[Dict[str, Any]],
        default_owner: str = "crypto-secops@enterprise.com",
        cbom_ref: str = "urn:ecdat:cbom:latest",
        connector_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        results = []
        for finding in findings:
            asset_id = finding.get("asset_id") or finding.get("assetId") or finding.get("file_path") or "unknown-asset"
            finding_id = (
                finding.get("finding_id")
                or finding.get("findingId")
                or finding.get("rule_id")
                or finding.get("id")
                or "find-default"
            )
            severity = str(finding.get("severity", "MEDIUM")).upper()
            owner = finding.get("owner") or default_owner
            evidence_link = (
                finding.get("evidence_link")
                or finding.get("evidenceLink")
                or (
                    f"{finding['file_path']}#L{finding.get('line_number', 1)}"
                    if finding.get("file_path")
                    else "https://ecdat.internal/evidence"
                )
            )
            remediation = (
                finding.get("remediation")
                or (finding.get("developer_feedback", {}).get("safe_fix", {}).get("summary"))
                or "Upgrade algorithm according to enterprise crypto policy."
            )
            c_ref = finding.get("cbom_ref") or finding.get("cbomRef") or cbom_ref
            risk_score = finding.get("risk_score")
            if risk_score is None:
                risk_score = 9.5 if severity == "CRITICAL" else 7.0

            req = TicketRequest(
                asset_id=asset_id,
                finding_id=finding_id,
                severity=severity,
                owner=owner,
                evidence_link=evidence_link,
                remediation=remediation,
                cbom_ref=c_ref,
                risk_score=float(risk_score),
                title=finding.get("title"),
                description=finding.get("description"),
                metadata=finding.get("metadata", {}),
            )

            dispatch_res = self.dispatch_multi(req, connector_names)
            results.append(
                {
                    "finding_id": finding_id,
                    "asset_id": asset_id,
                    "dispatch": dispatch_res,
                }
            )

        return {
            "total_findings": len(findings),
            "processed": len(results),
            "results": results,
        }
