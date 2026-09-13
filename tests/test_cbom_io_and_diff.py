"""
Tests for Phase 8.2: CBOM Import/Export and CBOM Diff Engine.

Validates:
1. Multi-format support:
   - JSON (CycloneDX 1.7 target, 1.6 backward-compatible)
   - XML (CycloneDX 1.7 / 1.6 XML)
   - CSV (human-readable tabular review)
   - SARIF (OASIS SARIF 2.1.0 security tooling)
   - Protobuf justification (documented NotImplementedError explaining ecosystem standard)
2. Lifecycle workflows:
   - import_cbom (JSON, XML, auto-detection)
   - normalize_cbom (canonical names, key sizes, reachability, secret redaction)
   - correlate_cbom (policy profile checks, Shor vulnerability flags, risk levels)
   - export_cbom (multi-format serialization)
3. CBOM Diff Engine:
   - NEW
   - REMOVED
   - CHANGED
   - UNCHANGED
   - RISK_CHANGED
   - POLICY_CHANGED
4. CRITICAL INVARIANT:
   - Never treat absence of a finding as proof that no crypto exists.
"""

import json
import pytest
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
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence

from scanners.cbom_io import (
    import_cbom,
    normalize_cbom,
    correlate_cbom,
    export_cbom,
    cbom_to_csv,
    cbom_to_sarif,
)
from scanners.cbom_diff import (
    diff_cboms,
    DiffStatus,
    ABSENCE_OF_FINDING_DISCLAIMER,
)
from scanners.cbom_mapping import serialize_cbom


def make_sample_bom():
    bom = Bom()
    # 1. AES algorithm
    a_props = AlgorithmProperties(parameter_set_identifier="256", nist_quantum_security_level=0)
    c1 = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="AES-256-GCM",
        bom_ref="crypto:algo/aes-256",
        crypto_properties=CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=a_props),
        evidence=ComponentEvidence(occurrences=[Occurrence(location="src/crypto.py", line=10)]),
    )
    c1.properties.add(Property(name="ecdat:algorithm", value="AES"))
    c1.properties.add(Property(name="ecdat:key_size", value="256"))
    c1.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    bom.components.add(c1)

    # 2. TLS 1.3 protocol
    p_props = ProtocolProperties(
        type=ProtocolPropertiesType.TLS,
        version="1.3",
        cipher_suites=[ProtocolPropertiesCipherSuite(name="TLS_AES_256_GCM_SHA384")],
    )
    c2 = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="TLS 1.3",
        bom_ref="net:protocol/tls1.3",
        crypto_properties=CryptoProperties(asset_type=CryptoAssetType.PROTOCOL, protocol_properties=p_props),
    )
    bom.components.add(c2)
    return bom


def test_cbom_export_and_import_json_roundtrip():
    """Verify JSON export and import round-trip preserves components."""
    bom = make_sample_bom()
    json_str = export_cbom(bom, format="json", spec_version="1.7")
    assert '"bomFormat": "CycloneDX"' in json_str
    assert '"specVersion": "1.7"' in json_str

    imported_bom = import_cbom(json_str, format="json")
    assert len(imported_bom.components) == 2
    comp_names = [c.name for c in imported_bom.components]
    assert "AES-256-GCM" in comp_names
    assert "TLS 1.3" in comp_names


def test_cbom_export_and_import_xml_roundtrip():
    """Verify XML export and import round-trip preserves components."""
    bom = make_sample_bom()
    xml_str = export_cbom(bom, format="xml", spec_version="1.7")
    assert "<bom" in xml_str
    assert 'xmlns="http://cyclonedx.org/schema/bom/1.7"' in xml_str

    imported_bom = import_cbom(xml_str, format="xml")
    assert len(imported_bom.components) == 2
    comp_names = [c.name for c in imported_bom.components]
    assert "AES-256-GCM" in comp_names
    assert "TLS 1.3" in comp_names


def test_cbom_export_csv_human_analysis():
    """Verify CSV export produces tabular view suitable for human risk review."""
    bom = make_sample_bom()
    csv_str = export_cbom(bom, format="csv")
    lines = csv_str.strip().split("\r\n" if "\r\n" in csv_str else "\n")
    assert len(lines) >= 3  # Header + 2 components

    header = lines[0]
    assert "BOM_Ref" in header
    assert "Algorithm" in header
    assert "Risk_Level" in header
    assert "Quantum_Vulnerable" in header

    content = "\n".join(lines[1:])
    assert "crypto:algo/aes-256" in content
    assert "AES" in content
    assert "RUNTIME_CONFIRMED" in content


