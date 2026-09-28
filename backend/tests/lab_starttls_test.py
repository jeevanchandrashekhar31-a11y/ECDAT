from scanners.network.plugins.tls import TlsScanner, ScanProfile
from scanners.network.target_validation import NormalizedTarget

def test_starttls_smtp():
    print("Scanning smtp.office365.com:587 (STARTTLS SMTP)...")
    scanner = TlsScanner(profile=ScanProfile.QUICK)
    import socket
    ip = socket.gethostbyname("smtp.office365.com")
    target = NormalizedTarget(original_input="smtp.office365.com", hostname="smtp.office365.com", port=587, resolved_ip=ip)
    
    findings = scanner.scan([target], max_concurrency=1, timeout=15)
    
    f = findings[0]
    print(f"Scan Status: {f.scan_status}")
    if f.error_reason:
        print(f"Error: {f.error_reason}")
    print(f"TLS Versions: {f.tls_versions}")
    print(f"Cipher Suites: {f.cipher_suites}")
    print(f"Key Sizes: {f.key_sizes}")
    
if __name__ == "__main__":
    test_starttls_smtp()
