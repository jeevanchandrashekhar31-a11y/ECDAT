"""
Unit tests for ECDAT Developer Feedback Engine (Phase 13.2).

Verifies:
- 9 required dimensions for developer-actionable findings:
  1. Exact location (file_path, line_number, column_number, formatted)
  2. Evidence (sanitized snippet)
  3. Confidence
  4. Severity
  5. Why it matters (deep cryptographic rationale, non-generic)
  6. Safe fix (concrete code example and migration steps)
  7. References (NIST, RFC, CWE, FIPS)
  8. Suppression/exception workflow (inline comment syntax & API exception)
  9. Verification command
- Strictly avoids generic "crypto is insecure" messages
- In-code inline suppression parsing (# ecdat:suppress / // ecdat:suppress)
- Terminal and Markdown card rendering
- Suppressed findings do not fail the CI policy gate
"""

import json
from pathlib import Path
import pytest

from scanners.developer_feedback import (
    DeveloperFeedbackGenerator,
    DeveloperFeedback,
    SafeFixGuidance,
    SuppressionWorkflow,
    KNOWLEDGE_CATALOG,
)
from scanners.ci_scanner import CIScanner, CIScanConfig, CIExitCode


def test_developer_feedback_has_all_9_dimensions():
    """Every generated DeveloperFeedback must contain all 9 required dimensions."""
    finding = {
        "rule_id": "ECDAT-STATIC-MD5",
        "algorithm": "MD5",
        "finding_type": "weak_hash",
        "file_path": "src/auth/hasher.py",
        "line_number": 42,
        "column_number": 5,
        "severity": "critical",
        "confidence": "high",
        "evidence": "return hashlib.md5(pwd).hexdigest()",
    }

    feedback = DeveloperFeedbackGenerator.generate(finding)

    # 1. Exact location
    assert feedback.exact_location["file_path"] == "src/auth/hasher.py"
    assert feedback.exact_location["line_number"] == 42
    assert feedback.exact_location["column_number"] == 5
    assert feedback.exact_location["formatted"] == "src/auth/hasher.py:42:5"

    # 2. Evidence
    assert "hashlib.md5" in feedback.evidence

    # 3. Confidence
    assert feedback.confidence == "HIGH"

    # 4. Severity
    assert feedback.severity == "CRITICAL"

    # 5. Why it matters
    assert "collision" in feedback.why_it_matters.lower()
    assert "crypto is insecure" not in feedback.why_it_matters.lower()

    # 6. Safe fix
    assert "SHA-256" in feedback.safe_fix.summary
    assert len(feedback.safe_fix.migration_steps) >= 3
    assert "hashlib.sha256" in feedback.safe_fix.code_example

    # 7. References
    assert len(feedback.references) >= 2
    assert any("NIST" in r or "CWE" in r or "RFC" in r for r in feedback.references)

    # 8. Suppression workflow
    assert "# ecdat:suppress" in feedback.suppression_workflow.inline_comment_syntax
    assert "POST /api/v1/policy/exceptions" in feedback.suppression_workflow.policy_exception_api

    # 9. Verification command
    assert "python -m scanners.ci_scanner" in feedback.verification_command
    assert "src/auth/hasher.py" in feedback.verification_command


@pytest.mark.parametrize(
    "algo,finding_type,expected_keyword",
    [
        ("MD5", "weak_hash", "collision"),
        ("SHA-1", "weak_hash", "collision"),
        ("DES", "weak_cipher", "56-bit"),
        ("3DES", "weak_cipher", "sweet32"),
        ("RC4", "weak_cipher", "keystream"),
        ("AES", "insecure_mode_ecb", "electronic codebook"),
        ("RSA", "weak_rsa_key_size", "factorable"),
        ("TLSv1.0", "insecure_tls_version", "poodle"),
        ("RSA_PRIVATE_KEY", "hardcoded_key", "exposes"),
    ],
)
def test_why_it_matters_specific_cryptographic_rationale(algo, finding_type, expected_keyword):
    """Why it matters must articulate exact cryptographic mechanisms and never use generic phrasing."""
    finding = {
        "rule_id": f"ECDAT-{algo}",
        "algorithm": algo,
        "finding_type": finding_type,
        "file_path": "crypto_impl.py",
        "line_number": 10,
        "evidence": f"use({algo})",
    }
    feedback = DeveloperFeedbackGenerator.generate(finding)

    # Must NOT be a generic hand-wave
    assert "crypto is insecure" not in feedback.why_it_matters.lower()
    assert "this is insecure" not in feedback.why_it_matters.lower()
    # Must contain specific mathematical/cryptographic mechanism
    assert expected_keyword in feedback.why_it_matters.lower()


