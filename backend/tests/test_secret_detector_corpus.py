import pytest
from scanners.static.secret_detector import SecretSafeDetector

CORPUS = [
    # POSITIVES (real-format fake secrets that must be detected)
    ("AWS Access Key", "AKIA" + "IOSF" + "ODNN7" + "ABCD123", True),
    ("AWS Secret Key", "aws_secret_access_key = 'wJalrXUtn" + "FEMI/K7MDENG/bPx" + "RfiCYEXAMPLEKE1'", True),
    ("GitHub Token", "ghp_" + "ABCDEF1234567890" + "ABCDEF1234567890" + "ABCD", True),
    ("Stripe Key", "sk_" + "live_" + "aBcDeFgHiJkLmNoPqRsTuVwX", True),
    ("JWT", "eyJhbGciOiJIUzI1NiIs" + "InR5cCI.eyJzdWIiOiIxMjM" + "0NTY3ODkwIiwibmFtZS.SflKxwR" + "JSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", True),
    ("DB Password", "db_password = 'Super" + "SecretDb" + "Password123!'", True),
    ("Generic API", "api_key = 'abc123def456ghi" + "789jkl012mno345pqr678stu901'", True),
    
    # NEGATIVES (placeholders and test keys)
    ("Test File Dummy", "mock_aws_secret = 'mock_wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'", False),
    ("Test password", "db_password = 'testpassword'", False),
    ("Synthetic marker", "ecdat:fixture\napi_key = 'abc123def456ghi789jkl012mno345pqr678stu901'", False),
    ("Localhost DB", "postgres://user:password@localhost/testdb", False),
    ("AWS Documented", "AKIAIOSFODNN7EXAMPLE", False),
    
    # NEGATIVES (high-entropy non-secrets)
    ("UUID", "uuid = '123e4567-e89b-12d3-a456-426614174000'", False),
    ("SHA256 Hash", "hash = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'", False),
    ("Commit Hash", "commit = '7d2e4f0a9b3c6d8e1f2a4b5c7d8e9f0a1b2c3d4e'", False),
]

def test_secret_detector_corpus():
    tp = 0
    fp = 0
    fn = 0
    tn = 0
    
    for label, content, expected_positive in CORPUS:
        sanitized, candidates = SecretSafeDetector.detect_and_redact(content, file_path="sample.py")
        
        detected = False
        for cand in candidates:
            if not cand.is_synthetic:
                detected = True
                
        if expected_positive and detected:
            tp += 1
        elif expected_positive and not detected:
            fn += 1
        elif not expected_positive and detected:
            fp += 1
        elif not expected_positive and not detected:
            tn += 1

    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    
    print(f"Precision: {precision:.2f}, Recall: {recall:.2f}")
    assert precision > 0.90, "Precision is too low"
    assert recall > 0.90, "Recall is too low"
