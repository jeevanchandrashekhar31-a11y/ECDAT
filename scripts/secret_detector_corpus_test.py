import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from scanners.static.secret_detector import SecretSafeDetector

CORPUS = [
    # POSITIVES (real-format fake secrets that must be detected)
    ("AWS Access Key", "AKIAIOSFODNN7ABCD123", True),  # Fake real format
    ("AWS Secret Key", "aws_secret_access_key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKE1'", True),
    ("GitHub Token", "ghp_ABCDEF1234567890ABCDEF1234567890ABCD", True),
    ("Stripe Key", "sk_dummy_aBcDeFgHiJkLmNoPqRsTuVwX", True),
    ("JWT", "eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZS.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", True),
    ("DB Password", "db_password = 'SuperSecretDbPassword123!'", True),
    ("Generic API", "api_key = 'abc123def456ghi789jkl012mno345pqr678stu901'", True),
    
    # NEGATIVES (placeholders and test keys)
    ("Test File Dummy", "mock_aws_secret = 'mock_wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'", False), # prefix dummy-
    ("Test password", "db_password = 'testpassword'", False),
    ("Synthetic marker", "ecdat:fixture\napi_key = 'abc123def456ghi789jkl012mno345pqr678stu901'", False),
    ("Localhost DB", "postgres://user:password@localhost/testdb", False),
    ("AWS Documented", "AKIAIOSFODNN7EXAMPLE", False), # Exact documentation key
    
    # NEGATIVES (high-entropy non-secrets)
    ("UUID", "uuid = '123e4567-e89b-12d3-a456-426614174000'", False),
    ("SHA256 Hash", "hash = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'", False),
    ("Commit Hash", "commit = '7d2e4f0a9b3c6d8e1f2a4b5c7d8e9f0a1b2c3d4e'", False),
]

def run_corpus():
    tp = 0
    fp = 0
    fn = 0
    tn = 0
    
    print("Running Secret Detector Evaluation Corpus...")
    for label, content, expected_positive in CORPUS:
        # Scan
        sanitized, candidates = SecretSafeDetector.detect_and_redact(content, file_path="sample.py")
        
        # Determine actual positive (detected any secret with critical or high severity? Wait, synthetic secrets return candidates but with severity="low")
        # Let's say a positive is a candidate that is NOT synthetic.
        detected = False
        for cand in candidates:
            if not cand.is_synthetic:
                detected = True
                
        if expected_positive and detected:
            tp += 1
            print(f"[TP] {label}")
        elif expected_positive and not detected:
            fn += 1
            print(f"[FN] {label}")
        elif not expected_positive and detected:
            fp += 1
            print(f"[FP] {label} (Expected Negative but got Positive)")
            print(f"     Candidates: {candidates}")
        elif not expected_positive and not detected:
            tn += 1
            print(f"[TN] {label}")

    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    
    print("\n--- Evaluation Results ---")
    print(f"Total Samples: {len(CORPUS)}")
    print(f"True Positives: {tp}")
    print(f"False Positives: {fp}")
    print(f"False Negatives: {fn}")
    print(f"True Negatives: {tn}")
    print(f"Precision: {precision:.2f}")
    print(f"Recall: {recall:.2f}")

if __name__ == "__main__":
    run_corpus()
