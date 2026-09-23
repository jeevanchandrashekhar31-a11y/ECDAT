import json
import csv
import sys
import os
import argparse

def normalize_path(path):
    if path is None:
        return ""
    return path.replace("\\", "/").lower()

def main():
    parser = argparse.ArgumentParser(description="Evaluate ECDAT Benchmark Output")
    parser.add_argument("--cbom", required=True, help="Path to the output CBOM JSON")
    parser.add_argument("--expected", required=True, help="Path to the expected inventory CSV")
    args = parser.parse_args()

    # Load Expected CSV
    expected_evidence = set()
    expected_assets = set()
    negative_evidence = set() # files expected NOT to be detected
    
    with open(args.expected, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            algo = row['algorithm'].strip().upper()
            filepath = normalize_path(row['file'].strip())
            is_expected = row['expected_detection'].strip().lower() == 'true'
            
            if is_expected:
                expected_evidence.add((filepath, algo))
                expected_assets.add(algo)
            else:
                negative_evidence.add((filepath, algo))

    # Load CBOM
    with open(args.cbom, mode='r', encoding='utf-8') as f:
        cbom = json.load(f)

    detected_evidence = set()
    detected_assets = set()

    for comp in cbom.get('components', []):
        algo = comp.get('name', '').upper()
        if algo:
            detected_assets.add(algo)
            
            evidence = comp.get('evidence', {})
            occurrences = evidence.get('occurrences', [])
            for occ in occurrences:
                loc = occ.get('location', '')
                loc_norm = normalize_path(loc)
                # Find the suffix that matches the expected filepath
                matched_file = loc_norm
                for exp_path, _ in expected_evidence.union(negative_evidence):
                    if loc_norm.endswith(exp_path):
                        matched_file = exp_path
                        break
                
                detected_evidence.add((matched_file, algo))

    # Evaluate Asset Level
    tp_assets = expected_assets.intersection(detected_assets)
    fp_assets = detected_assets - expected_assets
    fn_assets = expected_assets - detected_assets

    # Evaluate Evidence Level
    tp_evidence = expected_evidence.intersection(detected_evidence)
    fp_evidence = detected_evidence - expected_evidence
    fn_evidence = expected_evidence - detected_evidence

    # Print Metrics
    def calc_metrics(tp, fp, fn):
        precision = len(tp) / (len(tp) + len(fp)) if (len(tp) + len(fp)) > 0 else 0
        recall = len(tp) / (len(tp) + len(fn)) if (len(tp) + len(fn)) > 0 else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        return precision, recall, f1

    a_prec, a_rec, a_f1 = calc_metrics(tp_assets, fp_assets, fn_assets)
    e_prec, e_rec, e_f1 = calc_metrics(tp_evidence, fp_evidence, fn_evidence)

    print("=== ECDAT Benchmark Evaluation ===")
    print("\n--- Asset Level Metrics ---")
    print(f"True Positives (TP):  {len(tp_assets)}")
    print(f"False Positives (FP): {len(fp_assets)}")
    print(f"False Negatives (FN): {len(fn_assets)}")
    print(f"Precision:            {a_prec:.2%}")
    print(f"Recall:               {a_rec:.2%}")
    print(f"F1 Score:             {a_f1:.2%}")

    if fn_assets:
        print("\nMissing Assets (FN):")
        for a in sorted(fn_assets):
            print(f"  - {a}")
            
    if fp_assets:
        print("\nUnexpected Assets (FP):")
        for a in sorted(fp_assets):
            print(f"  - {a}")

    print("\n--- Evidence Level Metrics ---")
    print(f"True Positives (TP):  {len(tp_evidence)}")
    print(f"False Positives (FP): {len(fp_evidence)}")
    print(f"False Negatives (FN): {len(fn_evidence)}")
    print(f"Precision:            {e_prec:.2%}")
    print(f"Recall:               {e_rec:.2%}")
    print(f"F1 Score:             {e_f1:.2%}")

    if fn_evidence:
        print("\nMissing Evidence (FN):")
        for f, a in sorted(fn_evidence):
            print(f"  - [{a}] in {f}")

    if fp_evidence:
        print("\nUnexpected Evidence (FP):")
        for f, a in sorted(fp_evidence):
            print(f"  - [{a}] in {f}")

if __name__ == "__main__":
    main()
