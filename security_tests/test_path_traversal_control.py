# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Path Traversal & Canonical Containment Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import tempfile
import pytest
from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    PathTraversalError,
)

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "path_traversal_payloads.json"


class TestPathTraversalControl:
    """
    Security Control: Canonical Path Containment & Traversal Defense
    Guarantees that input paths and archive members cannot escape the intended target sandbox.
    """

    @pytest.fixture
    def guard(self):
        return ArchiveSecurityGuard()

    @pytest.fixture
    def sandbox(self):
        with tempfile.TemporaryDirectory() as td:
            yield Path(td).resolve()

    @pytest.fixture
    def payloads(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Legitimate subpaths resolve cleanly within sandbox
    def test_positive_path_traversal(self, guard, sandbox, payloads):
        pos_list = payloads.get("positive", [
            "safe_reports/summary.json",
            "cbom/cyclonedx_1.6.json",
            "scans/2026/09/scan_run.log",
        ])
        for p in pos_list:
            resolved = guard._validate_path_containment(p, sandbox)
            assert str(resolved).startswith(str(sandbox))

    # 2. NEGATIVE TEST: Empty or whitespace path strings fail
    def test_negative_path_traversal(self, guard, sandbox):
        with pytest.raises(PathTraversalError):
            guard._validate_path_containment("", sandbox)

        with pytest.raises(PathTraversalError):
            guard._validate_path_containment("   ", sandbox)

    # 3. BOUNDARY TEST: Deeply nested valid directories within sandbox
    def test_boundary_path_traversal(self, guard, sandbox):
        deep_path = "/".join(["sub"] * 15) + "/target.json"
        resolved = guard._validate_path_containment(deep_path, sandbox)
        assert str(resolved).startswith(str(sandbox))

    # 4. MALICIOUS TEST: Hostile path traversal exploit payloads blocked
    def test_malicious_path_traversal(self, guard, sandbox, payloads):
        mal_list = payloads.get("malicious", [
            "../../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
            "/etc/shadow",
            "C:\\Windows\\win.ini",
            "safe/../../../../secret.pem",
            "CON",
            "NUL",
            "AUX",
            "file.txt::$DATA",
        ])
        for mal in mal_list:
            with pytest.raises(PathTraversalError):
                guard._validate_path_containment(mal, sandbox)

    # 5. REGRESSION TEST: Verification of SEC-REG-007 traversal immunity
    def test_regression_path_traversal(self, guard, sandbox, payloads):
        reg_list = payloads.get("regression", [
            "../../etc/passwd",
            "..\\..\\windows\\win.ini",
        ])
        for reg in reg_list:
            with pytest.raises(PathTraversalError):
                guard._validate_path_containment(reg, sandbox)
