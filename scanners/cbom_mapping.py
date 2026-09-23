import json
import jsonschema
from datetime import datetime, timezone
from typing import List, Optional, Tuple, Any, Set, Dict
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    ProtocolProperties,
    ProtocolPropertiesType,
    ProtocolPropertiesCipherSuite,
    AlgorithmProperties,
    CertificateProperties,
    RelatedCryptoMaterialProperties,
    RelatedCryptoMaterialType,
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from cyclonedx.model.tool import Tool
from cyclonedx.output.json import JsonV1Dot6, JsonV1Dot7
from cyclonedx.validation.json import JsonValidator
from cyclonedx.schema import SchemaVersion
from scanners.models import NetworkCryptoFinding, CodeCryptoFinding, BinaryContainerFinding
from scanners.common.crypto_classifier import CryptoClassifier

CYCLONEDX_17_ALGORITHM_FAMILIES = {
    "3DES",
    "3GPP-XOR",
    "A5/1",
    "A5/2",
    "AES",
    "ARIA",
    "Argon2",
    "Ascon",
    "BLAKE2",
    "BLAKE3",
    "BLS",
    "Blowfish",
    "CAMELLIA",
    "CAST5",
    "CAST6",
    "CMAC",
    "CMEA",
    "CTR_DRBG",
    "ChaCha",
    "ChaCha20",
    "DES",
    "DSA",
    "ECDH",
    "ECDSA",
    "ECIES",
    "EdDSA",
    "ElGamal",
    "FFDH",
    "Fortuna",
    "GOST",
    "HC",
    "HKDF",
    "HMAC",
    "HMAC_DRBG",
    "HPKE",
    "Hash_DRBG",
    "IDEA",
    "IKE-PRF",
    "J-PAKE",
    "LMS",
    "MD2",
    "MD4",
    "MD5",
    "MILENAGE",
    "ML-DSA",
    "ML-KEM",
    "MQV",
    "OPAQUE",
    "PBES1",
    "PBES2",
    "PBKDF1",
    "PBKDF2",
    "PBMAC1",
    "Poly1305",
    "RABBIT",
    "RC2",
    "RC4",
    "RC5",
    "RC6",
    "RIPEMD",
    "RSAES-OAEP",
    "RSAES-PKCS1",
    "RSASSA-PKCS1",
    "RSASSA-PSS",
    "SEED",
    "SHA-1",
    "SHA-2",
    "SHA-3",
    "SLH-DSA",
    "SM2",
    "SM3",
    "SM4",
    "SM9",
    "SNOW3G",
    "SP800-108",
    "SPAKE2",
    "SPAKE2PLUS",
    "SRP",
    "Salsa20",
    "Serpent",
    "SipHash",
    "Skipjack",
    "TUAK",
    "Twofish",
    "UMAC",
    "Whirlpool",
    "X3DH",
    "XMSS",
    "Yarrow",
    "ZUC",
    "bcrypt",
    "scrypt",
    "yescrypt",
}

FAMILY_CASE_MAP = {f.upper(): f for f in CYCLONEDX_17_ALGORITHM_FAMILIES}


def resolve_cdx17_algorithm_family(name: str, context: str = "") -> Optional[str]:
    if not name:
        return None
    raw = name.strip()
    upper = raw.upper()
    if upper in FAMILY_CASE_MAP:
        return FAMILY_CASE_MAP[upper]
    if upper in ("SHA1", "SHA-1"):
        return "SHA-1"
    if upper in ("SHA2", "SHA-2", "SHA256", "SHA-256", "SHA384", "SHA-384", "SHA512", "SHA-512"):
        return "SHA-2"
    if upper in ("SHA3", "SHA-3", "SHA3-256", "SHA3-512"):
        return "SHA-3"
    if upper in ("ED25519", "ED448", "EDDSA"):
        return "EdDSA"
    if upper in ("X25519", "X448"):
        return "ECDH"
    if upper in ("SECP256R1", "PRIME256V1", "P-256", "NISTP256"):
        return "ECDSA"
    if "CHACHA20" in upper:
        return "ChaCha20"
    if "ML-KEM" in upper or "MLKEM" in upper:
        return "ML-KEM"
    if "ML-DSA" in upper or "MLDSA" in upper:
        return "ML-DSA"
    if "SLH-DSA" in upper or "SLHDSA" in upper:
        return "SLH-DSA"
    if "RSA" in upper:
        if "OAEP" in upper:
            return "RSAES-OAEP"
        if "PSS" in upper:
            return "RSASSA-PSS"
        if "SIGN" in context.lower() or "signature" in upper:
            return "RSASSA-PKCS1"
        if "ENCRYPT" in context.lower():
            return "RSAES-PKCS1"
        return "RSASSA-PKCS1"
    return None


