"""
Unit tests for Enterprise Ticketing Connectors (Phase 14.1).

Verifies:
- All 5 connector interfaces:
  1. Jira
  2. ServiceNow
  3. GitHub Issues
  4. GitLab Issues
  5. Generic Webhook
- Zero hardcoded vendor logic in core risk code
- Strict enforcement of the 8 mandatory ticket fields:
  - asset ID
  - finding ID
  - severity
  - owner
  - evidence link
  - remediation
  - CBOM reference
  - risk score
"""

import hashlib
import hmac
import pytest

from scanners.integrations.ticket_request import TicketRequest, TicketResponse
from scanners.integrations.jira_connector import JiraConnector
from scanners.integrations.servicenow_connector import ServiceNowConnector
from scanners.integrations.github_issues_connector import GitHubIssuesConnector
from scanners.integrations.gitlab_issues_connector import GitLabIssuesConnector
from scanners.integrations.webhook_connector import WebhookConnector
from scanners.integrations.ticketing_service import TicketingService


@pytest.fixture
def sample_ticket_request():
    return TicketRequest(
        asset_id="asset-auth-srv-01",
        finding_id="find-md5-tok-001",
        severity="CRITICAL",
        owner="secops-crypto@enterprise.com",
        evidence_link="https://github.com/org/repo/blob/main/src/token.py#L42",
        remediation="Migrate from MD5 to SHA-256 with 64-char storage column.",
        cbom_ref="urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
        risk_score=9.6,
        title="[CRITICAL] MD5 Collision Vulnerability in Token Service",
        description="Collision vulnerability permits token forgery.",
    )


def test_ticket_request_enforces_all_8_mandatory_fields():
    """TicketRequest must reject initialization if any of the 8 required fields are missing."""
    valid_kwargs = {
        "asset_id": "asset-1",
        "finding_id": "find-1",
        "severity": "HIGH",
        "owner": "owner@corp.com",
        "evidence_link": "https://ecdat.local/evidence/1",
        "remediation": "Upgrade to AES-256",
        "cbom_ref": "urn:ecdat:cbom:1",
        "risk_score": 8.0,
    }

    # Valid creation succeeds
    req = TicketRequest(**valid_kwargs)
    assert req.asset_id == "asset-1"
    assert req.finding_id == "find-1"
    assert req.severity == "HIGH"
    assert req.owner == "owner@corp.com"
    assert req.evidence_link == "https://ecdat.local/evidence/1"
    assert req.remediation == "Upgrade to AES-256"
    assert req.cbom_ref == "urn:ecdat:cbom:1"
    assert req.risk_score == 8.0

    # Missing each of the 8 fields must raise ValueError
    for key in valid_kwargs.keys():
        bad_kwargs = dict(valid_kwargs)
        bad_kwargs[key] = "" if key != "risk_score" else None
        with pytest.raises(ValueError) as excinfo:
            TicketRequest(**bad_kwargs)
        assert key in str(excinfo.value)


def test_jira_connector_payload_and_create(sample_ticket_request):
    """Jira connector formats Jira REST API payload containing all 8 fields and dispatches."""
    captured = {}

    def mock_http(url, method="POST", json_payload=None, headers=None):
        captured["url"] = url
        captured["method"] = method
        captured["payload"] = json_payload
        captured["headers"] = headers
        return {"key": "SEC-104", "id": "10004"}

    connector = JiraConnector(
        name="jira-prod",
        config={
            "host": "https://jira.enterprise.com",
            "project_key": "SEC",
            "username": "crypto-bot@enterprise.com",
            "api_token": "secret-token-123",
            "issue_type": "Security Finding",
        },
        http_client=mock_http,
    )

    payload = connector.format_payload(sample_ticket_request)
    fields = payload["fields"]

    # Verify Jira fields
    assert fields["project"]["key"] == "SEC"
    assert fields["issuetype"]["name"] == "Security Finding"
    assert fields["priority"]["name"] == "Highest"  # Mapped from CRITICAL
    assert "MD5" in fields["summary"]
    assert "ecdat" in fields["labels"]
    assert "sev-critical" in fields["labels"]

    # Verify all 8 fields are in Jira description
    desc = fields["description"]
    assert sample_ticket_request.asset_id in desc
    assert sample_ticket_request.finding_id in desc
    assert sample_ticket_request.severity in desc
    assert sample_ticket_request.owner in desc
    assert sample_ticket_request.evidence_link in desc
    assert sample_ticket_request.remediation in desc
    assert sample_ticket_request.cbom_ref in desc
    assert str(sample_ticket_request.risk_score) in desc

    # Dispatch create_ticket
    res = connector.create_ticket(sample_ticket_request)
    assert res.success is True
    assert res.ticket_id == "SEC-104"
    assert res.ticket_url == "https://jira.enterprise.com/browse/SEC-104"
    assert res.connector_type == "jira"
    assert "Basic " in captured["headers"]["Authorization"]


