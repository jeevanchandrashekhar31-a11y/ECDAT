from scanners.network.plugins.ssh import SshScanner
from scanners.network.target_validation import NormalizedTarget

def test_ssh_github():
    print("Scanning github.com:22...")
    scanner = SshScanner()
    target = NormalizedTarget(original_input="github.com", hostname="github.com", port=22, resolved_ip="140.82.112.4")
    
    findings = scanner.scan([target], max_concurrency=1)
    
    f = findings[0]
    print(f"Scan Status: {f.scan_status}")
    if f.error_reason:
        print(f"Error: {f.error_reason}")
    print(f"Banner: {f.tls_versions}")
    print(f"Key Exchanges: {f.key_exchanges}")
    print(f"Host Keys (Sig Algs): {f.signature_algorithms}")
    # Extract ciphers, macs, etc. from cipher_suites which holds enc, mac, comp as prefixed strings.
    enc = [c for c in f.cipher_suites if c.startswith("enc:")]
    macs = [c for c in f.cipher_suites if c.startswith("mac:")]
    print(f"Ciphers: {enc}")
    print(f"MACs: {macs}")

if __name__ == "__main__":
    test_ssh_github()
