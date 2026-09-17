import json
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import cryptography.x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa, ec

from scanners.models import NetworkCryptoFinding
from scanners.network.authorization import (
    TargetScope,
    TargetScopeAuthorizer,
    AuditLogger,
    ScopeAuthorizationError,
)
from scanners.network.security import (
    DNSRebindingGuard,
    RateLimiter,
    DeploymentPolicy,
    SSRFProtectionError,
    SecurityControlError,
)
from scanners.network.cert_parser import parse_cert, get_key_info
from scanners.network.intelligence import (
    classify_weak_algorithms,
    extract_key_exchanges,
    extract_signature_algorithms,
    classify_quantum_vulnerabilities,
    enrich_finding_intelligence,
)
from scanners.cbom_mapping import network_finding_to_cbom, serialize_cbom, validate_cbom_json


def _create_test_cert(
    key_size=2048,
    is_ca=False,
    expired=False,
    not_yet_valid=False,
    self_signed=True,
    hash_algo=hashes.SHA256(),
    algo="RSA",
):
    if algo == "RSA":
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    else:
        private_key = ec.generate_private_key(ec.SECP256R1())

    public_key = private_key.public_key()
    now = datetime.now(timezone.utc)

    if expired:
        not_before = now - timedelta(days=60)
        not_after = now - timedelta(days=1)
    elif not_yet_valid:
        not_before = now + timedelta(days=10)
        not_after = now + timedelta(days=40)
    else:
        not_before = now - timedelta(days=1)
        not_after = now + timedelta(days=365)

    subject = cryptography.x509.Name(
        [
            cryptography.x509.NameAttribute(cryptography.x509.NameOID.COMMON_NAME, "test.internal"),
        ]
    )
    issuer = (
        subject
        if self_signed
        else cryptography.x509.Name(
            [
                cryptography.x509.NameAttribute(cryptography.x509.NameOID.COMMON_NAME, "Test Internal CA"),
            ]
        )
    )

    cert = (
        cryptography.x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(public_key)
        .serial_number(cryptography.x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
        .add_extension(
            cryptography.x509.SubjectAlternativeName(
                [
                    cryptography.x509.DNSName("test.internal"),
                    cryptography.x509.DNSName("api.test.internal"),
                ]
            ),
            critical=False,
        )
        .sign(private_key, hash_algo)
    )
    return cert


# ==============================================================================
# 1. SCOPE AUTHORIZATION & AUDIT TRAIL TESTS
# ==============================================================================


def test_scope_authorization_exact_and_wildcard(tmp_path):
    audit_file = tmp_path / "audit.jsonl"
    logger = AuditLogger(audit_file_path=str(audit_file))
    scope = TargetScope(
        scope_id="scope-prod-001",
        authorized_by="sec-admin@org.com",
        allowed_hostnames={"api.example.com", "*.internal.net"},
        allowed_ports={443, 8443},
    )
    authorizer = TargetScopeAuthorizer(default_scope=scope, audit_logger=logger)

    # 1. Exact match
    ok, reason, audit_id = authorizer.authorize("https://api.example.com", "api.example.com", 443, "93.184.216.34")
    assert ok is True
    assert "successfully authorized" in reason
    assert audit_id.startswith("audit-")

    # 2. Wildcard match
    ok2, reason2, _ = authorizer.authorize("node1.internal.net:8443", "node1.internal.net", 8443, "93.184.216.35")
    assert ok2 is True

    # 3. Unauthorized host
    with pytest.raises(ScopeAuthorizationError) as exc:
        authorizer.authorize("https://unauthorized.com", "unauthorized.com", 443, "93.184.216.36")
    assert "does not match authorized scope" in str(exc.value)

    # 4. Unauthorized port
    with pytest.raises(ScopeAuthorizationError) as exc:
        authorizer.authorize("https://api.example.com:8080", "api.example.com", 8080, "93.184.216.34")
    assert "Port 8080 is not permitted" in str(exc.value)

    # Verify audit file contents
    assert audit_file.exists()
    lines = [json.loads(line) for line in audit_file.read_text().splitlines() if line.strip()]
    assert len(lines) == 4
    assert lines[0]["authorized"] is True
    assert lines[2]["authorized"] is False
    assert lines[2]["hostname"] == "unauthorized.com"


def test_scope_authorization_cidr_subnet(tmp_path):
    audit_file = tmp_path / "audit_subnet.jsonl"
    logger = AuditLogger(audit_file_path=str(audit_file))
    scope = TargetScope(
        scope_id="scope-subnet-001",
        allowed_subnets=["93.184.216.0/24"],
        allowed_ports={443},
    )
    authorizer = TargetScopeAuthorizer(default_scope=scope, audit_logger=logger)

    ok, reason, _ = authorizer.authorize("93.184.216.34:443", "93.184.216.34", 443, "93.184.216.34")
    assert ok is True

    with pytest.raises(ScopeAuthorizationError):
        authorizer.authorize("203.0.113.1:443", "203.0.113.1", 443, "203.0.113.1")


def test_scope_expiration_and_missing_scope(tmp_path):
    audit_file = tmp_path / "audit_exp.jsonl"
    logger = AuditLogger(audit_file_path=str(audit_file))

    # Missing scope
    authorizer_no_scope = TargetScopeAuthorizer(default_scope=None, audit_logger=logger)
    with pytest.raises(ScopeAuthorizationError) as exc:
        authorizer_no_scope.authorize("target.com", "target.com", 443)
    assert "No target authorization scope provided" in str(exc.value)

    # Expired scope
    past_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    expired_scope = TargetScope(
        allowed_hostnames={"target.com"},
        valid_until=past_date,
    )
    authorizer_expired = TargetScopeAuthorizer(default_scope=expired_scope, audit_logger=logger)
    with pytest.raises(ScopeAuthorizationError) as exc:
        authorizer_expired.authorize("target.com", "target.com", 443)
    assert "expired" in str(exc.value)


def test_target_scope_file_io(tmp_path):
    scope_file = tmp_path / "scope.json"
    data = {
        "scope_id": "scope-file-io",
        "authorized_by": "auditor@corp.com",
        "allowed_hostnames": ["service.example.org"],
        "allowed_subnets": ["192.0.2.0/24"],
        "allowed_ports": [443, 636],
        "allow_private_ips": False,
        "purpose": "Security compliance",
    }
    scope_file.write_text(json.dumps(data))

    loaded = TargetScope.from_file(scope_file)
    assert loaded.scope_id == "scope-file-io"
    assert "service.example.org" in loaded.allowed_hostnames
    assert 636 in loaded.allowed_ports


# ==============================================================================
# 2. SECURITY CONTROLS & SSRF / REBINDING GUARD TESTS
# ==============================================================================


def test_dns_rebinding_ssrf_blocking():
    # Loopback
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("127.0.0.1", allow_private=True)
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("::1", allow_private=True)

    # Cloud metadata
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("169.254.169.254", allow_private=True)
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("100.100.100.200", allow_private=True)

    # Private IP when prohibited
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("10.0.0.1", allow_private=False)
    with pytest.raises(SSRFProtectionError):
        DNSRebindingGuard.validate_ip_address("192.168.1.1", allow_private=False)

    # Private IP when allowed
    ip = DNSRebindingGuard.validate_ip_address("192.168.1.1", allow_private=True)
    assert str(ip) == "192.168.1.1"

    # Public IP
    ip_pub = DNSRebindingGuard.validate_ip_address("93.184.216.34", allow_private=False)
    assert str(ip_pub) == "93.184.216.34"


def test_dns_rebinding_ip_pinning():
    with patch("socket.getaddrinfo") as mock_dns:
        mock_dns.return_value = [
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("93.184.216.35", 443)),
        ]
        pinned_ip, all_ips = DNSRebindingGuard.resolve_and_pin("example.com", 443, allow_private=False)
        assert pinned_ip == "93.184.216.34"
        assert len(all_ips) == 2


