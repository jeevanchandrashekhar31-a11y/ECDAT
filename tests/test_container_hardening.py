"""
Unit & Integration Tests for Phase 24.1: Container Hardening.

Validates the 10 production hardening requirements:
1. minimal base images
2. non-root users
3. read-only filesystem where possible
4. dropped Linux capabilities
5. seccomp profile
6. AppArmor/SELinux / no-new-privileges
7. resource limits
8. health checks
9. no privileged mode
10. no host networking
"""

import json
from pathlib import Path
import pytest

from scanners.container_hardening_auditor import (
    ContainerHardeningAuditor,
    REPO_ROOT,
)


@pytest.fixture
def auditor():
    return ContainerHardeningAuditor(repo_root=REPO_ROOT)


def test_dockerfile_minimal_base_and_pinned_digest(auditor):
    """All production Dockerfiles must use minimal base images with immutable @sha256 digests."""
    targets = [
        REPO_ROOT / "backend" / "Dockerfile",
        REPO_ROOT / "frontend" / "Dockerfile",
        REPO_ROOT / "docker" / "scanner.Dockerfile",
    ]
    for target in targets:
        assert target.exists()
        res = auditor.audit_dockerfile(target)
        assert "minimal_base_images" in res.passed_rules
        assert res.score == 100.0


def test_dockerfile_non_root_user(auditor):
    """All production Dockerfiles must declare a non-root USER instruction."""
    backend_res = auditor.audit_dockerfile(REPO_ROOT / "backend" / "Dockerfile")
    assert "non_root_users" in backend_res.passed_rules
    assert "USER node" in backend_res.details["non_root_users"]

    frontend_res = auditor.audit_dockerfile(REPO_ROOT / "frontend" / "Dockerfile")
    assert "non_root_users" in frontend_res.passed_rules
    assert "USER nginx" in frontend_res.details["non_root_users"]

    scanner_res = auditor.audit_dockerfile(REPO_ROOT / "docker" / "scanner.Dockerfile")
    assert "non_root_users" in scanner_res.passed_rules
    assert "USER ecdat" in scanner_res.details["non_root_users"]


def test_dockerfile_healthchecks(auditor):
    """All production Dockerfiles must declare an explicit HEALTHCHECK."""
    for df in [
        REPO_ROOT / "backend" / "Dockerfile",
        REPO_ROOT / "frontend" / "Dockerfile",
        REPO_ROOT / "docker" / "scanner.Dockerfile",
    ]:
        res = auditor.audit_dockerfile(df)
        assert "health_checks" in res.passed_rules


def test_compose_read_only_and_capabilities(auditor):
    """docker-compose.yml must enforce read_only: true and cap_drop: [ALL]."""
    compose_path = REPO_ROOT / "docker-compose.yml"
    assert compose_path.exists()
    res = auditor.audit_compose(compose_path)

    assert "read_only_filesystem" in res.passed_rules
    assert "dropped_capabilities" in res.passed_rules
    assert "non_root_users" in res.passed_rules
    assert "seccomp_profile" in res.passed_rules
    assert "apparmor_selinux" in res.passed_rules
    assert "resource_limits" in res.passed_rules
    assert "health_checks" in res.passed_rules
    assert "no_privileged_mode" in res.passed_rules
    assert "no_host_networking" in res.passed_rules
    assert res.score == 100.0


def test_seccomp_and_apparmor_profiles_exist():
    """Hardened seccomp profile JSON and AppArmor profiles must exist and be syntactically valid."""
    seccomp_file = REPO_ROOT / "docker" / "security" / "seccomp-profile.json"
    assert seccomp_file.exists()
    seccomp_data = json.loads(seccomp_file.read_text(encoding="utf-8"))
    assert seccomp_data.get("defaultAction") == "SCMP_ACT_ERRNO"
    assert len(seccomp_data.get("syscalls", [])) > 0

    apparmor_file = REPO_ROOT / "docker" / "security" / "apparmor-ecdat.profile"
    assert apparmor_file.exists()
    apparmor_text = apparmor_file.read_text(encoding="utf-8")
    assert "deny capability sys_admin" in apparmor_text
    assert "deny network raw" in apparmor_text


def test_kubernetes_manifests_restricted_security_context(auditor):
    """Kubernetes Deployment and CronJob manifests must satisfy restricted PodSecurityStandards."""
    k8s_dir = REPO_ROOT / "deploy" / "k8s"
    ns_file = (
        k8s_dir / "00-namespaces.yaml" if (k8s_dir / "00-namespaces.yaml").exists() else k8s_dir / "namespace.yaml"
    )
    assert ns_file.exists()
    ns_content = ns_file.read_text(encoding="utf-8")
    assert "pod-security.kubernetes.io/enforce: restricted" in ns_content

    manifests = [
        k8s_dir / "06-backend-deployment.yaml",
        k8s_dir / "07-frontend-deployment.yaml",
        k8s_dir / "08-scanner-cronjob.yaml",
    ]
    for mf in manifests:
        assert mf.exists()
        res = auditor.audit_kubernetes(mf)
        assert res.score == 100.0
        assert "non_root_users" in res.passed_rules
        assert "read_only_filesystem" in res.passed_rules
        assert "dropped_capabilities" in res.passed_rules
        assert "seccomp_profile" in res.passed_rules
        assert "resource_limits" in res.passed_rules
        assert "no_privileged_mode" in res.passed_rules
        assert "no_host_networking" in res.passed_rules


def test_overall_container_hardening_score(auditor):
    """Auditing all container artifacts must result in 100% compliance."""
    report = auditor.audit_all()
    assert report["overall_score"] == 100.0
    assert report["all_hardened"] is True
    assert report["total_artifacts"] >= 7
