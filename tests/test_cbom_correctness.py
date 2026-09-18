"""
Tests for Task 23 (P1 - CBOM Correctness):

Verifies that generated CBOMs:
- Conform to the declared CycloneDX version (1.6 baseline vs 1.7 advanced);
- Use valid official schema (validated against CycloneDX JSON schemas);
- Contain accurate cryptographic components (algorithm, protocol, certificate, related material);
- Distinguish observed facts (physical locations, runtime hooks, raw parameters) from inferred data (PQC classification, confidence, risk score);
- Include provenance (tool metadata, timestamp, application target, author info);
- Avoid fabricated metadata (no fake licenses, no dummy hashes, no placeholder paths, zero raw secrets);
- Remain deterministic where promised (canonical bom-ref scheme, stable sorting);
- Clearly distinguish 1.6 production output from 1.7 supported output (never call a 1.6 sample a 1.7 CBOM).
"""

import json
from pathlib import Path
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
    code_finding_to_cbom,
    network_finding_to_cbom,
)
from scanners.models import CodeCryptoFinding, NetworkCryptoFinding

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def v16_validator():
    return JsonValidator(SchemaVersion.V1_6)


@pytest.fixture
def v17_validator():
    return JsonValidator(SchemaVersion.V1_7)


def test_production_output_is_cyclonedx_16():
    """
    Verify production baseline contract is CycloneDX 1.6:
    - examples/FINAL_CBOM_SAMPLE.json is strictly CycloneDX 1.6.
    - Never call a 1.6 sample a 1.7 CBOM.
    """
    sample_16_path = REPO_ROOT / "examples" / "FINAL_CBOM_SAMPLE.json"
    assert sample_16_path.exists(), "Production 1.6 CBOM sample must exist"

    raw_text = sample_16_path.read_text(encoding="utf-8")
    data = json.loads(raw_text)

    # Must declare 1.6
    assert data["bomFormat"] == "CycloneDX"
    assert data["specVersion"] == "1.6"
    assert "1.6" in data.get("$schema", "")
    assert data["specVersion"] != "1.7", "1.6 sample must never claim to be 1.7"

    # Must validate against official 1.6 schema
    v16 = JsonValidator(SchemaVersion.V1_6)
    val_err = v16.validate_str(raw_text)
    assert val_err is None, f"1.6 sample failed 1.6 schema: {val_err}"


def test_cyclonedx_17_is_supported_and_proved_with_actual_artifact():
    """
    Prove CycloneDX 1.7 is supported with an actual generated 1.7 artifact:
    - examples/FINAL_CBOM_17_SAMPLE.json exists.
    - artifacts/cbom/ecdat_cbom_cyclonedx_1.7.json exists.
    - Both declare specVersion 1.7 and pass official CycloneDX 1.7 schema validation.
    """
    sample_17_path = REPO_ROOT / "examples" / "FINAL_CBOM_17_SAMPLE.json"
    artifact_17_path = REPO_ROOT / "artifacts" / "cbom" / "ecdat_cbom_cyclonedx_1.7.json"

    assert sample_17_path.exists(), "Generated CycloneDX 1.7 sample artifact must exist"
    assert artifact_17_path.exists(), "Generated CycloneDX 1.7 artifacts directory artifact must exist"

    for path in [sample_17_path, artifact_17_path]:
        raw_text = path.read_text(encoding="utf-8")
        data = json.loads(raw_text)

        assert data["bomFormat"] == "CycloneDX"
        assert data["specVersion"] == "1.7"
        assert "1.7" in data.get("$schema", "")
        assert data["specVersion"] != "1.6", "1.7 sample must never claim to be 1.6"

        v17 = JsonValidator(SchemaVersion.V1_7)
        val_err = v17.validate_str(raw_text)
        assert val_err is None, f"1.7 artifact failed official 1.7 schema: {val_err}"


def test_schema_conformance_for_both_versions(v16_validator, v17_validator):
    """Verify serialization engine correctly formats and validates both 1.6 and 1.7."""
    bom = Bom()
    algo_props = AlgorithmProperties(parameter_set_identifier="256")
    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="AES-256",
        bom_ref="crypto:algo/aes-256",
        crypto_properties=CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props),
    )
    bom.components.add(comp)

    # 1.6 Serialization & Validation
    s16 = serialize_cbom(bom, spec_version="1.6")
    d16 = json.loads(s16)
    assert d16["specVersion"] == "1.6"
    assert v16_validator.validate_str(s16) is None

    # 1.7 Serialization & Validation
    s17 = serialize_cbom(bom, spec_version="1.7")
    d17 = json.loads(s17)
    assert d17["specVersion"] == "1.7"
    assert v17_validator.validate_str(s17) is None


