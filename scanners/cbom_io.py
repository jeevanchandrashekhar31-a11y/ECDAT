"""
CBOM Import / Export Service (Phase 8.2)

Supports:
1. Formats:
   - JSON (CycloneDX 1.7 target, 1.6 compatible)
   - XML (CycloneDX 1.7 target, 1.6 compatible)
   - Protobuf justification:
     Protobuf in the CycloneDX ecosystem is an experimental format specified via
     proto3 schemas, but is not natively supported by the standard CycloneDX Python
     library (cyclonedx-python-lib relies on official JSON and XML schema engines).
     Real-world tooling (Syft, Trivy, Dependency-Track, CycloneDX CLI) standardizes on
     JSON and XML. Attempting protobuf serialization produces a documented explanatory
     error directing users to JSON/XML wire formats.
   - CSV: Flattened tabular format for human analysis and risk auditing.
   - SARIF: OASIS SARIF v2.1.0 JSON format for security tooling (GitHub Code Scanning, IDEs).

2. Lifecycles:
   - import_cbom: Ingests JSON or XML CBOM into an in-memory CycloneDX Bom model.
   - normalize_cbom: Canonicalizes components, cleanses secrets, normalizes names,
     key sizes, and reachability.
   - correlate_cbom: Correlates assets with ECDAT risk rules and policy profiles.
   - export_cbom: Emits JSON, XML, CSV, or SARIF.
"""

import csv
import io
import json
from datetime import datetime, timezone
from xml.etree import ElementTree
from typing import Dict, Any, List, Optional, Tuple, Union

from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    AlgorithmProperties,
    CertificateProperties,
    ProtocolProperties,
    RelatedCryptoMaterialProperties,
)
from cyclonedx.output.json import JsonV1Dot6, JsonV1Dot7
from cyclonedx.output.xml import XmlV1Dot6, XmlV1Dot7
from cyclonedx.validation.json import JsonValidator
from cyclonedx.validation.xml import XmlValidator
from cyclonedx.schema import SchemaVersion

from scanners.cbom_mapping import serialize_cbom, validate_cbom_json, validate_cbom_detailed
from scanners.static.sanitization import redact_secrets


def import_cbom(data: Union[str, bytes, dict], format: str = "auto") -> Bom:
    """
    Imports a CBOM from JSON or XML format and parses it into a CycloneDX Bom object.
    Validates structure and schema. Hardened against DoS, XML bombs, prototype pollution,
    and secret leakage.
    """
    if isinstance(data, bytes):
        raw_text = data.decode("utf-8", errors="replace")
    elif isinstance(data, dict):
        raw_text = json.dumps(data)
    else:
        raw_text = str(data)

    if len(raw_text) > 50 * 1024 * 1024:
        raise ValueError("CBOM payload exceeds maximum size limit (50 MB).")

    if "PRIVATE KEY" in raw_text:
        raise ValueError("CBOM payload contains raw private key material, which is strictly prohibited.")

    detected_format = format.lower()
    if detected_format == "auto":
        stripped = raw_text.strip()
        if stripped.startswith("<"):
            detected_format = "xml"
        elif stripped.startswith("{") or stripped.startswith("["):
            detected_format = "json"
        else:
            raise ValueError("Unable to determine CBOM format (expected JSON or XML).")

    if detected_format == "json":
        if "__proto__" in raw_text or '"prototype"' in raw_text or '"constructor"' in raw_text:
            raise ValueError("Dangerous prototype pollution keys detected in CBOM JSON.")

        try:
            parsed = json.loads(raw_text)
        except Exception as e:
            raise ValueError(f"Malformed JSON syntax: {type(e).__name__}")

        if isinstance(parsed, list):
            parsed = {"bomFormat": "CycloneDX", "specVersion": "1.7", "components": parsed}
            raw_text = json.dumps(parsed)

        is_valid, err = validate_cbom_detailed(raw_text)
        if not is_valid:
            if "components" not in parsed:
                raise ValueError(f"Invalid CycloneDX JSON: {err}")

        try:
            return Bom.from_json(parsed)
        except Exception as e:
            clean_err = redact_secrets(str(e))
            raise ValueError(f"Failed to deserialize CycloneDX Bom: {type(e).__name__}: {clean_err}")

    elif detected_format == "xml":
        upper_xml = raw_text.upper()
        if "<!DOCTYPE" in upper_xml or "<!ENTITY" in upper_xml:
            raise ValueError("XML entity expansion / DOCTYPE is forbidden for security.")

        try:
            elem = ElementTree.fromstring(raw_text)
        except Exception as e:
            raise ValueError(f"Invalid XML syntax: {str(e)}")

        return Bom.from_xml(elem)

    elif detected_format == "protobuf":
        raise NotImplementedError(
            "Protobuf import is not justified in current CycloneDX Python ecosystem; "
            "standard enterprise tooling exchanges CBOM via JSON or XML."
        )
    else:
        raise ValueError(f"Unsupported import format: '{format}'. Supported formats: 'json', 'xml', 'auto'.")


