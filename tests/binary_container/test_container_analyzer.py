"""
Comprehensive test suite for Phase 4.3 Container Image Analyzer.
Verifies:
- Never executes application entrypoints
- Inspection of layers, packages, shared libraries, configs, certificates, crypto libraries, SBOM, and metadata
- Prevention of registry SSRF
- Prevention of credential leakage
- Prevention of untrusted registry access
- Prevention of oversized layers and decompression bombs
"""

import io
import json
import os
import tarfile
import tempfile
from pathlib import Path

import pytest
from scanners.binary_container.container_analyzer import (
    ContainerImageAnalyzer,
    container_report_to_cbom,
)
from scanners.binary_container.security_guards import (
    RegistrySSRFError,
    UntrustedRegistryError,
    DecompressionBombError,
    PathTraversalError,
    validate_registry_security,
    sanitize_config_env,
    SafeArchiveExtractor,
)
from scanners.cbom_mapping import serialize_cbom, validate_cbom_json


def create_synthetic_image_tarball() -> bytes:
    """
    Builds an in-memory Docker/OCI image tarball with layers, configs,
    packages, shared libraries, and certificates.
    """
    # 1. Build layer 1 (base layer: dpkg status, libcrypto.so.3, cert)
    layer1_stream = io.BytesIO()
    with tarfile.open(fileobj=layer1_stream, mode="w") as l1_tar:
        # /var/lib/dpkg/status
        dpkg_content = (
            b"Package: openssl\n"
            b"Version: 3.0.8-1\n"
            b"Architecture: amd64\n"
            b"Description: Secure Sockets Layer toolkit\n\n"
            b"Package: nginx\n"
            b"Version: 1.22.1-1\n"
            b"Architecture: amd64\n"
            b"Description: High performance web server\n\n"
        )
        ti_dpkg = tarfile.TarInfo(name="var/lib/dpkg/status")
        ti_dpkg.size = len(dpkg_content)
        l1_tar.addfile(ti_dpkg, io.BytesIO(dpkg_content))

        # /usr/lib/x86_64-linux-gnu/libcrypto.so.3
        lib_content = b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 200
        ti_lib = tarfile.TarInfo(name="usr/lib/libcrypto.so.3")
        ti_lib.size = len(lib_content)
        l1_tar.addfile(ti_lib, io.BytesIO(lib_content))

        # /etc/ssl/certs/ca-certificates.crt
        cert_content = (
            b"-----BEGIN CERTIFICATE-----\n"
            b"MIIDITCCAomgAwIBAgIUW6o1\n"
            b"Subject: CN=ECDAT Root CA, O=ECDAT Org\n"
            b"Issuer: CN=ECDAT Root CA, O=ECDAT Org\n"
            b"-----END CERTIFICATE-----\n"
        )
        ti_cert = tarfile.TarInfo(name="etc/ssl/certs/ca-certificates.crt")
        ti_cert.size = len(cert_content)
        l1_tar.addfile(ti_cert, io.BytesIO(cert_content))

    layer1_bytes = layer1_stream.getvalue()

    # 2. Config JSON
    config_dict = {
        "architecture": "amd64",
        "os": "linux",
        "created": "2026-09-13T12:00:00Z",
        "config": {
            "Entrypoint": ["/entrypoint.sh", "run"],
            "Cmd": ["nginx", "-g", "daemon off;"],
            "WorkingDir": "/var/www/html",
            "User": "www-data",
            "Labels": {"maintainer": "ecdat-team@example.com"},
            "Env": [
                "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "DB_PASSWORD=SuperSecretPassword123!",
                "API_KEY=sk_live_abcdef1234567890",
                "PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
                "APP_ENV=production",
            ],
        },
    }
    config_bytes = json.dumps(config_dict, indent=2).encode("utf-8")

    # 3. Manifest JSON
    manifest = [
        {
            "Config": "config.json",
            "RepoTags": ["my-org/secure-app:latest"],
            "Layers": ["layer1.tar"],
        }
    ]
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")

    # 4. Master Image Tarball
    image_stream = io.BytesIO()
    with tarfile.open(fileobj=image_stream, mode="w") as img_tar:
        # Add manifest.json
        ti_m = tarfile.TarInfo(name="manifest.json")
        ti_m.size = len(manifest_bytes)
        img_tar.addfile(ti_m, io.BytesIO(manifest_bytes))

        # Add config.json
        ti_c = tarfile.TarInfo(name="config.json")
        ti_c.size = len(config_bytes)
        img_tar.addfile(ti_c, io.BytesIO(config_bytes))

        # Add layer1.tar
        ti_l1 = tarfile.TarInfo(name="layer1.tar")
        ti_l1.size = len(layer1_bytes)
        img_tar.addfile(ti_l1, io.BytesIO(layer1_bytes))

    return image_stream.getvalue()


