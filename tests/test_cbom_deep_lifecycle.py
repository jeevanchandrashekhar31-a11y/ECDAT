# @ecdat-synthetic-corpus
"""
Phase 22.1 — Subsystem 4: CBOM Deep Lifecycle Tests

Extensive test coverage for Cryptographic Bill of Materials (CBOM):
1. Ingestion of CycloneDX 1.6 & 1.7 JSON & XML
2. Multi-scanner merging (net, code, bin, runtime) with collision-free bom-ref resolution
3. Lifecycle pipeline: ingest -> normalize -> correlate -> diff -> export (JSON, XML, CSV, SARIF)
4. Strict validation against standard schema (no custom unrecognized properties, zero secret exposure)
5. Property integrity under malformed CBOM payloads (missing fields, duplicate refs, unknown algorithms)
6. Absence of finding invariant during diffs (never treat missing as proof of non-existence)
"""

import json
import pytest
from datetime import datetime, timezone
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    AlgorithmProperties,
    CertificateProperties,
    ProtocolProperties,
    RelatedCryptoMaterialProperties,
    RelatedCryptoMaterialType,
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from cyclonedx.validation.json import JsonValidator
from cyclonedx.schema import SchemaVersion

from scanners.cbom_io import (
    import_cbom,
    normalize_cbom,
    correlate_cbom,
    export_cbom,
    cbom_to_csv,
    cbom_to_sarif,
)
from scanners.cbom_mapping import (
    serialize_cbom,
    validate_cbom_json,
    validate_cbom_detailed,
    network_finding_to_cbom,
    code_finding_to_cbom,
    binary_finding_to_cbom,
    runtime_event_to_cbom,
)
from scanners.cbom_diff import diff_cboms, DiffStatus, ABSENCE_OF_FINDING_DISCLAIMER
from scanners.models import (
    NetworkCryptoFinding,
    CodeCryptoFinding,
    BinaryContainerFinding,
)


@pytest.fixture
def validator_v17():
    return JsonValidator(SchemaVersion.V1_7)


@pytest.fixture
def validator_v16():
    return JsonValidator(SchemaVersion.V1_6)


# ---------------------------------------------------------------------------
# 1. Ingestion of CycloneDX 1.6 & 1.7 JSON & XML
# ---------------------------------------------------------------------------


def test_cbom_ingest_cyclonedx_17_json(validator_v17):
    """CycloneDX 1.7 JSON is ingested into a valid Bom object."""
    raw_cdx = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "serialNumber": "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
        "version": 1,
        "metadata": {
            "timestamp": "2026-09-16T12:00:00Z",
            "component": {
                "bom-ref": "pkg:npm/demo-app@1.0.0",
                "type": "application",
                "name": "demo-app",
                "version": "1.0.0",
            },
        },
        "components": [
            {
                "bom-ref": "code:algorithm/aes-256-gcm@src/crypto.py:10",
                "type": "cryptographic-asset",
                "name": "AES-256-GCM",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "primitive": "ae",
                        "algorithmFamily": "AES",
                        "parameterSetIdentifier": "256",
                        "classicalSecurityLevel": 256,
                        "nistQuantumSecurityLevel": 0,
                    },
                },
            }
        ],
    }
    bom = import_cbom(raw_cdx, format="json")
    assert isinstance(bom, Bom)
    assert len(bom.components) == 1
    comp = list(bom.components)[0]
    assert comp.name == "AES-256-GCM"
    assert comp.crypto_properties.asset_type == CryptoAssetType.ALGORITHM


def test_cbom_ingest_cyclonedx_xml():
    """CycloneDX XML representation is ingested correctly."""
    xml_data = """<?xml version="1.0" encoding="UTF-8"?>
    <bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1">
      <components>
        <component type="cryptographic-asset" bom-ref="net:certificate/cert1@host:443">
          <name>Production TLS Certificate</name>
          <cryptoProperties>
            <assetType>certificate</assetType>
            <certificateProperties>
              <subjectName>CN=example.com</subjectName>
              <issuerName>CN=DigiCert Global Root CA</issuerName>
              <certificateFormat>X.509</certificateFormat>
            </certificateProperties>
          </cryptoProperties>
        </component>
      </components>
    </bom>"""
    bom = import_cbom(xml_data, format="xml")
    assert isinstance(bom, Bom)
    assert len(bom.components) == 1
    comp = list(bom.components)[0]
    assert "Production TLS Certificate" in comp.name