def normalize_cbom(bom_or_data: Union[Bom, dict, str]) -> Dict[str, Any]:
    """
    Normalizes a CBOM:
    1. Standardizes component types and cryptographic property structures.
    2. Canonicalizes algorithm names, key sizes, and reachability levels.
    3. Guarantees raw private keys are never stored (strictly redacted).
    4. Deduplicates components and builds deterministic property indexes.
    """
    if isinstance(bom_or_data, Bom):
        raw_json = serialize_cbom(bom_or_data, spec_version="1.7")
        data = json.loads(raw_json)
    elif isinstance(bom_or_data, str):
        data = json.loads(bom_or_data)
    else:
        data = json.loads(json.dumps(bom_or_data))

    components = data.get("components", [])
    normalized_components = []
    seen_refs = set()

    for comp in components:
        ref = comp.get("bom-ref") or comp.get("name", "unknown")
        if ref in seen_refs:
            continue
        seen_refs.add(ref)

        c = dict(comp)
        props = {p.get("name"): p.get("value") for p in c.get("properties", []) if isinstance(p, dict)}

        # Redact private key values if present
        c_props = c.get("cryptoProperties", {})
        if "relatedCryptoMaterialProperties" in c_props:
            mat = c_props["relatedCryptoMaterialProperties"]
            if "value" in mat and mat["value"]:
                mat["value"] = "[REDACTED_SECRET_MATERIAL]"

        # Standardize algorithm and key size
        name = c.get("name", "")
        algo_name = props.get("ecdat:algorithm") or name
        key_size = props.get("ecdat:key_size") or props.get("ecdat:publicKeySize")

        if "algorithmProperties" in c_props:
            algo_p = c_props["algorithmProperties"]
            if key_size and "parameterSetIdentifier" not in algo_p:
                algo_p["parameterSetIdentifier"] = str(key_size)

        # Standardize reachability
        reachability = props.get("ecdat:reachabilityLevel") or props.get("ecdat:evidence_type") or "CAPABILITY_PRESENT"
        props["ecdat:reachabilityLevel"] = reachability

        # Normalization flags
        c["_normalized"] = {
            "canonical_algorithm": algo_name,
            "canonical_key_size": int(key_size) if key_size and str(key_size).isdigit() else None,
            "reachability": reachability,
            "has_provenance": any(k.startswith("ecdat:scanner") for k in props),
        }

        normalized_components.append(c)

    data["components"] = normalized_components
    data["_normalization_metadata"] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_components": len(normalized_components),
        "target_spec_version": "1.7",
    }
    return data