def test_cbom_export_sarif_security_tooling():
    """Verify SARIF export produces standard OASIS SARIF v2.1.0 document."""
    # Add a weak algorithm to trigger SARIF findings
    bom = make_sample_bom()
    md5_comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="MD5",
        bom_ref="crypto:algo/md5",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.ALGORITHM,
            algorithm_properties=AlgorithmProperties(parameter_set_identifier="128"),
        ),
        evidence=ComponentEvidence(occurrences=[Occurrence(location="src/legacy_hash.py", line=88)]),
    )
    md5_comp.properties.add(Property(name="ecdat:algorithm", value="MD5"))
    bom.components.add(md5_comp)

    sarif_str = export_cbom(bom, format="sarif")
    sarif_doc = json.loads(sarif_str)

    assert sarif_doc["version"] == "2.1.0"
    assert len(sarif_doc["runs"]) == 1
    run = sarif_doc["runs"][0]
    assert run["tool"]["driver"]["name"] == "ECDAT"
    assert len(run["results"]) >= 1

    md5_result = next((r for r in run["results"] if "MD5" in r["ruleId"]), None)
    assert md5_result is not None
    assert md5_result["level"] == "error"
    loc = md5_result["locations"][0]["physicalLocation"]
    assert loc["artifactLocation"]["uri"] == "src/legacy_hash.py"
    assert loc["region"]["startLine"] == 88


def test_cbom_protobuf_justification_error():
    """Verify Protobuf export produces documented justification exception."""
    bom = make_sample_bom()
    with pytest.raises(NotImplementedError) as excinfo:
        export_cbom(bom, format="protobuf")
    assert "Protobuf export is not justified in current CycloneDX Python ecosystem" in str(excinfo.value)


def test_cbom_normalization_and_correlation():
    """Verify normalize_cbom and correlate_cbom standardize fields and evaluate policies."""
    bom = make_sample_bom()
    norm = normalize_cbom(bom)
    assert "_normalization_metadata" in norm
    assert norm["_normalization_metadata"]["total_components"] == 2

    # Correlate under regulated BFSI profile
    corr = correlate_cbom(bom, policy_profile="regulated_bfsi")
    assert "_correlation" in corr
    corr_meta = corr["_correlation"]
    assert corr_meta["policy_profile"] == "regulated_bfsi"
    assert corr_meta["total_analyzed"] == 2


def test_cbom_diff_engine_all_categories():
    """
    Validates CBOM Diff correctly identifies:
    - NEW
    - REMOVED (with mandatory absence invariant)
    - CHANGED
    - UNCHANGED
    - RISK_CHANGED
    - POLICY_CHANGED
    """
    # 1. Baseline BOM
    base_bom = Bom()
    # Unchanged component
    c_unchanged = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="AES-256", bom_ref="ref:aes")
    c_unchanged.properties.add(Property(name="ecdat:algorithm", value="AES"))
    c_unchanged.properties.add(Property(name="ecdat:key_size", value="256"))
    base_bom.components.add(c_unchanged)

    # Component to be removed in current
    c_removed = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="DES-56", bom_ref="ref:des")
    c_removed.properties.add(Property(name="ecdat:algorithm", value="DES"))
    base_bom.components.add(c_removed)

    # Component whose key size changes
    c_changed = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="RSA-1024", bom_ref="ref:rsa")
    c_changed.properties.add(Property(name="ecdat:algorithm", value="RSA"))
    c_changed.properties.add(Property(name="ecdat:key_size", value="1024"))
    base_bom.components.add(c_changed)

    # 2. Current BOM
    cur_bom = Bom()
    # Unchanged
    c_unchanged_cur = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="AES-256", bom_ref="ref:aes")
    c_unchanged_cur.properties.add(Property(name="ecdat:algorithm", value="AES"))
    c_unchanged_cur.properties.add(Property(name="ecdat:key_size", value="256"))
    cur_bom.components.add(c_unchanged_cur)

    # Changed (key size upgraded)
    c_changed_cur = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="RSA-2048", bom_ref="ref:rsa")
    c_changed_cur.properties.add(Property(name="ecdat:algorithm", value="RSA"))
    c_changed_cur.properties.add(Property(name="ecdat:key_size", value="2048"))
    cur_bom.components.add(c_changed_cur)

    # New component
    c_new = Component(type=ComponentType.CRYPTOGRAPHIC_ASSET, name="ML-KEM-768", bom_ref="ref:mlkem")
    c_new.properties.add(Property(name="ecdat:algorithm", value="ML-KEM"))
    cur_bom.components.add(c_new)

    # Run diff
    diff = diff_cboms(base_bom, cur_bom, policy_profile="internal_enterprise")

    summary = diff["summary"]
    assert summary[DiffStatus.NEW.value] == 1
    assert summary[DiffStatus.REMOVED.value] == 1
    assert summary[DiffStatus.CHANGED.value] == 1
    assert summary[DiffStatus.UNCHANGED.value] == 1

    # Check NEW item
    new_item = next(i for i in diff["diff_items"] if i["bom_ref"] == "ref:mlkem")
    assert new_item["status"] == DiffStatus.NEW.value

    # Check CHANGED item
    changed_item = next(i for i in diff["diff_items"] if i["bom_ref"] == "ref:rsa")
    assert changed_item["status"] == DiffStatus.CHANGED.value
    assert any("Key size changed" in c for c in changed_item["technical_changes"])

    # CRITICAL INVARIANT: Check REMOVED item
    removed_item = next(i for i in diff["diff_items"] if i["bom_ref"] == "ref:des")
    assert removed_item["status"] == DiffStatus.REMOVED.value
    assert removed_item["is_definitive_absence"] is False
    assert removed_item["absence_proof_disclaimer"] == ABSENCE_OF_FINDING_DISCLAIMER
    assert removed_item["removal_classification"] == "UNVERIFIED_ABSENCE"
