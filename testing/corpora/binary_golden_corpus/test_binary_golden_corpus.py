"""
Test Suite for Binary Golden Corpus Benchmark (Phase 30 / P2)

Validates:
1. Manifest structure and required categories (OpenSSL, mbedTLS, wolfSSL, clean).
2. Clean binaries produce strictly 0 false positive findings (100% True Negative rate).
3. Overall binary golden corpus precision >= 90%, recall >= 95%, F1 >= 92%.
4. Automated empirical Markdown report generation directly from the run.
5. Resource and scan performance tracking (wall time, peak memory).
"""

import json
from pathlib import Path
import pytest

from testing.corpora.binary_golden_corpus.evaluator import BinaryGoldenCorpusEvaluator


@pytest.fixture(scope="module")
def evaluator():
    return BinaryGoldenCorpusEvaluator()


@pytest.fixture(scope="module")
def evaluation_results(evaluator):
    return evaluator.run_evaluation()


def test_binary_manifest_structure_and_categories(evaluator):
    manifest = evaluator.load_manifest()
    assert "categories" in manifest
    assert "entries" in manifest
    assert len(manifest["entries"]) >= 4

    required_categories = {
        "01_openssl_binaries",
        "02_mbedtls_binaries",
        "03_wolfssl_binaries",
        "04_clean_binaries",
    }
    assert required_categories.issubset(set(manifest["categories"]))


def test_clean_binary_zero_false_positives(evaluation_results):
    cats = evaluation_results["category_breakdown"]
    clean_cat = cats.get("04_clean_binaries")
    assert clean_cat is not None
    assert clean_cat["fp"] == 0, f"Clean binary produced {clean_cat['fp']} false positives!"
    assert evaluation_results["metrics"]["true_negatives"] >= 1


def test_binary_precision_recall_f1_targets(evaluation_results):
    m = evaluation_results["metrics"]
    assert m["precision"] >= 0.90, f"Precision {m['precision']} is below 0.90 threshold"
    assert m["recall"] >= 0.95, f"Recall {m['recall']} is below 0.95 threshold"
    assert m["f1_score"] >= 0.92, f"F1 score {m['f1_score']} is below 0.92 threshold"


def test_positive_libraries_detection(evaluation_results):
    cats = evaluation_results["category_breakdown"]
    assert cats["01_openssl_binaries"]["tp"] >= 1
    assert cats["02_mbedtls_binaries"]["tp"] >= 1
    assert cats["03_wolfssl_binaries"]["tp"] >= 1


def test_binary_resource_performance_tracking(evaluation_results):
    perf = evaluation_results["performance"]
    assert perf["scan_time_seconds"] > 0
    assert perf["peak_memory_mb"] > 0
    assert perf["throughput_targets_per_second"] > 0


def test_binary_markdown_report_generation(evaluator, evaluation_results):
    report_md = evaluator.generate_report(evaluation_results)
    assert "# ECDAT Binary Golden Corpus Empirical Benchmark Report" in report_md
    assert "Executive Summary" in report_md
    assert "Category Breakdown" in report_md
    assert "Target-by-Target Ground-Truth Results" in report_md