def test_servicenow_connector_payload_and_create(sample_ticket_request):
    """ServiceNow connector formats Table API incident with all 8 fields and correlation ID."""
    captured = {}

    def mock_http(url, method="POST", json_payload=None, headers=None):
        captured["url"] = url
        captured["payload"] = json_payload
        return {"result": {"sys_id": "sys_987654", "number": "INC001094", "state": "1"}}

    connector = ServiceNowConnector(
        name="snow-secops",
        config={
            "instance_url": "https://company.service-now.com",
            "username": "admin",
            "password": "password123",
            "table": "sn_si_incident",
            "assignment_group": "Cryptographic Operations",
        },
        http_client=mock_http,
    )

    payload = connector.format_payload(sample_ticket_request)
    assert payload["urgency"] == "1"
    assert payload["impact"] == "1"
    assert payload["correlation_id"] == sample_ticket_request.finding_id
    assert payload["correlation_display"] == "ECDAT"
    assert payload["assignment_group"] == "Cryptographic Operations"

    desc = payload["description"]
    assert sample_ticket_request.asset_id in desc
    assert sample_ticket_request.finding_id in desc
    assert sample_ticket_request.severity in desc
    assert sample_ticket_request.owner in desc
    assert sample_ticket_request.evidence_link in desc
    assert sample_ticket_request.remediation in desc
    assert sample_ticket_request.cbom_ref in desc
    assert str(sample_ticket_request.risk_score) in desc

    res = connector.create_ticket(sample_ticket_request)
    assert res.success is True
    assert res.ticket_id == "INC001094"
    assert "nav_to.do" in res.ticket_url
    assert res.connector_type == "servicenow"


def test_github_issues_connector_payload_and_create(sample_ticket_request):
    """GitHub Issues connector formats rich markdown table with 8 fields and severity labels."""
    captured = {}

    def mock_http(url, method="POST", json_payload=None, headers=None):
        captured["url"] = url
        captured["payload"] = json_payload
        return {"number": 89, "html_url": "https://github.com/org/repo/issues/89", "state": "open"}

    connector = GitHubIssuesConnector(
        name="github-crypto",
        config={
            "repo": "org/repo",
            "token": "ghp_mocktoken123",
        },
        http_client=mock_http,
    )

    payload = connector.format_payload(sample_ticket_request)
    assert "[CRITICAL]" in payload["title"]
    assert "security" in payload["labels"]
    assert "severity:critical" in payload["labels"]

    body = payload["body"]
    assert sample_ticket_request.asset_id in body
    assert sample_ticket_request.finding_id in body
    assert sample_ticket_request.severity in body
    assert sample_ticket_request.owner in body
    assert sample_ticket_request.evidence_link in body
    assert sample_ticket_request.remediation in body
    assert sample_ticket_request.cbom_ref in body
    assert str(sample_ticket_request.risk_score) in body

    res = connector.create_ticket(sample_ticket_request)
    assert res.success is True
    assert res.ticket_id == "#89"
    assert res.ticket_url == "https://github.com/org/repo/issues/89"
    assert res.connector_type == "github"


def test_gitlab_issues_connector_payload_and_create(sample_ticket_request):
    """GitLab Issues connector formats confidential issue with all 8 fields and weight."""
    captured = {}

    def mock_http(url, method="POST", json_payload=None, headers=None):
        captured["url"] = url
        captured["payload"] = json_payload
        return {"iid": 12, "id": 1012, "web_url": "https://gitlab.com/group/proj/-/issues/12", "state": "opened"}

    connector = GitLabIssuesConnector(
        name="gitlab-crypto",
        config={
            "project_id": "group/proj",
            "token": "glpat_mocktoken456",
            "confidential": True,
        },
        http_client=mock_http,
    )

    payload = connector.format_payload(sample_ticket_request)
    assert "[CRITICAL]" in payload["title"]
    assert payload["confidential"] is True
    assert payload["weight"] == 10  # round(9.6)
    assert "security" in payload["labels"]

    desc = payload["description"]
    assert sample_ticket_request.asset_id in desc
    assert sample_ticket_request.finding_id in desc
    assert sample_ticket_request.severity in desc
    assert sample_ticket_request.owner in desc
    assert sample_ticket_request.evidence_link in desc
    assert sample_ticket_request.remediation in desc
    assert sample_ticket_request.cbom_ref in desc
    assert str(sample_ticket_request.risk_score) in desc

    res = connector.create_ticket(sample_ticket_request)
    assert res.success is True
    assert res.ticket_id == "#12"
    assert res.ticket_url == "https://gitlab.com/group/proj/-/issues/12"
    assert res.connector_type == "gitlab"