def test_rate_limiter_throttling():
    limiter = RateLimiter(host_rate_rps=10.0, global_rate_rps=20.0)
    # Fast acquire
    assert limiter.acquire("host1", timeout=0.1) is True
    assert limiter.acquire("host1", timeout=0.1) is True


# ==============================================================================
# 3. CERTIFICATE PARSING & TRUST INTELLIGENCE TESTS
# ==============================================================================


def test_parse_cert_intelligence_valid_and_expired():
    # 1. Valid certificate
    cert_valid = _create_test_cert(key_size=2048, expired=False)
    parsed = parse_cert(cert_valid)

    assert parsed["algo_family"] == "RSA"
    assert parsed["key_size"] == 2048
    assert parsed["isExpired"] is False
    assert parsed["isSelfSigned"] is True
    assert "sha256WithRSAEncryption" in parsed["signature_algorithm"]
    assert "test.internal" in parsed["sans"]
    assert "shor_vulnerable_asymmetric_key" in parsed["quantum_vulnerabilities"]
    assert "self_signed_certificate" in parsed["trust_problems"]

    # 2. Expired certificate with weak RSA key
    cert_expired_weak = _create_test_cert(key_size=1024, expired=True)
    parsed_exp = parse_cert(cert_expired_weak)

    assert parsed_exp["isExpired"] is True
    assert "expired_certificate" in parsed_exp["trust_problems"]
    assert "weak_rsa_key_size_1024" in parsed_exp["trust_problems"]


