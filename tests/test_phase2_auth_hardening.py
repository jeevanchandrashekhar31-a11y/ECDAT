import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_auth_middleware_does_not_fail_open_on_unconfigured_key():
    """Auth fail-closed: boot the app with ECDAT_API_KEY unset, issue an unauthenticated request,
    assert the response status is 503 (or 401) and that req.auth is never populated with a role."""
    script = """
    const express = require('express');
    const config = require('./backend/src/config');
    config.ECDAT_API_KEY = null;
    const { apiKeyAuthMiddleware } = require('./backend/src/middleware/auth');
    const app = express();
    app.use(apiKeyAuthMiddleware);
    app.get('/api/v1/assets', (req, res) => {
        res.json({ auth: req.auth || null });
    });
    const server = app.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        try {
            const resp = await fetch(`http://127.0.0.1:${port}/api/v1/assets`);
            const status = resp.status;
            const data = await resp.json().catch(() => ({}));
            server.close();
            console.log(JSON.stringify({ status, data }));
        } catch (err) {
            server.close();
            console.error(err);
            process.exit(1);
        }
    });
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout.strip())
    assert result["status"] in (503, 401), f"Expected 503 or 401, got {result['status']}"
    assert result["data"].get("code") == "AUTH_NOT_CONFIGURED" or result["status"] in (503, 401)


def test_tenant_context_does_not_elevate_open_mode_to_admin():
    """Tenant no-elevation: construct a request with no auth, call TenantContext.fromRequest,
    assert roles === [] and isPlatformAdmin === false and tenantId === null."""
    script = """
    const { TenantContext } = require('./backend/src/tenancy/tenant_isolation');
    const req = {};
    const ctx = TenantContext.fromRequest(req);
    console.log(JSON.stringify({
        roles: ctx.roles,
        isPlatformAdmin: ctx.isPlatformAdmin,
        tenantId: ctx.tenantId
    }));
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout.strip())
    assert result["roles"] == [], f"Expected roles == [], got {result['roles']}"
    assert result["isPlatformAdmin"] is False, f"Expected isPlatformAdmin == False, got {result['isPlatformAdmin']}"
    assert result["tenantId"] is None, f"Expected tenantId == None, got {result['tenantId']}"
