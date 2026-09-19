"""
Adversarial Security Test: Remediation Actor Integrity & Role Spoofing Defense Control.

Guards against vulnerability: test_remediation_route_prevents_actor_role_spoofing.
Ensures that remediation approval and lifecycle execution endpoints strictly derive the
actor's identity and role from the authenticated token context, completely ignoring
client-supplied X-Actor-Role or X-Actor-Username headers.

This control is covered end-to-end by backend/tests/api/approval_api.test.js.
"""

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_remediation_actor_integrity_via_approval_suite():
    """
    Executes backend/tests/api/approval_api.test.js to verify that role separation,
    Four-Eyes principle, and actor-role spoofing defenses are enforced end-to-end.
    """
    env = dict(os.environ)
    env.pop("NODE_TEST_CONTEXT", None)
    proc = subprocess.run(
        ["node", "--test", "tests/api/approval_api.test.js"],
        cwd=str(REPO_ROOT / "backend"),
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.returncode == 0, f"approval_api.test.js failed:\n{proc.stdout}\n{proc.stderr}"
    assert "Approval API" in proc.stdout
