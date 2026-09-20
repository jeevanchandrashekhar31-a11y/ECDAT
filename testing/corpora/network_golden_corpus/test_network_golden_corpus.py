"""
Test Suite for Network Golden Corpus Benchmark (Phase 30)

Validates:
1. Manifest structure and required categories (expiration, wrong host, self-signed, weak cipher, revoked, clean).
2. Clean endpoints produce strictly 0 false positive findings (100% True Negative rate).
3. Overall network golden corpus precision >= 85%, recall >= 80%, F1 >= 82%.
4. Automated empirical Markdown report generation directly from the run.
5. Resource and scan performance tracking (wall time, peak memory).
"""

import json
from pathlib import Path
import pytest

from testing.corpora.network_golden_corpus.evaluator import NetworkGoldenCorpusEvaluator


@pytest.fixture(scope="module")
def evaluator():
    return NetworkGoldenCorpusEvaluator()


@pytest.fixture(scope="module")
def evaluation_results(evaluator):
    return evaluator.run_evaluation()


def test_network_manifest_structure_and_categories(evaluator):
    manifest = evaluator.load_manifest()
    assert "categories" in manifest
    assert "entries" in manifest
    assert len(manifest["entries"]) >= 7

    required_categories = {
        "01_certificate_expiration",
        "02_hostname_mismatch",
        "03_self_signed_certificate",
        "04_weak_ciphers",
        "05_revoked_certificate",
        "06_clean_endpoints",
    }
    assert required_categories.issubset(set(manifest["categories"]))


def test_clean_endpoints_zero_false_positives(evaluation_results):
    cats = evaluation_results["category_breakdown"]
    clean_cat = cats.get("06_clean_endpoints")
    assert clean_cat is not None
    assert clean_cat["fp"] == 0, f"Clean endpoints produced {clean_cat['fp']} false positives!"
    assert evaluation_results["metrics"]["true_negatives"] >= 3


def test_network_precision_recall_f1_targets(evaluation_results):
    m = evaluation_results["metrics"]
    assert m["precision"] >= 0.85, f"Precision {m['precision']} is below standard 0.85 threshold"
    assert m["recall"] >= 0.80, f"Recall {m['recall']} is below standard 0.80 threshold"
    assert m["f1_score"] >= 0.82, f"F1 score {m['f1_score']} is below standard 0.82 threshold"


def test_misconfigured_endpoints_detection(evaluation_results):
    cats = evaluation_results["category_breakdown"]
    assert cats["01_certificate_expiration"]["tp"] >= 1
    assert cats["02_hostname_mismatch"]["tp"] >= 1
    assert cats["03_self_signed_certificate"]["tp"] >= 1
    assert cats["04_weak_ciphers"]["tp"] >= 1
    assert cats["05_revoked_certificate"]["tp"] >= 1


def test_network_resource_performance_tracking(evaluation_results):
    perf = evaluation_results["performance"]
    assert perf["scan_time_seconds"] > 0
    assert perf["peak_memory_mb"] > 0
    assert perf["throughput_endpoints_per_second"] > 0


def test_network_markdown_report_generation(evaluator, evaluation_results):
    report_md = evaluator.generate_report(evaluation_results)
    assert "# ECDAT Network & TLS Scanner Empirical Benchmark Report" in report_md
    assert "Scientific Integrity Notice" in report_md
    assert "Executive Summary & Core Metrics" in report_md
    assert "Category Breakdown" in report_md
