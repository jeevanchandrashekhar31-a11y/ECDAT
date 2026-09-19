"""
Adversarial Security Test: Runtime Reachability Truthfulness Control.

Guards against vulnerability: test_p1_02_truthful_observations_and_mosca_calculations.
Ensures that given a finding with no runtime observation metadata, the dashboard views service
faithfully reports reachability_confirmed as null (unverified), never defaulting to true or false.
"""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_reachability_confirmed_is_null_when_unobserved():
    """
    Given a finding with no runtime metadata, calls getEnterpriseDashboardViews and asserts
    that reachability_confirmed is null (None in Python), not True or False.
    """
    node_script = """
    const { inMemoryScansStore } = require('./backend/src/services/cbom_ingestion');
    const { getEnterpriseDashboardViews } = require('./backend/src/services/dashboard_views_service');

    const scanRecord = {
        id: 'test-scan-reachability-control',
        name: 'Test Scan Control',
        created_at: new Date().toISOString(),
        classified_findings: [
            {
                id: 'fnd-runtime-ctrl-1',
                finding_type: 'runtime',
                algorithm: 'RSA-1024',
                location: 'src/crypto.js',
                metadata: {}, // No reachability_confirmed
            }
        ],
        assets: [
            { id: 'asset-1', name: 'core-crypto' }
        ],
        metrics: {
            total_assets: 1,
            total_findings: 1,
            severity_counts: { critical: 0, high: 0, medium: 0, low: 0 }
        }
    };

    inMemoryScansStore.set('test-scan-reachability-control', scanRecord);

    (async () => {
        const res = await getEnterpriseDashboardViews('test-scan-reachability-control');
        const runtimeView = res.views.runtime_observations;
        const observation = runtimeView && runtimeView.observations ? runtimeView.observations[0] : null;
        console.log(JSON.stringify({
            hasObservation: Boolean(observation),
            reachability_confirmed: observation ? observation.reachability_confirmed : undefined
        }));
        process.exit(0);
    })();
    """
    proc = subprocess.run(
        ["node", "-e", node_script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    # Find the JSON line in output
    json_line = None
    for line in reversed(proc.stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            json_line = line
            break
    assert json_line is not None, f"No JSON output found in stdout: {proc.stdout}\nstderr: {proc.stderr}"
    result = json.loads(json_line)
    assert result["hasObservation"] is True, "Must produce runtime observation"
    assert result["reachability_confirmed"] is None, (
        f"reachability_confirmed must be None (null), got {result['reachability_confirmed']}"
    )
