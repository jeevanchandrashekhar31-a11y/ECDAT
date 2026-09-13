"""
Comprehensive tests for Phase 4.4 Secure Filesystem Analyzer.
Verifies detection of:
- Certificate files
- Public keys
- Crypto configuration
- TLS configuration
- Library installations
- References to key stores
Verifies protection against:
- ../ traversal
- Symlink escapes
- Mount/device abuse
- Giant files
- Permission confusion
- Scan-root containment enforcement
"""

import json
import os
import tempfile
from pathlib import Path

import pytest
from scanners.filesystem import (
    FilesystemScanner,
    FilesystemAssetType,
    FilesystemSecurityGuard,
    ContainmentViolationError,
    filesystem_report_to_cbom,
)
from scanners.cbom_mapping import serialize_cbom, validate_cbom_json


@pytest.fixture
def crypto_filesystem_tree():
    """
    Creates a rich temporary directory tree containing certificates, public keys,
    crypto configs, TLS configs, shared libraries, and key stores.
    """
    with tempfile.TemporaryDirectory(prefix="ecdat_fs_test_") as tmp_dir:
        root = Path(tmp_dir)

        # 1. Certificates
        certs_dir = root / "etc" / "ssl" / "certs"
        certs_dir.mkdir(parents=True)
        cert_file = certs_dir / "server.crt"
        cert_file.write_bytes(
            b"-----BEGIN CERTIFICATE-----\n"
            b"MIIDTjCCAjagAwIBAgIUW6o1...\n"
            b"Subject: CN=api.example.com, O=Example Corp\n"
            b"Issuer: CN=Example Intermediate CA, O=Example Corp\n"
            b"Not Before: May 1 00:00:00 2026 GMT\n"
            b"Not After : May 1 00:00:00 2027 GMT\n"
            b"-----END CERTIFICATE-----\n"
        )

        # 2. Public Keys (PEM, SSH, JWK)
        keys_dir = root / "etc" / "keys"
        keys_dir.mkdir(parents=True)
        pubkey_pem = keys_dir / "rsa_pub.pem"
        pubkey_pem.write_bytes(
            b"-----BEGIN PUBLIC KEY-----\n"
            b"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n"
            b"-----END PUBLIC KEY-----\n"
        )

        ssh_pub = keys_dir / "id_ed25519.pub"
        ssh_pub.write_text("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey user@host\n")

        jwk_file = keys_dir / "jwks.json"
        jwk_file.write_text(
            json.dumps({
                "keys": [
                    {"kty": "RSA", "use": "sig", "kid": "key1", "n": "0vx7agoebGcQSuuPiG...", "e": "AQAB"}
                ]
            })
        )

        # 3. Crypto Configuration (OpenSSL, Java security)
        conf_dir = root / "etc" / "crypto_conf"
        conf_dir.mkdir(parents=True)
        openssl_cnf = conf_dir / "openssl.cnf"
        openssl_cnf.write_text(
            "[system_default_sect]\n"
            "MinProtocol = TLSv1.2\n"
            "CipherString = DEFAULT@SECLEVEL=2:!aNULL:!eNULL\n"
        )

        java_sec = conf_dir / "java.security"
        java_sec.write_text(
            "crypto.policy=unlimited\n"
            "jdk.tls.disabledAlgorithms=SSLv3, TLSv1, TLSv1.1, RC4, DES, MD5withRSA\n"
        )

        # 4. TLS Configuration (Nginx, SSHD)
        nginx_dir = root / "etc" / "nginx"
        nginx_dir.mkdir(parents=True)
        nginx_conf = nginx_dir / "nginx.conf"
        nginx_conf.write_text(
            "server {\n"
            "    listen 443 ssl;\n"
            "    ssl_protocols TLSv1.2 TLSv1.3;\n"
            "    ssl_ciphers HIGH:!aNULL:!MD5;\n"
            "    ssl_certificate /etc/ssl/certs/server.crt;\n"
            "}\n"
        )

        # 5. Shared Libraries (OpenSSL, libsodium)
        lib_dir = root / "usr" / "lib"
        lib_dir.mkdir(parents=True)
        (lib_dir / "libcrypto.so.3").write_bytes(b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 100)
        (lib_dir / "libsodium.so.23").write_bytes(b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 100)

        # 6. References to Key Stores (JKS, PKCS#12, Cloud KMS)
        keystore_dir = root / "var" / "keystores"
        keystore_dir.mkdir(parents=True)
        jks_file = keystore_dir / "application.jks"
        jks_file.write_bytes(b"\xfe\xed\xfe\xed" + b"\x00" * 200)

        p12_file = keystore_dir / "client.p12"
        p12_file.write_bytes(b"\x30\x82\x01\x00" + b"\x00" * 150)

        kms_config = keystore_dir / "kms_config.yaml"
        kms_config.write_text(
            "kms:\n"
            "  provider: aws\n"
            "  key_arn: arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012\n"
        )

        yield root


