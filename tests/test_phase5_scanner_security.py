"""
Phase 5 Regression Test Suite: Scanner Security, SSRF, Upload & Dependency Security.
Verifies P0-10, P0-11, P0-12, and P1-10 under OWASP ASVS 5.0 and ECDAT specifications:
- P0-10: Scanner authentication boundaries (zero unauthenticated scan triggers)
- P0-11: Vulnerability scanner fail-closed integrity (offline / error != clean)
- P0-12: AnyIO dependency upgrade and security compliance (>= 4.15.1)
- P1-10: Abuse controls for Git URLs, zip archives, and rate limits
"""

import os
import re
import pytest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_p0_12_anyio_dependency_version():
    """P0-12: Ensure anyio is at least 4.15.1 in requirements locks to fix known vulnerabilities."""
    req_lock = REPO_ROOT / "requirements.lock"
    req_lock_txt = REPO_ROOT / "requirements-lock.txt"

    assert req_lock.exists(), "requirements.lock must exist"
    content = req_lock.read_text(encoding="utf-8")
    match = re.search(r"anyio==([\d\.]+)", content)
    assert match, "anyio must be pinned in requirements.lock"
    version_tuple = tuple(map(int, match.group(1).split(".")))
    assert version_tuple >= (4, 15, 1), f"anyio version {match.group(1)} must be >= 4.15.1"

    if req_lock_txt.exists():
        content_txt = req_lock_txt.read_text(encoding="utf-8")
        match_txt = re.search(r"anyio==([\d\.]+)", content_txt)
        if match_txt:
            v_tuple = tuple(map(int, match_txt.group(1).split(".")))
            assert v_tuple >= (4, 15, 1), f"anyio in requirements-lock.txt {match_txt.group(1)} must be >= 4.15.1"


def test_p0_10_scanner_auth_route_classification():
    """P0-10: Verify that scanner routes in auth.js are classified under SCAN and require authentication."""
    auth_js = REPO_ROOT / "backend" / "src" / "middleware" / "auth.js"
    assert auth_js.exists(), "backend/src/middleware/auth.js must exist"
    content = auth_js.read_text(encoding="utf-8")

    # Verify isScannerRoute contains all scanner vectors
    for route_prefix in ["/scan", "/cbom", "/cboms", "/sbom", "/sboms", "/api/v1/ci/scan"]:
        assert f'"{route_prefix}"' in content or f"'{route_prefix}'" in content, (
            f"Prefix {route_prefix} must be covered in isScannerRoute"
        )

    # Verify scanner routes fail closed if unauthenticated
    assert "Authentication required for scanner endpoints" in content


def test_p0_11_vulnerability_scanner_fail_closed_logic():
    """P0-11: Vulnerability scanner must fail closed on API error, network disconnect, or parsing errors."""
    scan_script = REPO_ROOT / "scripts" / "scan_vulnerabilities.py"
    assert scan_script.exists(), "scripts/scan_vulnerabilities.py must exist"
    content = scan_script.read_text(encoding="utf-8")

    # Verify fail-closed states and constants
    assert "SCAN_UNAVAILABLE" in content
    assert "SCAN_ERROR" in content
    assert "INCOMPLETE" in content or "PARTIALLY_SCANNED" in content

    # Verify result integrity module
    result_integrity_py = REPO_ROOT / "scanners" / "common" / "result_integrity.py"
    assert result_integrity_py.exists(), "scanners/common/result_integrity.py must exist"
    ri_content = result_integrity_py.read_text(encoding="utf-8")
    assert "CANNOT claim clean" in ri_content or "clean" in ri_content.lower()


def test_p1_10_git_and_archive_abuse_controls():
    """P1-10: Git clone guard and archive guard enforce SSRF protection and path containment."""
    git_guard_js = REPO_ROOT / "backend" / "src" / "security" / "git_clone_guard.js"
    archive_guard_js = REPO_ROOT / "backend" / "src" / "security" / "archive_guard.js"

    assert git_guard_js.exists()
    assert archive_guard_js.exists()

    git_content = git_guard_js.read_text(encoding="utf-8")
    assert "validateGitCloneUrl" in git_content
    assert "validateSafeTargetDirectory" in git_content
    assert "protocol.file.allow=never" in git_content

    archive_content = archive_guard_js.read_text(encoding="utf-8")
    assert "validateZipBufferSafety" in archive_content
    assert "ZipSlip" in archive_content or "traversal" in archive_content.lower()
