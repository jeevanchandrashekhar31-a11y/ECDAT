"""
Phase 8 Regression Test Suite: Fabricated-Data Regression & Empty-Database Proof.

Verifies that starting from a genuinely empty database (no assets, no findings, no scans):
1. Dashboard views render null/"UNASSESSED"/"Not assessed"/0 for every metric — never default 100%,
   never fabricated actor names, never invented certificates, never fake domains.
2. Executive report renders null/"NOT_ASSESSED"/0 for every metric — never synthetic canonical
   findings, never hardcoded certificates, never default 100% remediation.
3. Technical drill-down report renders 0 findings, empty list, null/unknown fields — never synthetic
   baseline findings, never invented certificate authorities or serial numbers.
"""

import json
import subprocess
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"


def run_node_eval(script: str) -> dict:
    """Executes a Node.js snippet in the backend directory and returns parsed JSON stdout."""
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Node evaluation failed with exit code {proc.returncode}:\n"
            f"STDOUT:\n{proc.stdout}\n"
            f"STDERR:\n{proc.stderr}"
        )
    return json.loads(proc.stdout.strip())


def test_empty_database_dashboard_truthfulness():
    """Asserts dashboard views render null/unassessed/0 on an empty database with no synthetic data."""
    script = """
    const { getEnterpriseDashboardViews } = require('./src/services/dashboard_views_service');
    const { inMemoryScansStore, cbomIngestionService } = require('./src/services/cbom_ingestion');

    (async () => {
        inMemoryScansStore.clear();
        cbomIngestionService._scans.clear();

        const isolatedTenant = { tenantId: 'tenant-empty-test-' + Date.now(), isPlatformAdmin: false };
        const res = await getEnterpriseDashboardViews({ tenantContext: isolatedTenant });

        const overview = res.views?.executive_overview || {};
        const certs = res.views?.certificates || {};
        const audit = res.views?.audit_trail || {};
        const ownership = res.views?.ownership || {};
        const pqc = res.views?.pqc_readiness || {};
        const runtime = res.views?.runtime_observations || {};

        const output = {
            posture_score: overview.posture_score,
            posture_rating: overview.posture_rating,
            pqc_readiness_pct: overview.pqc_readiness_pct,
            total_assets: overview.total_assets,
            total_findings: overview.total_findings,
            critical_findings: overview.critical_findings,
            kpis: overview.kpis || [],
            pqc_overall_score: pqc.overall_readiness_score,
            total_certificates: certs.total_certificates,
            certificates: certs.certificates || [],
            total_events: audit.total_events,
            events: audit.events || [],
            total_teams: ownership.total_teams,
            teams: ownership.teams || [],
            total_observations: runtime.total_observations,
            observations: runtime.observations || [],
            // Raw string serialization to check for fabricated tokens
            raw_string: JSON.stringify(res)
        };

        console.log(JSON.stringify(output));
        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
    """
    res = run_node_eval(script)

    # Metric truthfulness
    assert res["posture_score"] is None, f"Expected posture_score to be None, got {res['posture_score']}"
    assert res["posture_rating"] == "UNASSESSED", f"Expected UNASSESSED posture_rating, got {res['posture_rating']}"
    assert res["pqc_readiness_pct"] is None, f"Expected pqc_readiness_pct to be None, got {res['pqc_readiness_pct']}"
    assert res["total_assets"] == 0, f"Expected total_assets to be 0, got {res['total_assets']}"
    assert res["total_findings"] == 0, f"Expected total_findings to be 0, got {res['total_findings']}"
    assert res["critical_findings"] == 0, f"Expected critical_findings to be 0, got {res['critical_findings']}"

    # KPI truthfulness
    pqc_kpi = next((k for k in res["kpis"] if k["id"] == "kpi_pqc_readiness"), None)
    assert pqc_kpi is not None, "kpi_pqc_readiness must exist in KPIs"
    assert pqc_kpi["value"] is None, f"PQC readiness KPI value must be None, got {pqc_kpi['value']}"
    assert pqc_kpi["change"] == "Not assessed", f"PQC readiness KPI change must be 'Not assessed', got {pqc_kpi['change']}"

    # Zero certificates & zero observations
    assert res["total_certificates"] == 0
    assert len(res["certificates"]) == 0
    assert res["total_observations"] == 0
    assert len(res["observations"]) == 0

    # Zero synthetic audit events & zero teams
    assert res["total_events"] == 0
    assert len(res["events"]) == 0
    assert res["total_teams"] == 0
    assert len(res["teams"]) == 0

    # No fabricated actors or fake corporate domains
    raw = res["raw_string"]
    assert "sec-ops-runner" not in raw, "Synthetic actor 'sec-ops-runner' must not exist"
    assert "compliance-bot" not in raw, "Synthetic actor 'compliance-bot' must not exist"
    assert "backup-daemon" not in raw, "Synthetic actor 'backup-daemon' must not exist"
    assert "@ecdat.corp" not in raw, "Fake domain '@ecdat.corp' must not exist"
    assert "Scanned Certificate Authority" not in raw, "Fake CA must not exist"