def test_inline_suppression_detection_comment():
    """Valid inline suppression comment on line or preceding line must suppress the finding."""
    python_code_with_suppression = """
# ecdat:suppress ECDAT-STATIC-MD5 reason="Non-security checksum for legacy file caching"
hasher = hashlib.md5(file_data)
"""
    is_supp, reason = DeveloperFeedbackGenerator.check_inline_suppression(
        python_code_with_suppression,
        line_number=3,
        rule_id="ECDAT-STATIC-MD5",
    )

    assert is_supp is True
    assert reason == "Non-security checksum for legacy file caching"


def test_inline_suppression_mismatched_rule():
    """Suppression for rule A must NOT suppress rule B."""
    code = """
# ecdat:suppress ECDAT-STATIC-DES reason="Legacy file"
hasher = hashlib.md5(file_data)
"""
    is_supp, reason = DeveloperFeedbackGenerator.check_inline_suppression(
        code,
        line_number=3,
        rule_id="ECDAT-STATIC-MD5",
    )

    assert is_supp is False
    assert reason is None


def test_terminal_and_markdown_rendering():
    """Terminal card and markdown rendering must include all dimensions cleanly."""
    finding = {
        "rule_id": "ECDAT-STATIC-DES",
        "algorithm": "DES",
        "finding_type": "weak_cipher",
        "file_path": "src/legacy_cipher.py",
        "line_number": 15,
        "column_number": 1,
        "severity": "critical",
        "confidence": "high",
        "evidence": "DES.new(key, DES.MODE_ECB)",
    }
    feedback = DeveloperFeedbackGenerator.generate(finding)

    term_card = DeveloperFeedbackGenerator.render_terminal_card(feedback)
    assert "[CRITICAL] src/legacy_cipher.py:15:1" in term_card
    assert "Why It Matters (Cryptographic Weakness):" in term_card
    assert "Safe Fix:" in term_card
    assert "Verify Locally:" in term_card

    md_card = DeveloperFeedbackGenerator.render_markdown(feedback)
    assert "### [CRITICAL]" in md_card
    assert "#### Why It Matters" in md_card
    assert "#### Safe Fix" in md_card
    assert "#### Verification Command" in md_card


def test_suppressed_finding_does_not_fail_ci_gate(tmp_path):
    """A finding with developer inline suppression must be marked is_suppressed and NOT fail gate."""
    code_with_supp = """
import hashlib
# ecdat:suppress ECDAT-STATIC-MD5 reason="Checksum only for public assets"
h = hashlib.md5(b"hello")
"""
    f = tmp_path / "suppressed_file.py"
    f.write_text(code_with_supp, encoding="utf-8")

    config = CIScanConfig(
        target_dir=str(tmp_path),
        fail_on="critical",
    )
    scanner = CIScanner(config)
    result = scanner.run()

    # Finding was discovered
    assert len(result.findings) >= 1
    md5_finding = next((item for item in result.findings if "MD5" in item.get("algorithm", "")), None)
    assert md5_finding is not None
    assert md5_finding.get("is_suppressed") is True
    assert md5_finding.get("suppression_reason") == "Checksum only for public assets"

    # Because it is suppressed, it does NOT fail the CI gate!
    assert result.exit_code == CIExitCode.PASS
    assert result.gate_passed is True
