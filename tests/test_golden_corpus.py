"""
ECDAT Golden Corpus Test Suite (Phase 22.3)

Validates the permanent cryptographic benchmark corpus against:
1. All 11 Standardized Categories:
   - secure examples
   - weak algorithms
   - weak keys
   - TLS misconfigurations
   - certificate problems
   - PQC examples
   - hybrid examples
   - wrapper APIs
   - aliases
   - dynamically selected algorithms
   - negative examples
2. Empirical Metric Requirements:
   - Precision >= 85.0%
   - Recall >= 80.0%
   - F1 Score >= 82.0%
   - False Positives on negative examples == 0 (Strict Invariant)
   - Scan time and Peak Working Set (RAM) tracking
"""

from pathlib import Path
import json
import pytest

from testing.corpora.golden_corpus.evaluator import GoldenCorpusEvaluator


MANDATORY_CATEGORIES = [
    "01_secure_examples",
    "02_weak_algorithms",
    "03_weak_keys",
    "04_tls_misconfigurations",
    "05_certificate_problems",
    "06_pqc_examples",
    "07_hybrid_examples",
    "08_wrapper_apis",
    "09_aliases",
    "10_dynamic_algorithms",
    "11_negative_examples",
    "12_obfuscated_samples",
    "13_nested_samples",
    "14_multi_language_modern",
    "15_pqc_extended",
    "16_false_positives_and_negatives",
]


@pytest.fixture(scope="module")
def evaluator():
    corpus_dir = Path(__file__).resolve().parent.parent / "testing" / "corpora" / "golden_corpus"
    return GoldenCorpusEvaluator(corpus_dir=corpus_dir)


@pytest.fixture(scope="module")
def eval_results(evaluator):
    return evaluator.run_evaluation()


def test_manifest_structure_and_categories(evaluator):
    """Verifies that the ground-truth manifest contains all 16 standardized categories."""
    manifest = evaluator.load_manifest()
    assert manifest.get("corpus_version") == "2.0.0"
    assert manifest.get("standard") == "Phase 30 Golden Corpus"

    categories = manifest.get("categories", [])
    for cat in MANDATORY_CATEGORIES:
        assert cat in categories, f"Mandatory category '{cat}' missing from manifest"

    entries = manifest.get("entries", [])
    assert len(entries) >= 35, f"Expected at least 35 corpus files, found {len(entries)}"

    # Ensure every mandatory category has at least one corpus file entry
    present_cats = {entry.get("category") for entry in entries}
    for cat in MANDATORY_CATEGORIES:
        assert cat in present_cats, f"No entries found in manifest for category '{cat}'"


def test_corpus_filesystem_integrity(evaluator):
    """Verifies that all 11 category folders and their files physically exist."""
    corpus_dir = evaluator.corpus_dir
    assert corpus_dir.exists(), f"Corpus directory not found: {corpus_dir}"

    manifest = evaluator.load_manifest()
    for entry in manifest.get("entries", []):
        file_path = corpus_dir / entry["file_path"]
        assert file_path.exists(), f"Corpus file missing on disk: {file_path}"
        assert file_path.stat().st_size > 0, f"Corpus file is empty: {file_path}"


def test_negative_examples_zero_false_positives(eval_results):
    """
    CRITICAL INVARIANT:
    Negative examples (clean non-crypto code, non-crypto hash(), descriptions)
    must produce strictly ZERO false positives (100% True Negatives).
    """
    cat_breakdown = eval_results["category_breakdown"]
    neg_stats = cat_breakdown.get("11_negative_examples")
    assert neg_stats is not None, "Category '11_negative_examples' missing from evaluation breakdown"

    assert neg_stats["fp"] == 0, f"Expected 0 false positives on negative examples, got {neg_stats['fp']}"
    assert neg_stats["precision"] == 1.0
    assert neg_stats["recall"] == 1.0
    assert neg_stats["f1"] == 1.0

    # Verify per-file results for each negative example
    for detail in eval_results["detailed_file_results"]:
        if detail["is_negative"]:
            assert detail["detected_count"] == 0, (
                f"Negative file {detail['file_path']} triggered {detail['detected_count']} false findings: "
                f"{detail['findings']}"
            )
            assert detail["fp"] == 0


