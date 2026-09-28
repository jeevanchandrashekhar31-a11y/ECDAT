import os
import json
import sys

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from scanners.binary_container.parsers.worker_pool import WorkerIsolatedBinaryAnalyzer

GOLDEN_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'benchmarks', 'binary_golden_set'))
LABELS_FILE = os.path.join(GOLDEN_DIR, "labels.json")

def evaluate():
    with open(LABELS_FILE, 'r') as f:
        labels = json.load(f)

    analyzer = WorkerIsolatedBinaryAnalyzer()
    
    tp_lib = 0
    fp_lib = 0
    fn_lib = 0
    
    tp_const = 0
    fp_const = 0
    
    constant_fps = []
    
    for filename, label in labels.items():
        file_path = os.path.join(GOLDEN_DIR, filename)
        if not os.path.exists(file_path):
            continue
            
        print(f"Scanning {filename}...")
        try:
            result = analyzer.analyze(file_path, )
        except Exception as e:
            print(f"Failed to scan {filename}: {e}")
            continue
            
        if not result:
            continue
            
        result = result.to_dict()
            
        # Check library
        expected_lib = label.get("expected_library", "None")
        found_libs = [ind["library_name"] for ind in result.get("crypto_library_indicators", []) if ind["confidence"] in ("high", "medium")]
        
        if expected_lib != "None":
            # We expect a library
            matched = False
            for lib in found_libs:
                if expected_lib.lower() in lib.lower() or lib.lower() in expected_lib.lower():
                    matched = True
                    break
            
            if matched:
                tp_lib += 1
            else:
                fn_lib += 1
                
            for lib in found_libs:
                if not (expected_lib.lower() in lib.lower() or lib.lower() in expected_lib.lower()):
                    fp_lib += 1
        else:
            # We don't expect a library (negative test)
            if found_libs:
                fp_lib += len(found_libs)
                
        # Check constants
        expected_caps = label.get("expected_capabilities", [])
        custom_crypto = result.get("custom_crypto_implementations", [])
        
        if expected_lib == "None":
            # If it's a negative test, any constant found is a FP
            for c in custom_crypto:
                if c["evidence_type"] == "constants":
                    fp_const += 1
                    constant_fps.append(f"{filename}: Found {c['algorithm']} {c['primitive']}")
        else:
            for c in custom_crypto:
                if c["evidence_type"] == "constants":
                    tp_const += 1

    precision_lib = tp_lib / (tp_lib + fp_lib) if (tp_lib + fp_lib) > 0 else 0
    recall_lib = tp_lib / (tp_lib + fn_lib) if (tp_lib + fn_lib) > 0 else 0
    
    print("\n--- Evaluation Results ---")
    print(f"Library Identification:")
    print(f"  Precision: {precision_lib:.2f} (TP: {tp_lib}, FP: {fp_lib})")
    print(f"  Recall:    {recall_lib:.2f} (TP: {tp_lib}, FN: {fn_lib})")
    
    print(f"\nConstant Findings:")
    print(f"  TP: {tp_const}")
    print(f"  FP: {fp_const}")
    
    if constant_fps:
        print("\nFalse Positives from Constant Scanner:")
        for fp in constant_fps:
            print(f"  - {fp}")

if __name__ == "__main__":
    evaluate()
