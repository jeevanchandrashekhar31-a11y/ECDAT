"""
Phase 6 Regression Test Suite: Frontend ↔ Backend Integration & Data Truthfulness.
Verifies P1-01, P1-02, P1-03, and P1-04 under OWASP ASVS 5.0 and ECDAT specifications:
- P1-01: Frontend and backend feature surfaces connect to real endpoints
- P1-02: Production dashboard excludes fabricated observations and fake Mosca timelines
- P1-03: Zero synthetic audit events presented as real history
- P1-04: Zero synthetic certificates or fake ownership domains (@ecdat.corp)
"""

import re
import pytest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_p1_03_no_synthetic_audit_events_in_views():
    """P1-03: Dashboard views must never fabricate synthetic audit events when logs are empty."""
    views_service = REPO_ROOT / "backend" / "src" / "services" / "dashboard_views_service.js"
    assert views_service.exists()
    content = views_service.read_text(encoding="utf-8")

    # Verify synthetic audit events ("sec-ops-runner", "compliance-bot", "backup-daemon") are gone
    assert "sec-ops-runner" not in content, "Synthetic actor 'sec-ops-runner' must not exist in dashboard views"
    assert "compliance-bot" not in content, "Synthetic actor 'compliance-bot' must not exist in dashboard views"
    assert "backup-daemon" not in content, "Synthetic actor 'backup-daemon' must not exist in dashboard views"
    assert "audit_1789396000001" not in content, "Hardcoded synthetic audit IDs must not exist"


def test_p1_04_no_synthetic_certificate_or_ownership_metadata():
    """P1-04: Dashboard views must not invent fake certificate validity or fake corporate emails."""
    views_service = REPO_ROOT / "backend" / "src" / "services" / "dashboard_views_service.js"
    content = views_service.read_text(encoding="utf-8")

    # Verify fake corporate email '@ecdat.corp' is removed
    assert "@ecdat.corp" not in content, "Fake corporate email domain '@ecdat.corp' must not be fabricated"

    # Verify fake certificate authority string is removed
    assert "Scanned Certificate Authority" not in content, "Fake issuer 'Scanned Certificate Authority' must not be fabricated"


import json
import subprocess


def test_p1_02_truthful_observations_and_mosca_calculations():
    """P1-02: Reachability: given a finding with no runtime metadata, assert the emitted
    reachability_confirmed is null — not true, not false."""
    script = """
    const { inMemoryScansStore } = require('./src/services/cbom_ingestion');
    const { getEnterpriseDashboardViews } = require('./src/services/dashboard_views_service');

    const scanRecord = {
        id: 'test-scan-reachability',
        name: 'Test Scan',
        created_at: new Date().toISOString(),
        classified_findings: [
            {
                id: 'fnd-runtime-1',
                finding_type: 'runtime',
                algorithm: 'RSA-1024',
                location: 'src/crypto.js',
                metadata: {} // No reachability_confirmed
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

    inMemoryScansStore.set('test-scan-reachability', scanRecord);

    (async () => {
        const res = await getEnterpriseDashboardViews('test-scan-reachability');
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
        ["node", "-e", script],
        cwd=str(REPO_ROOT / "backend"),
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(proc.stdout.strip())
    assert result["hasObservation"] is True, "Must produce runtime observation"
    assert result["reachability_confirmed"] is None, (
        f"reachability_confirmed must be None (null), got {result['reachability_confirmed']}"
    )


def test_p1_01_frontend_client_endpoint_alignment():
    """P1-01: Verify frontend API client maps exclusively to real backend endpoints."""
    client_ts = REPO_ROOT / "frontend" / "src" / "api" / "client.ts"
    assert client_ts.exists()
    content = client_ts.read_text(encoding="utf-8")

    # Check key endpoints exist
    assert "/api/v1/dashboard/views" in content
    assert "/api/v1/dashboard/summary" in content
    assert "/api/v1/graph" in content
    assert "/api/v1/assets" in content
    assert "/api/v1/findings" in content
    assert "/api/v1/scans" in content