def test_parse_cert_not_yet_valid_and_weak_hash():
    cert_future = _create_test_cert(key_size=2048, not_yet_valid=True)
    parsed = parse_cert(cert_future)

    assert parsed["isNotYetValid"] is True
    assert "not_yet_valid_certificate" in parsed["trust_problems"]

    # Test weak signature algorithm parsing using mock
    mock_cert = MagicMock()
    mock_cert.not_valid_before_utc = datetime.now(timezone.utc) - timedelta(days=1)
    mock_cert.not_valid_after_utc = datetime.now(timezone.utc) + timedelta(days=30)
    mock_cert.subject.rfc4514_string.return_value = "CN=legacy.test"
    mock_cert.issuer.rfc4514_string.return_value = "CN=legacy.test"
    mock_cert.public_key.return_value = rsa.generate_private_key(65537, 2048).public_key()
    mock_cert.signature_algorithm_oid._name = "sha1WithRSAEncryption"
    mock_cert.signature_hash_algorithm.name = "sha1"
    mock_cert.extensions.get_extension_for_oid.side_effect = Exception("No SAN")
    mock_cert.serial_number = 12345

    parsed_legacy = parse_cert(mock_cert)
    assert "weak_signature_algorithm_sha1" in parsed_legacy["trust_problems"]
    assert parsed_legacy["signature_algorithm"] == "sha1WithRSAEncryption"


# ==============================================================================
# 4. CRYPTO INTELLIGENCE & WEAK ALGORITHMS & QUANTUM TESTS
# ==============================================================================


def test_extract_key_exchanges_and_weak_algorithms():
    tls_versions = ["TLSv1.0", "TLSv1.2", "TLSv1.3"]
    cipher_suites = [
        "TLS_AES_128_GCM_SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
        "DES-CBC3-SHA",
        "RC4-MD5",
        "AES128-SHA",
    ]
    cert_chain = [{"signature_algorithm": "sha1WithRSAEncryption", "algo_family": "RSA", "key_size": 1024}]

    kex = extract_key_exchanges(tls_versions, cipher_suites)
    assert "ECDHE-TLS1.3-KeyShare" in kex
    assert "ECDHE" in kex
    assert "RSA-KeyExchange" in kex

    weak = classify_weak_algorithms(tls_versions, cipher_suites, cert_chain)
    assert "deprecated_protocol:TLSv1.0" in weak
    assert "weak_cipher:3DES" in weak
    assert "weak_cipher:RC4" in weak
    assert "weak_hash:MD5" in weak
    assert "deprecated_hash:SHA1" in weak
    assert "vulnerable_cipher_mode:CBC" in weak
    assert "weak_cert_signature:SHA1" in weak
    assert "weak_cert_key:RSA_1024_below_2048" in weak


