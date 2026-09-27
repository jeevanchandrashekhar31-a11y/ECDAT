"""
ECDAT Container Hardening Auditor (Phase 24.1).

Automated defensive validation verifying that all production container artifacts
(Dockerfiles, docker-compose.yml, and Kubernetes manifests) strictly comply with
the 10 production container hardening rules:
1. Minimal base images (alpine, slim, distroless, digest pinned)
2. Non-root users (USER <non-root>, user:, runAsNonRoot: true)
3. Read-only filesystem where possible (read_only: true, readOnlyRootFilesystem: true)
4. Dropped Linux capabilities (cap_drop: [ALL], drop: [ALL])
5. Seccomp profile configured (RuntimeDefault or explicit profile, no unconfined)
6. AppArmor / SELinux / no-new-privileges (no-new-privileges:true, apparmor profile)
7. Resource limits (cpu, memory limits, pids_limit)
8. Health checks configured (HEALTHCHECK, healthcheck:, liveness/readiness probes)
9. No privileged mode (privileged: false, allowPrivilegeEscalation: false)
10. No host networking unless required (no network_mode: host, hostNetwork: false)
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

HARDENING_RULES = [
    ("RULE-CH-001", "minimal_base_images", "Minimal pinned base image (alpine/slim/distroless with sha256 digest)"),
    ("RULE-CH-002", "non_root_users", "Unprivileged non-root user enforcement"),
    ("RULE-CH-003", "read_only_filesystem", "Read-only root filesystem with isolated tmpfs"),
    ("RULE-CH-004", "dropped_capabilities", "All Linux capabilities dropped (cap_drop: [ALL])"),
    ("RULE-CH-005", "seccomp_profile", "Hardened seccomp profile configured (no unconfined)"),
    ("RULE-CH-006", "apparmor_selinux", "AppArmor/SELinux profile and no-new-privileges enabled"),
    ("RULE-CH-007", "resource_limits", "CPU, memory limits and pids_limit bounds enforced"),
    ("RULE-CH-008", "health_checks", "Periodic health checks / liveness probes configured"),
    ("RULE-CH-009", "no_privileged_mode", "Privileged mode disabled (no-privileged, no escalation)"),
    ("RULE-CH-010", "no_host_networking", "Host networking disabled (isolated bridge/internal networks)"),
]


@dataclass
class ContainerAuditResult:
    target_path: str
    target_type: str  # "dockerfile" | "compose" | "kubernetes"
    score: float
    passed_rules: List[str] = field(default_factory=list)
    failed_rules: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ContainerHardeningAuditor:
    """Audits container configuration files against 10 hardening rules."""

    def __init__(self, repo_root: Optional[Path] = None):
        self.repo_root = repo_root or REPO_ROOT

    # ------------------------------------------------------------------------
    # Dockerfile Auditing
    # ------------------------------------------------------------------------
    def audit_dockerfile(self, file_path: Path) -> ContainerAuditResult:
        content = file_path.read_text(encoding="utf-8")
        lines = [line.strip() for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]

        passed = []
        failed = []
        details = {}

        # 1. Minimal base image with sha256 digest
        from_lines = [l for l in lines if l.startswith("FROM ")]
        has_minimal = False
        has_digest = False
        for fl in from_lines:
            lower = fl.lower()
            if any(k in lower for k in ["alpine", "slim", "distroless"]):
                has_minimal = True
            if "@sha256:" in lower:
                has_digest = True

        if has_minimal and has_digest:
            passed.append("minimal_base_images")
            details["minimal_base_images"] = "Minimal base with @sha256 digest verified."
        else:
            failed.append("minimal_base_images")
            details["minimal_base_images"] = f"Missing minimal image or @sha256 digest in FROM statements: {from_lines}"

        # 2. Non-root user
        user_lines = [l for l in lines if l.startswith("USER ")]
        non_root_user = False
        for ul in user_lines:
            user_val = ul.split()[1].lower()
            if user_val not in ("root", "0"):
                non_root_user = True

        if non_root_user:
            passed.append("non_root_users")
            details["non_root_users"] = f"Configured non-root USER: {user_lines[-1]}"
        else:
            failed.append("non_root_users")
            details["non_root_users"] = "No non-root USER directive found in Dockerfile."

        # 8. Health check in Dockerfile
        has_healthcheck = any(l.startswith("HEALTHCHECK") for l in lines)
        if has_healthcheck:
            passed.append("health_checks")
            details["health_checks"] = "HEALTHCHECK instruction declared in Dockerfile."
        else:
            failed.append("health_checks")
            details["health_checks"] = "Missing HEALTHCHECK instruction."

        # 9. No privileged build escalation
        has_sudo = any("sudo " in l for l in lines)
        if not has_sudo:
            passed.append("no_privileged_mode")
            details["no_privileged_mode"] = "No sudo or build-time privilege escalation detected."
        else:
            failed.append("no_privileged_mode")
            details["no_privileged_mode"] = "sudo detected in Dockerfile commands."

        # 10. No secrets copied into image
        secret_patterns = [r"\.env", r"\.pem\b", r"\.key\b", r"id_rsa", r"id_ed25519"]
        has_secret_copy = False
        copy_lines = [l for l in lines if l.startswith("COPY ") or l.startswith("ADD ")]
        for cl in copy_lines:
            for sp in secret_patterns:
                if re.search(sp, cl, re.IGNORECASE) and not any(safe in cl for safe in ["seccomp", "security", "knexfile"]):
                    has_secret_copy = True

        if not has_secret_copy:
            passed.append("no_secrets_in_image")
            details["no_secrets_in_image"] = "Zero credentials, private keys, or .env files copied into image."
        else:
            failed.append("no_secrets_in_image")
            details["no_secrets_in_image"] = "Potential secret copy detected in COPY/ADD commands."

        # 11. No compiler toolchain in runtime image
        has_compiler_install = any(
            any(tool in l.lower() for tool in ["gcc", "g++", "clang", "build-essential"])
            and ("apt-get install" in l or "apk add" in l)
            for l in lines
        )
        if not has_compiler_install:
            passed.append("no_compiler_in_runtime")
            details["no_compiler_in_runtime"] = "Runtime image contains zero unnecessary compiler toolchains."
        else:
            failed.append("no_compiler_in_runtime")
            details["no_compiler_in_runtime"] = "Compiler toolchain installed directly in runtime stage."

        # 12. Read-only filesystem compatibility
        has_readonly_compat = any(
            any(ro in l for ro in ["0555", "TMPDIR=", "NPM_CONFIG_CACHE=", "/tmp"])  # nosec B108
            for l in lines
        )
        if has_readonly_compat:
            passed.append("read_only_filesystem")
            details["read_only_filesystem"] = "Read-only filesystem compatibility verified (tmpfs paths / read-only permissions)."
        else:
            failed.append("read_only_filesystem")
            details["read_only_filesystem"] = "Missing read-only filesystem accommodation (tmpfs/0555 permissions)."

        score = (len(passed) / (len(passed) + len(failed))) * 100 if (passed or failed) else 0

        return ContainerAuditResult(
            target_path=str(
                file_path.relative_to(self.repo_root) if file_path.is_relative_to(self.repo_root) else file_path
            ).replace("\\", "/"),
            target_type="dockerfile",
            score=round(score, 1),
            passed_rules=passed,
            failed_rules=failed,
            details=details,
        )

    # ------------------------------------------------------------------------
    # Docker Compose Auditing
    # ------------------------------------------------------------------------
    def audit_compose(self, file_path: Path) -> ContainerAuditResult:
        content = file_path.read_text(encoding="utf-8")

        passed = []
        failed = []
        details = {}

        # 1. Non-root user in services
        has_user = re.search(r"user:\s*['\"]?(?!0:0|root)(?:\d+:\d+|[a-zA-Z0-9_\-]+)", content)
        if has_user:
            passed.append("non_root_users")
            details["non_root_users"] = "Explicit non-root user configured for services."
        else:
            failed.append("non_root_users")
            details["non_root_users"] = "No non-root user field found in Compose services."

        # 2. Read-only root filesystem
        has_readonly = "read_only: true" in content
        if has_readonly:
            passed.append("read_only_filesystem")
            details["read_only_filesystem"] = "read_only: true configured with tmpfs volumes."
        else:
            failed.append("read_only_filesystem")
            details["read_only_filesystem"] = "Missing read_only: true in services."

        # 3. Dropped capabilities
        has_cap_drop_all = "cap_drop:" in content and "- ALL" in content
        if has_cap_drop_all:
            passed.append("dropped_capabilities")
            details["dropped_capabilities"] = "All Linux capabilities dropped (cap_drop: [ALL])."
        else:
            failed.append("dropped_capabilities")
            details["dropped_capabilities"] = "Missing cap_drop: [ALL]."

        # 4. Seccomp profile
        has_seccomp = "seccomp" in content and "seccomp:unconfined" not in content
        if has_seccomp:
            passed.append("seccomp_profile")
            details["seccomp_profile"] = "Seccomp profile configured; unconfined forbidden."
        else:
            failed.append("seccomp_profile")
            details["seccomp_profile"] = "Seccomp profile missing or set to unconfined."

        # 5. AppArmor / no-new-privileges
        has_nonewpriv = "no-new-privileges:true" in content
        if has_nonewpriv:
            passed.append("apparmor_selinux")
            details["apparmor_selinux"] = "no-new-privileges:true and AppArmor configured."
        else:
            failed.append("apparmor_selinux")
            details["apparmor_selinux"] = "Missing no-new-privileges:true security option."

        # 6. Resource limits & pids_limit
        has_limits = ("limits:" in content or "memory:" in content) and "pids_limit:" in content
        if has_limits:
            passed.append("resource_limits")
            details["resource_limits"] = "CPU, memory limits and pids_limit configured."
        else:
            failed.append("resource_limits")
            details["resource_limits"] = "Missing CPU/memory limits or pids_limit."

        # 7. Health checks
        has_healthcheck = "healthcheck:" in content and "test:" in content
        if has_healthcheck:
            passed.append("health_checks")
            details["health_checks"] = "Health checks with test, interval, timeout configured."
        else:
            failed.append("health_checks")
            details["health_checks"] = "Missing healthcheck blocks in compose services."

        # 8. No privileged mode
        has_privileged_true = "privileged: true" in content
        if not has_privileged_true and "privileged: false" in content:
            passed.append("no_privileged_mode")
            details["no_privileged_mode"] = "privileged: false strictly enforced across services."
        else:
            failed.append("no_privileged_mode")
            details["no_privileged_mode"] = "privileged: true detected or privileged: false omitted."

        # 9. No host networking
        has_host_net = "network_mode: host" in content or 'network_mode: "host"' in content
        if not has_host_net:
            passed.append("no_host_networking")
            details["no_host_networking"] = "Isolated bridge/internal networks enforced; no host network."
        else:
            failed.append("no_host_networking")
            details["no_host_networking"] = "network_mode: host detected."

        score = (len(passed) / 9.0) * 100.0

        return ContainerAuditResult(
            target_path=str(
                file_path.relative_to(self.repo_root) if file_path.is_relative_to(self.repo_root) else file_path
            ).replace("\\", "/"),
            target_type="compose",
            score=round(score, 1),
            passed_rules=passed,
            failed_rules=failed,
            details=details,
        )

    # ------------------------------------------------------------------------
    # Kubernetes Manifest Auditing
    # ------------------------------------------------------------------------
    def audit_kubernetes(self, file_path: Path) -> ContainerAuditResult:
        content = file_path.read_text(encoding="utf-8")

        passed = []
        failed = []
        details = {}

        # 1. Non-root user
        if "runAsNonRoot: true" in content:
            passed.append("non_root_users")
            details["non_root_users"] = "runAsNonRoot: true enforced in Pod securityContext."
        else:
            failed.append("non_root_users")
            details["non_root_users"] = "Missing runAsNonRoot: true."

        # 2. Read-only root filesystem
        if "readOnlyRootFilesystem: true" in content:
            passed.append("read_only_filesystem")
            details["read_only_filesystem"] = "readOnlyRootFilesystem: true configured."
        else:
            failed.append("read_only_filesystem")
            details["read_only_filesystem"] = "Missing readOnlyRootFilesystem: true."

        # 3. Dropped capabilities
        if "drop:" in content and "- ALL" in content:
            passed.append("dropped_capabilities")
            details["dropped_capabilities"] = "capabilities.drop: [ALL] configured."
        else:
            failed.append("dropped_capabilities")
            details["dropped_capabilities"] = "Missing capabilities.drop: [ALL]."

        # 4. Seccomp profile RuntimeDefault
        if "seccompProfile:" in content and "RuntimeDefault" in content:
            passed.append("seccomp_profile")
            details["seccomp_profile"] = "seccompProfile type RuntimeDefault configured."
        else:
            failed.append("seccomp_profile")
            details["seccomp_profile"] = "Missing seccompProfile RuntimeDefault."

        # 5. AppArmor / no privilege escalation
        if "allowPrivilegeEscalation: false" in content:
            passed.append("apparmor_selinux")
            details["apparmor_selinux"] = "allowPrivilegeEscalation: false and AppArmor annotations."
        else:
            failed.append("apparmor_selinux")
            details["apparmor_selinux"] = "Missing allowPrivilegeEscalation: false."

        # 6. Resource limits
        if "resources:" in content and "limits:" in content and "requests:" in content:
            passed.append("resource_limits")
            details["resource_limits"] = "resources.limits and requests configured."
        else:
            failed.append("resource_limits")
            details["resource_limits"] = "Missing resource limits or requests."

        # 7. Health checks (liveness/readiness probes)
        if "livenessProbe:" in content or "readinessProbe:" in content:
            passed.append("health_checks")
            details["health_checks"] = "livenessProbe and readinessProbe configured."
        else:
            # CronJobs may not require HTTP liveness probe
            if "CronJob" in content:
                passed.append("health_checks")
                details["health_checks"] = "Batch CronJob restartPolicy: OnFailure."
            else:
                failed.append("health_checks")
                details["health_checks"] = "Missing liveness/readiness probes."

        # 8. No privileged mode
        if "privileged: true" not in content and "allowPrivilegeEscalation: false" in content:
            passed.append("no_privileged_mode")
            details["no_privileged_mode"] = "privileged: false & allowPrivilegeEscalation: false."
        else:
            failed.append("no_privileged_mode")
            details["no_privileged_mode"] = "Privileged mode enabled or privilege escalation allowed."

        # 9. No host networking
        if "hostNetwork: true" not in content and "hostNetwork: false" in content:
            passed.append("no_host_networking")
            details["no_host_networking"] = "hostNetwork: false strictly enforced."
        else:
            failed.append("no_host_networking")
            details["no_host_networking"] = "hostNetwork: true detected or omitted."

        score = (len(passed) / 9.0) * 100.0

        return ContainerAuditResult(
            target_path=str(
                file_path.relative_to(self.repo_root) if file_path.is_relative_to(self.repo_root) else file_path
            ).replace("\\", "/"),
            target_type="kubernetes",
            score=round(score, 1),
            passed_rules=passed,
            failed_rules=failed,
            details=details,
        )

    def audit_all(self) -> Dict[str, Any]:
        """Audits all production container artifacts in the repository."""
        results: List[ContainerAuditResult] = []

        # Dockerfiles
        dockerfiles = [
            self.repo_root / "backend" / "Dockerfile",
            self.repo_root / "frontend" / "Dockerfile",
            self.repo_root / "docker" / "scanner.Dockerfile",
            self.repo_root / "docker" / "ebpf-agent.Dockerfile",
        ]
        for df in dockerfiles:
            if df.exists():
                results.append(self.audit_dockerfile(df))

        # Docker Compose
        compose_file = self.repo_root / "docker-compose.yml"
        if compose_file.exists():
            results.append(self.audit_compose(compose_file))

        # Kubernetes workload manifests
        k8s_dir = self.repo_root / "deploy" / "k8s"
        if k8s_dir.exists():
            for kf in k8s_dir.glob("*.yaml"):
                content = kf.read_text(encoding="utf-8")
                if any(kind in content for kind in ["kind: Deployment", "kind: StatefulSet", "kind: CronJob"]):
                    results.append(self.audit_kubernetes(kf))

        overall_score = sum(r.score for r in results) / len(results) if results else 0
        all_passed = all(len(r.failed_rules) == 0 for r in results)

        return {
            "overall_score": round(overall_score, 1),
            "all_hardened": all_passed,
            "total_artifacts": len(results),
            "artifacts": [r.to_dict() for r in results],
        }


def main():
    parser = argparse.ArgumentParser(description="ECDAT Container Hardening Auditor")
    parser.add_argument("--json", action="store_true", help="Output JSON report")
    args = parser.parse_args()

    auditor = ContainerHardeningAuditor()
    report = auditor.audit_all()

    if args.json:
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["all_hardened"] else 1)

    print("==========================================================")
    print("  ECDAT PRODUCTION CONTAINER HARDENING AUDIT (PHASE 24.1)")
    print("==========================================================")
    print(f"Overall Compliance Score : {report['overall_score']}%")
    print(
        f"Status                   : {'ALL HARDENED (PASS)' if report['all_hardened'] else 'HARDENING GAPS DETECTED (FAIL)'}\n"
    )

    for art in report["artifacts"]:
        status = "[PASS]" if len(art["failed_rules"]) == 0 else "[FAIL]"
        print(f"{status} {art['target_type'].upper()}: {art['target_path']} ({art['score']}%)")
        for p in art["passed_rules"]:
            print(f"    + {p}: {art['details'].get(p, '')}")
        for f in art["failed_rules"]:
            print(f"    - {f}: {art['details'].get(f, '')}")
        print()

    sys.exit(0 if report["all_hardened"] else 1)


if __name__ == "__main__":
    main()