def _attach_provenance_metadata(bom: Bom, target_name: Optional[str] = None):
    try:
        tool_comp = Component(
            type=ComponentType.APPLICATION,
            name="ECDAT Cryptographic Discovery and Analysis Tool",
            version="1.0.0",
        )
        bom.metadata.tools.components.add(tool_comp)
    except Exception:
        pass


def network_finding_to_cbom(finding: NetworkCryptoFinding) -> Bom:
    bom = Bom()

    target_ref = f"net:target/{finding.host}:{finding.port}"
    target_comp = Component(type=ComponentType.APPLICATION, name=f"{finding.host}:{finding.port}", bom_ref=target_ref)
    target_comp.properties.add(Property(name="ecdat:scanner", value="network_scanner"))
    target_comp.properties.add(Property(name="ecdat:file", value=f"{finding.host}:{finding.port}"))
    target_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=f"{finding.host}:{finding.port}")])
    if finding.authorization_id:
        target_comp.properties.add(Property(name="ecdat:authorizationId", value=finding.authorization_id))
    if finding.audit_id:
        target_comp.properties.add(Property(name="ecdat:auditId", value=finding.audit_id))
    if finding.weak_algorithms:
        target_comp.properties.add(Property(name="ecdat:weakAlgorithms", value=",".join(finding.weak_algorithms)))
    if finding.trust_problems:
        target_comp.properties.add(Property(name="ecdat:trustProblems", value=",".join(finding.trust_problems)))
    if finding.quantum_vulnerabilities:
        target_comp.properties.add(
            Property(name="ecdat:quantumVulnerabilities", value=",".join(finding.quantum_vulnerabilities))
        )
    if finding.key_exchanges:
        target_comp.properties.add(Property(name="ecdat:keyExchanges", value=",".join(finding.key_exchanges)))
    if finding.signature_algorithms:
        target_comp.properties.add(
            Property(name="ecdat:signatureAlgorithms", value=",".join(finding.signature_algorithms))
        )
    if finding.alpn_protocols:
        target_comp.properties.add(Property(name="ecdat:alpnProtocols", value=",".join(finding.alpn_protocols)))

    bom.components.add(target_comp)

    dependencies = set()

    for version in finding.tls_versions:
        slug = version.lower().replace(" ", "")
        comp_ref = f"net:protocol/{slug}@{finding.bom_ref}"

        proto_type = ProtocolPropertiesType.SSH if finding.protocol.upper() == "SSH" else ProtocolPropertiesType.TLS
        protocol_props = ProtocolProperties(type=proto_type, version=version)
        if finding.cipher_suites:
            protocol_props.cipher_suites = [
                ProtocolPropertiesCipherSuite(name=cs) if isinstance(cs, str) else cs for cs in finding.cipher_suites
            ]

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
        comp.properties.add(Property(name="ecdat:scanner", value="network_scanner"))
        comp.properties.add(Property(name="ecdat:file", value=f"{finding.host}:{finding.port}"))
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
        comp.properties.add(Property(name="ecdat:scanner", value="network_scanner"))
        comp.properties.add(Property(name="ecdat:file", value=f"{finding.host}:{finding.port}"))
        if cert.get("isExpired") is not None:
            comp.properties.add(Property(name="ecdat:isExpired", value=str(cert.get("isExpired")).lower()))
        if cert.get("isSelfSigned") is not None:
            comp.properties.add(Property(name="ecdat:isSelfSigned", value=str(cert.get("isSelfSigned")).lower()))
        if cert.get("algo_family"):
            comp.properties.add(Property(name="ecdat:algorithm", value=str(cert.get("algo_family"))))
        else:
            comp.properties.add(Property(name="ecdat:algorithm", value="unknown"))
        if cert.get("key_size"):
            comp.properties.add(Property(name="ecdat:key_size", value=str(cert.get("key_size"))))
        else:
            comp.properties.add(Property(name="ecdat:key_size", value="unknown"))
        if cert.get("signature_algorithm"):
            comp.properties.add(Property(name="ecdat:signatureAlgorithm", value=str(cert.get("signature_algorithm"))))
        if cert.get("trust_problems"):
            comp.properties.add(Property(name="ecdat:trustProblems", value=",".join(cert.get("trust_problems"))))
        if cert.get("quantum_vulnerabilities"):
            comp.properties.add(
                Property(name="ecdat:quantumVulnerabilities", value=",".join(cert.get("quantum_vulnerabilities")))
            )
        if cert.get("fingerprint_sha256"):
            comp.properties.add(Property(name="ecdat:fingerprint", value=str(cert.get("fingerprint_sha256"))))
        comp.properties.add(Property(name="ecdat:chainPosition", value=position))

        bom.components.add(comp)
        dependencies.add(comp)

    for algo_family, size in finding.key_sizes.items():
        algo_name = algo_family or "unknown"
        size_str = str(size) if (size is not None and size != 0) else None
        slug = f"{algo_name.lower()}-{size_str or 'unknown'}"
        comp_ref = f"net:algorithm/{slug}@{finding.bom_ref}"

        algo_props = AlgorithmProperties(parameter_set_identifier=size_str, nist_quantum_security_level=0)
        crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
        evidence = ComponentEvidence(
            occurrences=[Occurrence(location=finding.bom_ref, additional_context="key exchange/signature material")]
        )

        comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"{algo_name}-{size_str}" if size_str else algo_name,
            bom_ref=comp_ref,
            crypto_properties=crypto_props,
            evidence=evidence,
        )
        comp.properties.add(Property(name="ecdat:scanner", value="network_scanner"))
        comp.properties.add(Property(name="ecdat:file", value=f"{finding.host}:{finding.port}"))
        comp.properties.add(Property(name="ecdat:algorithm", value=algo_name))
        comp.properties.add(Property(name="ecdat:key_size", value=size_str or "unknown"))
        clf_res = CryptoClassifier.classify(algo_name, key_size=size)
        comp.properties.add(Property(name="ecdat:quantumClassification", value=clf_res.classification))
        bom.components.add(comp)
        dependencies.add(comp)

    bom.register_dependency(target_comp, dependencies)
    _attach_provenance_metadata(bom, "network_scanner")
    return bom