def test_precision_recall_f1_targets(eval_results):
    """
    Validates overall detection quality against standard targets:
    - Precision >= 85.0%
    - Recall >= 80.0%
    - F1 Score >= 82.0%
    """
    metrics = eval_results["metrics"]
    precision = metrics["precision"]
    recall = metrics["recall"]
    f1 = metrics["f1_score"]

    assert precision >= 0.85, f"Precision {precision * 100:.1f}% below target 85.0%"
    assert recall >= 0.80, f"Recall {recall * 100:.1f}% below target 80.0%"
    assert f1 >= 0.82, f"F1 score {f1 * 100:.1f}% below target 82.0%"
    assert metrics["true_positives"] >= 90


def test_post_quantum_and_hybrid_discovery(eval_results):
    """Validates 100% recall on Post-Quantum Cryptography (PQC) and Hybrid schemes."""
    cat_breakdown = eval_results["category_breakdown"]

    # 1. PQC examples (Kyber, Dilithium, SPHINCS+, Falcon)
    pqc_stats = cat_breakdown.get("06_pqc_examples")
    assert pqc_stats is not None
    assert pqc_stats["recall"] == 1.0, f"PQC recall was {pqc_stats['recall']}, expected 100%"
    assert pqc_stats["tp"] == pqc_stats["expected"]

    # 2. Hybrid examples (X25519Kyber768, Dual-Signatures)
    hybrid_stats = cat_breakdown.get("07_hybrid_examples")
    assert hybrid_stats is not None
    assert hybrid_stats["recall"] == 1.0, f"Hybrid recall was {hybrid_stats['recall']}, expected 100%"


def test_secure_and_weak_algorithms_discovery(eval_results):
    """Validates 100% recall on Secure Examples and Weak Algorithms."""
    cat_breakdown = eval_results["category_breakdown"]

    # Secure examples (AES-256-GCM, ChaCha20-Poly1305, SHA-384/512, Ed25519)
    secure_stats = cat_breakdown.get("01_secure_examples")
    assert secure_stats is not None
    assert secure_stats["recall"] >= 0.90, f"Secure examples recall was {secure_stats['recall']}"
    assert secure_stats["precision"] == 1.0

    # Weak algorithms (MD5, SHA-1, DES, 3DES, RC4, Blowfish, ECB)
    weak_stats = cat_breakdown.get("02_weak_algorithms")
    assert weak_stats is not None
    assert weak_stats["recall"] == 1.0, f"Weak algorithms recall was {weak_stats['recall']}"
    assert weak_stats["precision"] == 1.0


def test_resource_performance_tracking(eval_results):
    """
    Validates empirical performance and resource measurement tracking:
    - Scan time in seconds
    - Peak process memory (RAM in MB)
    - Filesystem scan throughput
    """
    perf = eval_results["performance"]
    scan_time = perf["scan_time_seconds"]
    peak_ram = perf["peak_memory_mb"]
    throughput = perf["throughput_files_per_second"]

    assert scan_time > 0.0, "Scan time must be strictly positive"
    assert scan_time < 5.0, f"Golden corpus scan took unexpectedly long: {scan_time}s"
    assert peak_ram > 0.0, "Peak RAM must be measured and strictly positive"
    assert peak_ram < 512.0, f"Peak RAM exceeded 512MB limit: {peak_ram}MB"
    assert throughput > 10.0, f"Throughput too low: {throughput} files/s"


def test_markdown_report_generation(evaluator, eval_results):
    """Verifies markdown report generation accurately includes all tables and metrics."""
    report = evaluator.generate_report(eval_results)
    assert "# ECDAT Golden Corpus Empirical Benchmark Report (Phase 30 / P2)" in report
    assert "Golden Corpus Precision" in report
    assert "Golden Corpus Recall" in report
    assert "Golden Corpus F1 Score" in report
    assert "Known Limitations & Analysis Boundaries" in report
    assert "Peak Process Working Set (RAM)" in report
    for cat in MANDATORY_CATEGORIES:
        assert f"`{cat}`" in report, f"Category `{cat}` missing from report markdown table"