def test_empty_database_executive_report_truthfulness():
    """Asserts executive report renders null/unassessed/0 on an empty database with no fabricated data."""
    script = """
    const { generateExecutiveReport } = require('./src/services/executive_report_service');
    const { inMemoryScansStore, cbomIngestionService } = require('./src/services/cbom_ingestion');

    (async () => {
        inMemoryScansStore.clear();
        cbomIngestionService._scans.clear();

        const isolatedTenant = { tenantId: 'tenant-empty-exec-' + Date.now(), isPlatformAdmin: false };
        let report;
        try {
            report = await generateExecutiveReport({ tenantContext: isolatedTenant });
        } catch (e) {
            console.log(JSON.stringify({ error: e.name, statusCode: e.statusCode, message: e.message }));
            process.exit(0);
        }

        const output = {
            error: null,
            status: report.report_metadata?.status,
            total_crypto_assets: report.total_crypto_assets?.total_count,
            weak_deprecated_assets: report.weak_deprecated_assets?.total_weak_count,
            pqc_total_assessed: report.pqc_readiness?.total_assessed,
            pqc_readiness_score: report.pqc_readiness?.overall_readiness_score,
            mosca_delta_years: report.pqc_readiness?.mosca_calculus?.mosca_delta_years,
            critical_applications: report.critical_applications?.total_critical_applications,
            total_certificates: report.certificates?.total_certificates,
            certificate_details: report.certificates?.certificate_details || [],
            total_violations: report.policy_violations?.total_violations,
            remediation_total_findings: report.remediation_progress?.total_findings,
            remediation_rate_percentage: report.remediation_progress?.remediation_rate_percentage,
            total_owners: report.business_ownership?.total_owners_count,
            trend_direction: report.trend_over_time?.velocity_summary?.direction,
            raw_string: JSON.stringify(report)
        };

        console.log(JSON.stringify(output));
        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
    """
    res = run_node_eval(script)

    assert res.get("error") is None, f"Executive report should render clean empty report on empty database, got error: {res}"

    # Metric truthfulness
    assert res["total_crypto_assets"] == 0, f"Expected 0 crypto assets, got {res['total_crypto_assets']}"
    assert res["weak_deprecated_assets"] == 0, f"Expected 0 weak assets, got {res['weak_deprecated_assets']}"
    assert res["pqc_total_assessed"] == 0, f"Expected 0 pqc assessed, got {res['pqc_total_assessed']}"
    assert res["pqc_readiness_score"] in (None, "NOT_ASSESSED", "not assessed")
    assert res["mosca_delta_years"] is None, f"Expected mosca_delta_years to be None, got {res['mosca_delta_years']}"
    assert res["critical_applications"] == 0, f"Expected 0 critical applications, got {res['critical_applications']}"
    assert res["total_certificates"] == 0, f"Expected 0 certificates, got {res['total_certificates']}"
    assert len(res["certificate_details"]) == 0
    assert res["total_violations"] == 0
    assert res["remediation_total_findings"] == 0
    assert res["remediation_rate_percentage"] in (None, 0), "Remediation rate should not default to 100% on empty DB"
    assert res["total_owners"] == 0
    assert res["trend_direction"] in (None, "UNKNOWN", "NOT_ASSESSED")

    # No synthetic findings or certificates
    raw = res["raw_string"]
    assert "find_rsa_1024_auth" not in raw, "Synthetic finding 'find_rsa_1024_auth' must not be fabricated"
    assert "find_md5_cache" not in raw, "Synthetic finding 'find_md5_cache' must not be fabricated"
    assert "CN=Let's Encrypt Authority X3" not in raw, "Fake certificate 'CN=Let's Encrypt Authority X3' must not be fabricated"
    assert "CN=ECDAT Internal Enterprise Root CA" not in raw, "Fake CA 'CN=ECDAT Internal Enterprise Root CA' must not be fabricated"