def code_finding_to_cbom(finding: CodeCryptoFinding) -> Bom:
    bom = Bom()

    target_comp = Component(type=ComponentType.FILE, name=finding.file_path, bom_ref=f"code:file@{finding.file_path}")
    target_comp.properties.add(Property(name="ecdat:scanner", value="static_scanner"))
    target_comp.properties.add(Property(name="ecdat:file", value=finding.file_path))
    target_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=finding.file_path, line=finding.line)])
    bom.components.add(target_comp)

    algo_name = finding.algorithm or "unknown"
    key_size_str = str(finding.key_size) if (finding.key_size is not None and finding.key_size != 0) else None

    if finding.finding_type == "hardcoded_key":
        related_props = RelatedCryptoMaterialProperties(type=RelatedCryptoMaterialType.PRIVATE_KEY)
        crypto_props = CryptoProperties(
            asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL, related_crypto_material_properties=related_props
        )
        comp_name = f"Hardcoded {algo_name} Key" if algo_name != "unknown" else "Hardcoded Key"
    else:
        algo_props = AlgorithmProperties(
            parameter_set_identifier=key_size_str, nist_quantum_security_level=0
        )
        crypto_props = CryptoProperties(asset_type=CryptoAssetType.ALGORITHM, algorithm_properties=algo_props)
        comp_name = f"{algo_name}-{key_size_str}" if key_size_str else algo_name

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
    if getattr(finding, "fingerprint", None):
        comp.properties.add(Property(name="ecdat:fingerprint", value=finding.fingerprint))
    comp.properties.add(Property(name="ecdat:scanner", value="static_scanner"))
    comp.properties.add(Property(name="ecdat:scanner_version", value="1.0.0"))
    comp.properties.add(Property(name="ecdat:file", value=finding.file_path))
    comp.properties.add(Property(name="ecdat:algorithm", value=algo_name))
    comp.properties.add(Property(name="ecdat:key_size", value=key_size_str or "unknown"))
    clf_code_res = CryptoClassifier.classify(algo_name, key_size=finding.key_size)
    comp.properties.add(Property(name="ecdat:quantumClassification", value=clf_code_res.classification))
    comp.properties.add(Property(name="ecdat:timestamp", value=datetime.now(timezone.utc).isoformat()))
    comp.properties.add(Property(name="ecdat:source", value=getattr(finding, "analysis_source", "source_code")))
    comp.properties.add(Property(name="ecdat:evidence_nature", value="observed"))

    bom.components.add(comp)
    bom.register_dependency(target_comp, [comp])
    _attach_provenance_metadata(bom, "static_scanner")

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

    loc = finding.artifact_path or finding.target or "unknown"
    comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=loc)])
    comp.properties.add(Property(name="ecdat:scanner", value="binary_container_scanner"))
    comp.properties.add(Property(name="ecdat:file", value=loc))
    comp.properties.add(Property(name="ecdat:data_sensitivity", value=finding.data_sensitivity))
    comp.properties.add(Property(name="ecdat:business_criticality", value=finding.business_criticality))
    comp.properties.add(Property(name="ecdat:evidence_type", value=finding.evidence_type))
    comp.properties.add(Property(name="ecdat:confidence", value=finding.confidence))
    comp.properties.add(Property(name="ecdat:reason", value="Library presence does not prove active crypto usage."))

    if finding.cpe:
        comp.properties.add(Property(name="syft:cpe", value=finding.cpe))
    if finding.artifact_path:
        comp.properties.add(Property(name="syft:artifact_path", value=finding.artifact_path))
    if finding.crypto_library:
        comp.properties.add(Property(name="ecdat:crypto_library", value=finding.crypto_library))
        comp.properties.add(Property(name="ecdat:algorithm", value=finding.crypto_library))

    bom.components.add(comp)
    _attach_provenance_metadata(bom, "binary_container_scanner")
    return bom


