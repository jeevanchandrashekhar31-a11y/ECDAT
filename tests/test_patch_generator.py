"""
Unit and Safety Tests for ECDAT Safe Patch Generator (Phase 12.2).
"""

import ast
import os
import pytest
import tempfile
from scanners.patch_generator import (
    SafePatchGenerator,
    PythonCryptoASTTransformer,
    transform_python_code_ast,
    transform_javascript_code_ast_aware,
    generate_unified_diff,
    validate_syntax,
)


@pytest.fixture
def generator():
    return SafePatchGenerator()


def test_ast_aware_python_hashlib_transformation():
    # Source code containing a crypto call AND unrelated variables/strings named "md5"
    source = """
import hashlib

def calculate_checksum(data):
    # This is an md5 checksum variable
    md5_checksum_label = "md5_result"
    digest = hashlib.md5(data).hexdigest()
    return f"{md5_checksum_label}:{digest}"
"""

    patched, transformations = transform_python_code_ast(source, target_algorithm="SHA-256")

    # The crypto call hashlib.md5() MUST be transformed to hashlib.sha256()
    assert "hashlib.sha256(data).hexdigest()" in patched

    # The variable and comment MUST NOT be blindly replaced
    assert "md5_checksum_label = 'md5_result'" in patched or 'md5_checksum_label = "md5_result"' in patched

    # Valid Python syntax
    parsed = ast.parse(patched)
    assert parsed is not None
    assert len(transformations) == 1
    assert transformations[0]["type"] == "AST_CALL_REPLACE"


def test_ast_aware_python_rsa_key_upgrade():
    source = """
from cryptography.hazmat.primitives.asymmetric import rsa

def generate_key():
    return rsa.generate_private_key(
        public_exponent=65537,
        key_size=1024,
    )
"""

    patched, transformations = transform_python_code_ast(source)
    assert "key_size=3072" in patched
    assert "key_size=1024" not in patched
    assert len(transformations) == 1
    assert transformations[0]["type"] == "AST_KEYWORD_REPLACE"


def test_unified_diff_generation():
    orig = "def compute():\n    return hashlib.md5(b'test').hexdigest()\n"
    patched = "def compute():\n    return hashlib.sha256(b'test').hexdigest()\n"

    diff = generate_unified_diff(orig, patched, file_path="auth/hash.py")
    assert "--- a/auth/hash.py" in diff
    assert "+++ b/auth/hash.py" in diff
    assert "-    return hashlib.md5(b'test').hexdigest()" in diff
    assert "+    return hashlib.sha256(b'test').hexdigest()" in diff


def test_syntax_validation():
    valid_python = "def foo():\n    return 42\n"
    res_valid = validate_syntax(valid_python, file_type="python")
    assert res_valid["valid"] is True
    assert res_valid["syntax_error"] is None

    broken_python = "def foo(:\n    return 42\n"
    res_broken = validate_syntax(broken_python, file_type="python")
    assert res_broken["valid"] is False
    assert res_broken["syntax_error"] is not None


def test_javascript_context_aware_patch(generator):
    js_source = """
const crypto = require('crypto');

function hashToken(token) {
    const md5_label = "md5_token";
    return crypto.createHash('md5').update(token).digest('hex');
}
"""

    res = generator.generate_patch(js_source, "tokens.js", target_algorithm="SHA-256")
    assert res["has_changes"] is True
    assert "crypto.createHash('sha256')" in res["patched_code"]
    # Verify no blind replace of label
    assert 'md5_label = "md5_token"' in res["patched_code"]
    assert res["validation_result"]["valid"] is True
    assert len(res["explanation"]["transformations"]) == 1
    assert "unit_tests" in res["test_plan"]


def test_pre_application_safety_lifecycle(generator):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("import hashlib\n\ndef hash_data(d):\n    return hashlib.md5(d).digest()\n")
        temp_path = f.name

    try:
        with open(temp_path, "r", encoding="utf-8") as f:
            src = f.read()

        patch_res = generator.generate_patch(src, temp_path, target_algorithm="SHA-256")
        assert patch_res["has_changes"] is True

        # Execute safety lifecycle
        lifecycle = generator.execute_pre_application_lifecycle(temp_path, patch_res)

        # Verify all 6 safety checks:
        assert "backup" in lifecycle["steps"]
        assert lifecycle["steps"]["backup"]["status"] == "PASSED"
        assert os.path.exists(lifecycle["steps"]["backup"]["backup_path"])

        assert "isolated_environment" in lifecycle["steps"]
        assert lifecycle["steps"]["isolated_environment"]["status"] == "PASSED"

        assert "run_tests" in lifecycle["steps"]
        assert lifecycle["steps"]["run_tests"]["status"] == "PASSED"

        assert "rerun_ecdat" in lifecycle["steps"]
        assert lifecycle["steps"]["rerun_ecdat"]["status"] == "PASSED"
        assert lifecycle["steps"]["rerun_ecdat"]["verdict"] == "VULNERABILITY_RESOLVED"

        assert "rerun_security_scans" in lifecycle["steps"]
        assert lifecycle["steps"]["rerun_security_scans"]["status"] == "PASSED"

        assert "compare_cbom" in lifecycle["steps"]
        assert lifecycle["steps"]["compare_cbom"]["status"] == "PASSED"

        assert lifecycle["all_passed"] is True
        assert lifecycle["verdict"] == "SAFE_TO_APPLY"

        # Clean up backup
        if os.path.exists(lifecycle["steps"]["backup"]["backup_path"]):
            os.remove(lifecycle["steps"]["backup"]["backup_path"])

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