# ---------------------------------------------------------------------------
# Test: Never Execute Application Entrypoints
# ---------------------------------------------------------------------------

def test_never_execute_application_entrypoint(monkeypatch):
    """
    Strictly verifies that analyzing a container image NEVER runs the entrypoint, CMD,
    or spawns any sub-processes from inside the image.
    """
    import subprocess

    def forbidden_call(*args, **kwargs):
        raise AssertionError("SECURITY VIOLATION: Execution of container entrypoint was attempted!")

    monkeypatch.setattr(subprocess, "run", forbidden_call)
    monkeypatch.setattr(subprocess, "Popen", forbidden_call)
    monkeypatch.setattr(os, "system", forbidden_call)

    img_bytes = create_synthetic_image_tarball()
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
        tf.write(img_bytes)
        tf_path = Path(tf.name)

    try:
        analyzer = ContainerImageAnalyzer()
        report = analyzer.analyze_image_archive(tf_path, image_reference="docker.io/my-org/secure-app:latest")

        # Entrypoint is captured purely as passive metadata
        assert report.config.entrypoint == ["/entrypoint.sh", "run"]
        assert report.config.cmd == ["nginx", "-g", "daemon off;"]
        assert report.config.working_dir == "/var/www/html"
        assert report.config.user == "www-data"
    finally:
        if tf_path.exists():
            tf_path.unlink()


# ---------------------------------------------------------------------------
# Test: Inspection of Layers, Packages, Libraries, Configs, Certs, SBOM
# ---------------------------------------------------------------------------

def test_full_container_inspection():
    img_bytes = create_synthetic_image_tarball()
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
        tf.write(img_bytes)
        tf_path = Path(tf.name)

    try:
        analyzer = ContainerImageAnalyzer()
        report = analyzer.analyze_image_archive(tf_path, image_reference="docker.io/my-org/secure-app:latest")

        # 1. Layers
        assert len(report.layers) == 1
        assert report.layers[0].diff_id.startswith("sha256:")
        assert report.layers[0].file_count >= 3
        assert "libcrypto.so.3" in report.layers[0].added_crypto_libs

        # 2. Packages
        assert len(report.packages) == 2
        openssl_pkg = next(p for p in report.packages if p.name == "openssl")
        assert openssl_pkg.version == "3.0.8-1"
        assert openssl_pkg.is_crypto_relevant is True

        # 3. Shared libraries
        assert any(l.name == "libcrypto.so.3" for l in report.shared_libraries)

        # 4. Certificates
        assert len(report.certificates) >= 1
        cert = report.certificates[0]
        assert "ECDAT Root CA" in (cert.subject or "")
        assert cert.sha256_fingerprint is not None

        # 5. Crypto libraries fingerprinting
        assert any(c.library_name == "OpenSSL" for c in report.crypto_libraries)

        # 6. SBOM generation
        cbom = container_report_to_cbom(report)
        json_cbom = serialize_cbom(cbom)
        assert validate_cbom_json(json_cbom) is True

        parsed_cbom = json.loads(json_cbom)
        components = parsed_cbom.get("components", [])
        assert any(c["type"] == "container" for c in components)
        assert any(c["name"] == "OpenSSL" for c in components)
    finally:
        if tf_path.exists():
            tf_path.unlink()


# ---------------------------------------------------------------------------
# Test: Credential Leakage Prevention
# ---------------------------------------------------------------------------

