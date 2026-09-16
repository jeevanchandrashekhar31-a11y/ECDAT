"""
Unit tests for ECDAT CI/CD Scanner & Orchestrator (Phase 13.1).

Verifies:
- Deterministic exit codes (0 = PASS, 1 = POLICY/SECURITY FAILURE, 2 = SCANNER ERROR, 3 = INVALID CONFIG)
- Strict invariant: Never conflate scanner error with 'no vulnerabilities'
- Pull request diff-aware scanning
- Full repository scanning
- Policy gate evaluation
- CBOM generation (CycloneDX)
- SARIF export (OASIS SARIF v2.1.0)
- Dependency scanning
- Secret-safe detection (zero leakage, sha256 fingerprinted, redacted)
- Container scanning
"""

import json
from pathlib import Path
import pytest
from unittest.mock import patch, MagicMock

from scanners.ci_scanner import (
    CIScanner,
    CIScanConfig,
    CIScanMode,
    CIExitCode,
    generate_sarif_v2,
    resolve_pr_diff_files,
)


@pytest.fixture
def clean_repo(tmp_path):
    """Creates a temporary workspace with clean, safe cryptographic usage."""
    safe_code = """
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def hash_data(data: bytes):
    return hashlib.sha256(data).hexdigest()

def encrypt_data(key: bytes, plaintext: bytes):
    aesgcm = AESGCM(key)
    return aesgcm.encrypt(b"123456789012", plaintext, None)
"""
    f = tmp_path / "safe_module.py"
    f.write_text(safe_code, encoding="utf-8")
    return tmp_path


@pytest.fixture
def vulnerable_repo(tmp_path):
    """Creates a temporary workspace with weak algorithms and exposed secrets."""
    vuln_code = """
import hashlib
from Crypto.Cipher import DES

def bad_hash(data: bytes):
    return hashlib.md5(data).hexdigest()

def bad_cipher():
    return DES.new(b"12345678", DES.MODE_ECB)

aes_key = "0123456789abcdef0123456789abcdef"
"""
    f = tmp_path / "vulnerable_module.py"
    f.write_text(vuln_code, encoding="utf-8")
    return tmp_path


