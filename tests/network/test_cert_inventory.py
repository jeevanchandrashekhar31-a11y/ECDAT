import json
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scanners.network.cert_inventory import (
    CertificateInventory,
    CertificateInventoryItem,
    RenewalState,
    TrustStatus,
    assert_no_private_key,
)
from scanners.models import NetworkCryptoFinding
from scanners.cbom_mapping import serialize_cbom, validate_cbom_json


def _make_cert_dict(
    fp="abcdef0123456789",
    subject="CN=api.example.com,O=Example Corp,C=US",
    issuer="CN=Example CA,O=Example Corp,C=US",
    sans=None,
    days_to_expiry=90,
    algo="RSA",
    key_size=2048,
    sig_algo="sha256WithRSAEncryption",
    is_self_signed=False,
    is_not_yet_valid=False,
):
    now = datetime.now(timezone.utc)
    if is_not_yet_valid:
        not_before = (now + timedelta(days=5)).isoformat()
        not_after = (now + timedelta(days=90)).isoformat()
    else:
        not_before = (now - timedelta(days=30)).isoformat()
        not_after = (now + timedelta(days=days_to_expiry)).isoformat()

    return {
        "fingerprint_sha256": fp,
        "serial_number": "1234567890",
        "subjectName": subject,
        "issuerName": issuer,
        "sans": sans or ["api.example.com", "api-internal.example.com"],
        "notValidBefore": not_before,
        "notValidAfter": not_after,
        "algo_family": algo,
        "key_size": key_size,
        "signature_algorithm": sig_algo,
        "isSelfSigned": is_self_signed,
    }


# ==============================================================================
# 1. FIELD TRACKING & INVENTORY TESTS
# ==============================================================================

def test_certificate_inventory_tracks_all_required_fields():
    inv = CertificateInventory()
    cert_data = _make_cert_dict(
        fp="leaf_fp_001",
        subject="CN=service.prod.corp,O=Corp",
        issuer="CN=Intermediate CA,O=Corp",
        sans=["service.prod.corp", "alt.prod.corp"],
        days_to_expiry=120,
        algo="RSA",
        key_size=4096,
        sig_algo="sha256WithRSAEncryption",
    )
    chain = [
        cert_data,
        {
            "fingerprint_sha256": "intermediate_fp_002",
            "subjectName": "CN=Intermediate CA,O=Corp",
            "issuerName": "CN=Root CA,O=Corp",
        },
        {
            "fingerprint_sha256": "root_fp_003",
            "subjectName": "CN=Root CA,O=Corp",
            "issuerName": "CN=Root CA,O=Corp",
            "isSelfSigned": True,
        },
    ]
    endpoint = {"endpoint": "service.prod.corp:443", "host": "service.prod.corp", "port": 443}

    item = inv.add_or_update_certificate(
        cert_data=cert_data,
        chain=chain,
        endpoint=endpoint,
        owner="sec-ops@corp.internal",
        environment="production",
    )

    # Verification of all required tracked fields
    assert item.fingerprint_sha256 == "leaf_fp_001"
    assert item.subject == "CN=service.prod.corp,O=Corp"
    assert item.issuer == "CN=Intermediate CA,O=Corp"
    assert item.san == ["service.prod.corp", "alt.prod.corp"]
    assert item.not_before != ""
    assert item.not_after != ""
    assert item.days_until_expiration > 100
    assert item.public_key_algorithm == "RSA"
    assert item.public_key_size == 4096
    assert item.signature_algorithm == "sha256WithRSAEncryption"
    assert len(item.chain) == 3
    assert item.chain_fingerprints == ["leaf_fp_001", "intermediate_fp_002", "root_fp_003"]
    assert item.trust_context["trust_status"] == TrustStatus.TRUSTED.value
    assert len(item.endpoint_usage) == 1
    assert item.endpoint_usage[0]["endpoint"] == "service.prod.corp:443"
    assert item.owner == "sec-ops@corp.internal"
    assert item.environment == "production"
    assert item.renewal_state == RenewalState.OK.value


# ==============================================================================
# 2. ANOMALY DETECTION TESTS
# ==============================================================================