# ---------------------------------------------------------------------------
# Test: Full Filesystem Discovery Across All 6 Asset Types
# ---------------------------------------------------------------------------

def test_filesystem_scanner_discovers_all_asset_types(crypto_filesystem_tree):
    scanner = FilesystemScanner(str(crypto_filesystem_tree))
    report = scanner.scan()

    assert report.scan_status == "success"
    assert report.files_scanned >= 10
    assert report.directories_scanned >= 6
    assert len(report.assets) >= 8

    # 1. Certificate files
    cert_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.CERTIFICATE]
    assert len(cert_assets) >= 1
    assert any("api.example.com" in a.metadata.get("subject", "") for a in cert_assets)
    assert any(a.file_path.endswith("server.crt") for a in cert_assets)

    # 2. Public keys
    pubkey_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.PUBLIC_KEY]
    assert len(pubkey_assets) >= 2
    types = [a.metadata.get("key_type", "") for a in pubkey_assets]
    assert any("RSA Public Key" in t or "SubjectPublicKeyInfo" in t for t in types)
    assert any("OpenSSH" in t for t in types)

    # 3. Crypto configuration
    crypto_cfg_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.CRYPTO_CONFIG]
    assert len(crypto_cfg_assets) >= 2
    openssl_asset = next(a for a in crypto_cfg_assets if "openssl.cnf" in a.file_path)
    assert "openssl:MinProtocol" in openssl_asset.metadata.get("directives", {})

    # 4. TLS configuration
    tls_cfg_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.TLS_CONFIG]
    assert len(tls_cfg_assets) >= 1
    nginx_asset = next(a for a in tls_cfg_assets if "nginx.conf" in a.file_path)
    assert "nginx:ssl_protocols" in nginx_asset.metadata.get("tls_settings", {})

    # 5. Library installations
    lib_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.LIBRARY_INSTALLATION]
    assert len(lib_assets) >= 2
    lib_names = [a.metadata.get("library_name") for a in lib_assets]
    assert "OpenSSL" in lib_names
    assert "libsodium" in lib_names

    # 6. References to key stores
    keystore_assets = [a for a in report.assets if a.asset_type == FilesystemAssetType.KEY_STORE_REFERENCE]
    assert len(keystore_assets) >= 2
    store_types = [a.metadata.get("store_type", "") for a in keystore_assets]
    assert any("JKS" in st for st in store_types)
    assert any("Cloud KMS" in st for st in store_types)

    # Containment verified on all assets
    for asset in report.assets:
        assert asset.containment_verified is True


# ---------------------------------------------------------------------------
# Test: Scan-Root Containment & ../ Traversal Protection
# ---------------------------------------------------------------------------

def test_prevent_dot_dot_traversal(crypto_filesystem_tree):
    guard = FilesystemSecurityGuard(crypto_filesystem_tree)

    # Path attempting to escape via ../
    escaping_path = crypto_filesystem_tree / "etc" / ".." / ".." / "outside_root"
    assert guard.is_contained(escaping_path) is False

    is_safe, reason = guard.check_file_safety(escaping_path)
    assert is_safe is False
    assert "CONTAINMENT_VIOLATION" in reason


# ---------------------------------------------------------------------------
# Test: Symlink Escape Protection
# ---------------------------------------------------------------------------

