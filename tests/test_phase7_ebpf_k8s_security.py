"""
Phase 7 Regression Test Suite: eBPF, Runtime Security & Kubernetes Hardening.
Verifies P1-05, P1-06, and P1-07 under OWASP ASVS 5.0 and ECDAT specifications:
- P1-05: eBPF kernel observation path truthful declaration (no fake in-kernel verification claims)
- P1-06: eBPF telemetry ingestion route and pipeline connectivity
- P1-07: Kubernetes eBPF least-privilege security context and namespace isolation
"""

import re
import pytest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_p1_05_ebpf_truthful_reporting():
    """P1-05: eBPF runtime collector strictly declares is_live_ebpf_verified=False when kernel probes not attached."""
    from scanners.runtime.ebpf_collector import LinuxEbpfProbeCollector

    collector = LinuxEbpfProbeCollector()
    assert collector.is_live_ebpf_verified is False

    from scanners.runtime.security_boundary import RuntimeSecurityAgent

    agent = RuntimeSecurityAgent()
    status = agent.get_status_report()
    assert status["is_kernel_ebpf_attached"] is False
    assert status["is_live_ebpf_verified"] is False
    assert status["architecture_type"] == "runtime_security_observation_abstraction"


def test_p1_06_ebpf_telemetry_route_defined():
    """P1-06: Backend app and routes implement authenticated /api/v1/telemetry/ebpf ingestion."""
    telemetry_js = REPO_ROOT / "backend" / "src" / "routes" / "telemetry.js"
    assert telemetry_js.exists(), "backend/src/routes/telemetry.js must exist"
    content = telemetry_js.read_text(encoding="utf-8")

    assert "router.post('/ebpf'" in content or 'router.post("/ebpf"' in content
    assert "assertTelemetryMetadataOnly" in content
    assert "is_kernel_ebpf_proven" in content

    app_js = REPO_ROOT / "backend" / "src" / "app.js"
    app_content = app_js.read_text(encoding="utf-8")
    assert "telemetryRoutes" in app_content


def test_p1_07_k8s_ebpf_least_privilege():
    """P1-07: Kubernetes eBPF daemonset enforces least-privilege non-root container configuration."""
    manifest = REPO_ROOT / "deploy" / "k8s" / "09-ebpf-agent-daemonset.yaml"
    assert manifest.exists(), "deploy/k8s/09-ebpf-agent-daemonset.yaml must exist"
    content = manifest.read_text(encoding="utf-8")

    assert "namespace: ecdat-runtime" in content
    assert "privileged: false" in content
    assert "allowPrivilegeEscalation: false" in content
    assert "readOnlyRootFilesystem: true" in content
    assert "runAsNonRoot: true" in content
    assert "- ALL" in content
    assert "- BPF" in content
    assert "- PERFMON" in content


def test_p5b_ebpf_truthfulness_separation():
    """Phase 5B: eBPF collector strictly distinguishes kernel_attachment_verified from algorithm_identification_verified."""
    from scanners.runtime.ebpf_collector import LinuxEbpfProbeCollector

    collector = LinuxEbpfProbeCollector()
    assert collector.kernel_attachment_verified is False
    assert collector.algorithm_identification_verified is False
    assert collector.is_live_ebpf_verified is False
    assert collector.verification_status == "NOT IMPLEMENTED"

    # Simulate genuine kernel attachment without dynamic algorithm inspection
    collector.kernel_attachment_verified = True
    assert collector.algorithm_identification_verified is False
    assert collector.is_live_ebpf_verified is False  # Must NOT be set True as a stand-in for both
    assert collector.verification_status == "KERNEL_ATTACHED_ALGORITHMS_UNVERIFIED"

    status = collector.get_telemetry_status()
    assert status["kernel_attachment_verified"] is True
    assert status["algorithm_identification_verified"] is False
    assert status["is_live_ebpf_verified"] is False
    assert status["verification_status"] == "KERNEL_ATTACHED_ALGORITHMS_UNVERIFIED"

    collector.detach_all_kernel_probes()
    assert collector.kernel_attachment_verified is False
    assert collector.algorithm_identification_verified is False
    assert collector.verification_status == "NOT IMPLEMENTED"

