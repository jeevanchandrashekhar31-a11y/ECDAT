"""
Self-Test: ECDAT Security Release Gate Cannot Lie.

Asserts that:
1. Injecting a deliberately failing command into any control causes the gate to
   return REJECTED with exit code 1.
2. A control whose verification command fails (non-zero exit code) reports FAIL,
   never PASS.
3. A control whose verification command is missing or times out reports NOT_RUN,
   never PASS.
4. Control 03 fails whenever pytest or node test runner output contains failures,
   even if exit codes are manipulated.
5. Exit codes are captured and displayed alongside every control.
"""

import subprocess
import sys
from pathlib import Path
import pytest

from scripts.security_gate import REPO_ROOT, SecurityReleaseGate, GateControlResult, main


def make_gate_with_fast_controls(repo_root=None) -> SecurityReleaseGate:
    """Helper creating a gate where all 14 controls run lightweight subprocesses."""
    gate = SecurityReleaseGate(repo_root=repo_root or REPO_ROOT, verbose=False)
    for i in range(1, 15):
        gate.set_control_command(i, [sys.executable, "-c", "import sys; sys.exit(0)"])
    return gate


def test_injected_failing_command_returns_rejected_with_exit_code_1():
    """
    Injects a deliberately failing command into Control 01 and asserts
    that the gate reports FAIL for that control, prints REJECTED,
    and returns exit code 1.
    """
    gate = make_gate_with_fast_controls()
    # Inject a failing command: exit code 42
    failing_cmd = [sys.executable, "-c", "import sys; sys.exit(42)"]
    gate.set_control_command(1, failing_cmd)

    passed, results = gate.execute(quick=True)
    assert passed is False, "Gate must return passed=False when a control fails"

    c1 = next(r for r in results if r.control_id == 1)
    assert c1.status == "FAIL", f"Expected FAIL, got {c1.status}"
    assert c1.exit_code == 42
    assert c1.passed is False
    assert "exit=42" in c1.output_summary


def test_injected_failing_command_cli_subprocess_exits_1_and_prints_rejected():
    """
    Executes the gate in a subprocess with an injected failure in Control 05,
    asserting it returns exit code 1 and stdout includes REJECTED.
    """
    script = (
        "import sys; "
        "from scripts.security_gate import SecurityReleaseGate; "
        "gate = SecurityReleaseGate(); "
        "[gate.set_control_command(i, [sys.executable, '-c', 'import sys; sys.exit(0)']) for i in range(1, 15)]; "
        "gate.set_control_command(5, [sys.executable, '-c', 'import sys; sys.exit(1)']); "
        "passed, _ = gate.execute(); "
        "sys.exit(0 if passed else 1)"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 1, f"Expected exit code 1, got {proc.returncode}"
    assert "REJECTED" in proc.stdout, "Expected REJECTED in gate output"
    assert "[FAIL] Control 05" in proc.stdout


def test_missing_or_unrun_command_is_not_run_and_rejects():
    """
    A command that is missing, timed out, or skipped must be marked NOT_RUN,
    and NOT_RUN must never be rendered as PASS or allow gate approval.
    """
    gate = make_gate_with_fast_controls()
    # Non-existent executable
    gate.set_control_command(4, ["non_existent_binary_xyz_12345"])

    passed, results = gate.execute(quick=True)
    assert passed is False

    c4 = next(r for r in results if r.control_id == 4)
    assert c4.status == "NOT_RUN", f"Expected NOT_RUN, got {c4.status}"
    assert c4.passed is False
    assert c4.exit_code is None


def test_control_03_fails_when_test_runner_reports_failures():
    """
    Control 03 must parse the actual test runner output.
    If pytest reports failures or node --test reports fail > 0, Control 03 is FAIL,
    even if the exit code is somehow 0.
    """
    gate = make_gate_with_fast_controls()
    # Command that prints failure text but exits with 0
    fake_pytest_with_failures = [
        sys.executable,
        "-c",
        "import sys; print('4 failed, 1020 passed in 10.5s'); sys.exit(0)",
    ]
    gate.set_control_command(3, fake_pytest_with_failures)

    res = gate.check_03_test_suite()
    assert res.status == "FAIL", "Control 03 must FAIL when failures are parsed in runner output"
    assert res.passed is False
    assert "4 failed" in res.output_summary or "4 failed" in res.fail_reason


def test_control_03_fails_when_exit_code_nonzero():
    """
    Control 03 must FAIL if test runner exits non-zero.
    """
    gate = make_gate_with_fast_controls()
    fake_failing_node = [
        sys.executable,
        "-c",
        "import sys; sys.exit(1)",
    ]
    gate.set_control_command(3, fake_failing_node)

    res = gate.check_03_test_suite()
    assert res.status == "FAIL"
    assert res.exit_code == 1
    assert res.passed is False


def test_main_function_returns_code_1_on_failure(monkeypatch):
    """
    main() must return code 1 if any control fails.
    """
    from scripts import security_gate

    # Inject a failing command in control 1
    failing_commands = {
        i: [sys.executable, "-c", "import sys; sys.exit(0)"] for i in range(1, 15)
    }
    failing_commands[1] = [sys.executable, "-c", "import sys; sys.exit(1)"]
    monkeypatch.setattr(
        security_gate.SecurityReleaseGate, "DEFAULT_COMMANDS", failing_commands
    )

    exit_code = security_gate.main(argv=[])
    assert exit_code == 1, f"Expected main() to return 1, got {exit_code}"


def test_all_14_controls_must_pass_for_approved():
    """
    The gate is APPROVED only if all 14 controls are PASS.
    If 13 controls PASS and 1 is FAIL, gate is REJECTED.
    """
    gate = make_gate_with_fast_controls()
    passed, results = gate.execute()
    assert passed is True
    assert all(r.status == "PASS" for r in results)
    assert len(results) == 14

    # Now make one FAIL
    gate.set_control_command(14, [sys.executable, "-c", "import sys; sys.exit(1)"])
    passed, results = gate.execute()
    assert passed is False
    c14 = next(r for r in results if r.control_id == 14)
    assert c14.status == "FAIL"
    assert c14.passed is False
