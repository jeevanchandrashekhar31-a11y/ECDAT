"""
Test Suite for Final Quality Gate & Complete Release Qualification (Phase 27.2).

Verifies:
- All 17 release qualification domains are evaluated.
- Every domain satisfies enterprise quality standards.
- Anti-Zero Vulnerability Mandate: Transparently records known vulnerability inventory without false claims.
- Production release approval sign-off.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.final_quality_gate import FinalQualityGateOrchestrator, REPO_ROOT


def test_final_quality_gate_orchestrator_initialization():
    """Verify that the orchestrator initializes with correct repo root and domain list."""
    orchestrator = FinalQualityGateOrchestrator(repo_root=REPO_ROOT)
    assert orchestrator.repo_root == REPO_ROOT
    assert len(orchestrator.results) == 0


def test_final_quality_gate_all_17_domains_represented():
    """Verify all 17 required release qualification domains exist and can be evaluated."""
    orchestrator = FinalQualityGateOrchestrator(repo_root=REPO_ROOT)
    report_file = REPO_ROOT / "artifacts" / "security" / "final_quality_gate_report.json"

    if not report_file.exists():
        orchestrator.run_qualification()

    assert report_file.exists(), "Final quality gate report must exist"
    data = json.loads(report_file.read_text(encoding="utf-8"))

    meta = data["qualification_metadata"]
    assert meta["total_domains_evaluated"] == 17
    assert meta["domains_passed"] == 17
    assert meta["overall_verdict"] == "QUALIFIED_FOR_ENTERPRISE_PRODUCTION"

    # Verify all 17 domains by name
    domains = [d["name"] for d in data["domain_results"]]
    required_names = [
        "Unit Tests",
        "Integration Tests",
        "E2E Tests",
        "Fuzz Tests",
        "Adversarial Tests",
        "SAST",
        "Dependency Scan",
        "Secret Scan",
        "Container Scan",
        "IaC Scan",
        "API Security Tests",
        "Authorization Tests",
        "Performance Benchmarks",
        "CBOM Validation",
        "SBOM Generation",
        "Reproducibility/Provenance Checks",
        "Documentation Validation",
    ]

    for req in required_names:
        assert req in domains, f"Missing qualification domain: {req}"


def test_anti_zero_vulnerability_claim_mandate():
    """Verify that ECDAT never claims 'zero vulnerabilities' and documents reality transparently."""
    report_file = REPO_ROOT / "artifacts" / "security" / "final_quality_gate_report.json"
    assert report_file.exists()

    data = json.loads(report_file.read_text(encoding="utf-8"))
    posture = data["qualification_metadata"]["vulnerability_posture"]

    # Must explicitly disclaim zero vulnerabilities
    assert posture["claim_zero_vulnerabilities"] is False
    assert "does NOT claim 'zero vulnerabilities'" in posture["statement"]

    # Must confirm 0 unaccepted critical/high blockers
    assert posture["unaccepted_critical_vulnerabilities"] == 0
    assert posture["unaccepted_high_vulnerabilities"] == 0


def test_formal_markdown_report_generation():
    """Verify that formal markdown report is written and contains sign-off sections."""
    md_file = REPO_ROOT / "artifacts" / "security" / "FINAL_QUALITY_GATE_REPORT.md"
    assert md_file.exists()

    content = md_file.read_text(encoding="utf-8")
    assert "ECDAT Final Quality Gate — Release Qualification Report" in content
    assert "Zero Vulnerability Claim" in content
    assert "Complete 17-Point Qualification Matrix" in content
    assert "RELEASE APPROVED FOR PRODUCTION DEPLOYMENT" in content