def binary_metadata_to_cbom(meta, target_name: str = "") -> Bom:
    """
    Converts a BinaryMetadata object (extracted via safe, non-executing static analysis)
    into a rich CycloneDX 1.6 Cryptographic Bill of Materials (CBOM).
    """
    bom = Bom()
    file_name = target_name or (meta.file_path.replace("\\", "/").split("/")[-1] if meta.file_path else "binary")
    target_ref = f"binary:target/{file_name}"

    target_comp = Component(
        type=ComponentType.APPLICATION,
        name=file_name,
        bom_ref=target_ref,
    )
    fmt_val = meta.binary_format.value if hasattr(meta.binary_format, "value") else str(meta.binary_format)
    endian_val = meta.endianness.value if hasattr(meta.endianness, "value") else str(meta.endianness)

    target_comp.properties.add(Property(name="ecdat:scanner", value="binary_scanner"))
    target_comp.properties.add(Property(name="ecdat:file", value=file_name))
    target_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=file_name)])
    target_comp.properties.add(Property(name="ecdat:binary_format", value=fmt_val))
    target_comp.properties.add(Property(name="ecdat:architecture", value=meta.architecture or "unknown"))
    target_comp.properties.add(Property(name="ecdat:endianness", value=endian_val))
    target_comp.properties.add(Property(name="ecdat:file_size", value=str(meta.file_size)))
    target_comp.properties.add(Property(name="ecdat:sha256", value=meta.file_hash_sha256))
    target_comp.properties.add(Property(name="ecdat:bit_width", value=str(meta.bit_width)))
    target_comp.properties.add(Property(name="ecdat:analysis_mode", value="STATIC_SAFE_NON_EXECUTING"))

    # Add imported libraries summary
    if meta.imported_libraries:
        target_comp.properties.add(
            Property(name="ecdat:imported_libraries", value=",".join(meta.imported_libraries[:50]))
        )

    bom.components.add(target_comp)
    dep_comps = []

    # Map detected crypto indicators as components
    seen_libs = set()
    for ind in getattr(meta, "crypto_library_indicators", []):
        lib_name = ind.library_name
        comp_ref = f"binary:crypto_lib/{lib_name.lower().replace(' ', '_')}@{target_ref}"
        if comp_ref in seen_libs:
            continue
        seen_libs.add(comp_ref)

        lib_comp = Component(
            type=ComponentType.LIBRARY,
            name=lib_name,
            bom_ref=comp_ref,
        )
        lib_comp.properties.add(Property(name="ecdat:scanner", value="binary_scanner"))
        lib_comp.properties.add(Property(name="ecdat:file", value=file_name))
        lib_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=file_name)])
        lib_comp.properties.add(Property(name="ecdat:confidence", value=ind.confidence))
        if ind.description:
            lib_comp.properties.add(Property(name="ecdat:description", value=ind.description[:255]))

        evidence_parts = []
        if ind.matched_libraries:
            evidence_parts.append(f"libs:[{','.join(ind.matched_libraries[:5])}]")
        if ind.matched_symbols:
            evidence_parts.append(f"symbols:[{','.join(ind.matched_symbols[:10])}]")
        if ind.matched_strings:
            evidence_parts.append(f"strings:[{','.join(ind.matched_strings[:5])}]")
        if evidence_parts:
            lib_comp.properties.add(Property(name="ecdat:evidence", value="; ".join(evidence_parts)[:255]))
        lib_comp.properties.add(Property(name="ecdat:reason", value="Static binary metadata indicator (non-executing)"))
        bom.components.add(lib_comp)
        dep_comps.append(lib_comp)

    # Map certificates if discovered
    for i, cert in enumerate(getattr(meta, "certificates", [])):
        cert_ref = f"binary:cert/{i}@{target_ref}"
        algo_name = cert.public_key_algorithm or "unknown"
        cert_comp = Component(
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            name=f"Certificate {i + 1} ({algo_name})",
            bom_ref=cert_ref,
        )
        cert_comp.properties.add(Property(name="ecdat:scanner", value="binary_scanner"))
        cert_comp.properties.add(Property(name="ecdat:file", value=file_name))
        cert_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=file_name)])
        cert_comp.properties.add(Property(name="ecdat:public_key_algorithm", value=algo_name))
        cert_comp.properties.add(Property(name="ecdat:key_size_bits", value=str(cert.key_size_bits) if cert.key_size_bits else "unknown"))
        if cert.subject:
            cert_comp.properties.add(Property(name="ecdat:subject", value=cert.subject))
        if cert.issuer:
            cert_comp.properties.add(Property(name="ecdat:issuer", value=cert.issuer))
        if cert.sha256_fingerprint:
            cert_comp.properties.add(Property(name="ecdat:fingerprint", value=cert.sha256_fingerprint))
        bom.components.add(cert_comp)
        dep_comps.append(cert_comp)

    if dep_comps:
        bom.register_dependency(target_comp, dep_comps)

    _attach_provenance_metadata(bom, "binary_scanner")
    return bom


