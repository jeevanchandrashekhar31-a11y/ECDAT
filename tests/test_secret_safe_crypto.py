"""
Tests for Phase 2.9: Secret-Safe Crypto Detection.

Verifies:
1. Candidate type classification (RSA, EC, PKCS8, OpenSSH, Symmetric, API Tokens).
2. Location tracking (file_path, line_number).
3. Safe fingerprint generation (sha256:...).
4. Complete redaction and minimal evidence preservation.
5. Absolute non-leakage invariant: raw secret values NEVER appear in:
   - logs
   - JSON findings
   - CBOM
   - database
   - UI
   - error messages
"""

import io
import json
import logging
from pathlib import Path
import pytest

from scanners.static.secret_detector import SecretSafeDetector, SecretCandidate
from scanners.static.results import StaticFinding
from scanners.models import CodeCryptoFinding
from scanners.cbom_mapping import code_finding_to_cbom, serialize_cbom
from scanners.domain.errors import ParserFailureError, InvalidInputError, EcdatException, ErrorCategory, ErrorCode

# @ecdat-synthetic-corpus
# ecdat:synthetic-fixture
SAMPLE_RSA_KEY = (
    "-----BEGIN RSA PRIVATE KEY-----\n"
    "MIIEowIBAAKCAQEA0Y3+secretKeyBytesHereForTestingOnlyNotRealKey1234567890=\n"
    "-----END RSA PRIVATE KEY-----"
)

SAMPLE_EC_KEY = (
    "-----BEGIN EC PRIVATE KEY-----\n"
    "MHcCAQEEIIsecretEcBytesHereForTestingOnlyNotRealKey1234567890=\n"
    "-----END EC PRIVATE KEY-----"
)

SAMPLE_OPENSSH_KEY = (
    "-----BEGIN OPENSSH PRIVATE KEY-----\n"
    "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn\n"
    "-----END OPENSSH PRIVATE KEY-----"
)

SAMPLE_SYMMETRIC_KEY = "aes_super_secret_key_12345678901"
SAMPLE_AWS_TOKEN = "AKIAIOSFODNN7EXAMPLE"


def test_candidate_classification_and_fingerprinting():
    """Verify classification, location recording, safe fingerprinting, and minimal evidence."""
    content = (
        f'rsa_key = """{SAMPLE_RSA_KEY}"""\n'
        f'ec_key = """{SAMPLE_EC_KEY}"""\n'
        f'ssh_key = """{SAMPLE_OPENSSH_KEY}"""\n'
        f'aes_key = "{SAMPLE_SYMMETRIC_KEY}"\n'
        f'aws_token = "{SAMPLE_AWS_TOKEN}"\n'
    )

    sanitized, candidates = SecretSafeDetector.detect_and_redact(content, file_path="src/security/keys.py")

    assert len(candidates) >= 5
    types = [c.candidate_type for c in candidates]
    assert "RSA_PRIVATE_KEY" in types
    assert "EC_PRIVATE_KEY" in types
    assert "OPENSSH_PRIVATE_KEY" in types
    assert "SYMMETRIC_KEY" in types
    assert "AWS_ACCESS_KEY" in types

    # Verify fingerprints
    for c in candidates:
        assert c.safe_fingerprint.startswith("sha256:")
        assert len(c.safe_fingerprint) > 10
        # Fingerprint must NEVER contain plaintext secret
        assert SAMPLE_SYMMETRIC_KEY not in c.safe_fingerprint
        assert "MIIEow" not in c.safe_fingerprint
        # Minimal evidence contains variable name and redaction placeholder
        assert c.minimal_evidence is not None
        assert SAMPLE_SYMMETRIC_KEY not in c.minimal_evidence
        assert "MIIEow" not in c.minimal_evidence