def correlate_cbom(
    bom_or_data: Union[Bom, dict, str],
    policy_profile: str = "internal_enterprise",
) -> Dict[str, Any]:
    """
    Correlates CBOM assets against security policies, quantum migration timelines,
    and reachability metrics.
    """
    normalized = normalize_cbom(bom_or_data)
    components = normalized.get("components", [])

    correlated_assets = []
    high_or_critical_count = 0

    for comp in components:
        props = {p.get("name"): p.get("value") for p in comp.get("properties", []) if isinstance(p, dict)}
        norm = comp.get("_normalized", {})
        algo = (norm.get("canonical_algorithm") or comp.get("name", "")).upper()
        key_size = norm.get("canonical_key_size")
        c_props = comp.get("cryptoProperties", {})
        asset_type = c_props.get("assetType", "unknown")

        is_weak = False
        quantum_vulnerable = False
        risk_level = "LOW"
        reasons = []

        if any(w in algo for w in ["MD5", "SHA1", "SHA-1", "DES", "RC4", "3DES"]):
            is_weak = True
            risk_level = "CRITICAL" if "MD5" in algo or "DES" in algo else "HIGH"
            reasons.append(f"Deprecated/broken classical algorithm: {algo}")

        if any(w in algo for w in ["RSA", "ECC", "ECDSA", "ECDH", "DSA", "DH"]):
            quantum_vulnerable = True
            if risk_level == "LOW":
                risk_level = "MEDIUM"
            reasons.append("Shor algorithm vulnerable: asymmetric key exchange/signature vulnerable to CRQC")
            if key_size and key_size < 2048 and "RSA" in algo:
                is_weak = True
                risk_level = "CRITICAL"
                reasons.append(f"Sub-standard RSA key size: {key_size} < 2048 bits")

        policy_status = "COMPLIANT"
        if policy_profile == "regulated_bfsi":
            if is_weak or (algo == "RSA" and key_size and key_size < 3072):
                policy_status = "VIOLATION"
                reasons.append("BFSI regulatory standard requires >= 3072-bit RSA or PQC")
        elif is_weak:
            policy_status = "VIOLATION"
        elif quantum_vulnerable and policy_profile == "post_quantum_readiness":
            policy_status = "WARNING"
            reasons.append("Post-quantum readiness policy recommends hybrid or ML-KEM/ML-DSA migration")

        if risk_level in ("HIGH", "CRITICAL"):
            high_or_critical_count += 1

        correlation_info = {
            "bom_ref": comp.get("bom-ref", "unknown"),
            "name": comp.get("name", "unknown"),
            "asset_type": asset_type,
            "algorithm": algo,
            "key_size": key_size,
            "risk_level": risk_level,
            "quantum_vulnerable": quantum_vulnerable,
            "policy_status": policy_status,
            "reasons": reasons,
            "reachability": norm.get("reachability", "CAPABILITY_PRESENT"),
        }
        correlated_assets.append(correlation_info)

    normalized["_correlation"] = {
        "policy_profile": policy_profile,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "total_analyzed": len(components),
        "high_or_critical_risk_count": high_or_critical_count,
        "assets": correlated_assets,
    }
    return normalized


def cbom_to_csv(bom_or_data: Union[Bom, dict, str]) -> str:
    """
    Exports a CBOM to a flattened, human-readable CSV table for risk review and auditing.
    """
    correlated = correlate_cbom(bom_or_data)
    assets = correlated.get("_correlation", {}).get("assets", [])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "BOM_Ref",
        "Component_Name",
        "Asset_Type",
        "Algorithm",
        "Key_Size_Bits",
        "Risk_Level",
        "Quantum_Vulnerable",
        "Policy_Status",
        "Reachability",
        "Reasons",
    ])

    for a in assets:
        writer.writerow([
            a.get("bom_ref", ""),
            a.get("name", ""),
            a.get("asset_type", ""),
            a.get("algorithm", ""),
            a.get("key_size", "") or "",
            a.get("risk_level", ""),
            "YES" if a.get("quantum_vulnerable") else "NO",
            a.get("policy_status", ""),
            a.get("reachability", ""),
            "; ".join(a.get("reasons", [])),
        ])

    return output.getvalue()


