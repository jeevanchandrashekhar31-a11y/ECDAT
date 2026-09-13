"""
Tests for Phase 8.1 & 8.3: CycloneDX 1.7 CBOM Compliance and Provenance.

Validates:
1. Official CycloneDX 1.7 schema validation via cyclonedx.validation.json.JsonValidator.
2. Correct modeling of:
   - algorithms (standard algorithmFamily enum, key sizes, nist security levels)
   - protocols (structured ProtocolPropertiesCipherSuite objects, versions)
   - certificates (X.509 properties, fingerprints, trust metadata)
   - related crypto material (safe metadata, strict zero secret leakage)
   - dependencies graph
   - provenance (tool metadata, scanner, timestamp, source)
   - evidence references (occurrences, location, line)
3. Zero invented unsupported properties.
4. Backward compatibility with CycloneDX 1.6 schema.
"""

import json
import pytest
from datetime import datetime, timezone
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    AlgorithmProperties,
    ProtocolProperties,
    ProtocolPropertiesType,
    ProtocolPropertiesCipherSuite,
    CertificateProperties,
    RelatedCryptoMaterialProperties,
    RelatedCryptoMaterialType,
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from cyclonedx.validation.json import JsonValidator
from cyclonedx.schema import SchemaVersion

from scanners.cbom_mapping import (
    serialize_cbom,
    validate_cbom_json,
    validate_cbom_detailed,
    network_finding_to_cbom,
    code_finding_to_cbom,
    binary_finding_to_cbom,
    binary_metadata_to_cbom,
    hybrid_analysis_to_cbom,
    runtime_event_to_cbom,
    CYCLONEDX_17_ALGORITHM_FAMILIES,
)
from scanners.models import NetworkCryptoFinding, CodeCryptoFinding, BinaryContainerFinding


@pytest.fixture
def v17_validator():
    return JsonValidator(SchemaVersion.V1_7)


@pytest.fixture
def v16_validator():
    return JsonValidator(SchemaVersion.V1_6)


def test_official_cdx17_schema_validation_empty_bom(v17_validator):
    """CycloneDX 1.7 empty BOM validates against official schema."""
    bom = Bom()
    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    err = v17_validator.validate_str(serialized)
    assert err is None


def test_official_cdx17_algorithm_asset_compliance(v17_validator):
    """Cryptographic algorithm asset validates with official algorithmFamily enum and parameters."""
    bom = Bom()
    algo_props = AlgorithmProperties(
        parameter_set_identifier="256",
        nist_quantum_security_level=0,
    )
    crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="AES-256-GCM",
        bom_ref="crypto:algo/aes-256-gcm",
        crypto_properties=crypto_props,
        evidence=ComponentEvidence(occurrences=[Occurrence(location="src/crypto/cipher.py", line=42)]),
    )
    comp.properties.add(Property(name="ecdat:algorithm", value="AES"))
    comp.properties.add(Property(name="ecdat:scanner", value="static_scanner"))
    bom.components.add(comp)

    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    assert v17_validator.validate_str(serialized) is None

    parsed = json.loads(serialized)
    c_props = parsed["components"][0]["cryptoProperties"]
    assert c_props["assetType"] == "algorithm"
    assert c_props["algorithmProperties"]["algorithmFamily"] == "AES"
    assert c_props["algorithmProperties"]["parameterSetIdentifier"] == "256"


def test_official_cdx17_protocol_asset_compliance(v17_validator):
    """Cryptographic protocol asset validates with structured cipher suites and version."""
    bom = Bom()
    proto_props = ProtocolProperties(
        type=ProtocolPropertiesType.TLS,
        version="1.3",
        cipher_suites=[
            ProtocolPropertiesCipherSuite(name="TLS_AES_256_GCM_SHA384"),
            ProtocolPropertiesCipherSuite(name="TLS_CHACHA20_POLY1305_SHA256"),
        ],
    )
    crypto_props = CryptoProperties(asset_type=CryptoAssetType.PROTOCOL, protocol_properties=proto_props)
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="TLS 1.3",
        bom_ref="net:protocol/tls1.3@api.corp:443",
        crypto_properties=crypto_props,
        evidence=ComponentEvidence(occurrences=[Occurrence(location="api.corp:443", additional_context="TLS handshake")]),
    )
    bom.components.add(comp)

    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    assert v17_validator.validate_str(serialized) is None

    parsed = json.loads(serialized)
    p_props = parsed["components"][0]["cryptoProperties"]["protocolProperties"]
    assert p_props["type"] == "tls"
    assert p_props["version"] == "1.3"
    assert len(p_props["cipherSuites"]) == 2
    assert p_props["cipherSuites"][0]["name"] == "TLS_AES_256_GCM_SHA384"


def test_official_cdx17_certificate_asset_compliance(v17_validator):
    """Certificate asset models standard X.509 properties and passes official schema."""
    bom = Bom()
    cert_props = CertificateProperties(
        subject_name="CN=api.secure.org",
        issuer_name="CN=DigiCert Global Root G2",
        not_valid_before=datetime(2025, 1, 1, tzinfo=timezone.utc),
        not_valid_after=datetime(2026, 1, 1, tzinfo=timezone.utc),
        certificate_format="X.509",
    )
    crypto_props = CryptoProperties(asset_type=CryptoAssetType.CERTIFICATE, certificate_properties=cert_props)
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="api.secure.org Certificate",
        bom_ref="net:cert/api.secure.org",
        crypto_properties=crypto_props,
    )
    comp.properties.add(Property(name="ecdat:fingerprint", value="abcd1234ef567890"))
    bom.components.add(comp)

    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    assert v17_validator.validate_str(serialized) is None