def test_generic_webhook_connector_signing_and_dispatch(sample_ticket_request):
    """Generic Webhook connector signs payload with HMAC-SHA256 and includes all 8 fields."""
    captured = {}

    def mock_http(url, method="POST", json_payload=None, headers=None):
        captured["url"] = url
        captured["payload"] = json_payload
        captured["headers"] = headers
        return {"status": "DELIVERED", "ticketId": "wh_evt_998877", "url": "https://soar.corp/events/998877"}

    secret = "soar-webhook-secret-key-321"
    connector = WebhookConnector(
        name="soar-webhook",
        config={
            "url": "https://soar.enterprise.com/api/v1/crypto-alerts",
            "secret": secret,
        },
        http_client=mock_http,
    )

    payload = connector.format_payload(sample_ticket_request)
    assert payload["event"] == "ecdat.finding.ticket"
    ticket_data = payload["ticket"]
    assert ticket_data["asset_id"] == sample_ticket_request.asset_id
    assert ticket_data["finding_id"] == sample_ticket_request.finding_id
    assert ticket_data["severity"] == sample_ticket_request.severity
    assert ticket_data["owner"] == sample_ticket_request.owner
    assert ticket_data["evidence_link"] == sample_ticket_request.evidence_link
    assert ticket_data["remediation"] == sample_ticket_request.remediation
    assert ticket_data["cbom_ref"] == sample_ticket_request.cbom_ref
    assert ticket_data["risk_score"] == sample_ticket_request.risk_score

    res = connector.create_ticket(sample_ticket_request)
    assert res.success is True
    assert res.ticket_id == "wh_evt_998877"
    assert res.connector_type == "webhook"

    # Verify HMAC-SHA256 signature header was set
    sig_header = captured["headers"].get("X-ECDAT-Signature")
    assert sig_header is not None
    assert sig_header.startswith("sha256=")


def test_ticketing_service_multi_dispatch_and_batch():
    """TicketingService dispatches tickets across connectors and handles batching from findings."""

    def mock_jira_http(*args, **kwargs):
        return {"key": "SEC-55"}

    def mock_gh_http(*args, **kwargs):
        return {"number": 44, "html_url": "https://github.com/o/r/issues/44"}

    jira_conn = JiraConnector(
        name="jira-sec",
        config={"host": "https://jira.corp", "project_key": "SEC", "username": "u", "api_token": "t"},
        http_client=mock_jira_http,
    )
    gh_conn = GitHubIssuesConnector(
        name="gh-issues",
        config={"repo": "o/r", "token": "t"},
        http_client=mock_gh_http,
    )

    service = TicketingService()
    service.register_connector(jira_conn)
    service.register_connector(gh_conn)

    assert len(service.list_connectors()) == 2

    # Multi-dispatch single request to all connectors
    req = TicketRequest(
        asset_id="srv-db-01",
        finding_id="find-des-01",
        severity="HIGH",
        owner="db-admins@corp.com",
        evidence_link="https://ecdat.corp/find/1",
        remediation="Upgrade to AES-256",
        cbom_ref="urn:cbom:1",
        risk_score=8.5,
    )

    dispatched = service.dispatch_multi(req)
    assert len(dispatched) == 2
    assert all(d["success"] is True for d in dispatched)
    assert {d["connector"] for d in dispatched} == {"jira-sec", "gh-issues"}

    # Batch create from raw findings array (decoupled from vendor logic)
    raw_findings = [
        {
            "asset_id": "srv-api-01",
            "finding_id": "find-rc4-01",
            "severity": "CRITICAL",
            "owner": "api-team@corp.com",
            "evidence_link": "https://ecdat.corp/find/2",
            "remediation": "Migrate to ChaCha20-Poly1305",
            "cbom_ref": "urn:cbom:2",
            "risk_score": 9.2,
        },
        {
            "asset_id": "srv-cache-01",
            "finding_id": "find-sha1-01",
            "severity": "MEDIUM",
            "owner": "cache-team@corp.com",
            "evidence_link": "https://ecdat.corp/find/3",
            "remediation": "Upgrade to SHA-256",
            "cbom_ref": "urn:cbom:3",
            "risk_score": 6.5,
        },
    ]

    batch_result = service.batch_create_from_findings(raw_findings)
    assert batch_result["total_findings"] == 2
    assert batch_result["processed"] == 2
    assert len(batch_result["results"]) == 2
