"""
Adversarial Security Test: Tenant Context No-Elevation Control.

Guards against vulnerability: test_tenant_context_does_not_elevate_open_mode_to_admin.
Ensures that when an unauthenticated request is processed, TenantContext.fromRequest
strictly derives unprivileged state: roles === [], isPlatformAdmin === false, and tenantId === null.
"""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_tenant_context_no_elevation_on_unauthenticated_request():
    """
    Constructs a request with no auth and calls TenantContext.fromRequest directly.
    Asserts roles === [], isPlatformAdmin === false, and tenantId === null.
    """
    node_script = """
    const { TenantContext } = require('./src/tenancy/tenant_isolation');

    // Construct a request with no auth
    const req = {
        headers: {},
        method: 'GET',
        path: '/api/v1/findings',
    };

    const ctx = TenantContext.fromRequest(req);
    console.log(JSON.stringify({
        roles: ctx.roles,
        isPlatformAdmin: ctx.isPlatformAdmin,
        tenantId: ctx.tenantId,
        hasTenantScope: ctx.hasTenantScope,
    }));
    """
    proc = subprocess.run(
        ["node", "-e", node_script],
        cwd=str(REPO_ROOT / "backend"),
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout.strip())

    assert result["roles"] == [], f"Expected roles to be [], got {result['roles']}"
    assert result["isPlatformAdmin"] is False, f"Expected isPlatformAdmin to be False, got {result['isPlatformAdmin']}"
    assert result["tenantId"] is None, f"Expected tenantId to be None, got {result['tenantId']}"
    assert result["hasTenantScope"] is False
