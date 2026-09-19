"""Phase 3 Regression Tests: Authorization & Tenant Isolation.

Verifies:
- P0-06: Elimination of cross-tenant and anonymous exposure in DB queries.
- P1-08: Object-level authorization and tenant scoping across assets, findings, and dashboard.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_assets_route_enforces_tenant_scoping_on_db_queries():
    """Validates that assets.js scopes queries to caller tenant."""
    assets_js = REPO_ROOT / "backend" / "src" / "routes" / "assets.js"
    assert assets_js.exists(), f"File {assets_js} must exist"

    content = assets_js.read_text(encoding="utf-8")
    assert 'query.where("scans.tenant_id", callerTenant)' in content, (
        "assets.js must scope asset list queries by scans.tenant_id"
    )
    assert 'assetQuery.andWhere("scans.tenant_id", callerTenant)' in content, (
        "assets.js must scope individual asset detail queries by scans.tenant_id"
    )


def test_findings_route_enforces_tenant_scoping_on_db_queries():
    """Validates that findings.js scopes queries to caller tenant."""
    findings_js = REPO_ROOT / "backend" / "src" / "routes" / "findings.js"
    assert findings_js.exists(), f"File {findings_js} must exist"

    content = findings_js.read_text(encoding="utf-8")
    assert 'query.where("scans.tenant_id", callerTenant)' in content, (
        "findings.js must scope finding list queries by scans.tenant_id"
    )
    assert 'findingQuery.andWhere("scans.tenant_id", callerTenant)' in content, (
        "findings.js must scope individual finding detail queries by scans.tenant_id"
    )


def test_dashboard_route_enforces_tenant_scoping():
    """Validates that dashboard.js scopes queries to caller tenant."""
    dashboard_js = REPO_ROOT / "backend" / "src" / "routes" / "dashboard.js"
    assert dashboard_js.exists(), f"File {dashboard_js} must exist"

    content = dashboard_js.read_text(encoding="utf-8")
    assert 'scanQuery.where("tenant_id", callerTenant)' in content, (
        "dashboard.js must scope scanQuery by tenant_id"
    )
    assert "getScanById(scanId, req.tenantContext)" in content, (
        "dashboard.js must pass req.tenantContext to getScanById"
    )
