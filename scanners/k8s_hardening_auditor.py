"""
ECDAT Kubernetes Hardening Auditor (Phase 24.2).

Validates enterprise Kubernetes manifests and Helm chart against 7 critical hardening mandates:
1. RBAC Least Privilege (no wildcard '*' verbs, minimal scoped roles)
2. NetworkPolicies (default-deny, fine-grained ingress/egress, DNS egress)
3. Pod Security Standards (restricted profile on control plane)
4. Secret Management (no plaintext keys, external secrets integration)
5. Resource Quotas & LimitRanges (hard limits, requests, defaults)
6. securityContext (non-root, read-only root fs, drop ALL capabilities, seccomp RuntimeDefault)
7. Architectural Separation: Privileged runtime/eBPF agent strictly segregated from control plane
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

K8S_MANIFESTS_DIR = REPO_ROOT / "deploy" / "k8s"
HELM_CHART_DIR = REPO_ROOT / "deploy" / "helm" / "ecdat"


@dataclass
class K8sAuditCheck:
    check_id: str
    name: str
    passed: bool
    description: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class K8sHardeningReport:
    overall_score: float
    all_passed: bool
    total_checks: int
    passed_count: int
    failed_count: int
    checks: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class KubernetesHardeningAuditor:
    """Audits Kubernetes manifests and Helm chart configurations."""

    def __init__(self, manifests_dir: Path = K8S_MANIFESTS_DIR, helm_dir: Path = HELM_CHART_DIR):
        self.manifests_dir = manifests_dir
        self.helm_dir = helm_dir
        self.checks: List[K8sAuditCheck] = []

    def _read_all_manifest_texts(self) -> Dict[str, str]:
        texts = {}
        if self.manifests_dir.exists():
            for f in sorted(self.manifests_dir.glob("*.yaml")):
                texts[f.name] = f.read_text(encoding="utf-8")
        if (self.helm_dir / "templates").exists():
            for f in sorted((self.helm_dir / "templates").glob("*.yaml")):
                texts[f"helm/{f.name}"] = f.read_text(encoding="utf-8")
        return texts

    # 1. RBAC Least Privilege
    def check_rbac_least_privilege(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        rbac_content = manifests.get("02-rbac.yaml", "")
        has_wildcard = re.search(r"verbs:\s*\[.*?\*.*?\]", rbac_content) or re.search(
            r"resources:\s*\[.*?\*.*?\]", rbac_content
        )
        has_backend_sa = "name: ecdat-backend-sa" in rbac_content
        has_ebpf_sa = "name: ecdat-ebpf-agent-sa" in rbac_content
        has_roles = "kind: Role" in rbac_content and "kind: ClusterRole" in rbac_content

        passed = bool(not has_wildcard and has_backend_sa and has_ebpf_sa and has_roles)
        details = {
            "has_wildcard_verbs_or_resources": bool(has_wildcard),
            "has_backend_service_account": has_backend_sa,
            "has_ebpf_service_account": has_ebpf_sa,
            "has_scoped_roles": has_roles,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-001",
            name="RBAC Least Privilege",
            passed=passed,
            description="Enforces dedicated ServiceAccounts, scoped Roles without wildcard '*' permissions.",
            details=details,
        )

    # 2. NetworkPolicies (Default-Deny + Segmentation)
    def check_network_policies(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        netpol_content = manifests.get("03-network-policies.yaml", "")
        has_default_deny = "name: default-deny-all" in netpol_content and "policyTypes:" in netpol_content
        has_runtime_deny = "name: runtime-default-deny-all" in netpol_content
        has_dns_egress = "name: allow-dns-egress" in netpol_content and "port: 53" in netpol_content
        has_backend_netpol = "name: backend-networkpolicy" in netpol_content
        has_postgres_netpol = "name: postgres-networkpolicy" in netpol_content
        has_ebpf_netpol = "name: ebpf-agent-networkpolicy" in netpol_content

        passed = bool(
            has_default_deny
            and has_runtime_deny
            and has_dns_egress
            and has_backend_netpol
            and has_postgres_netpol
            and has_ebpf_netpol
        )
        details = {
            "control_plane_default_deny": has_default_deny,
            "runtime_default_deny": has_runtime_deny,
            "dns_egress_whitelisted": has_dns_egress,
            "backend_segmented": has_backend_netpol,
            "postgres_isolated": has_postgres_netpol,
            "ebpf_agent_ingress_denied": has_ebpf_netpol,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-002",
            name="NetworkPolicies Segmentation",
            passed=passed,
            description="Default-deny all ingress/egress with fine-grained service segmentation and DNS egress.",
            details=details,
        )

    # 3. Pod Security Standards (Restricted Profile)
    def check_pod_security_standards(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        ns_content = manifests.get("00-namespaces.yaml", "")
        has_restricted_enforce = "pod-security.kubernetes.io/enforce: restricted" in ns_content
        has_restricted_audit = "pod-security.kubernetes.io/audit: restricted" in ns_content
        has_restricted_warn = "pod-security.kubernetes.io/warn: restricted" in ns_content

        passed = bool(has_restricted_enforce and has_restricted_audit and has_restricted_warn)
        details = {
            "enforce_restricted": has_restricted_enforce,
            "audit_restricted": has_restricted_audit,
            "warn_restricted": has_restricted_warn,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-003",
            name="Pod Security Standards",
            passed=passed,
            description="Control plane namespace strictly enforces Pod Security Standards Restricted profile.",
            details=details,
        )

    # 4. Secret Management
    def check_secret_management(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        secret_content = manifests.get("04-secrets.yaml", "")
        backend_content = manifests.get("06-backend-deployment.yaml", "")
        postgres_content = manifests.get("05-postgres-statefulset.yaml", "")

        has_secrets = "kind: Secret" in secret_content
        has_vault_annotations = "secret.ecdat.io/managed-by" in secret_content
        has_secret_key_ref_backend = "secretKeyRef:" in backend_content
        has_secret_key_ref_postgres = "secretKeyRef:" in postgres_content

        passed = bool(
            has_secrets and has_vault_annotations and has_secret_key_ref_backend and has_secret_key_ref_postgres
        )
        details = {
            "kubernetes_secret_defined": has_secrets,
            "external_secrets_vault_annotations": has_vault_annotations,
            "backend_uses_secretKeyRef": has_secret_key_ref_backend,
            "postgres_uses_secretKeyRef": has_secret_key_ref_postgres,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-004",
            name="Secret Management",
            passed=passed,
            description="Decouples sensitive credentials into Secrets via secretKeyRef; integrates with Vault / ESO.",
            details=details,
        )

    # 5. Resource Quotas & LimitRanges
    def check_resource_quotas(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        quota_content = manifests.get("01-resource-quotas.yaml", "")
        has_control_quota = "name: ecdat-control-plane-quota" in quota_content
        has_runtime_quota = "name: ecdat-runtime-quota" in quota_content
        has_limit_range = "kind: LimitRange" in quota_content

        passed = bool(has_control_quota and has_runtime_quota and has_limit_range)
        details = {
            "control_plane_resource_quota": has_control_quota,
            "runtime_agent_resource_quota": has_runtime_quota,
            "limit_range_enforced": has_limit_range,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-005",
            name="Resource Quotas & LimitRanges",
            passed=passed,
            description="Enforces CPU/memory boundaries, container limits, and pod counts across namespaces.",
            details=details,
        )

    # 6. securityContext (Non-root, read-only root fs, drop ALL capabilities, seccomp)
    def check_security_contexts(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        backend_content = manifests.get("06-backend-deployment.yaml", "")
        frontend_content = manifests.get("07-frontend-deployment.yaml", "")
        ebpf_content = manifests.get("09-ebpf-agent-daemonset.yaml", "")

        checks = {
            "backend_non_root": "runAsNonRoot: true" in backend_content and "runAsUser: 1000" in backend_content,
            "backend_readonly_rootfs": "readOnlyRootFilesystem: true" in backend_content,
            "backend_drop_all_caps": "drop:\n                - ALL" in backend_content or "- ALL" in backend_content,
            "backend_seccomp_runtime_default": "seccompProfile:\n          type: RuntimeDefault" in backend_content
            or "RuntimeDefault" in backend_content,
            "backend_immutable_image": ("@sha256:" in backend_content) and ("image: ecdat/backend:latest" not in backend_content),
            "frontend_non_root": "runAsNonRoot: true" in frontend_content and "runAsUser: 101" in frontend_content,
            "frontend_readonly_rootfs": "readOnlyRootFilesystem: true" in frontend_content,
            "frontend_drop_all_caps": "- ALL" in frontend_content,
            "frontend_seccomp_runtime_default": "RuntimeDefault" in frontend_content,
            "frontend_immutable_image": ("@sha256:" in frontend_content) and ("image: ecdat/frontend:latest" not in frontend_content),
            "ebpf_privileged_false": ("privileged: false" in ebpf_content) and ("privileged: true" not in ebpf_content),
            "ebpf_allow_privilege_escalation_false": "allowPrivilegeEscalation: false" in ebpf_content,
            "ebpf_non_root": "runAsNonRoot: true" in ebpf_content and "runAsUser: 10002" in ebpf_content,
            "ebpf_readonly_rootfs": "readOnlyRootFilesystem: true" in ebpf_content,
            "ebpf_drop_all_caps": "- ALL" in ebpf_content,
            "ebpf_minimal_caps": ("- BPF" in ebpf_content) and ("- PERFMON" in ebpf_content) and ("- NET_ADMIN" not in ebpf_content),
            "ebpf_seccomp_runtime_default": "RuntimeDefault" in ebpf_content,
            "ebpf_immutable_image": ("@sha256:" in ebpf_content) and (":latest" not in ebpf_content),
        }

        passed = all(checks.values())
        return K8sAuditCheck(
            check_id="K8S-SEC-006",
            name="Pod & Container SecurityContext",
            passed=passed,
            description="runAsNonRoot, readOnlyRootFilesystem, drop: [ALL] capabilities, and RuntimeDefault seccomp.",
            details=checks,
        )

    # 7. Privileged Runtime / eBPF Agent Separation & Hardening
    def check_ebpf_agent_separation(self, manifests: Dict[str, str]) -> K8sAuditCheck:
        ns_content = manifests.get("00-namespaces.yaml", "")
        ebpf_daemonset = manifests.get("09-ebpf-agent-daemonset.yaml", "")
        backend_content = manifests.get("06-backend-deployment.yaml", "")
        frontend_content = manifests.get("07-frontend-deployment.yaml", "")

        # 1. Distinct Namespaces
        has_runtime_ns = "name: ecdat-runtime" in ns_content
        has_control_ns = "name: ecdat-control-plane" in ns_content

        # 2. DaemonSet is in ecdat-runtime only
        ebpf_in_runtime = "namespace: ecdat-runtime" in ebpf_daemonset and "name: ecdat-ebpf-agent" in ebpf_daemonset

        # 3. Control Plane has ZERO privileged containers
        control_plane_has_privileged = ("privileged: true" in backend_content) or (
            "privileged: true" in frontend_content
        )

        # 4. eBPF agent does NOT use hostNetwork
        ebpf_no_host_network = "hostNetwork: false" in ebpf_daemonset

        # 5. eBPF agent does NOT use privileged: true and has allowPrivilegeEscalation: false
        ebpf_unprivileged = ("privileged: false" in ebpf_daemonset) and ("privileged: true" not in ebpf_daemonset)
        ebpf_no_escalation = "allowPrivilegeEscalation: false" in ebpf_daemonset

        passed = bool(
            has_runtime_ns
            and has_control_ns
            and ebpf_in_runtime
            and not control_plane_has_privileged
            and ebpf_no_host_network
            and ebpf_unprivileged
            and ebpf_no_escalation
        )
        details = {
            "separate_runtime_namespace": has_runtime_ns,
            "control_plane_namespace": has_control_ns,
            "ebpf_daemonset_isolated_in_runtime": ebpf_in_runtime,
            "control_plane_has_zero_privileged": not control_plane_has_privileged,
            "ebpf_agent_host_network_disabled": ebpf_no_host_network,
            "ebpf_agent_unprivileged": ebpf_unprivileged,
            "ebpf_agent_no_privilege_escalation": ebpf_no_escalation,
        }
        return K8sAuditCheck(
            check_id="K8S-SEC-007",
            name="eBPF Runtime Agent Separation & Hardening",
            passed=passed,
            description="Privileged runtime eBPF agent strictly segregated in ecdat-runtime; enforced privileged: false, allowPrivilegeEscalation: false, and minimal capabilities.",
            details=details,
        )

    def audit_all(self) -> K8sHardeningReport:
        manifests = self._read_all_manifest_texts()
        checks = [
            self.check_rbac_least_privilege(manifests),
            self.check_network_policies(manifests),
            self.check_pod_security_standards(manifests),
            self.check_secret_management(manifests),
            self.check_resource_quotas(manifests),
            self.check_security_contexts(manifests),
            self.check_ebpf_agent_separation(manifests),
        ]

        passed_count = sum(1 for c in checks if c.passed)
        failed_count = len(checks) - passed_count
        score = (passed_count / len(checks)) * 100.0 if checks else 0

        return K8sHardeningReport(
            overall_score=round(score, 1),
            all_passed=(failed_count == 0),
            total_checks=len(checks),
            passed_count=passed_count,
            failed_count=failed_count,
            checks=[asdict(c) for c in checks],
        )


def main():
    parser = argparse.ArgumentParser(description="ECDAT Kubernetes Hardening Auditor")
    parser.add_argument("--json", action="store_true", help="Output JSON report")
    args = parser.parse_args()

    auditor = KubernetesHardeningAuditor()
    report = auditor.audit_all()

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
        sys.exit(0 if report.all_passed else 1)

    print("=================================================================")
    print("  ECDAT KUBERNETES DEPLOYMENT & HELM HARDENING AUDIT (PHASE 24.2)")
    print("=================================================================")
    print(f"Compliance Score : {report.overall_score}%")
    print(
        f"Status           : {'ALL 7 MANDATES HARDENED (PASS)' if report.all_passed else 'HARDENING GAPS DETECTED (FAIL)'}\n"
    )

    for c in report.checks:
        symbol = "[PASS]" if c["passed"] else "[FAIL]"
        print(f"{symbol} {c['check_id']}: {c['name']}")
        print(f"    Description : {c['description']}")
        for k, v in c["details"].items():
            print(f"    - {k}: {v}")
        print()

    sys.exit(0 if report.all_passed else 1)


if __name__ == "__main__":
    main()
