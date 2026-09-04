import json
from unittest.mock import Mock, patch

import pytest

from scanners.cbom_mapping import validate_cbom_json
from scanners.static.privacy_filter import sanitize_for_llm
from scanners.static.sanitization import redact_secrets
from scanners.static.llm_verifier import LLMVerifier
from scanners.binary_container import syft_runner


def test_secret_redaction_removes_pem_password_and_long_literal():
    content = (
        'password="do-not-log-this"\n'
        "-----BEGIN PRIVATE KEY-----\nSUPERSECRET\n-----END PRIVATE KEY-----\n"
        "token=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    )
    redacted = redact_secrets(content)
    assert "do-not-log-this" not in redacted
    assert "SUPERSECRET" not in redacted
    assert "[REDACTED_SECRET SHA256:" in redacted
    assert "[REDACTED_PEM_BODY SHA256:" in redacted
    assert "[REDACTED_BLOB SHA256:" in redacted


def test_llm_privacy_filter_omits_key_material_and_bounds_snippet():
    assert sanitize_for_llm("-----BEGIN PRIVATE KEY-----\nsecret", 1) == "[CODE OMITTED - CONTAINS KEY MATERIAL]"
    snippet = sanitize_for_llm('api_key = "very-long-secret-value-123456"\n' * 1000, 1)
    assert "very-long-secret-value" not in snippet
    assert len(snippet) <= 8017


def test_cbom_validation_accepts_contract_and_rejects_non_cbom():
    valid = json.dumps({"bomFormat": "CycloneDX", "specVersion": "1.6", "components": []})
    assert validate_cbom_json(valid) is True
    assert validate_cbom_json('{"bomFormat":"SPDX"}') is False
    assert validate_cbom_json("not-json") is False


def test_llm_verifier_uses_mocked_http_and_never_requires_network(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    verifier = LLMVerifier(max_requests=1, timeout=1)
    fake_response = Mock()
    fake_response.status_code = 200
    fake_response.raise_for_status.return_value = None
    fake_response.json.return_value = {"choices": [{"message": {"content": '{"is_cryptographic_operation": true}'}}]}
    with patch("scanners.static.llm_verifier.requests.post", return_value=fake_response) as post:
        result = verifier.verify_finding("hash(data)", "SHA-256", "R_HASH")
    assert result == {"is_cryptographic_operation": True}
    assert post.call_count == 1
    assert post.call_args.kwargs["timeout"] == 1


def test_llm_verifier_omits_pem_without_http_call(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    verifier = LLMVerifier()
    with patch("scanners.static.llm_verifier.requests.post") as post:
        assert verifier.verify_finding("[CODE OMITTED - CONTAINS KEY MATERIAL]", "RSA", "R_KEY") is None
    post.assert_not_called()


def test_syft_runner_parses_mocked_subprocess_output():
    completed = Mock(returncode=0, stdout='{"components": []}', stderr="")
    with (
        patch("scanners.binary_container.syft_runner.check_syft_installed", return_value=True),
        patch("scanners.binary_container.syft_runner.subprocess.run", return_value=completed) as run,
    ):
        assert syft_runner.run_syft_scan("safe-target", timeout_seconds=9) == {"components": []}
    assert run.call_args.args[0] == ["syft", "safe-target", "-o", "cyclonedx-json"]
    assert run.call_args.kwargs["shell"] is False


def test_syft_runner_timeout_is_handled_without_running_syft():
    with (
        patch("scanners.binary_container.syft_runner.check_syft_installed", return_value=True),
        patch(
            "scanners.binary_container.syft_runner.subprocess.run",
            side_effect=syft_runner.subprocess.TimeoutExpired("syft", 1),
        ),
    ):
        with pytest.raises(SystemExit) as exit_info:
            syft_runner.run_syft_scan("safe-target", timeout_seconds=1)
    assert exit_info.value.code == 1