def test_detect_expired_and_expiring():
    inv = CertificateInventory(warning_days=30, critical_days=7)

    # 1. Expired certificate (-10 days)
    cert_exp = _make_cert_dict(fp="expired_cert", days_to_expiry=-10)
    item_exp = inv.add_or_update_certificate(cert_exp)
    assert item_exp.renewal_state == RenewalState.EXPIRED.value
    assert "expired" in item_exp.detected_anomalies

    # 2. Critically expiring (4 days)
    cert_crit = _make_cert_dict(fp="crit_cert", days_to_expiry=4)
    item_crit = inv.add_or_update_certificate(cert_crit)
    assert item_crit.renewal_state == RenewalState.CRITICAL_EXPIRING.value
    assert "expiring" in item_crit.detected_anomalies

    # 3. Expiring soon (20 days)
    cert_warn = _make_cert_dict(fp="warn_cert", days_to_expiry=20)
    item_warn = inv.add_or_update_certificate(cert_warn)
    assert item_warn.renewal_state == RenewalState.EXPIRING_SOON.value
    assert "expiring" in item_warn.detected_anomalies


def test_detect_weak_keys_and_deprecated_signatures():
    inv = CertificateInventory()

    # Weak RSA key (1024-bit) and deprecated SHA-1 signature
    cert_weak = _make_cert_dict(
        fp="weak_cert_1",
        algo="RSA",
        key_size=1024,
        sig_algo="sha1WithRSAEncryption",
        days_to_expiry=180,
    )
    item_weak = inv.add_or_update_certificate(cert_weak)
    assert "weak_keys" in item_weak.detected_anomalies
    assert "deprecated_signatures" in item_weak.detected_anomalies

    # Weak MD5 signature
    cert_md5 = _make_cert_dict(
        fp="weak_cert_md5",
        algo="RSA",
        key_size=2048,
        sig_algo="md5WithRSAEncryption",
        days_to_expiry=180,
    )
    item_md5 = inv.add_or_update_certificate(cert_md5)
    assert "deprecated_signatures" in item_md5.detected_anomalies

    # Weak EC curve (< 224 bits, e.g. 192)
    cert_ec_weak = _make_cert_dict(
        fp="weak_ec",
        algo="EC",
        key_size=192,
        sig_algo="ecdsa-with-SHA256",
        days_to_expiry=180,
    )
    item_ec = inv.add_or_update_certificate(cert_ec_weak)
    assert "weak_keys" in item_ec.detected_anomalies


def test_detect_invalid_chains():
    inv = CertificateInventory()

    # 1. Broken issuer-subject linkage in chain
    leaf = _make_cert_dict(
        fp="broken_chain_leaf",
        subject="CN=leaf.example.com",
        issuer="CN=Expected Intermediate CA",
    )
    unmatched_intermediate = {
        "fingerprint_sha256": "wrong_intermediate",
        "subjectName": "CN=Unrelated Intermediate CA",
        "issuerName": "CN=Root CA",
    }
    item_broken = inv.add_or_update_certificate(leaf, chain=[leaf, unmatched_intermediate])
    assert "invalid_chains" in item_broken.detected_anomalies

    # 2. Missing intermediate in non-self-signed cert
    leaf_missing = _make_cert_dict(
        fp="missing_intermediate_leaf",
        subject="CN=service.internal",
        issuer="CN=Enterprise Sub CA",
        is_self_signed=False,
    )
    item_missing = inv.add_or_update_certificate(leaf_missing, chain=[leaf_missing])
    assert "invalid_chains" in item_missing.detected_anomalies


def test_detect_inconsistent_deployments():
    inv = CertificateInventory()

    # 1. Multiple differing certificates serving the same hostname across different endpoints
    cert_node1 = _make_cert_dict(
        fp="cert_cluster_node1",
        subject="CN=api.cluster.internal",
        sans=["api.cluster.internal"],
        days_to_expiry=60,
    )
    cert_node2 = _make_cert_dict(
        fp="cert_cluster_node2",
        subject="CN=api.cluster.internal",
        sans=["api.cluster.internal"],
        days_to_expiry=300,
    )

    inv.add_or_update_certificate(cert_node1, endpoint={"endpoint": "10.0.0.1:443", "host": "api.cluster.internal", "port": 443})
    inv.add_or_update_certificate(cert_node2, endpoint={"endpoint": "10.0.0.2:443", "host": "api.cluster.internal", "port": 443})

    inconsistencies = inv.detect_inconsistent_deployments()
    assert "cert_cluster_node1" in inconsistencies
    assert "cert_cluster_node2" in inconsistencies
    assert any("multiple_certificates_for_host:api.cluster.internal" in a for a in inv.get("cert_cluster_node1").detected_anomalies)

    # 2. Hostname mismatch
    cert_mismatch = _make_cert_dict(
        fp="cert_mismatch",
        subject="CN=internal.corp",
        sans=["internal.corp", "db.internal.corp"],
    )
    item_mismatch = inv.add_or_update_certificate(
        cert_mismatch,
        endpoint={"endpoint": "public-api.corp.com:443", "host": "public-api.corp.com", "port": 443},
    )
    inv.detect_inconsistent_deployments()
    assert any("hostname_mismatch:public-api.corp.com" in a for a in item_mismatch.detected_anomalies)

    # 3. Production self-signed certificate
    cert_self_signed = _make_cert_dict(
        fp="cert_self_signed_prod",
        subject="CN=gateway.corp.com",
        issuer="CN=gateway.corp.com",
        is_self_signed=True,
    )
    item_prod_ss = inv.add_or_update_certificate(cert_self_signed, environment="production")
    inv.detect_inconsistent_deployments()
    assert any("production_self_signed" in a for a in item_prod_ss.detected_anomalies)