def hybrid_analysis_to_cbom(analysis_props: Any) -> Bom:
    """
    Transforms TlsHandshakeProperties (Phase 5.3) into CycloneDX 1.6 CBOM.
    Preserves:
    - Explicit classical vs PQC vs hybrid categorization
    - First-class components (classical KEX, PQC KEX, combiner)
    - PCAP plaintext non-disclosure disclaimer
    - Versioned catalog algorithm metadata
    """
    bom = Bom()
    endpoint = getattr(analysis_props, "endpoint", "network-endpoint")
    endpoint_ref = f"net:endpoint/{endpoint}"

    # Endpoint Application Component
    endpoint_comp = Component(
        type=ComponentType.APPLICATION,
        name=endpoint,
        bom_ref=endpoint_ref,
    )
    endpoint_comp.properties.add(Property(name="ecdat:scanner", value="network_hybrid_analyzer"))
    endpoint_comp.properties.add(Property(name="ecdat:file", value=endpoint))
    endpoint_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=endpoint)])
    endpoint_comp.properties.add(
        Property(
            name="ecdat:evidenceSource", value=str(getattr(analysis_props, "evidence_source", "network_handshake"))
        )
    )
    endpoint_comp.properties.add(
        Property(name="ecdat:pcapDisclaimer", value=str(getattr(analysis_props, "pcap_plaintext_disclaimer", "")))
    )
    endpoint_comp.properties.add(Property(name="ecdat:packetCaptureCanRevealPlaintext", value="false"))

    bom.components.add(endpoint_comp)
    dep_comps = []

    # Negotiated KEX Component
    kex_name = (
        getattr(analysis_props, "standard_name", None)
        or getattr(analysis_props, "key_exchange_group", None)
        or "KeyExchange"
    )
    kex_ref = f"net:kex/{kex_name}@{endpoint}"

    nist_lvl = getattr(analysis_props, "nist_quantum_level", None)
    algo_props = AlgorithmProperties(nist_quantum_security_level=nist_lvl if nist_lvl is not None else 0)
    crypto_props = CryptoProperties(
        asset_type=CryptoAssetType.ALGORITHM,
        algorithm_properties=algo_props,
    )

    kex_comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name=kex_name,
        bom_ref=kex_ref,
        crypto_properties=crypto_props,
    )
    kex_comp.properties.add(Property(name="ecdat:scanner", value="network_hybrid_analyzer"))
    kex_comp.properties.add(Property(name="ecdat:file", value=endpoint))
    kex_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=endpoint)])
    kex_comp.properties.add(
        Property(name="ecdat:category", value=str(getattr(analysis_props, "category", "classical")))
    )
    kex_comp.properties.add(
        Property(name="ecdat:tlsVersion", value=str(getattr(analysis_props, "tls_version", "TLSv1.3")))
    )
    kex_comp.properties.add(Property(name="ecdat:cipherSuite", value=str(getattr(analysis_props, "cipher_suite", ""))))
    if getattr(analysis_props, "iana_group_id", None):
        kex_comp.properties.add(Property(name="ecdat:ianaGroupId", value=str(analysis_props.iana_group_id)))
    if getattr(analysis_props, "standard_reference", None):
        kex_comp.properties.add(Property(name="ecdat:standardReference", value=str(analysis_props.standard_reference)))
    kex_comp.properties.add(
        Property(
            name="ecdat:hndlResilient",
            value=str(getattr(analysis_props, "harvest_now_decrypt_later_resilient", False)).lower(),
        )
    )

    bom.components.add(kex_comp)
    dep_comps.append(kex_comp)

    # First-class relationships and child components
    sub_dependencies = []
    for rel in getattr(analysis_props, "relationships", []):
        r_type = getattr(rel, "relationship_type", None)
        if hasattr(r_type, "value"):
            r_type = r_type.value
        props = getattr(rel, "properties", {})

        if r_type in ["has_classical_component", "has_post_quantum_component"]:
            sub_id = getattr(rel, "target_id", "sub-algo")
            sub_name = props.get("standard_name", sub_id)
            sub_ref = f"net:subalgo/{sub_name}@{endpoint}"
            is_pqc = r_type == "has_post_quantum_component"

            sub_algo_props = AlgorithmProperties(
                nist_quantum_security_level=props.get("nist_level", 3 if is_pqc else 0)
            )
            sub_crypto_props = CryptoProperties(
                asset_type=CryptoAssetType.ALGORITHM,
                algorithm_properties=sub_algo_props,
            )
            sub_comp = Component(
                type=ComponentType.CRYPTOGRAPHIC_ASSET,
                name=sub_name,
                bom_ref=sub_ref,
                crypto_properties=sub_crypto_props,
            )
            sub_comp.properties.add(Property(name="ecdat:scanner", value="network_hybrid_analyzer"))
            sub_comp.properties.add(Property(name="ecdat:file", value=endpoint))
            sub_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=endpoint)])
            sub_comp.properties.add(Property(name="ecdat:componentRole", value=props.get("role", "pre_master_secret")))
            sub_comp.properties.add(Property(name="ecdat:quantumResilient", value=str(is_pqc).lower()))

            bom.components.add(sub_comp)
            sub_dependencies.append(sub_comp)

        elif r_type == "uses_hybrid_combiner":
            combiner_func = props.get("function", "HKDF-SHA256")
            comb_ref = f"net:combiner/{combiner_func}@{endpoint}"
            comb_comp = Component(
                type=ComponentType.CRYPTOGRAPHIC_ASSET,
                name=combiner_func,
                bom_ref=comb_ref,
            )
            comb_comp.properties.add(Property(name="ecdat:scanner", value="network_hybrid_analyzer"))
            comb_comp.properties.add(Property(name="ecdat:file", value=endpoint))
            comb_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=endpoint)])
            comb_comp.properties.add(
                Property(name="ecdat:combinerStrategy", value=props.get("combining_strategy", "kdf"))
            )
            bom.components.add(comb_comp)
            sub_dependencies.append(comb_comp)

    if sub_dependencies:
        bom.register_dependency(kex_comp, sub_dependencies)

    bom.register_dependency(endpoint_comp, dep_comps)
    _attach_provenance_metadata(bom, "network_hybrid_analyzer")
    return bom