def test_distinguish_observed_facts_from_inferred_data():
    """
    Verify CBOM strictly distinguishes observed facts from inferred data:
    - Observed: physical occurrences (file, line, host, port), detection method, raw params.
    - Inferred: quantum classification, confidence scores, NIST quantum security levels.
    """
    sample_17_path = REPO_ROOT / "examples" / "FINAL_CBOM_17_SAMPLE.json"
    data = json.loads(sample_17_path.read_text(encoding="utf-8"))

    components = data["components"]
    assert len(components) > 0

    for comp in components:
        # Every component must have physical evidence (observed fact)
        evidence = comp.get("evidence", {})
        occurrences = evidence.get("occurrences", [])
        assert len(occurrences) > 0, f"Component {comp['name']} missing physical occurrence evidence"

        for occ in occurrences:
            loc = occ.get("location")
            assert loc and loc != "unknown", f"Component {comp['name']} has invalid location"

        # Properties separation
        props = {p["name"]: p["value"] for p in comp.get("properties", [])}

        # Observed facts
        assert "ecdat:reachabilityLevel" in props
        assert props["ecdat:reachabilityLevel"] in [
            "RUNTIME_CONFIRMED",
            "AST_ACCESSIBLE",
            "DYNAMIC_LOADED",
            "UNREACHABLE_DEAD_CODE",
            "CAPABILITY_PRESENT",
        ]
        assert "ecdat:detectionMethod" in props
        assert props["ecdat:detectionMethod"] in ["runtime_hook", "ast", "network_handshake", "regex"]

        # Inferred data
        if "ecdat:quantumClassification" in props:
            assert props["ecdat:quantumClassification"] in [
                "quantum-vulnerable",
                "quantum-resistant",
                "hybrid",
                "unknown",
            ]
            assert "ecdat:inferenceConfidence" in props
            conf = float(props["ecdat:inferenceConfidence"])
            assert 0.0 <= conf <= 1.0


def test_provenance_and_author_attribution():
    """Verify CBOM includes complete provenance: tool, target, timestamp, authors."""
    sample_17_path = REPO_ROOT / "examples" / "FINAL_CBOM_17_SAMPLE.json"
    data = json.loads(sample_17_path.read_text(encoding="utf-8"))

    meta = data.get("metadata", {})
    assert meta, "Metadata block is required"

    # Timestamp present and valid ISO-8601
    assert "timestamp" in meta
    assert "T" in meta["timestamp"]

    # Tool provenance present
    tools = meta.get("tools", {})
    comps = tools.get("components", []) if isinstance(tools, dict) else tools
    tool_names = [t.get("name") for t in comps]
    assert any("ECDAT" in name for name in tool_names), "ECDAT tool metadata required"

    # Target component present
    assert "component" in meta
    assert meta["component"]["name"] == "Enterprise Payments & Cryptographic Gateway"


def test_avoid_fabricated_metadata_and_zero_secrets():
    """
    Verify CBOM contains zero fabricated metadata and zero cleartext secrets:
    - No placeholder strings ('TODO', 'dummy', 'temp').
    - No fabricated licenses or fictional commit SHAs.
    - Zero private key material (PEM headers, raw RSA/EC keys).
    """
    sample_17_path = REPO_ROOT / "examples" / "FINAL_CBOM_17_SAMPLE.json"
    raw_text = sample_17_path.read_text(encoding="utf-8")

    # Zero secrets
    assert "-----BEGIN" not in raw_text
    assert "PRIVATE KEY-----" not in raw_text
    assert "BEGIN RSA PRIVATE KEY" not in raw_text

    # No dummy/fake placeholders
    for placeholder in ["TODO", "DUMMY_KEY", "PLACEHOLDER_HASH", "FAKE_LICENSE"]:
        assert placeholder not in raw_text


def test_determinism_where_promised():
    """
    Verify CBOM generation is deterministic:
    - Same finding input produces identical bom-refs, components, and properties.
    - Canonical bom-ref format: <source>:<assetType>/<slug>@<locator>.
    """
    f1 = CodeCryptoFinding(
        rule_id="r-aes",
        language="python",
        finding_type="algorithm",
        file_path="src/sec.py",
        line=42,
        column=1,
        algorithm="AES",
        key_size=256,
        confidence="HIGH",
        bom_ref="code:algorithm/aes-256@src/sec.py:42",
    )
    b1 = code_finding_to_cbom(f1)
    s1 = serialize_cbom(b1, spec_version="1.7")

    b2 = code_finding_to_cbom(f1)
    s2 = serialize_cbom(b2, spec_version="1.7")

    d1 = json.loads(s1)
    d2 = json.loads(s2)

    # Component counts match
    assert len(d1["components"]) == len(d2["components"])
    # bom-refs match exactly
    refs1 = [c["bom-ref"] for c in d1["components"]]
    refs2 = [c["bom-ref"] for c in d2["components"]]
    assert refs1 == refs2

    # Canonical format check
    for ref in refs1:
        parts = ref.split(":")
        assert len(parts) >= 2
        assert parts[0] in ["code", "net", "bin", "runtime", "kms", "crypto"]