def test_quantum_vulnerabilities_classification():
    kex = ["ECDHE", "RSA-KeyExchange"]
    cert_chain = [{"algo_family": "RSA", "key_size": 2048}]
    ciphers = ["TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384"]

    vulns = classify_quantum_vulnerabilities(kex, cert_chain, ciphers)
    assert "shor_vulnerable_key_exchange" in vulns
    assert "shor_vulnerable_signature_and_identity" in vulns
    assert "grover_sensitive_symmetric_encryption_128bit" in vulns
    assert "quantum_resistant_symmetric_256bit" in vulns


def test_enrich_finding_intelligence():
    finding = NetworkCryptoFinding(
        bom_ref="net:target/test:443",
        host="test",
        port=443,
        tls_versions=["TLSv1.3"],
        cipher_suites=["TLS_AES_128_GCM_SHA256"],
        cert_chain=[
            {
                "algo_family": "RSA",
                "key_size": 2048,
                "signature_algorithm": "sha256WithRSAEncryption",
                "trust_problems": ["self_signed_certificate"],
            }
        ],
    )
    enriched = enrich_finding_intelligence(finding)

    assert "ECDHE-TLS1.3-KeyShare" in enriched.key_exchanges
    assert "sha256WithRSAEncryption" in enriched.signature_algorithms
    assert "self_signed_certificate" in enriched.trust_problems
    assert "shor_vulnerable_key_exchange" in enriched.quantum_vulnerabilities
    assert "shor_vulnerable_signature_and_identity" in enriched.quantum_vulnerabilities
    assert "grover_sensitive_symmetric_encryption_128bit" in enriched.quantum_vulnerabilities


# ==============================================================================
# 5. CBOM MAPPING & VALIDATION
# ==============================================================================


def test_cbom_mapping_and_schema_validation():
    finding = NetworkCryptoFinding(
        bom_ref="net:target/secure.example.com:443",
        host="secure.example.com",
        port=443,
        tls_versions=["TLSv1.2", "TLSv1.3"],
        cipher_suites=["ECDHE-RSA-AES128-GCM-SHA256", "TLS_AES_256_GCM_SHA384"],
        key_sizes={"RSA": 2048, "ECDH": 256},
        signature_algorithms=["sha256WithRSAEncryption"],
        key_exchanges=["ECDHE", "ECDHE-TLS1.3-KeyShare"],
        alpn_protocols=["h2", "http/1.1"],
        weak_algorithms=["deprecated_hash:SHA1"],
        trust_problems=["self_signed_certificate"],
        quantum_vulnerabilities=["shor_vulnerable_key_exchange", "shor_vulnerable_signature_and_identity"],
        authorization_id="scope-test-123",
        audit_id="audit-987654",
        cert_chain=[
            {
                "subjectName": "CN=secure.example.com",
                "issuerName": "CN=secure.example.com",
                "notValidBefore": "2026-01-01T00:00:00+00:00",
                "notValidAfter": "2027-01-01T00:00:00+00:00",
                "isExpired": False,
                "isSelfSigned": True,
                "algo_family": "RSA",
                "key_size": 2048,
                "signature_algorithm": "sha256WithRSAEncryption",
                "trust_problems": ["self_signed_certificate"],
                "quantum_vulnerabilities": ["shor_vulnerable_asymmetric_key"],
                "fingerprint_sha256": "abcdef1234567890",
            }
        ],
    )

    bom = network_finding_to_cbom(finding)
    json_str = serialize_cbom(bom)

    # Validate against CycloneDX 1.6 Schema
    assert validate_cbom_json(json_str) is True

    # Validate custom properties exist
    data = json.loads(json_str)
    target_comp = [c for c in data["components"] if c["name"] == "secure.example.com:443"][0]
    props = {p["name"]: p["value"] for p in target_comp["properties"]}

    assert props["ecdat:authorizationId"] == "scope-test-123"
    assert props["ecdat:auditId"] == "audit-987654"
    assert "shor_vulnerable_key_exchange" in props["ecdat:quantumVulnerabilities"]
    assert "h2,http/1.1" == props["ecdat:alpnProtocols"]