def runtime_event_to_cbom(event: Any) -> Bom:
    """
    Transforms a RuntimeCryptoEvent (Phase 6.1) into CycloneDX 1.6 CBOM.
    Preserves:
    - Application / Service container component
    - Process component with PID
    - Cryptographic library component
    - Cryptographic algorithm asset with RUNTIME_CONFIRMED reachability
    - Strictly metadata only (no keys, plaintext, or passwords)
    """
    bom = Bom()
    app_name = getattr(event, "application_name", None) or getattr(event, "process_name", "runtime-app")
    app_ref = f"runtime:app/{app_name}"

    app_comp = Component(
        type=ComponentType.APPLICATION,
        name=app_name,
        bom_ref=app_ref,
    )
    app_comp.properties.add(Property(name="ecdat:scanner", value="runtime_engine"))
    app_comp.properties.add(Property(name="ecdat:file", value=app_name))
    app_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=app_name)])
    if getattr(event, "container_id", None):
        app_comp.properties.add(Property(name="ecdat:containerId", value=event.container_id))
    if getattr(event, "service_name", None):
        app_comp.properties.add(Property(name="ecdat:serviceName", value=event.service_name))
    app_comp.properties.add(Property(name="ecdat:evidenceSource", value="runtime"))
    bom.components.add(app_comp)

    # Process Component
    proc_name = getattr(event, "process_name", "process")
    proc_pid = getattr(event, "process_id", 0)
    proc_ref = f"runtime:process/{proc_pid}@{proc_name}"
    proc_comp = Component(
        type=ComponentType.APPLICATION,
        name=f"{proc_name} (PID {proc_pid})",
        bom_ref=proc_ref,
    )
    proc_comp.properties.add(Property(name="ecdat:scanner", value="runtime_engine"))
    proc_comp.properties.add(Property(name="ecdat:file", value=app_name))
    proc_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=f"{proc_name}:{proc_pid}")])
    proc_comp.properties.add(Property(name="ecdat:pid", value=str(proc_pid)))
    proc_comp.properties.add(Property(name="ecdat:processName", value=proc_name))
    bom.components.add(proc_comp)

    # Library Component
    lib_name = getattr(event, "library_name", "CryptoLib")
    lib_ref = f"runtime:lib/{lib_name.lower()}@{proc_ref}"
    lib_comp = Component(
        type=ComponentType.LIBRARY,
        name=lib_name,
        bom_ref=lib_ref,
    )
    lib_comp.properties.add(Property(name="ecdat:scanner", value="runtime_engine"))
    lib_comp.properties.add(Property(name="ecdat:file", value=app_name))
    lib_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=lib_name)])
    lib_comp.properties.add(Property(name="ecdat:cryptoLibrary", value=lib_name))
    lib_comp.properties.add(Property(name="ecdat:functionHooked", value=getattr(event, "function_name", "unknown")))
    lib_comp.properties.add(
        Property(name="ecdat:cryptoOperation", value=getattr(event, "crypto_operation", "operation"))
    )
    bom.components.add(lib_comp)

    # Algorithm Asset
    params = getattr(event, "parameters", {}) or {}
    algo_name = (
        params.get("cipher_name") or params.get("digest_name") or params.get("algorithm") or "RuntimeCryptoAsset"
    )
    key_size = params.get("key_length") or params.get("key_size_bits")
    algo_ref = f"runtime:algo/{algo_name}@{proc_ref}"

    algo_props = AlgorithmProperties(
        parameter_set_identifier=str(key_size) if key_size else None,
        nist_quantum_security_level=0,
    )
    crypto_props = CryptoProperties(
        asset_type=CryptoAssetType.ALGORITHM,
        algorithm_properties=algo_props,
    )
    algo_comp = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name=f"{algo_name}-{key_size}" if key_size else str(algo_name),
        bom_ref=algo_ref,
        crypto_properties=crypto_props,
    )
    algo_comp.properties.add(Property(name="ecdat:scanner", value="runtime_engine"))
    algo_comp.properties.add(Property(name="ecdat:file", value=app_name))
    algo_comp.evidence = ComponentEvidence(occurrences=[Occurrence(location=f"{proc_name}@{lib_name}")])
    algo_comp.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    algo_comp.properties.add(Property(name="ecdat:evidenceSource", value="runtime"))
    for p_k, p_v in params.items():
        algo_comp.properties.add(Property(name=f"ecdat:param:{p_k}", value=str(p_v)))

    bom.components.add(algo_comp)

    # Dependencies: App -> Process -> Library -> Algorithm
    bom.register_dependency(app_comp, [proc_comp])
    bom.register_dependency(proc_comp, [lib_comp])
    bom.register_dependency(lib_comp, [algo_comp])
    _attach_provenance_metadata(bom, "runtime_engine")
    return bom


