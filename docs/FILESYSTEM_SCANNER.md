# ECDAT Secure Filesystem Analyzer (Phase 4.4)

The ECDAT Filesystem Analyzer (`scanners/filesystem/`) performs secure static discovery of cryptographic assets, certificates, public keys, TLS/crypto configurations, library installations, and key store references across filesystems.

---

## 1. Discovery Capabilities

The analyzer detects 6 key classes of cryptographic assets:

1. **Certificate Files (`FilesystemAssetType.CERTIFICATE`)**:
   - Formats: X.509 PEM (`.crt`, `.pem`, `.cer`), X.509 DER, PKCS#7 (`.p7b`, `.p7c`), and X.509 CRL (`.crl`).
   - Metadata parsed: Subject, Issuer, Validity Dates (Not Before, Not After), format, and SHA-256 fingerprint.
   - Secret-safe guarantee: Raw private keys are never stored; if found in PEM files, secret redaction alerts are recorded without exposing the key.
2. **Public Keys (`FilesystemAssetType.PUBLIC_KEY`)**:
   - Formats: Generic SubjectPublicKeyInfo PEM, PKCS#1 RSA Public Keys, SEC1 EC Public Keys, DSA Public Keys, OpenSSH public keys (`id_rsa.pub`, `id_ed25519.pub`, `authorized_keys`, `known_hosts`), and JSON Web Key sets (`jwks.json`).
3. **Crypto Configurations (`FilesystemAssetType.CRYPTO_CONFIG`)**:
   - Discovers configuration files: `openssl.cnf`, `openssl.cfg`, `java.security`, `gpg.conf`, `ipsec.conf`, `strongswan.conf`, `krb5.conf`.
   - Directives parsed: `MinProtocol`, `CipherString`, `crypto.policy`, `jdk.tls.disabledAlgorithms`, cipher and digest preferences.
4. **TLS Configurations (`FilesystemAssetType.TLS_CONFIG`)**:
   - Discovers service configs: Nginx (`nginx.conf`, `conf.d/*.conf`), Apache (`httpd.conf`, `ssl.conf`), HAProxy (`haproxy.cfg`), Envoy (`envoy.yaml`), SSH daemon (`sshd_config`).
   - Settings parsed: `ssl_protocols`, `ssl_ciphers`, `SSLEngine`, `SSLProtocol`, `SSLCipherSuite`, `Ciphers`, `KexAlgorithms`, `MACs`.
5. **Library Installations (`FilesystemAssetType.LIBRARY_INSTALLATION`)**:
   - Discovers installed dynamic shared libraries: `.so`, `.so.*`, `.dylib`, `.dll`.
   - Fingerprinted via `LibraryFingerprinter` (OpenSSL, BoringSSL, LibreSSL, mbedTLS, wolfSSL, Botan, libsodium, Windows CNG, Apple Security frameworks).
6. **References to Key Stores (`FilesystemAssetType.KEY_STORE_REFERENCE`)**:
   - Formats: Java KeyStore (`.jks`, `.keystore`, `.truststore` with magic `0xFEEDFEED`), PKCS#12 bundles (`.p12`, `.pfx`), PKCS#11 configurations (`softhsm2.conf`, `pkcs11.cfg`), and Cloud KMS references (AWS KMS ARN, GCP Cloud KMS Key, Azure Key Vault, HashiCorp Vault).

---

## 2. Security Guards & Containment Protections

The analyzer strictly protects the host system and the scan process against malicious or malformed filesystem structures:

- **Scan-Root Containment (`is_contained`)**:
  - Every file and directory visited is validated using `resolved_path.is_relative_to(scan_root)`.
  - Traversal outside the scan root is strictly forbidden.
- **`../` Traversal Protection**:
  - Path traversal sequences in inputs or filenames are resolved and blocked before access.
- **Symlink Escape Protection**:
  - Symlink following is disabled by default (`follow_symlinks=False`).
  - If following symlinks is enabled, symlink destinations are resolved and verified against the scan root. Any symlink pointing outside is skipped and logged as a security warning.
- **Mount & Device Abuse Protection**:
  - Automatically skips virtual/pseudo-filesystems on Linux/Unix: `/proc`, `/sys`, `/dev`, `/run`, `/sys/fs/cgroup`.
  - Blocks device nodes: character devices (`S_ISCHR`), block devices (`S_ISBLK`), FIFOs/named pipes (`S_ISFIFO`), and UNIX domain sockets (`S_ISSOCK`).
  - Prevents circular loops (infinite directory loops or circular mounts) by tracking visited device/inode tuples `(st_dev, st_ino)`.
- **Giant Files & Resource Budgets**:
  - Enforces `max_file_size_bytes` (default 10 MB): files exceeding this limit are skipped with a warning, preventing memory exhaustion.
  - Enforces `max_total_bytes` (default 2 GB) and `max_files_count` (default 50,000 files).
  - Bounded content reading (reads up to 1 MB sample per file for signature matching).
- **Permission Confusion & Non-Crashing Resilience**:
  - Permission errors (`PermissionError`, `EACCES`) are gracefully trapped and recorded in `permission_denied_paths` without aborting the scan.
  - The scanner operates strictly under current unprivileged process credentials and never escalates permissions.

---

## 3. Usage

```python
from scanners.filesystem import FilesystemScanner, filesystem_report_to_cbom
from scanners.cbom_mapping import serialize_cbom

# Initialize scanner with containment on /path/to/scan
scanner = FilesystemScanner(
    scan_root="/path/to/scan",
    follow_symlinks=False,
    max_file_size_bytes=10 * 1024 * 1024,
)

# Execute discovery walk
report = scanner.scan()

print(f"Scanned {report.files_scanned} files across {report.directories_scanned} directories.")
print(f"Found {len(report.assets)} cryptographic assets.")

# Export to CycloneDX 1.6 CBOM
cbom = filesystem_report_to_cbom(report)
json_cbom = serialize_cbom(cbom)
```
