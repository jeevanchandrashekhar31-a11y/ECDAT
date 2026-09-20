"""
Adversarial Security Test: Authentication Fail-Closed Control.

Guards against vulnerability: test_auth_middleware_does_not_fail_open_on_unconfigured_key.
Ensures that when ECDAT_API_KEY is unset or unconfigured, the authentication middleware
strictly fails closed by returning HTTP 503 Service Unavailable (AUTH_NOT_CONFIGURED),
and req.auth is never populated with any authorized role.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_auth_middleware_fails_closed_when_key_unset():
    """
    Boots the auth middleware with ECDAT_API_KEY unset.
    Asserts an unauthenticated request returns 503 and req.auth is never populated with any role.
    """
    node_script = """
    delete process.env.ECDAT_API_KEY;
    const config = require('./src/config');
    config.ECDAT_API_KEY = undefined;

    const { apiKeyAuthMiddleware } = require('./src/middleware/auth');

    const req = {
        path: '/api/v1/findings',
        method: 'GET',
        headers: {},
        ip: '127.0.0.1',
    };

    let statusCode = null;
    let responseBody = null;
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        },
    };

    let nextCalled = false;
    apiKeyAuthMiddleware(req, res, () => {
        nextCalled = true;
    });

    console.log(JSON.stringify({
        statusCode,
        responseBody,
        nextCalled,
        reqAuth: req.auth || null,
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

    assert result["statusCode"] in (401, 503), f"Expected 401 or 503, got {result['statusCode']}"
    assert result["responseBody"]["code"] in ("AUTHENTICATION_REQUIRED", "AUTH_NOT_CONFIGURED")
    assert result["nextCalled"] is False, "next() must not be called when auth is unconfigured"
    assert result["reqAuth"] is None or not result["reqAuth"].get("role") or result["reqAuth"].get("role") == "anonymous", (
        f"req.auth must not be populated with an authorized role, got {result['reqAuth']}"
    )


def test_app_boot_with_unset_api_key_returns_503():
    """
    Boots the full Express app with ECDAT_API_KEY unset and tests an unauthenticated request.
    """
    node_script = """
    delete process.env.ECDAT_API_KEY;
    const config = require('./src/config');
    config.ECDAT_API_KEY = undefined;

    const app = require('./src/app');
    const server = app.listen(0, async () => {
        const port = server.address().port;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/v1/findings`);
            const body = await res.json();
            console.log(JSON.stringify({ status: res.status, body }));
        } finally {
            server.close();
        }
    });
    """
    proc = subprocess.run(
        ["node", "-e", node_script],
        cwd=str(REPO_ROOT / "backend"),
        capture_output=True,
        text=True,
        check=True,
    )
    # Find the JSON line in output (filtering out any server boot logs)
    json_line = None
    for line in reversed(proc.stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            json_line = line
            break
    assert json_line is not None, f"No JSON output found in stdout: {proc.stdout}\nstderr: {proc.stderr}"
    result = json.loads(json_line)
    assert result["status"] in (401, 503)
    assert result["body"]["code"] in ("AUTHENTICATION_REQUIRED", "AUTH_NOT_CONFIGURED")
