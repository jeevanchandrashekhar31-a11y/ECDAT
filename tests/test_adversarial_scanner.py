"""
Tests for Phase 20.1: Adversarial Repository & Hostile Input Sandboxing.
Asserts that ECDAT satisfies all 5 core guarantees against adversarial repos:
1. Terminates safely (bounded execution time & memory)
2. Respects resource limits (size, depth, file limits)
3. Never executes target source code
4. Never escapes scan root directory
5. Never crashes the control plane (deterministic exit codes)
"""

import os
import subprocess
import sys
import time
from pathlib import Path
import pytest

from scanners.static.discovery import FileDiscovery
from scanners.static.regex_rules import apply_regex_rules, MAX_LINE_LENGTH, MAX_EVIDENCE_LENGTH
from testing.corpora.generate_hostile_repo import (
    create_huge_files,
    create_deeply_nested_dirs,
    create_symlink_loops,
    create_malformed_source,
    create_parser_edge_cases,
    create_malicious_filenames,
    create_unicode_path_tricks,
    create_generated_code_explosions,
    create_complex_asts,
    create_huge_dependency_graphs,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "hostile_repo"


@pytest.fixture(scope="module")
def hostile_corpus_dir(tmp_path_factory):
    """Generate a clean adversarial corpus in a temporary directory for isolation."""
    target_dir = tmp_path_factory.mktemp("adversarial_corpus")
    create_huge_files(target_dir)
    create_deeply_nested_dirs(target_dir)
    create_symlink_loops(target_dir)
    create_malformed_source(target_dir)
    create_parser_edge_cases(target_dir)
    create_malicious_filenames(target_dir)
    create_unicode_path_tricks(target_dir)
    create_generated_code_explosions(target_dir)
    create_complex_asts(target_dir)
    create_huge_dependency_graphs(target_dir)
    return target_dir


def test_huge_files_skipped(hostile_corpus_dir):
    """Guarantee 2: Oversized files exceeding max size limit must be skipped."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "01_huge_files"),
        include_exts={".c", ".h"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,  # 5 MB limit
        max_files=100,
    )
    files = discovery.discover_files()
    assert len(files) == 0, "Huge file should be skipped"
    assert discovery.skipped_stats["oversized"] >= 1


def test_deeply_nested_directories_bounded(hostile_corpus_dir):
    """Guarantee 2: Deeply nested directory traversal must be bounded at max_depth."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "02_deeply_nested"),
        include_exts={".c", ".h"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,
        max_files=100,
        max_depth=20,  # Limit to 20
    )
    files = discovery.discover_files()
    assert len(files) == 0, "Files deeper than max_depth should be skipped"
    assert discovery.skipped_stats["max_depth_exceeded"] >= 1


def test_symlink_loops_safe(hostile_corpus_dir):
    """Guarantee 1 & 4: Symlinks must not escape root or cause infinite recursion."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "03_symlink_loops"),
        include_exts={".c", ".h"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,
        max_files=100,
    )
    files = discovery.discover_files()
    # Should find real_file.c without entering circular loops
    assert all(not f.is_symlink() for f in files)
    assert all(discovery.root_dir in f.resolve().parents for f in files)


def test_malformed_source_tolerated(hostile_corpus_dir):
    """Guarantee 1 & 5: Malformed bytes and nulls must not crash the parser."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "04_malformed_source"),
        include_exts={".js", ".c", ".py"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,
        max_files=100,
    )
    files = discovery.discover_files()
    assert len(files) >= 2

    # Verify that reading and regex scanning does not raise unhandled exceptions
    for f in files:
        content = f.read_bytes().decode("utf-8", errors="replace")
        matches = apply_regex_rules(content)
        assert isinstance(matches, list)


def test_parser_edge_cases_terminate_safely(hostile_corpus_dir):
    """Guarantee 1: Deep ternaries and 2,000 parens must terminate cleanly."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "05_parser_edge_cases"),
        include_exts={".c", ".js", ".py"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,
        max_files=100,
    )
    files = discovery.discover_files()
    assert len(files) == 3

    for f in files:
        content = f.read_bytes().decode("utf-8", errors="replace")
        matches = apply_regex_rules(content)
        assert isinstance(matches, list)


def test_generated_code_explosion_redos_protection(hostile_corpus_dir):
    """Guarantee 1 & 2: 500,000-char line must be safely bounded without ReDoS or memory blowup."""
    discovery = FileDiscovery(
        str(hostile_corpus_dir / "08_generated_explosions"),
        include_exts={".js", ".py"},
        exclude_dirs=set(),
        max_file_size_bytes=5 * 1024 * 1024,
        max_files=100,
    )
    files = discovery.discover_files()
    assert len(files) == 2

    start_time = time.time()
    for f in files:
        content = f.read_bytes().decode("utf-8", errors="replace")
        matches = apply_regex_rules(content)
        # Verify evidence length is strictly bounded
        for m in matches:
            assert len(m["evidence"]) <= MAX_EVIDENCE_LENGTH + 5
    duration = time.time() - start_time
    # Must finish under 3 seconds
    assert duration < 3.0, f"Regex scanning took too long: {duration}s"


def test_no_source_execution_invariant():
    """Guarantee 3: Scanner must never execute target source code."""
    # Verify no eval/exec or subprocess python run of target code in static scanner
    static_main = (REPO_ROOT / "scanners" / "static" / "main.py").read_text(encoding="utf-8")
    assert "exec(" not in static_main
    assert "eval(" not in static_main
    assert "__import__" not in static_main


def test_full_hostile_repo_scan_command(hostile_corpus_dir, tmp_path):
    """Guarantee 5: Full scan of entire hostile corpus must exit code 0 and emit valid CBOM."""
    out_cbom = tmp_path / "hostile_scan_result.json"
    cmd = [
        sys.executable,
        "-m",
        "scanners.static.main",
        str(hostile_corpus_dir),
        "-o",
        str(out_cbom),
        "--fail-on",
        "none",
    ]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"Scanner crashed with exit code {proc.returncode}: {proc.stderr}"
    assert out_cbom.exists()
    assert out_cbom.stat().st_size > 100