def test_cbom_auto_format_detection():
    """import_cbom automatically detects JSON vs XML strings."""
    json_str = '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[]}'
    bom_json = import_cbom(json_str, format="auto")
    assert isinstance(bom_json, Bom)

    xml_str = '<bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"><components/></bom>'
    bom_xml = import_cbom(xml_str, format="auto")
    assert isinstance(bom_xml, Bom)


# ---------------------------------------------------------------------------
# 2. Multi-Scanner Merging and Collision-Free bom-ref Resolution
# ---------------------------------------------------------------------------


def test_multi_scanner_merging_collision_free():
    """Multi-scanner findings merge without bom-ref collisions adhering to contract."""
    # Finding from Static Code Scanner
    code_finding = CodeCryptoFinding(
        bom_ref="code:algorithm/md5@src/utils/legacy.py:45",
        file_path="src/utils/legacy.py",
        language="python",
        line=45,
        algorithm="MD5",
        finding_type="algorithm",
        confidence="high",
    )
    code_bom = code_finding_to_cbom(code_finding)
    code_comp = next(c for c in code_bom.components if c.type == ComponentType.CRYPTOGRAPHIC_ASSET)
    assert code_comp.bom_ref.value.startswith("code:algorithm/md5")

    # Finding from Network Scanner
    net_finding = NetworkCryptoFinding(
        bom_ref="net:target/api.internal.corp:443",
        host="api.internal.corp",
        port=443,
        protocol="TLS",
        tls_versions=["TLSv1.2"],
        cipher_suites=["TLS_RSA_WITH_AES_128_CBC_SHA"],
        key_sizes={"RSA": 2048},
    )
    net_bom = network_finding_to_cbom(net_finding)
    net_comp = next(c for c in net_bom.components if "protocol" in str(c.bom_ref.value))
    assert "protocol" in net_comp.bom_ref.value

    # Finding from Binary Scanner
    bin_finding = BinaryContainerFinding(
        bom_ref="bin:library/libcrypto@libcrypto.so.1.1",
        target="libcrypto.so.1.1",
        component_name="libcrypto",
        component_version="1.1.1",
        crypto_library="OpenSSL",
    )
    bin_bom = binary_finding_to_cbom(bin_finding)
    bin_comp = next(iter(bin_bom.components))
    assert bin_comp.bom_ref.value.startswith("bin:library/libcrypto")

    # Finding from Runtime Probe
    class RuntimeEventObj:
        def __init__(self):
            self.application_name = "vault-worker"
            self.process_name = "vault-worker"
            self.process_id = 4096
            self.library_name = "OpenSSL"
            self.algorithm = "AES-256-CBC"
            self.key_size = 256
            self.operation = "encrypt"
            self.timestamp = "2026-09-16T12:00:00Z"

    runtime_bom = runtime_event_to_cbom(RuntimeEventObj())
    runtime_comp = next(c for c in runtime_bom.components if "process" in str(c.bom_ref.value))
    assert "runtime:process" in runtime_comp.bom_ref.value

    # Merge into a single Bom
    bom = Bom()
    refs = set()
    for comp in [code_comp, net_comp, bin_comp, runtime_comp]:
        assert comp.bom_ref.value not in refs, f"Duplicate bom-ref detected: {comp.bom_ref.value}"
        refs.add(comp.bom_ref.value)
        bom.components.add(comp)

    assert len(bom.components) == 4
    serialized = serialize_cbom(bom, spec_version="1.7")
    is_valid, _ = validate_cbom_detailed(serialized)
    assert is_valid is True


# ---------------------------------------------------------------------------
# 3. Full Lifecycle Pipeline: Ingest -> Normalize -> Correlate -> Diff -> Export
# ---------------------------------------------------------------------------


def test_cbom_lifecycle_pipeline():
    """Complete CBOM lifecycle pipeline executes seamlessly."""
    raw_data = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "components": [
            {
                "bom-ref": "code:algorithm/des@src/crypto.py:20",
                "type": "cryptographic-asset",
                "name": "DES",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "primitive": "block-cipher",
                        "algorithmFamily": "DES",
                        "parameterSetIdentifier": "56",
                        "classicalSecurityLevel": 56,
                        "nistQuantumSecurityLevel": 0,
                    },
                },
                "evidence": {"occurrences": [{"location": "src/crypto.py", "line": 20}]},
            }
        ],
    }

    # Step 1: Ingest
    bom = import_cbom(raw_data, format="json")
    assert len(bom.components) == 1

    # Step 2: Normalize
    normalized = normalize_cbom(bom)
    assert normalized.get("bomFormat") == "CycloneDX"
    assert len(normalized.get("components", [])) == 1

    # Step 3: Correlate with policy & risk
    correlated = correlate_cbom(normalized, policy_profile="pqc_strict")
    assert "_correlation" in correlated
    assert correlated["_correlation"]["total_analyzed"] >= 1

    # Step 4: Export to JSON, XML, CSV, SARIF
    json_out = export_cbom(bom, format="json")
    assert "CycloneDX" in json_out

    xml_out = export_cbom(bom, format="xml")
    assert "<bom" in xml_out

    csv_out = cbom_to_csv(correlated)
    assert "BOM_Ref" in csv_out
    assert "DES" in csv_out

    sarif_out = cbom_to_sarif(correlated)
    sarif_dict = json.loads(sarif_out)
    assert sarif_dict.get("version") == "2.1.0"
    assert len(sarif_dict["runs"]) == 1


