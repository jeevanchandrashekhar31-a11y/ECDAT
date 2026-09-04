import json
import jsonschema
from datetime import datetime
from typing import List
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    ProtocolProperties,
    ProtocolPropertiesType,
    AlgorithmProperties,
    CertificateProperties,
    RelatedCryptoMaterialProperties,
    RelatedCryptoMaterialType,
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from cyclonedx.output.json import JsonV1Dot6
from scanners.models import NetworkCryptoFinding, CodeCryptoFinding, BinaryContainerFinding


def network_finding_to_cbom(finding: NetworkCryptoFinding) -> Bom:
    bom = Bom()

    target_ref = f"net:target/{finding.host}:{finding.port}"
    target_comp = Component(type=ComponentType.APPLICATION, name=f"{finding.host}:{finding.port}", bom_ref=target_ref)
    bom.components.add(target_comp)

    dependencies = set()

    for version in finding.tls_versions:
        slug = version.lower().replace(" ", "")
        comp_ref = f"net:protocol/{slug}@{finding.bom_ref}"

        proto_type = ProtocolPropertiesType.SSH if finding.protocol.upper() == "SSH" else ProtocolPropertiesType.TLS
        protocol_props = ProtocolProperties(type=proto_type, version=version)
        if finding.cipher_suites:
            protocol_props.cipher_suites = finding.cipher_suites

        crypto_props = CryptoProperties(asset_type=CryptoAssetType.PROTOCOL, protocol_properties=protocol_props)

        evidence = ComponentEvidence(
            occurrences=[Occurrence(location=finding.bom_ref, additional_context="negotiated/supported options")]
        )

        comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"{finding.protocol.upper()} {version}",
            bom_ref=comp_ref,
            crypto_properties=crypto_props,
            evidence=evidence,
        )
        bom.components.add(comp)
        dependencies.add(comp)

    for i, cert in enumerate(finding.cert_chain):
        is_leaf = i == 0
        position = "leaf" if is_leaf else ("root" if cert.get("is_self_signed") else "intermediate")
        suffix = finding.bom_ref if is_leaf else f"{finding.bom_ref}-chain{i}"
        comp_ref = f"net:certificate/{suffix}"

        cert_props = CertificateProperties(
            subject_name=cert.get("subjectName"),
            issuer_name=cert.get("issuerName"),
            not_valid_before=datetime.fromisoformat(cert.get("notValidBefore")) if cert.get("notValidBefore") else None,
            not_valid_after=datetime.fromisoformat(cert.get("notValidAfter")) if cert.get("notValidAfter") else None,
            certificate_format="X.509",
        )

        crypto_props = CryptoProperties(asset_type=CryptoAssetType.CERTIFICATE, certificate_properties=cert_props)
        evidence = ComponentEvidence(
            occurrences=[Occurrence(location=finding.bom_ref, additional_context=f"negotiated {position} certificate")]
        )

        comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"{finding.host} {position} certificate",
            bom_ref=comp_ref,
            crypto_properties=crypto_props,
            evidence=evidence,
        )
        if cert.get("isExpired") is not None:
            comp.properties.add(Property(name="ecdat:isExpired", value=str(cert.get("isExpired")).lower()))
        if cert.get("isSelfSigned") is not None:
            comp.properties.add(Property(name="ecdat:isSelfSigned", value=str(cert.get("isSelfSigned")).lower()))
        comp.properties.add(Property(name="ecdat:chainPosition", value=position))

        bom.components.add(comp)
        dependencies.add(comp)

    for algo_family, size in finding.key_sizes.items():
        slug = f"{algo_family.lower()}-{size}"
        comp_ref = f"net:algorithm/{slug}@{finding.bom_ref}"

        algo_props = AlgorithmProperties(parameter_set_identifier=str(size), nist_quantum_security_level=0)
        crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
        evidence = ComponentEvidence(
            occurrences=[Occurrence(location=finding.bom_ref, additional_context="key exchange/signature material")]
        )

        comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"{algo_family}-{size}",
            bom_ref=comp_ref,
            crypto_properties=crypto_props,
            evidence=evidence,
        )
        bom.components.add(comp)
        dependencies.add(comp)

    bom.register_dependency(target_comp, dependencies)
    return bom