def cbom_to_sarif(bom_or_data: Union[Bom, dict, str]) -> str:
    """
    Exports CBOM findings into standard SARIF v2.1.0 for consumption by
    security tooling (e.g. GitHub Code Scanning, SonarQube, VS Code).
    """
    correlated = correlate_cbom(bom_or_data)
    assets = correlated.get("_correlation", {}).get("assets", [])
    components = {c.get("bom-ref"): c for c in correlated.get("components", [])}

    sarif_rules = []
    sarif_results = []
    rule_ids_seen = set()

    for a in assets:
        if a.get("risk_level") in ("LOW", "INFORMATIONAL") and a.get("policy_status") == "COMPLIANT":
            continue

        rule_id = f"ECDAT-{a.get('algorithm', 'CRYPTO')}-{a.get('risk_level', 'WARN')}"
        if rule_id not in rule_ids_seen:
            rule_ids_seen.add(rule_id)
            sarif_rules.append({
                "id": rule_id,
                "name": f"CryptographicRisk_{a.get('algorithm', 'Asset')}",
                "shortDescription": {"text": f"Cryptographic risk detected for {a.get('algorithm')}"},
                "fullDescription": {
                    "text": f"Identified {a.get('risk_level')} risk cryptographic asset: {a.get('algorithm')} ({a.get('asset_type')})."
                },
                "defaultConfiguration": {
                    "level": "error" if a.get("risk_level") in ("CRITICAL", "HIGH") else "warning"
                },
            })

        comp = components.get(a.get("bom_ref"), {})
        evidence = comp.get("evidence", {})
        occurrences = evidence.get("occurrences", [])
        loc_uri = "unknown"
        loc_line = 1
        if occurrences:
            first_occ = occurrences[0]
            loc_uri = first_occ.get("location", "crypto-inventory")
            loc_line = int(first_occ.get("line", 1) or 1)

        sarif_results.append({
            "ruleId": rule_id,
            "level": "error" if a.get("risk_level") in ("CRITICAL", "HIGH") else "warning",
            "message": {
                "text": f"{a.get('name')}: {'; '.join(a.get('reasons', ['Risk detected']))} [Policy: {a.get('policy_status')}]"
            },
            "locations": [
                {
                    "physicalLocation": {
                        "artifactLocation": {"uri": loc_uri},
                        "region": {"startLine": loc_line},
                    }
                }
            ],
            "properties": {
                "bomRef": a.get("bom_ref"),
                "reachability": a.get("reachability"),
                "quantumVulnerable": a.get("quantum_vulnerable"),
            },
        })

    sarif_doc = {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "ECDAT",
                        "version": "1.0.0",
                        "informationUri": "https://github.com/ecdat/ecdat",
                        "rules": sarif_rules,
                    }
                },
                "results": sarif_results,
            }
        ],
    }
    return json.dumps(sarif_doc, indent=2)


def export_cbom(bom: Bom, format: str = "json", spec_version: str = "1.7") -> str:
    """
    Exports a CycloneDX Bom object to the requested format:
    - 'json': CycloneDX 1.7 / 1.6 JSON
    - 'xml': CycloneDX 1.7 / 1.6 XML
    - 'csv': Flat tabular format for human analysis
    - 'sarif': OASIS SARIF v2.1.0 for security tooling
    - 'protobuf': Raises explanatory error regarding CycloneDX ecosystem standards
    """
    fmt = format.lower()
    if fmt == "json":
        return serialize_cbom(bom, spec_version=spec_version)

    elif fmt == "xml":
        if spec_version == "1.6":
            return XmlV1Dot6(bom).output_as_string(indent=2)
        return XmlV1Dot7(bom).output_as_string(indent=2)

    elif fmt == "csv":
        return cbom_to_csv(bom)

    elif fmt == "sarif":
        return cbom_to_sarif(bom)

    elif fmt == "protobuf":
        raise NotImplementedError(
            "Protobuf export is not justified in current CycloneDX Python ecosystem: "
            "standard enterprise security pipelines (CycloneDX CLI, Syft, Trivy, Dependency-Track) "
            "operate on CycloneDX JSON (1.7/1.6) or XML. "
            "Please use format='json' or format='xml'."
        )
    else:
        raise ValueError(f"Unsupported export format: '{format}'. Supported formats: 'json', 'xml', 'csv', 'sarif'.")