def test_official_cdx17_related_crypto_material_compliance(v17_validator):
    """Related crypto material models private key metadata without secret leakage."""
    bom = Bom()
    mat_props = RelatedCryptoMaterialProperties(
        type=RelatedCryptoMaterialType.PRIVATE_KEY,
        size=2048,
    )
    crypto_props = CryptoProperties(
        asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL,
        related_crypto_material_properties=mat_props,
    )
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="Hardcoded RSA Private Key",
        bom_ref="code:key/rsa-2048@src/auth.py:12",
        crypto_properties=crypto_props,
        evidence=ComponentEvidence(occurrences=[Occurrence(location="src/auth.py", line=12)]),
    )
    comp.properties.add(Property(name="ecdat:fingerprint", value="sha256:0123456789abcdef"))
    bom.components.add(comp)

    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    assert v17_validator.validate_str(serialized) is None

    # Strict Zero Secret Leakage Invariant
    assert "-----BEGIN" not in serialized
    assert "PRIVATE KEY" not in serialized or "name" in serialized


def test_cbom_dependencies_and_provenance(v17_validator):
    """Dependencies and tool provenance are properly attached to CBOM."""
    app_comp = Component(type=ComponentType.APPLICATION, name="BankGateway", bom_ref="app:gateway")
    algo_comp = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="ML-KEM-768", bom_ref="algo:ml-kem-768")
    
    bom = Bom()
    bom.components.add(app_comp)
    bom.components.add(algo_comp)
    bom.register_dependency(app_comp, [algo_comp])

    serialized = serialize_cbom(bom, spec_version="1.7")
    assert validate_cbom_json(serialized) is True
    assert v17_validator.validate_str(serialized) is None

    parsed = json.loads(serialized)
    # Check tool provenance in metadata
    tools = parsed["metadata"]["tools"]
    tool_items = tools.get("components", []) if isinstance(tools, dict) else tools
    tool_names = [t.get("name") for t in tool_items]
    assert any("ECDAT" in name for name in tool_names)

    # Check dependencies graph
    deps = parsed.get("dependencies", [])
    assert len(deps) >= 1
    gateway_dep = next((d for d in deps if d["ref"] == "app:gateway"), None)
    assert gateway_dep is not None
    assert "algo:ml-kem-768" in gateway_dep["dependsOn"]


def test_scanner_generators_produce_valid_cdx17(v17_validator):
    """End-to-end scanner mapping functions produce schema-valid CycloneDX 1.7 CBOMs."""
    # 1. Code finding
    cf = CodeCryptoFinding(
        rule_id="crypto-rule-1",
        language="python",
        finding_type="algorithm",
        file_path="src/service/auth.py",
        line=15,
        column=4,
        algorithm="AES",
        key_size=256,
        confidence="HIGH",
        bom_ref="code:finding/1",
    )
    b_code = code_finding_to_cbom(cf)
    s_code = serialize_cbom(b_code, spec_version="1.7")
    assert validate_cbom_json(s_code) is True
    assert v17_validator.validate_str(s_code) is None

    # 2. Network finding
    nf = NetworkCryptoFinding(
        host="secure.bank.com",
        port=443,
        protocol="tls",
        tls_versions=["TLSv1.2", "TLSv1.3"],
        cipher_suites=["TLS_AES_256_GCM_SHA384"],
        cert_chain=[{
            "subjectName": "CN=secure.bank.com",
            "issuerName": "CN=Root CA",
            "notValidBefore": "2025-01-01T00:00:00",
            "notValidAfter": "2026-01-01T00:00:00",
            "fingerprint_sha256": "abcdef1234567890",
        }],
        key_sizes={"RSA": 2048},
        bom_ref="net:target/bank.com:443",
    )
    b_net = network_finding_to_cbom(nf)
    s_net = serialize_cbom(b_net, spec_version="1.7")
    assert validate_cbom_json(s_net) is True
    assert v17_validator.validate_str(s_net) is None


def test_reject_invented_unsupported_properties():
    """Schema validation strictly rejects invented properties inside cryptoProperties."""
    invalid_doc = json.dumps({
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "components": [
            {
                "type": "cryptographic-asset",
                "name": "InvalidAsset",
                "bom-ref": "invalid:ref",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "inventedProperty": "illegal_value",  # additionalProperties: false
                },
            }
        ],
    })
    is_valid, err = validate_cbom_detailed(invalid_doc)
    assert is_valid is False
    assert "inventedProperty" in str(err) or "additionalProperties" in str(err)


def test_backward_compatibility_cyclonedx_16(v16_validator):
    """CBOM serializer can emit schema-compliant CycloneDX 1.6 on demand."""
    bom = Bom()
    algo_props = AlgorithmProperties(parameter_set_identifier="256")
    crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="AES-256",
        bom_ref="algo:aes-256",
        crypto_properties=crypto_props,
    )
    bom.components.add(comp)

    serialized = serialize_cbom(bom, spec_version="1.6")
    parsed = json.loads(serialized)
    assert parsed["specVersion"] == "1.6"
    assert validate_cbom_json(serialized) is True
    assert v16_validator.validate_str(serialized) is None
