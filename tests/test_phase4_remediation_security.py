import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_remediation_route_prevents_actor_role_spoofing():
    """Actor-role spoofing: issue a request carrying header X-Actor-Role: admin as a non-admin
    authenticated user, assert the approval is REJECTED and that the recorded actor role is the server-derived one, not 'admin'."""
    script = """
    const express = require('express');
    const config = require('./src/config');
    config.ECDAT_API_KEY = 'test-remediation-key-123';
    const { apiKeyAuthMiddleware } = require('./src/middleware/auth');
    const { defaultTokenService } = require('./src/identity/token_service');
    const { getDefaultApprovalEngine } = require('./src/remediation/approval_workflow');
    const remediationRouter = require('./src/routes/remediation');

    const app = express();
    app.use(express.json());
    app.use(apiKeyAuthMiddleware);
    app.use('/api/v1/remediation', remediationRouter);

    // Create a proposal in REVIEWED state ready for approval
    const engine = getDefaultApprovalEngine();
    const proposal = engine.proposeRemediation({ title: 'Test Migration' }, { username: 'dev1', role: 'developer' });
    engine.reviewRemediation(proposal.approval_id, { username: 'reviewer1', role: 'reviewer' });

    // Generate non-admin user token (developer)
    const pair = defaultTokenService.issueTokenPair({ userId: 'attacker_user', roles: ['developer'] });
    const token = pair.accessToken;

    const server = app.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        try {
            // Issue request carrying header X-Actor-Role: admin as a non-admin authenticated user
            const resp = await fetch(`http://127.0.0.1:${port}/api/v1/remediation/approvals/${proposal.approval_id}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Actor-Role': 'admin'
                },
                body: JSON.stringify({ comments: 'Attempted spoofed approval' })
            });
            const status = resp.status;
            const data = await resp.json().catch(() => ({}));

            // Check the approval state in the engine: must NOT be APPROVED
            const currentRecord = engine.getApproval(proposal.approval_id);
            server.close();

            console.log(JSON.stringify({
                status,
                data,
                recordState: currentRecord.state,
                approverRole: currentRecord.approver ? currentRecord.approver.role : null
            }));
            process.exit(0);
        } catch (err) {
            server.close();
            console.error(err);
            process.exit(1);
        }
    });
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT / "backend"),
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout.strip())
    assert result["status"] in (403, 401), f"Expected 403 or 401, got {result['status']}"
    assert result["recordState"] != "APPROVED", "Remediation must not be approved via spoofed header"
    assert result["approverRole"] != "admin", "Recorded approver role must not be spoofed admin"


def test_remediation_verification_fails_closed():
    """Validates that verify endpoint requires explicit verification_results without defaulting to success."""
    remediation_js = REPO_ROOT / "backend" / "src" / "routes" / "remediation.js"
    workflow_js = REPO_ROOT / "backend" / "src" / "remediation" / "approval_workflow.js"

    rem_content = remediation_js.read_text(encoding="utf-8")
    assert "|| { tests_passed: true, finding_resolved: true }" not in rem_content, (
        "remediation.js must not default verification_results to success"
    )
    assert "MISSING_VERIFICATION_RESULTS" in rem_content, (
        "remediation.js must fail closed when verification_results are missing"
    )

    wf_content = workflow_js.read_text(encoding="utf-8")
    assert "verificationResults = { tests_passed: true, finding_resolved: true }" not in wf_content, (
        "approval_workflow.js must not default verificationResults to success"
    )


def test_remediation_path_confinement():
    """Validates that remediation.js enforces validateRemediationPath confinement."""
    remediation_js = REPO_ROOT / "backend" / "src" / "routes" / "remediation.js"
    content = remediation_js.read_text(encoding="utf-8")

    assert "function validateRemediationPath(" in content, (
        "remediation.js must define validateRemediationPath function"
    )
    assert "PATH_CONFINEMENT_VIOLATION" in content, (
        "remediation.js must reject unconfined paths with PATH_CONFINEMENT_VIOLATION"
    )
    assert "validateRemediationPath(filePath)" in content, (
        "remediation.js must validate filePath in patch application"
    )