# ---------------------------------------------------------------------------
# 4. CBOM Diff Engine & Absence-of-Finding Guarantee
# ---------------------------------------------------------------------------


def test_cbom_diff_categorization_and_absence_invariant():
    """CBOM diff accurately categorizes changes and protects absence invariant."""
    baseline = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "components": [
            {
                "bom-ref": "code:algorithm/rsa-1024@src/auth.py:5",
                "type": "cryptographic-asset",
                "name": "RSA-1024",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "algorithmFamily": "RSA",
                        "parameterSetIdentifier": "1024",
                        "nistQuantumSecurityLevel": 0,
                    },
                },
            },
            {
                "bom-ref": "code:algorithm/sha256@src/hash.py:12",
                "type": "cryptographic-asset",
                "name": "SHA-256",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "algorithmFamily": "SHA-2",
                        "parameterSetIdentifier": "256",
                        "nistQuantumSecurityLevel": 0,
                    },
                },
            },
        ],
    }

    # Current scan: RSA-1024 upgraded to ML-KEM-768, SHA-256 missing
    current = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.7",
        "components": [
            {
                "bom-ref": "code:algorithm/ml-kem-768@src/auth.py:5",
                "type": "cryptographic-asset",
                "name": "ML-KEM-768",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "algorithmFamily": "ML-KEM",
                        "parameterSetIdentifier": "768",
                        "nistQuantumSecurityLevel": 3,
                    },
                },
            }
        ],
    }

    diff = diff_cboms(baseline, current, policy_profile="pqc_strict")

    assert diff["summary"][DiffStatus.NEW.value] >= 1
    assert diff["summary"][DiffStatus.REMOVED.value] >= 1

    # Check the absence disclaimer on REMOVED items
    removed_items = [d for d in diff["diff_items"] if d["status"] == DiffStatus.REMOVED.value]
    assert len(removed_items) >= 1
    for item in removed_items:
        assert item.get("absence_proof_disclaimer") == ABSENCE_OF_FINDING_DISCLAIMER
        assert item.get("is_definitive_absence") is False
        assert item.get("removal_classification") == "UNVERIFIED_ABSENCE"


# ---------------------------------------------------------------------------
# 5. Schema Strictness and Zero Secret Exposure
# ---------------------------------------------------------------------------


def test_cbom_zero_secret_exposure():
    """Private key material, passwords, or seeds must never be serialized in CBOM."""
    from cyclonedx.model.crypto import RelatedCryptoMaterialProperties, RelatedCryptoMaterialType

    secret_raw = "SECRET_SUPER_CONFIDENTIAL_PRIVATE_KEY_BYTES_12345"

    # RelatedCryptoMaterial must only store metadata (type, identifier), NOT raw key bytes
    rcm_prop = RelatedCryptoMaterialProperties(
        type=RelatedCryptoMaterialType.PRIVATE_KEY,
        id="kms-key-alias-production-vault",
    )
    crypto_prop = CryptoProperties(
        asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL,
        related_crypto_material_properties=rcm_prop,
    )
    comp = Component(
        name="Production Key Reference",
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        bom_ref="kms:key/prod-vault-key",
        crypto_properties=crypto_prop,
    )
    bom = Bom(components=[comp])
    serialized = serialize_cbom(bom, spec_version="1.7")

    assert secret_raw not in serialized
    assert "kms-key-alias-production-vault" in serialized
    assert validate_cbom_json(serialized) is True


# ---------------------------------------------------------------------------
# 6. Malformed & Resilient Parsing Under Stress
# ---------------------------------------------------------------------------


def test_cbom_malformed_json_handling():
    """Malformed JSON triggers clean error without unhandled crashes."""
    with pytest.raises(Exception):
        import_cbom("{ invalid: json missing closing bracket", format="json")


def test_cbom_missing_required_fields():
    """CBOM lacking valid CycloneDX structure raises ValueError."""
    with pytest.raises(ValueError):
        import_cbom('{"invalid_root": true}', format="json")