def merge_cboms(cboms: List[Bom]) -> Bom:
    merged = Bom()
    comp_map = {}

    for bom in cboms:
        for comp in bom.components:
            ref = comp.bom_ref.value
            if ref not in comp_map:
                comp_map[ref] = comp
                merged.components.add(comp)
            else:
                # Merge occurrences
                existing = comp_map[ref]
                if comp.evidence and comp.evidence.occurrences:
                    if not existing.evidence:
                        existing.evidence = ComponentEvidence(occurrences=[])
                    if not existing.evidence.occurrences:
                        existing.evidence.occurrences = []
                    
                    # Add new occurrences, avoiding exact duplicates
                    existing_locs = {(o.location, getattr(o, "line", None)) for o in existing.evidence.occurrences}
                    for new_occ in comp.evidence.occurrences:
                        loc_key = (new_occ.location, getattr(new_occ, "line", None))
                        if loc_key not in existing_locs:
                            if hasattr(existing.evidence.occurrences, "add"):
                                existing.evidence.occurrences.add(new_occ)
                            else:
                                existing.evidence.occurrences.append(new_occ)
                            existing_locs.add(loc_key)

        for dep in bom.dependencies:
            # Note: dependency merging logic assumes dependencies with identical ref are inherently identical sets.
            # A full deep merge of dependency arrays would require cross-referencing by ref.
            merged.dependencies.add(dep)

    return merged