def code_finding_to_cbom(finding: CodeCryptoFinding) -> Bom:
    bom = Bom()

    target_comp = Component(type=ComponentType.FILE, name=finding.file_path, bom_ref=f"code:file@{finding.file_path}")
    bom.components.add(target_comp)

    if finding.finding_type == "hardcoded_key":
        related_props = RelatedCryptoMaterialProperties(type=RelatedCryptoMaterialType.PRIVATE_KEY)
        crypto_props = CryptoProperties(
            asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL, related_crypto_material_properties=related_props
        )
        comp_name = f"Hardcoded {finding.algorithm} Key" if finding.algorithm else "Hardcoded Key"
    else:
        algo_props = AlgorithmProperties(
            parameter_set_identifier=str(finding.key_size) if finding.key_size else None, nist_quantum_security_level=0
        )
        crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
        comp_name = f"{finding.algorithm}-{finding.key_size}" if finding.key_size else finding.algorithm

    evidence = ComponentEvidence(occurrences=[Occurrence(location=finding.file_path, line=finding.line)])

    comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name=comp_name,
        bom_ref=finding.bom_ref,
        crypto_properties=crypto_props,
        evidence=evidence,
    )
    comp.properties.add(Property(name="ecdat:confidence", value=finding.confidence))
    if finding.library:
        comp.properties.add(Property(name="ecdat:library", value=finding.library))
    if getattr(finding, "analysis_source", None):
        comp.properties.add(Property(name="ecdat:analysis_source", value=finding.analysis_source))
    if getattr(finding, "needs_human_review", None):
        comp.properties.add(Property(name="ecdat:needs_human_review", value=str(finding.needs_human_review).lower()))
    if getattr(finding, "reason", None):
        comp.properties.add(Property(name="ecdat:reason", value=finding.reason))

    bom.components.add(comp)
    bom.register_dependency(target_comp, [comp])

    return bom


def binary_finding_to_cbom(finding: BinaryContainerFinding) -> Bom:
    bom = Bom()

    comp = Component(
        type=ComponentType.LIBRARY,
        name=finding.component_name,
        version=finding.component_version or "unknown",
        bom_ref=finding.bom_ref,
    )

    if finding.purl:
        try:
            from packageurl import PackageURL

            comp.purl = PackageURL.from_string(finding.purl)
        except Exception:
            comp.properties.add(Property(name="purl", value=finding.purl))

    comp.properties.add(Property(name="ecdat:data_sensitivity", value=finding.data_sensitivity))
    comp.properties.add(Property(name="ecdat:business_criticality", value=finding.business_criticality))
    comp.properties.add(Property(name="ecdat:evidence_type", value=finding.evidence_type))
    comp.properties.add(Property(name="ecdat:confidence", value=finding.confidence))
    comp.properties.add(Property(name="ecdat:reason", value="Library presence does not prove active crypto usage."))

    if finding.cpe:
        comp.properties.add(Property(name="syft:cpe", value=finding.cpe))
    if finding.artifact_path:
        comp.properties.add(Property(name="syft:artifact_path", value=finding.artifact_path))

    bom.components.add(comp)
    return bom


def merge_cboms(cboms: List[Bom]) -> Bom:
    merged = Bom()
    seen_refs = set()

    for bom in cboms:
        for comp in bom.components:
            if comp.bom_ref.value not in seen_refs:
                merged.components.add(comp)
                seen_refs.add(comp.bom_ref.value)
        for dep in bom.dependencies:
            merged.dependencies.add(dep)

    return merged


def serialize_cbom(bom: Bom) -> str:
    # Serialize to JSON using cyclonedx SDK
    json_str = JsonV1Dot6(bom).output_as_string(indent=2)
    # The current python SDK (v11.12.0) doesn't natively support algorithmFamily in AlgorithmProperties.
    # To maintain schema compliance, we inject it manually using a hack similar to the original scanner.
    import json

    data = json.loads(json_str)

    # Very basic patch for known family names
    for comp in data.get("components", []):
        name = comp.get("name", "").upper()
        c_props = comp.get("cryptoProperties", {})
        if c_props.get("assetType") == "algorithm" and "algorithmProperties" in c_props:
            family = "Unknown"
            if "RSA" in name:
                family = "RSA"
            elif "MD5" in name:
                family = "MD5"
            elif "SHA1" in name or "SHA-1" in name:
                family = "SHA1"
            elif "ECC" in name or "EC" in name or "DH" in name:
                family = "ECC/DH"
            elif "AES" in name:
                family = "AES"
            c_props["algorithmProperties"]["algorithmFamily"] = family

    return json.dumps(data, indent=2)


def validate_cbom_json(json_str: str) -> bool:
    try:
        data = json.loads(json_str)
        # A basic check to ensure it looks like a valid CDX 1.6
        if data.get("bomFormat") != "CycloneDX" or data.get("specVersion") != "1.6":
            return False
        if "components" not in data:
            return False
        return True
    except Exception:
        return False
