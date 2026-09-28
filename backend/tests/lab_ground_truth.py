import sys
from scanners.network.plugins.tls import TlsScanner, ScanProfile
from scanners.network.target_validation import NormalizedTarget

def run_lab_test():
    print("Scanning Nginx server on port 8443 (configured for TLS 1.2 and 1.3)...")
    scanner = TlsScanner(profile=ScanProfile.QUICK)
    target = NormalizedTarget(original_input="127.0.0.1", hostname="127.0.0.1", port=8443, resolved_ip="127.0.0.1")
    
    findings = scanner.scan([target], max_concurrency=1)
    
    f = findings[0]
    print(f"Scan Status: {f.scan_status}")
    if f.error_reason:
        print(f"Error: {f.error_reason}")
    print(f"TLS Versions: {f.tls_versions}")
    print(f"Cipher Suites: {f.cipher_suites}")
    print(f"PQC Groups Accepted: {f.pqc_groups_accepted}")
    
    if "TLSv1.3" not in f.tls_versions:
        print("MISMATCH: Expected TLSv1.3 support")
    if "TLSv1.2" not in f.tls_versions:
        print("MISMATCH: Expected TLSv1.2 support")
        
    expected_groups = ["X25519", "SECP256R1"]
    missing = [g for g in expected_groups if g not in f.pqc_groups_accepted]
    if missing:
        print(f"MISMATCH: Missing expected groups: {missing}")

if __name__ == "__main__":
    run_lab_test()
