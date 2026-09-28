import json
import math
import sys
import argparse
from datetime import datetime
from pathlib import Path

# Provide a mock dataset for testing if actual scans aren't performed.
# In a real environment, this script would invoke the scanners, parse their outputs, 
# and compare them against the adjudication labels.

def wilson_score_interval(p, n, z=1.96):
    """Calculate the Wilson score interval for a binomial proportion."""
    if n == 0:
        return 0.0, 0.0
    denominator = 1 + z**2 / n
    centre_adjusted_probability = p + z**2 / (2 * n)
    adjusted_standard_deviation = math.sqrt((p * (1 - p) + z**2 / (4 * n)) / n)
    
    lower_bound = (centre_adjusted_probability - z * adjusted_standard_deviation) / denominator
    upper_bound = (centre_adjusted_probability + z * adjusted_standard_deviation) / denominator
    return lower_bound, upper_bound

def calculate_metrics(true_positives, false_positives, false_negatives):
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    
    n_precision = true_positives + false_positives
    p_lower, p_upper = wilson_score_interval(precision, n_precision)
    
    n_recall = true_positives + false_negatives
    r_lower, r_upper = wilson_score_interval(recall, n_recall)
    
    return {
        "precision": precision,
        "precision_ci": (p_lower, p_upper),
        "recall": recall,
        "recall_ci": (r_lower, r_upper),
        "f1": f1
    }

def generate_report(results, report_path):
    with open(report_path, "w") as f:
        f.write("# ECDAT External Benchmark Report\n\n")
        f.write("> **SCOPE STATEMENT**: Measured on these specific datasets (OWASP CryptoAPI-Bench, CamBench, Juliet, and pinned real repositories); not a guarantee of performance on arbitrary code.\n\n")
        
        f.write("## Overview\n")
        f.write("Metrics per language and per category, compared against baselines (Semgrep, CodeQL, CBOMkit, Trivy/Syft, gitleaks, testssl.sh, sslyze).\n\n")
        
        for lang, lang_results in results["languages"].items():
            f.write(f"### Language: {lang.capitalize()}\n")
            f.write("| Scanner | Precision | Precision 95% CI | Recall | Recall 95% CI | F1 Score | Scan Time (s) | Memory (MB) |\n")
            f.write("|---------|-----------|------------------|--------|---------------|----------|---------------|-------------|\n")
            
            for scanner, metrics in lang_results.items():
                p = metrics['precision'] * 100
                p_l, p_u = metrics['precision_ci']
                r = metrics['recall'] * 100
                r_l, r_u = metrics['recall_ci']
                f1 = metrics['f1'] * 100
                t = metrics.get('scan_time', 0.0)
                m = metrics.get('memory_mb', 0.0)
                
                f.write(f"| {scanner} | {p:.1f}% | [{p_l*100:.1f}%, {p_u*100:.1f}%] | {r:.1f}% | [{r_l*100:.1f}%, {r_u*100:.1f}%] | {f1:.1f}% | {t:.1f} | {m:.1f} |\n")
            f.write("\n")
            
        f.write("## Top 20 False Positives by Rule\n")
        for rule, count in results.get("top_fps", []):
            f.write(f"- `{rule}`: {count} false positives\n")
            
        f.write("\n*Note: Golden fixtures in `tests/` are maintained as an **internal regression set** and are excluded from these headline numbers.*\n")

def check_ci_gate(results, baseline_scanner="Semgrep", target_scanner="ECDAT"):
    failed = False
    for lang, lang_results in results["languages"].items():
        if baseline_scanner not in lang_results or target_scanner not in lang_results:
            continue
            
        base_p = lang_results[baseline_scanner]['precision'] * 100
        base_r = lang_results[baseline_scanner]['recall'] * 100
        
        target_p = lang_results[target_scanner]['precision'] * 100
        target_r = lang_results[target_scanner]['recall'] * 100
        
        p_drop = base_p - target_p
        r_drop = base_r - target_r
        
        if p_drop > 2.0:
            print(f"::error::CI Gate Failed for {lang}: Precision dropped by {p_drop:.2f} points vs {baseline_scanner} (allowed: 2.0)")
            failed = True
        if r_drop > 3.0:
            print(f"::error::CI Gate Failed for {lang}: Recall dropped by {r_drop:.2f} points vs {baseline_scanner} (allowed: 3.0)")
            failed = True
            
    return failed

def main():
    parser = argparse.ArgumentParser(description="Run External Benchmarks for ECDAT")
    parser.add_argument("--config", default="datasets.json", help="Path to datasets configuration")
    parser.add_argument("--report", default="benchmark_report.md", help="Output report path")
    parser.add_argument("--mock", action="store_true", help="Run with mock data for CI testing")
    args = parser.parse_args()
    
    # In a real implementation, we would parse datasets.json, clone/download repos, run scanners, 
    # parse SARIF/JSON outputs, compare against adjudication files, and calculate true metrics.
    # Here we mock the result format to ensure the CI gate and report generation work.
    
    if args.mock:
        results = {
            "languages": {
                "java": {
                    "Semgrep": calculate_metrics(80, 20, 30) | {"scan_time": 45.2, "memory_mb": 512.0},
                    "CodeQL": calculate_metrics(85, 10, 25) | {"scan_time": 300.5, "memory_mb": 2048.0},
                    "ECDAT": calculate_metrics(86, 12, 15) | {"scan_time": 15.0, "memory_mb": 128.0}
                },
                "python": {
                    "Semgrep": calculate_metrics(75, 15, 35) | {"scan_time": 30.1, "memory_mb": 400.0},
                    "ECDAT": calculate_metrics(78, 10, 20) | {"scan_time": 10.5, "memory_mb": 110.0}
                }
            },
            "top_fps": [
                ("weak_hash_md5", 45),
                ("hardcoded_secret_test", 30),
                ("tls_min_version", 15)
            ]
        }
    else:
        print("Real benchmarking execution not fully implemented in stub. Use --mock.")
        sys.exit(1)

    generate_report(results, args.report)
    print(f"Generated benchmark report at {args.report}")
    
    if check_ci_gate(results):
        sys.exit(1)
    else:
        print("CI Gate Passed.")
        sys.exit(0)

if __name__ == "__main__":
    main()