def test_credential_leakage_prevention():
    raw_env = [
        "PATH=/usr/bin",
        "DATABASE_PASSWORD=SuperSecretPassword123!",
        "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "GITHUB_TOKEN=ghp_1234567890abcdef",
        "PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEogIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
        "APP_NAME=my-secure-service",
    ]

    sanitized = sanitize_config_env(raw_env)

    # Sensitive values MUST be redacted
    assert sanitized["DATABASE_PASSWORD"] == "[REDACTED_SECRET]"
    assert sanitized["AWS_SECRET_ACCESS_KEY"] == "[REDACTED_SECRET]"
    assert sanitized["GITHUB_TOKEN"] == "[REDACTED_SECRET]"
    assert sanitized["PRIVATE_KEY"] == "[REDACTED_SECRET]"

    # Non-sensitive values MUST be preserved
    assert sanitized["PATH"] == "/usr/bin"
    assert sanitized["APP_NAME"] == "my-secure-service"

    # Verify raw secret strings never appear in serialized output
    json_dump = json.dumps(sanitized)
    assert "SuperSecretPassword123!" not in json_dump
    assert "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" not in json_dump
    assert "ghp_1234567890abcdef" not in json_dump


# ---------------------------------------------------------------------------
# Test: Registry SSRF Prevention
# ---------------------------------------------------------------------------

def test_prevent_registry_ssrf():
    """
    Prevents SSRF attacks against loopback, private IPs, link-local, and cloud metadata.
    """
    ssrf_targets = [
        "127.0.0.1:5000/app:latest",
        "127.0.0.1/app:latest",
        "localhost:5000/my-image",
        "169.254.169.254/secret:v1",          # AWS/GCP/Azure IMDS
        "metadata.google.internal/app:latest",
        "10.0.0.1:5000/internal-repo:latest", # RFC 1918 private
        "192.168.1.1/app:latest",             # RFC 1918 private
        "172.16.0.1:5000/app:latest",          # RFC 1918 private
        "http://docker.io/library/nginx:latest",  # URL scheme injection
        "file:///etc/shadow",                  # Local file inclusion
    ]

    for target in ssrf_targets:
        with pytest.raises(RegistrySSRFError):
            validate_registry_security(target)


# ---------------------------------------------------------------------------
# Test: Untrusted Registry Access Prevention
# ---------------------------------------------------------------------------

def test_prevent_untrusted_registry():
    """
    Enforces registry allowlist when policy is active.
    """
    allowed = {"docker.io", "ghcr.io"}

    # Allowed registries pass
    reg, repo = validate_registry_security("ghcr.io/org/repo:v1", allowed_registries=allowed, enforce_allowlist=True)
    assert reg == "ghcr.io"

    # Untrusted registry is blocked
    with pytest.raises(UntrustedRegistryError):
        validate_registry_security("untrusted-registry.evil.com/app:latest", allowed_registries=allowed, enforce_allowlist=True)


# ---------------------------------------------------------------------------
# Test: Decompression Bombs & Oversized Layers Prevention
# ---------------------------------------------------------------------------

def test_prevent_tar_slip_path_traversal():
    """
    Guarantees that archive members attempting directory traversal are blocked.
    """
    tar_stream = io.BytesIO()
    with tarfile.open(fileobj=tar_stream, mode="w") as tar:
        ti = tarfile.TarInfo(name="../../etc/shadow")
        ti.size = 10
        tar.addfile(ti, io.BytesIO(b"root:x:0:0"))

    tar_bytes = tar_stream.getvalue()
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
        tf.write(tar_bytes)
        tf_path = Path(tf.name)

    with tempfile.TemporaryDirectory() as extract_dir:
        extractor = SafeArchiveExtractor()
        with pytest.raises(PathTraversalError):
            extractor.inspect_and_extract_layer(tf_path, Path(extract_dir))

    if tf_path.exists():
        tf_path.unlink()


def test_prevent_oversized_layer():
    """
    Rejects layers exceeding max layer size.
    """
    extractor = SafeArchiveExtractor(max_layer_size_bytes=1024)  # 1 KB limit

    tar_stream = io.BytesIO()
    with tarfile.open(fileobj=tar_stream, mode="w") as tar:
        payload = b"A" * 2048  # 2 KB uncompressed
        ti = tarfile.TarInfo(name="large_file.dat")
        ti.size = len(payload)
        tar.addfile(ti, io.BytesIO(payload))

    tar_bytes = tar_stream.getvalue()
    with tempfile.NamedTemporaryFile(suffix=".tar", delete=False) as tf:
        tf.write(tar_bytes)
        tf_path = Path(tf.name)

    with tempfile.TemporaryDirectory() as extract_dir:
        with pytest.raises(DecompressionBombError):
            extractor.inspect_and_extract_layer(tf_path, Path(extract_dir))

    if tf_path.exists():
        tf_path.unlink()