def test_empty_database_technical_report_truthfulness():
    """Asserts technical report renders 0 findings/empty list on an empty database with no synthetic items."""
    script = """
    const { generateTechnicalDrillDownReport } = require('./src/services/technical_report_service');
    const { inMemoryScansStore, cbomIngestionService } = require('./src/services/cbom_ingestion');

    (async () => {
        inMemoryScansStore.clear();
        cbomIngestionService._scans.clear();

        const isolatedTenant = { tenantId: 'tenant-empty-tech-' + Date.now(), isPlatformAdmin: false };
        let report;
        try {
            report = await generateTechnicalDrillDownReport({ tenantContext: isolatedTenant });
        } catch (e) {
            console.log(JSON.stringify({ error: e.name, statusCode: e.statusCode, message: e.message }));
            process.exit(0);
        }

        const output = {
            error: null,
            total_findings: report.metadata?.total_findings,
            findings_count: report.findings?.length,
            findings: report.findings || [],
            raw_string: JSON.stringify(report)
        };

        console.log(JSON.stringify(output));
        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
    """
    res = run_node_eval(script)

    assert res.get("error") is None, f"Technical report should render clean empty report on empty database, got error: {res}"

    # Metric truthfulness
    assert res["total_findings"] == 0, f"Expected 0 findings, got {res['total_findings']}"
    assert res["findings_count"] == 0, f"Expected findings list length 0, got {res['findings_count']}"
    assert len(res["findings"]) == 0

    # No synthetic findings or fake certs
    raw = res["raw_string"]
    assert "find_rsa_1024_auth" not in raw, "Synthetic finding 'find_rsa_1024_auth' must not be fabricated"
    assert "find_md5_cache" not in raw, "Synthetic finding 'find_md5_cache' must not be fabricated"
    assert "CANONICAL_BASELINE_FINDINGS" not in raw
    assert "CN=Let's Encrypt Authority X3" not in raw, "Fake certificate 'CN=Let's Encrypt Authority X3' must not be fabricated"
    assert "04:3A:8B:9C:1D:2E:3F" not in raw, "Fake serial number must not be fabricated"
    assert "git@github.com:ecdat-corp/core-banking.git" not in raw, "Fake repo URL must not be fabricated"


def test_empty_scan_truthfulness_no_synthetic_injection():
    """Asserts that when an empty scan (0 findings, 0 assets) is assessed, no synthetic fallback is injected."""
    script = """
    const { getEnterpriseDashboardViews } = require('./src/services/dashboard_views_service');
    const { generateExecutiveReport } = require('./src/services/executive_report_service');
    const { generateTechnicalDrillDownReport } = require('./src/services/technical_report_service');
    const { inMemoryScansStore, cbomIngestionService } = require('./src/services/cbom_ingestion');

    (async () => {
        inMemoryScansStore.clear();
        cbomIngestionService._scans.clear();

        const tenantId = 'tenant-empty-scan-' + Date.now();
        const scanId = 'scan-empty-' + Date.now();
        const emptyScan = {
            id: scanId,
            name: 'Empty Target Scan',
            tenantId: tenantId,
            created_at: new Date().toISOString(),
            classified_findings: [],
            assets: [],
            metrics: {
                total_assets: 0,
                total_findings: 0,
                severity_counts: { critical: 0, high: 0, medium: 0, low: 0 }
            }
        };
        inMemoryScansStore.set(scanId, emptyScan);
        const tenantCtx = { tenantId, isPlatformAdmin: false };

        const dash = await getEnterpriseDashboardViews({ scanId, tenantContext: tenantCtx });
        const exec = await generateExecutiveReport({ scanId, tenantContext: tenantCtx });
        const tech = await generateTechnicalDrillDownReport({ scanId, tenantContext: tenantCtx });

        console.log(JSON.stringify({
            dash_posture_score: dash.views?.executive_overview?.posture_score,
            dash_posture_rating: dash.views?.executive_overview?.posture_rating,
            dash_total_findings: dash.views?.executive_overview?.total_findings,
            exec_total_assets: exec.total_crypto_assets?.total_count,
            exec_total_certs: exec.certificates?.total_certificates,
            tech_total_findings: tech.metadata?.total_findings,
            tech_findings_count: tech.findings?.length,
            raw_exec: JSON.stringify(exec),
            raw_tech: JSON.stringify(tech)
        }));
        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
    """
    res = run_node_eval(script)

    # Dashboard on empty scan
    assert res["dash_posture_score"] is None
    assert res["dash_posture_rating"] == "UNASSESSED"
    assert res["dash_total_findings"] == 0

    # Executive report on empty scan
    assert res["exec_total_assets"] == 0, f"Expected 0 exec crypto assets on empty scan, got {res['exec_total_assets']}"
    assert res["exec_total_certs"] == 0, f"Expected 0 exec certificates on empty scan, got {res['exec_total_certs']}"

    # Technical report on empty scan
    assert res["tech_total_findings"] == 0, f"Expected 0 tech findings on empty scan, got {res['tech_total_findings']}"
    assert res["tech_findings_count"] == 0, f"Expected 0 tech findings list on empty scan, got {res['tech_findings_count']}"

    # Zero synthetic artifacts injected
    for raw in [res["raw_exec"], res["raw_tech"]]:
        assert "find_rsa_1024_auth" not in raw
        assert "find_md5_cache" not in raw
        assert "CN=Let's Encrypt Authority X3" not in raw