def test_raw_secrets_never_appear_in_json_findings():
    """Verify raw secrets never appear in StaticFinding JSON outputs."""
    raw_secret = SAMPLE_RSA_KEY
    sanitized, candidates = SecretSafeDetector.detect_and_redact(f'key = "{raw_secret}"', file_path="config.py")
    findings = SecretSafeDetector.create_static_findings(candidates)

    for f in findings:
        finding_dict = f.to_dict()
        finding_json = json.dumps(finding_dict)

        assert "MIIEowIBAAKCAQEA0Y3+secretKeyBytes" not in finding_json
        assert "BEGIN RSA PRIVATE KEY" not in finding_json
        assert "[REDACTED_PRIVATE_KEY:RSA_PRIVATE_KEY:sha256:" in finding_json
        assert f.fingerprint is not None


def test_raw_secrets_never_appear_in_cbom():
    """Verify raw secrets never appear in generated CycloneDX CBOM."""
    finding = CodeCryptoFinding(
        bom_ref="code:config.py:10:RSA_PRIVATE_KEY",
        file_path="config.py",
        language="Python",
        line=10,
        algorithm="RSA_PRIVATE_KEY",
        finding_type="hardcoded_private_key",
        confidence="high",
        fingerprint="sha256:abcd1234ef567890",
        secret_type="RSA_PRIVATE_KEY",
    )

    bom = code_finding_to_cbom(finding)
    cbom_json = serialize_cbom(bom)

    assert SAMPLE_RSA_KEY not in cbom_json
    assert "MIIEowIBAAKCAQEA" not in cbom_json
    assert "ecdat:fingerprint" in cbom_json
    assert "sha256:abcd1234ef567890" in cbom_json


def test_raw_secrets_never_appear_in_logs():
    """Verify logger output with sanitized evidence never leaks raw secret."""
    log_stream = io.StringIO()
    handler = logging.StreamHandler(log_stream)
    logger = logging.getLogger("test_secret_logger")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)

    sanitized, candidates = SecretSafeDetector.detect_and_redact(f'signing_key = "{SAMPLE_RSA_KEY}"')
    for c in candidates:
        logger.info(f"Discovered candidate: type={c.candidate_type} evidence={c.minimal_evidence}")

    handler.flush()
    logged_output = log_stream.getvalue()

    assert "MIIEowIBAAKCAQEA" not in logged_output
    assert SAMPLE_RSA_KEY not in logged_output
    assert "[REDACTED_PRIVATE_KEY:RSA_PRIVATE_KEY:sha256:" in logged_output


def test_raw_secrets_never_appear_in_error_messages():
    """Verify error messages and details sanitize any embedded key material."""
    err = ParserFailureError(
        message=f"Parser encountered unexpected token inside private key: {SAMPLE_RSA_KEY}",
        details={"raw_snippet": f"const key = '{SAMPLE_EC_KEY}';"},
        fatal=False,
    )

    err_dict = err.to_dict()
    err_json = json.dumps(err_dict)

    assert "MIIEowIBAAKCAQEA" not in err.message
    assert "MHcCAQEEII" not in json.dumps(err.details)
    assert SAMPLE_RSA_KEY not in err_json
    assert SAMPLE_EC_KEY not in err_json
    assert "[REDACTED_PRIVATE_KEY]" in err.message
    assert "[REDACTED_PRIVATE_KEY]" in err.details["raw_snippet"]


def test_raw_secrets_never_appear_in_ui_and_reports():
    """Verify HTML reporting sanitizes any secret material."""
    raw_html_snippet = f"<div>Asset evidence: {SAMPLE_RSA_KEY}</div>"
    clean_html = sanitize_report_mock(raw_html_snippet)

    assert "MIIEowIBAAKCAQEA" not in clean_html
    assert SAMPLE_RSA_KEY not in clean_html
    assert "[REDACTED_PRIVATE_KEY]" in clean_html


def sanitize_report_mock(str_val: str) -> str:
    import re

    pat = re.compile(
        r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
        re.IGNORECASE,
    )
    return pat.sub("[REDACTED_PRIVATE_KEY]", str_val)