# ==============================================================================
# 3. STRICT INVARIANT: NEVER STORE PRIVATE KEY MATERIAL
# ==============================================================================

def test_strict_invariant_never_store_private_key():
    # 1. Direct assert function
    with pytest.raises(ValueError) as exc:
        assert_no_private_key("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...")
    assert "SECURITY VIOLATION" in str(exc.value)

    with pytest.raises(ValueError):
        assert_no_private_key("-----BEGIN PRIVATE KEY-----")

    with pytest.raises(ValueError):
        assert_no_private_key("-----BEGIN EC PRIVATE KEY-----")

    # 2. Attempting to add certificate with private key in cert_data or chain
    inv = CertificateInventory()
    poisoned_cert = _make_cert_dict()
    poisoned_cert["private_key"] = "-----BEGIN RSA PRIVATE KEY-----\n..."

    with pytest.raises(ValueError):
        inv.add_or_update_certificate(poisoned_cert)

    # 3. Attempting to instantiate item with private key in subject/owner
    with pytest.raises(ValueError):
        CertificateInventoryItem(
            fingerprint_sha256="safe_fp",
            serial_number="123",
            subject="-----BEGIN PRIVATE KEY-----",
            issuer="CN=CA",
        )


# ==============================================================================
# 4. NETWORK SCANNING FINDING INGESTION & CBOM
# ==============================================================================

def test_ingest_from_network_finding_and_cbom_validation(tmp_path):
    inv = CertificateInventory()

    finding = NetworkCryptoFinding(
        bom_ref="net:target/api.secure.org:443",
        host="api.secure.org",
        port=443,
        tls_versions=["TLSv1.3"],
        cipher_suites=["TLS_AES_256_GCM_SHA384"],
        cert_chain=[
            {
                "fingerprint_sha256": "leaf_sha256_abcdef",
                "serial_number": "999888777",
                "subjectName": "CN=api.secure.org",
                "issuerName": "CN=Let's Encrypt R3",
                "sans": ["api.secure.org"],
                "notValidBefore": "2026-01-01T00:00:00+00:00",
                "notValidAfter": "2027-10-01T00:00:00+00:00",
                "algo_family": "EC",

                "key_size": 256,
                "signature_algorithm": "ecdsa-with-SHA384",
                "isSelfSigned": False,
            },
            {
                "fingerprint_sha256": "inter_sha256_123456",
                "subjectName": "CN=Let's Encrypt R3",
                "issuerName": "CN=ISRG Root X1",
            },
        ],
    )

    items = inv.ingest_from_network_finding(finding, owner="cloud-team@secure.org", environment="production")
    assert len(items) == 1
    assert items[0].fingerprint_sha256 == "leaf_sha256_abcdef"
    assert items[0].owner == "cloud-team@secure.org"

    # Export to CBOM and validate
    bom = inv.to_cbom()
    json_str = serialize_cbom(bom)
    assert validate_cbom_json(json_str) is True

    # Check CBOM properties
    cbom_data = json.loads(json_str)
    comp = cbom_data["components"][0]
    props = {p["name"]: p["value"] for p in comp["properties"]}
    assert props["ecdat:fingerprint"] == "leaf_sha256_abcdef"
    assert props["ecdat:owner"] == "cloud-team@secure.org"
    assert props["ecdat:renewalState"] == RenewalState.OK.value
    assert "api.secure.org:443" in props["ecdat:endpointUsage"]

    # File export & reload
    out_file = tmp_path / "cert_inventory.json"
    inv.save_to_file(out_file)
    assert out_file.exists()

    reloaded = CertificateInventory.load_from_file(out_file)
    assert len(reloaded.all_items()) == 1
    assert reloaded.get("leaf_sha256_abcdef").owner == "cloud-team@secure.org"
