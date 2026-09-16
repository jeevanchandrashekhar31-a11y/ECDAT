"""
Unit & Integration Tests for Phase 24.2: Kubernetes Hardening.

Validates:
- RBAC least privilege (no wildcard '*' verbs/resources)
- NetworkPolicies (default-deny, fine-grained ingress/egress, DNS egress)
- Pod Security standards (restricted on control plane)
- Secret management (no plaintext passwords, Vault / ESO annotations)
- Resource quotas & LimitRanges
- securityContext (runAsNonRoot, readOnlyRootFilesystem, drop: [ALL], seccomp RuntimeDefault)
- Architectural separation of privileged runtime/eBPF agent from control plane
- Helm chart integrity and template coverage
"""

from pathlib import Path
import pytest

from scanners.k8s_hardening_auditor import (
    KubernetesHardeningAuditor,
    K8S_MANIFESTS_DIR,
    HELM_CHART_DIR,
)


@pytest.fixture
def auditor():
    return KubernetesHardeningAuditor(
        manifests_dir=K8S_MANIFESTS_DIR,
        helm_dir=HELM_CHART_DIR,
    )


def test_rbac_least_privilege_no_wildcards(auditor):
    """RBAC manifests must have dedicated ServiceAccounts and zero wildcard '*' permissions."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_rbac_least_privilege(manifests)
    assert check.passed is True
    assert check.details["has_wildcard_verbs_or_resources"] is False
    assert check.details["has_backend_service_account"] is True
    assert check.details["has_ebpf_service_account"] is True


def test_network_policies_segmentation(auditor):
    """NetworkPolicies must enforce default-deny and fine-grained segmentation."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_network_policies(manifests)
    assert check.passed is True
    assert check.details["control_plane_default_deny"] is True
    assert check.details["runtime_default_deny"] is True
    assert check.details["dns_egress_whitelisted"] is True
    assert check.details["backend_segmented"] is True
    assert check.details["postgres_isolated"] is True
    assert check.details["ebpf_agent_ingress_denied"] is True


def test_pod_security_standards_restricted(auditor):
    """Control plane namespace must enforce restricted Pod Security Standards."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_pod_security_standards(manifests)
    assert check.passed is True
    assert check.details["enforce_restricted"] is True
    assert check.details["audit_restricted"] is True
    assert check.details["warn_restricted"] is True


def test_secret_management(auditor):
    """Secrets must decouple credentials and support Vault / ESO rotation."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_secret_management(manifests)
    assert check.passed is True
    assert check.details["kubernetes_secret_defined"] is True
    assert check.details["external_secrets_vault_annotations"] is True
    assert check.details["backend_uses_secretKeyRef"] is True
    assert check.details["postgres_uses_secretKeyRef"] is True


def test_resource_quotas_and_limits(auditor):
    """Namespaces must have ResourceQuotas and LimitRanges enforced."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_resource_quotas(manifests)
    assert check.passed is True
    assert check.details["control_plane_resource_quota"] is True
    assert check.details["runtime_agent_resource_quota"] is True
    assert check.details["limit_range_enforced"] is True


def test_security_context_and_readonly_fs(auditor):
    """Workloads must enforce non-root, readOnlyRootFilesystem, and dropped capabilities."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_security_contexts(manifests)
    assert check.passed is True
    assert check.details["backend_non_root"] is True
    assert check.details["backend_readonly_rootfs"] is True
    assert check.details["backend_drop_all_caps"] is True
    assert check.details["frontend_non_root"] is True
    assert check.details["frontend_readonly_rootfs"] is True
    assert check.details["frontend_drop_all_caps"] is True


def test_ebpf_agent_architectural_separation(auditor):
    """Privileged runtime eBPF agent must be strictly isolated from control plane."""
    manifests = auditor._read_all_manifest_texts()
    check = auditor.check_ebpf_agent_separation(manifests)
    assert check.passed is True
    assert check.details["separate_runtime_namespace"] is True
    assert check.details["control_plane_namespace"] is True
    assert check.details["ebpf_daemonset_isolated_in_runtime"] is True
    assert check.details["control_plane_has_zero_privileged"] is True
    assert check.details["ebpf_agent_host_network_disabled"] is True


def test_helm_chart_templates_exist():
    """Helm chart directory must contain Chart.yaml, values.yaml, and all templates."""
    assert HELM_CHART_DIR.exists()
    assert (HELM_CHART_DIR / "Chart.yaml").exists()
    assert (HELM_CHART_DIR / "values.yaml").exists()
    templates = list((HELM_CHART_DIR / "templates").glob("*.yaml"))
    assert len(templates) >= 8


def test_overall_k8s_hardening_compliance(auditor):
    """Overall Kubernetes hardening audit must achieve 100% compliance across all 7 mandates."""
    report = auditor.audit_all()
    assert report.overall_score == 100.0
    assert report.all_passed is True
    assert report.failed_count == 0
    assert report.passed_count == 7
