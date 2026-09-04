from scanners.binary_container.component_classifier import (
    is_cryptographic_component,
    parse_cyclonedx_for_crypto,
    match_crypto_library,
)
from scanners.cbom_mapping import binary_finding_to_cbom, serialize_cbom


def test_is_cryptographic_component():
    assert is_cryptographic_component("openssl") is True
    assert is_cryptographic_component("libssl") is True
    assert is_cryptographic_component("libssl3") is True
    assert is_cryptographic_component("mbedtls") is True
    assert is_cryptographic_component("libsodium") is True
    assert is_cryptographic_component("libgcrypt20") is True
    assert is_cryptographic_component("bouncycastle") is True
    assert is_cryptographic_component("express") is False
    assert is_cryptographic_component("lodash") is False


def test_match_crypto_library_metadata():
    entry = match_crypto_library("libssl3")
    assert entry is not None
    assert entry["canonical_name"] == "OpenSSL"
    assert "TLS" in entry["typical_capabilities"]
    assert entry["confidence_limits"] == "medium"


def test_parse_cyclonedx_for_crypto_with_metadata():
    mock_data = {
        "components": [
            {
                "bom-ref": "pkg:deb/debian/libssl3@3.0.11",
                "name": "libssl3",
                "version": "3.0.11-1~deb12u2",
                "purl": "pkg:deb/debian/libssl3@3.0.11-1~deb12u2?arch=amd64",
                "cpe": "cpe:2.3:a:openssl:openssl:3.0.11:*:*:*:*:*:*:*",
                "properties": [{"name": "syft:location:0:path", "value": "/usr/lib/x86_64-linux-gnu/libssl.so.3"}],
            },
            {"name": "nginx", "version": "1.21.0"},
            {"name": "node-forge", "version": "1.3.1", "purl": "pkg:npm/node-forge@1.3.1"},
        ]
    }

    findings = parse_cyclonedx_for_crypto("test-target", mock_data)
    assert len(findings) == 2

    # Check libssl3 finding
    ssl_finding = findings[0]
    assert ssl_finding.component_name == "libssl3"
    assert ssl_finding.component_version == "3.0.11-1~deb12u2"
    assert ssl_finding.crypto_library == "OpenSSL"
    assert ssl_finding.evidence_type == "package_inventory"
    assert ssl_finding.confidence == "medium"
    assert ssl_finding.purl == "pkg:deb/debian/libssl3@3.0.11-1~deb12u2?arch=amd64"
    assert ssl_finding.cpe == "cpe:2.3:a:openssl:openssl:3.0.11:*:*:*:*:*:*:*"
    assert ssl_finding.artifact_path == "/usr/lib/x86_64-linux-gnu/libssl.so.3"

    # Test CBOM conversion
    cbom = binary_finding_to_cbom(ssl_finding)
    json_str = serialize_cbom(cbom)
    assert "package_inventory" in json_str
    assert "Library presence does not prove active crypto usage." in json_str
    assert "syft:cpe" in json_str
    assert "syft:artifact_path" in json_str