def serialize_cbom(bom: Bom, spec_version: str = "1.6") -> str:
    """
    Serializes a CycloneDX CBOM document.
    Defaults to CycloneDX 1.6 (baseline production contract). Supports CycloneDX 1.7 if requested.
    Ensures strict schema compliance with official CycloneDX specification:
    - Never injects invalid/invented properties.
    - Only injects official algorithmFamily enum values in 1.7.
    - Omits algorithmFamily in 1.6 (where it is forbidden by additionalProperties: false).
    """
    _attach_provenance_metadata(bom)

    if spec_version == "1.6":
        return JsonV1Dot6(bom).output_as_string(indent=2)

    # CycloneDX 1.7 target serialization
    json_str = JsonV1Dot7(bom).output_as_string(indent=2)
    data = json.loads(json_str)

    if "components" not in data:
        data["components"] = []

    # In CycloneDX 1.7, algorithmFamily is a defined enum in cryptography-defs.schema.json
    # We resolve valid families and inject ONLY strictly valid enum values.
    for comp in data.get("components", []):
        c_props = comp.get("cryptoProperties", {})
        if c_props.get("assetType") == "algorithm" and "algorithmProperties" in c_props:
            name = comp.get("name", "")
            props = {p.get("name"): p.get("value") for p in comp.get("properties", []) if isinstance(p, dict)}
            algo_hint = props.get("ecdat:algorithm") or props.get("ecdat:signatureAlgorithm") or name
            resolved_family = resolve_cdx17_algorithm_family(algo_hint, context=name)
            if resolved_family and resolved_family in CYCLONEDX_17_ALGORITHM_FAMILIES:
                c_props["algorithmProperties"]["algorithmFamily"] = resolved_family

    return json.dumps(data, indent=2)


def validate_cbom_json(json_str: str) -> bool:
    """
    Validates a CycloneDX CBOM JSON string against the official specification.
    Supports both CycloneDX 1.7 and 1.6.
    Returns True if valid, False otherwise.
    """
    is_valid, _ = validate_cbom_detailed(json_str)
    return is_valid


def validate_cbom_detailed(json_str: str) -> Tuple[bool, Optional[str]]:
    """
    Validates a CycloneDX CBOM JSON string against the official specification schema.
    Returns (is_valid, error_message).
    """
    try:
        data = json.loads(json_str)
    except Exception as e:
        return False, f"Invalid JSON syntax: {str(e)}"

    if not isinstance(data, dict):
        return False, "Root JSON payload must be an object"

    if data.get("bomFormat") != "CycloneDX":
        return False, f"Invalid bomFormat: expected 'CycloneDX', received '{data.get('bomFormat')}'"

    spec_ver = str(data.get("specVersion", ""))
    if spec_ver not in ("1.6", "1.7"):
        return False, f"Unsupported specVersion: expected '1.6' or '1.7', received '{spec_ver}'"

    if "components" in data and not isinstance(data.get("components"), list):
        return False, "CycloneDX document 'components' field must be an array"

    try:
        sv = SchemaVersion.V1_7 if spec_ver == "1.7" else SchemaVersion.V1_6
        validator = JsonValidator(sv)
        validation_err = validator.validate_str(json_str)
        if validation_err is not None:
            return False, str(validation_err)
        return True, None
    except Exception as e:
        return False, f"Official schema validation error: {str(e)}"