def test_exit_code_0_pass_on_clean_repo(clean_repo):
    """Clean codebase with no critical/high violations must exit with code 0 (PASS)."""
    config = CIScanConfig(
        target_dir=str(clean_repo),
        fail_on="critical",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.exit_code == CIExitCode.PASS
    assert result.exit_code == 0
    assert result.complete is True
    assert result.gate_passed is True
    assert result.vulnerabilities_conflated is False
    assert len(result.scanner_errors) == 0


def test_exit_code_1_security_failure_on_vulnerable_repo(vulnerable_repo):
    """Vulnerable codebase exceeding fail-on threshold must exit with code 1 (POLICY_SECURITY_FAILURE)."""
    config = CIScanConfig(
        target_dir=str(vulnerable_repo),
        fail_on="critical",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.exit_code == CIExitCode.POLICY_SECURITY_FAILURE
    assert result.exit_code == 1
    assert result.complete is True
    assert result.gate_passed is False
    assert len(result.gate_violations) > 0
    assert result.vulnerabilities_conflated is False


def test_exit_code_1_policy_gate_block(vulnerable_repo, tmp_path):
    """Policy-as-code evaluating to BLOCK must yield exit code 1."""
    # Custom policy that prohibits MD5 (for test verification)
    policy_content = {
        "id": "policy-no-md5",
        "name": "Strict Test Policy",
        "version": "1.0.0",
        "rules": [
            {
                "id": "rule-no-md5",
                "name": "Prohibit MD5 in Test",
                "category": "algorithm",
                "action": "BLOCK",
                "algorithms": {
                    "prohibited": ["MD5"]
                }
            }
        ]
    }
    policy_file = tmp_path / "test_policy.json"
    policy_file.write_text(json.dumps(policy_content), encoding="utf-8")

    config = CIScanConfig(
        target_dir=str(vulnerable_repo),
        policy_path=str(policy_file),
        fail_on="policy",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.exit_code == CIExitCode.POLICY_SECURITY_FAILURE
    assert result.gate_passed is False
    assert result.gate_verdict == "BLOCK"
    assert len(result.gate_violations) > 0


def test_exit_code_2_scanner_error_invariant(clean_repo):
    """
    CRITICAL INVARIANT: Scanner error must NEVER be conflated with 'no vulnerabilities'.
    Even if 0 vulnerabilities were found, exit code must strictly be 2 (SCANNER_ERROR),
    and complete must be False.
    """
    config = CIScanConfig(
        target_dir=str(clean_repo),
        fail_on="critical",
    )
    scanner = CIScanner(config)

    # Simulate an unexpected engine crash during file reading or adapter invocation
    with patch("scanners.ci_scanner.get_default_adapter_registry", side_effect=RuntimeError("Engine fatal crash")):
        result = scanner.run()

    assert result.exit_code == CIExitCode.SCANNER_ERROR
    assert result.exit_code == 2
    assert result.complete is False
    assert result.vulnerabilities_conflated is False
    assert len(result.scanner_errors) > 0
    assert "Engine fatal crash" in result.scanner_errors[0]
    # Invariant: must not claim clean or pass
    assert result.gate_passed is False
    assert result.summary["status"] == "SCANNER_ERROR"


def test_exit_code_3_invalid_config_non_existent_target():
    """Non-existent target directory must exit with code 3 (INVALID_CONFIG)."""
    config = CIScanConfig(
        target_dir="non_existent_dir_999999",
        fail_on="critical",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.exit_code == CIExitCode.INVALID_CONFIG
    assert result.exit_code == 3
    assert result.complete is False
    assert result.vulnerabilities_conflated is False
    assert "does not exist" in result.scanner_errors[0]


def test_exit_code_3_invalid_fail_on(clean_repo):
    """Unsupported fail-on parameter must exit with code 3 (INVALID_CONFIG)."""
    config = CIScanConfig(
        target_dir=str(clean_repo),
        fail_on="unsupported_choice",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.exit_code == CIExitCode.INVALID_CONFIG
    assert result.exit_code == 3
    assert "Invalid fail_on choice" in result.scanner_errors[0]


def test_pull_request_scan_changed_files(tmp_path):
    """Pull request scan must only scan specified changed files."""
    file1 = tmp_path / "unchanged_vuln.py"
    file1.write_text("import hashlib\nhashlib.md5(b'test')", encoding="utf-8")

    file2 = tmp_path / "pr_safe_file.py"
    file2.write_text("import hashlib\nhashlib.sha256(b'test')", encoding="utf-8")

    # In PR mode, only pr_safe_file.py was modified in PR
    config = CIScanConfig(
        target_dir=str(tmp_path),
        changed_files=["pr_safe_file.py"],
        fail_on="critical",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert result.scan_mode == CIScanMode.PULL_REQUEST.value
    assert result.total_files_scanned == 1
    assert result.exit_code == CIExitCode.PASS
    # The unchanged vulnerable file was excluded from PR scope
    file_paths = [f["file_path"] for f in result.findings]
    assert "unchanged_vuln.py" not in file_paths


def test_secret_scan_zero_leakage(tmp_path):
    """Secret scanning must detect secrets with non-reversible fingerprint and redacted evidence."""
    secret_code = """
# Test secret exposure
PRIVATE_KEY = \"\"\"-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0YpW3...FAKE_KEY_FOR_TESTING...
-----END RSA PRIVATE KEY-----\"\"\"
"""
    f = tmp_path / "secret_file.py"
    f.write_text(secret_code, encoding="utf-8")

    config = CIScanConfig(
        target_dir=str(tmp_path),
        scan_secrets=True,
        fail_on="none",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    secret_findings = [f for f in result.findings if f.get("category") == "secret"]
    assert len(secret_findings) >= 1
    sec = secret_findings[0]
    assert sec["finding_type"] == "hardcoded_key"
    assert sec["severity"] == "critical"
    assert "sha256:" in sec["fingerprint"]
    # Verify zero leakage: raw secret content must not be present in evidence
    assert "FAKE_KEY_FOR_TESTING" not in sec["evidence"]
    assert "[REDACTED_PRIVATE_KEY" in sec["evidence"]


def test_dependency_scan(tmp_path):
    """Dependency scanning must detect weak crypto libraries in package manifests."""
    pkg_json = {
        "name": "test-app",
        "dependencies": {
            "pycrypto": "2.6.1",
            "express": "4.18.2"
        }
    }
    (tmp_path / "package.json").write_text(json.dumps(pkg_json), encoding="utf-8")

    req_txt = "pycrypto==2.6.1\nrequests>=2.28.0\n"
    (tmp_path / "requirements.txt").write_text(req_txt, encoding="utf-8")

    config = CIScanConfig(
        target_dir=str(tmp_path),
        scan_deps=True,
        fail_on="none",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    dep_findings = [f for f in result.findings if f.get("category") == "dependency"]
    assert len(dep_findings) >= 2
    pkg_names = [f["algorithm"] for f in dep_findings]
    assert "pycrypto" in pkg_names


def test_container_scan_dockerfile(tmp_path):
    """Container scanning must detect legacy base images and insecure package installs in Dockerfiles."""
    dockerfile_content = """
FROM ubuntu:14.04
RUN apt-get update && apt-get install -y pycrypto
"""
    (tmp_path / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")

    config = CIScanConfig(
        target_dir=str(tmp_path),
        scan_container="Dockerfile",
        fail_on="none",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    container_findings = [f for f in result.findings if f.get("category") == "container"]
    assert len(container_findings) >= 1


def test_sarif_v2_generation(vulnerable_repo, tmp_path):
    """SARIF report generation must produce OASIS SARIF v2.1.0 compliant JSON."""
    sarif_output = tmp_path / "results.sarif"
    config = CIScanConfig(
        target_dir=str(vulnerable_repo),
        output_sarif=str(sarif_output),
        fail_on="none",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert sarif_output.exists()
    sarif_data = json.loads(sarif_output.read_text(encoding="utf-8"))
    assert sarif_data["version"] == "2.1.0"
    assert sarif_data["$schema"] == "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json"
    assert len(sarif_data["runs"]) == 1

    driver = sarif_data["runs"][0]["tool"]["driver"]
    assert driver["name"] == "ECDAT CI Scanner"
    assert len(driver["rules"]) > 0

    results = sarif_data["runs"][0]["results"]
    assert len(results) > 0
    first_res = results[0]
    assert "ruleId" in first_res
    assert "level" in first_res
    assert "locations" in first_res
    assert "partialFingerprints" in first_res


def test_cbom_generation(clean_repo, tmp_path):
    """CBOM report generation must produce valid CycloneDX CBOM JSON."""
    cbom_output = tmp_path / "cbom.json"
    config = CIScanConfig(
        target_dir=str(clean_repo),
        output_cbom=str(cbom_output),
        fail_on="none",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    assert cbom_output.exists()
    cbom_data = json.loads(cbom_output.read_text(encoding="utf-8"))
    assert cbom_data["bomFormat"] == "CycloneDX"
    assert "components" in cbom_data
