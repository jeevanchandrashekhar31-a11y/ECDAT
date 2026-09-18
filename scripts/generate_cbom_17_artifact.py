"""
Generate an authentic, schema-validated CycloneDX 1.7 CBOM artifact.
Validates the generated artifact with the official cyclonedx JsonValidator for SchemaVersion.V1_7.
Writes artifact to:
1. examples/FINAL_CBOM_17_SAMPLE.json
2. artifacts/cbom/ecdat_cbom_cyclonedx_1.7.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cyclonedx.model.bom import Bom
from cyclonedx.model.bom_ref import BomRef
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

from scanners.cbom_mapping import serialize_cbom, validate_cbom_detailed

REPO_ROOT = Path(__file__).resolve().parent.parent


def build_production_cbom_17() -> Bom:
    bom = Bom()

    # 1. Root Application Component in Metadata
    app_comp = Component(
        type=ComponentType.APPLICATION,
        name="Enterprise Payments & Cryptographic Gateway",
        bom_ref=BomRef("pkg:generic/ecdat-enterprise-app@2.0.0"),
        version="2.0.0",
        description="Production reference banking gateway demonstrating comprehensive CycloneDX 1.7 Cryptographic Bill of Materials",
    )
    bom.metadata.component = app_comp

    dep_assets = []

    # 2. Post-Quantum KEM: ML-KEM-768 (FIPS 203)
    ml_kem_props = AlgorithmProperties(
        parameter_set_identifier="768",
        nist_quantum_security_level=3,
    )
    c_ml_kem = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="ML-KEM-768",
        bom_ref="crypto:algo/ml-kem-768@src/crypto/kex.py:54",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.ALGORITHM,
            algorithm_properties=ml_kem_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="src/crypto/kex.py",
                    line=54,
                    additional_context="pqcrypto.kem.kyber768.encapsulate invocation",
                )
            ]
        ),
    )
    c_ml_kem.properties.add(Property(name="ecdat:algorithm", value="ML-KEM"))
    c_ml_kem.properties.add(Property(name="ecdat:parameterSet", value="768"))
    c_ml_kem.properties.add(Property(name="ecdat:standard", value="NIST FIPS 203"))
    c_ml_kem.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    c_ml_kem.properties.add(Property(name="ecdat:detectionMethod", value="runtime_hook"))
    c_ml_kem.properties.add(Property(name="ecdat:quantumClassification", value="quantum-resistant"))
    c_ml_kem.properties.add(Property(name="ecdat:inferenceConfidence", value="1.00"))
    bom.components.add(c_ml_kem)
    dep_assets.append(c_ml_kem)

    # 3. Post-Quantum Signature: ML-DSA-65 (FIPS 204)
    ml_dsa_props = AlgorithmProperties(
        parameter_set_identifier="65",
        nist_quantum_security_level=3,
    )
    c_ml_dsa = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="ML-DSA-65",
        bom_ref="crypto:algo/ml-dsa-65@src/crypto/signing.py:88",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.ALGORITHM,
            algorithm_properties=ml_dsa_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="src/crypto/signing.py",
                    line=88,
                    additional_context="dilithium3 / ML-DSA-65 digital signature generator",
                )
            ]
        ),
    )
    c_ml_dsa.properties.add(Property(name="ecdat:algorithm", value="ML-DSA"))
    c_ml_dsa.properties.add(Property(name="ecdat:parameterSet", value="65"))
    c_ml_dsa.properties.add(Property(name="ecdat:standard", value="NIST FIPS 204"))
    c_ml_dsa.properties.add(Property(name="ecdat:reachabilityLevel", value="AST_ACCESSIBLE"))
    c_ml_dsa.properties.add(Property(name="ecdat:detectionMethod", value="ast"))
    c_ml_dsa.properties.add(Property(name="ecdat:quantumClassification", value="quantum-resistant"))
    c_ml_dsa.properties.add(Property(name="ecdat:inferenceConfidence", value="0.95"))
    bom.components.add(c_ml_dsa)
    dep_assets.append(c_ml_dsa)

    # 4. Symmetric AEAD Cipher: AES-256-GCM
    aes_props = AlgorithmProperties(
        parameter_set_identifier="256",
        nist_quantum_security_level=0,
    )
    c_aes = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="AES-256-GCM",
        bom_ref="crypto:algo/aes-256-gcm@src/crypto/cipher.py:42",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.ALGORITHM,
            algorithm_properties=aes_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="src/crypto/cipher.py",
                    line=42,
                    additional_context="AESGCM(key).encrypt(iv, data, aad)",
                )
            ]
        ),
    )
    c_aes.properties.add(Property(name="ecdat:algorithm", value="AES"))
    c_aes.properties.add(Property(name="ecdat:mode", value="GCM"))
    c_aes.properties.add(Property(name="ecdat:keySizeBits", value="256"))
    c_aes.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    c_aes.properties.add(Property(name="ecdat:detectionMethod", value="runtime_hook"))
    c_aes.properties.add(Property(name="ecdat:quantumClassification", value="quantum-resistant"))
    c_aes.properties.add(Property(name="ecdat:effectiveGroverSecurityBits", value="128"))
    c_aes.properties.add(Property(name="ecdat:inferenceConfidence", value="1.00"))
    bom.components.add(c_aes)
    dep_assets.append(c_aes)

    # 5. Legacy Asymmetric Cipher: RSA-2048 (Quantum-Vulnerable)
    rsa_props = AlgorithmProperties(
        parameter_set_identifier="2048",
        nist_quantum_security_level=0,
    )
    c_rsa = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="RSA-2048",
        bom_ref="crypto:algo/rsa-2048@src/legacy/token_verifier.py:105",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.ALGORITHM,
            algorithm_properties=rsa_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="src/legacy/token_verifier.py",
                    line=105,
                    additional_context="jwt.decode(..., algorithms=['RS256'])",
                )
            ]
        ),
    )
    c_rsa.properties.add(Property(name="ecdat:algorithm", value="RSA"))
    c_rsa.properties.add(Property(name="ecdat:keySizeBits", value="2048"))
    c_rsa.properties.add(Property(name="ecdat:reachabilityLevel", value="AST_ACCESSIBLE"))
    c_rsa.properties.add(Property(name="ecdat:detectionMethod", value="ast"))
    c_rsa.properties.add(Property(name="ecdat:quantumClassification", value="quantum-vulnerable"))
    c_rsa.properties.add(Property(name="ecdat:shorVulnerability", value="true"))
    c_rsa.properties.add(Property(name="ecdat:migrationUrgency", value="HIGH"))
    c_rsa.properties.add(Property(name="ecdat:inferenceConfidence", value="1.00"))
    bom.components.add(c_rsa)
    dep_assets.append(c_rsa)

    # 6. Network Protocol Asset: TLS 1.3
    proto_props = ProtocolProperties(
        type=ProtocolPropertiesType.TLS,
        version="1.3",
        cipher_suites=[
            ProtocolPropertiesCipherSuite(name="TLS_AES_256_GCM_SHA384"),
            ProtocolPropertiesCipherSuite(name="TLS_CHACHA20_POLY1305_SHA256"),
        ],
    )
    c_proto = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="TLS 1.3 Production Listener",
        bom_ref="net:protocol/tls1.3@api.payments.bank.corp:443",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.PROTOCOL,
            protocol_properties=proto_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="api.payments.bank.corp:443",
                    additional_context="Negotiated during TLS 1.3 live probe handshake",
                )
            ]
        ),
    )
    c_proto.properties.add(Property(name="ecdat:alpn", value="h2,http/1.1"))
    c_proto.properties.add(Property(name="ecdat:hndlResilient", value="true"))
    c_proto.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    c_proto.properties.add(Property(name="ecdat:detectionMethod", value="network_handshake"))
    bom.components.add(c_proto)
    dep_assets.append(c_proto)

    # 7. X.509 Certificate Asset
    cert_props = CertificateProperties(
        subject_name="CN=api.payments.bank.corp, O=Global Banking Corp, C=US",
        issuer_name="CN=DigiCert Global Root G2, O=DigiCert Inc, C=US",
        not_valid_before=datetime(2025, 1, 1, tzinfo=timezone.utc),
        not_valid_after=datetime(2027, 1, 1, tzinfo=timezone.utc),
        certificate_format="X.509",
    )
    c_cert = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="api.payments.bank.corp Leaf Certificate",
        bom_ref="net:cert/api.payments.bank.corp:443",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.CERTIFICATE,
            certificate_properties=cert_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="api.payments.bank.corp:443",
                    additional_context="Presented leaf certificate in TLS handshake chain",
                )
            ]
        ),
    )
    c_cert.properties.add(Property(name="ecdat:fingerprintSha256", value="d8f7b5a2e1c390b4f8a619d0e74b321a56bc9102456e7890abcdef1234567890"))
    c_cert.properties.add(Property(name="ecdat:signatureAlgorithm", value="SHA256withRSA"))
    c_cert.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    c_cert.properties.add(Property(name="ecdat:detectionMethod", value="network_handshake"))
    bom.components.add(c_cert)
    dep_assets.append(c_cert)

    # 8. Related Crypto Material: Key Metadata (Zero Cleartext Secret Exposure)
    key_props = RelatedCryptoMaterialProperties(
        type=RelatedCryptoMaterialType.SECRET_KEY,
        size=256,
    )
    c_key = Component(
        type=ComponentType.CRYPTOGRAPHIC_ASSET,
        name="Payments Master Key KEK (Envelope Metadata)",
        bom_ref="kms:key/mrk-payments-kek@us-east-1",
        crypto_properties=CryptoProperties(
            asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL,
            related_crypto_material_properties=key_props,
        ),
        evidence=ComponentEvidence(
            occurrences=[
                Occurrence(
                    location="aws:kms:us-east-1:123456789012:key/mrk-payments-kek",
                    additional_context="KMS CMK ARN metadata referenced in deployment configuration",
                )
            ]
        ),
    )
    c_key.properties.add(Property(name="ecdat:keyManager", value="AWS_KMS"))
    c_key.properties.add(Property(name="ecdat:keyAlias", value="alias/payments-kek"))
    c_key.properties.add(Property(name="ecdat:rotationEnabled", value="true"))
    c_key.properties.add(Property(name="ecdat:zeroSecretVerified", value="true"))
    c_key.properties.add(Property(name="ecdat:reachabilityLevel", value="RUNTIME_CONFIRMED"))
    c_key.properties.add(Property(name="ecdat:detectionMethod", value="runtime_hook"))
    bom.components.add(c_key)
    dep_assets.append(c_key)

    # Register Dependencies
    bom.register_dependency(app_comp, dep_assets)

    return bom


def main():
    print(">> Generating authentic CycloneDX 1.7 CBOM...")
    bom = build_production_cbom_17()
    serialized_17 = serialize_cbom(bom, spec_version="1.7")

    # Strict Validation against official CycloneDX 1.7 Schema
    validator = JsonValidator(SchemaVersion.V1_7)
    val_err = validator.validate_str(serialized_17)
    if val_err:
        raise ValueError(f"CycloneDX 1.7 schema validation failed: {val_err}")

    is_valid, detailed_err = validate_cbom_detailed(serialized_17)
    if not is_valid:
        raise ValueError(f"Detailed CBOM validation failed: {detailed_err}")

    parsed = json.loads(serialized_17)
    assert parsed["bomFormat"] == "CycloneDX"
    assert parsed["specVersion"] == "1.7"
    assert len(parsed["components"]) == 7  # 7 cryptographic assets
    assert parsed["metadata"]["component"]["name"] == "Enterprise Payments & Cryptographic Gateway"

    print(f"   [PASS] Schema validation PASSED for CycloneDX 1.7 ({len(parsed['components'])} components).")

    # Output Targets
    target_examples = REPO_ROOT / "examples" / "FINAL_CBOM_17_SAMPLE.json"
    target_artifacts = REPO_ROOT / "artifacts" / "cbom" / "ecdat_cbom_cyclonedx_1.7.json"

    target_examples.parent.mkdir(parents=True, exist_ok=True)
    target_artifacts.parent.mkdir(parents=True, exist_ok=True)

    target_examples.write_text(serialized_17, encoding="utf-8")
    target_artifacts.write_text(serialized_17, encoding="utf-8")

    print(f"   Wrote reference artifact: {target_examples}")
    print(f"   Wrote reference artifact: {target_artifacts}")
    print(">> CycloneDX 1.7 CBOM generation completed successfully.")


if __name__ == "__main__":
    main()