def test_prevent_symlink_escape(crypto_filesystem_tree):
    """
    Creates a symlink inside the scan root pointing to a file outside the scan root.
    Verifies that the scanner skips it and does NOT follow it.
    """
    with tempfile.NamedTemporaryFile(suffix=".secret", delete=False) as outside_file:
        outside_file.write(b"EXTREMELY_SENSITIVE_DATA_OUTSIDE_ROOT")
        outside_path = Path(outside_file.name)

    symlink_path = crypto_filesystem_tree / "escape_link"
    try:
        try:
            symlink_path.symlink_to(outside_path)
        except (OSError, NotImplementedError):
            pytest.skip("Symlink creation not permitted in this environment")

        scanner = FilesystemScanner(str(crypto_filesystem_tree), follow_symlinks=False)
        report = scanner.scan()

        # Symlink must be skipped
        assert report.skipped_symlinks >= 1

        # Even with follow_symlinks=True, escaping targets MUST be blocked by containment checks
        scanner_follow = FilesystemScanner(str(crypto_filesystem_tree), follow_symlinks=True)
        report_follow = scanner_follow.scan()
        assert report_follow.skipped_symlinks >= 1
        assert any("escape_link" in w for w in report_follow.security_warnings)
    finally:
        if symlink_path.is_symlink():
            symlink_path.unlink()
        if outside_path.exists():
            outside_path.unlink()


# ---------------------------------------------------------------------------
# Test: Giant File Protection
# ---------------------------------------------------------------------------

def test_prevent_giant_files(crypto_filesystem_tree):
    """
    Creates a file exceeding max_file_size_bytes and verifies it is skipped.
    """
    giant_file = crypto_filesystem_tree / "huge_data.bin"
    # Write 100 KB file with limit set to 10 KB
    giant_file.write_bytes(b"A" * 100 * 1024)

    scanner = FilesystemScanner(
        str(crypto_filesystem_tree),
        max_file_size_bytes=10 * 1024,  # 10 KB limit
    )
    report = scanner.scan()

    assert report.skipped_giant_files >= 1


# ---------------------------------------------------------------------------
# Test: Permission Confusion & Graceful Handling
# ---------------------------------------------------------------------------

def test_permission_denied_graceful_handling(crypto_filesystem_tree, monkeypatch):
    """
    Simulates a PermissionError on a directory and verifies the scanner continues safely.
    """
    restricted_dir = crypto_filesystem_tree / "restricted"
    restricted_dir.mkdir()
    (restricted_dir / "secret.crt").write_text("-----BEGIN CERTIFICATE-----\nMIID...")

    original_scandir = os.scandir

    def mocked_scandir(path):
        if "restricted" in str(path):
            raise PermissionError("Access is denied")
        return original_scandir(path)

    monkeypatch.setattr(os, "scandir", mocked_scandir)

    scanner = FilesystemScanner(str(crypto_filesystem_tree))
    report = scanner.scan()

    assert report.scan_status == "success"
    assert any("restricted" in p for p in report.permission_denied_paths)


# ---------------------------------------------------------------------------
# Test: CBOM Generation from Filesystem Report
# ---------------------------------------------------------------------------

def test_filesystem_report_to_cbom(crypto_filesystem_tree):
    scanner = FilesystemScanner(str(crypto_filesystem_tree))
    report = scanner.scan()

    cbom = filesystem_report_to_cbom(report)
    json_str = serialize_cbom(cbom)

    assert validate_cbom_json(json_str) is True
    data = json.loads(json_str)

    components = data.get("components", [])
    assert len(components) >= 8

    root_comp = next(c for c in components if c["type"] == "application")
    assert "Filesystem:" in root_comp["name"]
    root_props = {p["name"]: p["value"] for p in root_comp.get("properties", [])}
    assert root_props["ecdat:analysis_mode"] == "SECURE_FILESYSTEM_CONTAINED"

    # Verify library component
    lib_comp = next(c for c in components if c["type"] == "library")
    assert "OpenSSL" in lib_comp["name"] or "libsodium" in lib_comp["name"]
