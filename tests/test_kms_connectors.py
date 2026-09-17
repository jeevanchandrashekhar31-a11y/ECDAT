"""
Tests for Cloud KMS, Vault, and HSM Metadata Connectors — Phase 14.3
"""

import pytest
from scanners.integrations.kms import (
    KmsKeyMetadata,
    ProtectedKeyMaterialError,
    FORBIDDEN_PRIVATE_KEY_FIELDS,
    assert_no_private_key_material,
    sanitize_metadata,
    BaseKmsConnector,
    AwsKmsConnector,
    GcpKmsConnector,
    AzureKeyVaultConnector,
    VaultTransitConnector,
    Pkcs11HsmConnector,
    KmsDiscoveryService,
)


class TestKmsKeyMetadataAndSecurityInvariants:
    """Test the 7 required metadata dimensions and strict private key prohibition."""

    def test_enforces_seven_required_dimensions(self):
        meta = KmsKeyMetadata(
            key_id="arn:aws:kms:us-east-1:123456789012:key/test-key-uuid",
            algorithm="AES-256-GCM",
            size=256,
            state="Enabled",
            owner="123456789012",
            rotation={"enabled": True, "period_days": 365, "version": "1"},
            usage={
                "key_usage": "ENCRYPT_DECRYPT",
                "operations": ["encrypt", "decrypt"],
                "origin": "AWS_KMS",
                "is_exportable": False,
            },
            provider="aws_kms",
            description="Production Database Encryption Key",
        )

        # 1. key identifier
        assert meta.key_id == "arn:aws:kms:us-east-1:123456789012:key/test-key-uuid"
        # 2. algorithm
        assert meta.algorithm == "AES-256-GCM"
        # 3. size/parameters
        assert meta.size == 256
        # 4. state
        assert meta.state == "Enabled"
        # 5. rotation metadata
        assert meta.rotation["enabled"] is True
        assert meta.rotation["period_days"] == 365
        assert meta.rotation["version"] == "1"
        # 6. owner
        assert meta.owner == "123456789012"
        # 7. usage metadata
        assert meta.usage["key_usage"] == "ENCRYPT_DECRYPT"
        assert "encrypt" in meta.usage["operations"]
        assert meta.usage["origin"] == "AWS_KMS"
        assert meta.usage["is_exportable"] is False

    def test_rejects_missing_required_dimensions(self):
        with pytest.raises(ValueError, match="key_id"):
            KmsKeyMetadata(key_id="", algorithm="AES", size=256, state="Enabled", owner="user")

        with pytest.raises(ValueError, match="algorithm"):
            KmsKeyMetadata(key_id="k1", algorithm="", size=256, state="Enabled", owner="user")

        with pytest.raises(ValueError, match="size"):
            KmsKeyMetadata(key_id="k1", algorithm="AES", size=None, state="Enabled", owner="user")

        with pytest.raises(ValueError, match="state"):
            KmsKeyMetadata(key_id="k1", algorithm="AES", size=256, state="", owner="user")

        with pytest.raises(ValueError, match="owner"):
            KmsKeyMetadata(key_id="k1", algorithm="AES", size=256, state="Enabled", owner="")

    @pytest.mark.parametrize(
        "forbidden_field",
        [
            "privateKey",
            "private_key",
            "d",
            "p",
            "q",
            "raw_key",
            "secret_bytes",
            "seed",
            "key_material",
            "master_key",
        ],
    )
    def test_critical_invariant_never_extract_private_key_material(self, forbidden_field):
        """Security invariant: attempting to include protected private key material raises ProtectedKeyMaterialError."""
        bad_raw_metadata = {
            "keyId": "key-123",
            forbidden_field: "MIIEowIBAAKCAQEA0Yp...",
        }

        with pytest.raises(ProtectedKeyMaterialError, match="CRITICAL SECURITY VIOLATION"):
            KmsKeyMetadata(
                key_id="key-123",
                algorithm="RSA-2048",
                size=2048,
                state="Enabled",
                owner="sec-ops",
                raw_metadata=bad_raw_metadata,
            )

    def test_nested_private_key_detection(self):
        nested = {
            "metadata": {
                "crypto": {
                    "private_key_bytes": "deadbeef",
                }
            }
        }
        with pytest.raises(ProtectedKeyMaterialError, match="CRITICAL SECURITY VIOLATION"):
            assert_no_private_key_material(nested)

    def test_sanitization_redacts_forbidden_fields(self):
        dirty = {
            "key_name": "app-key",
            "privateKey": "secret",
            "public_key": "safe_cert_or_key",
        }
        clean = sanitize_metadata(dirty)
        assert clean["key_name"] == "app-key"
        assert clean["public_key"] == "safe_cert_or_key"
        assert clean["privateKey"] == "[REDACTED_PROTECTED_MATERIAL]"

    def test_to_cbom_component(self):
        meta = KmsKeyMetadata(
            key_id="projects/p1/locations/global/keyRings/r1/cryptoKeys/k1",
            algorithm="RSA-3072",
            size=3072,
            state="ENABLED",
            owner="project-p1",
            rotation={"enabled": True, "period_days": 90, "version": "2"},
            usage={
                "key_usage": "ASYMMETRIC_SIGN",
                "operations": ["sign", "verify"],
                "origin": "GCP_KMS",
                "is_exportable": False,
            },
            provider="gcp_kms",
        )

        cbom = meta.to_cbom_component()
        assert cbom["type"] == "cryptographic-asset"
        assert cbom["bom-ref"] == "cbom:gcp_kms:projects/p1/locations/global/keyRings/r1/cryptoKeys/k1"
        assert cbom["cryptoProperties"]["algorithm"] == "RSA-3072"
        assert cbom["cryptoProperties"]["keyLength"] == 3072
        assert cbom["cryptoProperties"]["rotationEnabled"] is True
        assert cbom["cryptoProperties"]["rotationPeriodDays"] == 90
        assert cbom["cryptoProperties"]["isExportable"] is False


class TestKmsConnectorsLeastPrivilegeAndDiscovery:
    """Test least privilege enforcement and connector abstractions."""

    def test_least_privilege_enforced_by_default(self):
        class DummyConnector(BaseKmsConnector):
            def get_least_privilege_role_definition(self):
                return {}

            def list_keys(self):
                return []

            def describe_key(self, kid):
                pass

        conn = DummyConnector(name="test", provider="aws_kms")
        assert conn.read_only is True

        # Attempting read_only=False must be rejected
        with pytest.raises(PermissionError, match="Security Policy Violation"):
            DummyConnector(name="test-rw", provider="aws_kms", read_only=False)

    def test_aws_kms_connector(self):
        mock_details = {
            "arn:aws:kms:us-east-1:1111:key/uuid-1": {
                "KeyMetadata": {
                    "Arn": "arn:aws:kms:us-east-1:1111:key/uuid-1",
                    "KeyId": "uuid-1",
                    "KeySpec": "SYMMETRIC_DEFAULT",
                    "KeyState": "Enabled",
                    "KeyUsage": "ENCRYPT_DECRYPT",
                    "AWSAccountId": "1111",
                    "Origin": "AWS_KMS",
                    "Description": "Main S3 CMK",
                },
                "RotationStatus": {
                    "KeyRotationEnabled": True,
                },
                "Tags": [{"TagKey": "Owner", "TagValue": "cloud-infra"}],
            }
        }

        conn = AwsKmsConnector(
            name="aws-prod",
            config={
                "region": "us-east-1",
                "mock_keys": ["arn:aws:kms:us-east-1:1111:key/uuid-1"],
                "mock_key_details": mock_details,
            },
        )

        role = conn.get_least_privilege_role_definition()
        assert "kms:DescribeKey" in role["statement"][0]["Action"]
        assert "kms:Decrypt" in role["statement"][1]["Action"]

        # Validate that dangerous permissions are flagged
        val = conn.validate_least_privilege(["kms:DescribeKey", "kms:Decrypt"])
        assert val["valid"] is False
        assert any("kms:Decrypt" in v for v in val["violations"])

        # Discover
        keys = conn.discover_all()
        assert len(keys) == 1
        key = keys[0]
        assert key.algorithm == "AES-256-GCM"
        assert key.size == 256
        assert key.owner == "cloud-infra"
        assert key.rotation["enabled"] is True
        assert key.rotation["period_days"] == 365
        assert key.usage["is_exportable"] is False

    def test_gcp_kms_connector(self):
        mock_details = {
            "projects/gcp-proj/locations/us-central1/keyRings/ring1/cryptoKeys/key1": {
                "name": "projects/gcp-proj/locations/us-central1/keyRings/ring1/cryptoKeys/key1",
                "purpose": "ENCRYPT_DECRYPT",
                "rotationPeriod": "7776000s",  # 90 days
                "primary": {
                    "name": "projects/gcp-proj/locations/us-central1/keyRings/ring1/cryptoKeys/key1/cryptoKeyVersions/1",
                    "algorithm": "GOOGLE_SYMMETRIC_ENCRYPTION",
                    "state": "ENABLED",
                    "protectionLevel": "HSM",
                },
                "labels": {"owner": "data-team"},
            }
        }

        conn = GcpKmsConnector(
            name="gcp-prod",
            config={
                "project_id": "gcp-proj",
                "mock_keys": ["projects/gcp-proj/locations/us-central1/keyRings/ring1/cryptoKeys/key1"],
                "mock_key_details": mock_details,
            },
        )

        role = conn.get_least_privilege_role_definition()
        assert role["role"] == "roles/cloudkms.viewer"

        keys = conn.discover_all()
        assert len(keys) == 1
        key = keys[0]
        assert key.algorithm == "AES-256-GCM"
        assert key.rotation["period_days"] == 90
        assert key.owner == "data-team"
        assert key.usage["origin"] == "HSM"

    def test_azure_keyvault_connector(self):
        mock_details = {
            "app-tls-cert-key": {
                "key": {
                    "kid": "https://vault.vault.azure.net/keys/app-tls-cert-key/version123",
                    "kty": "RSA",
                    "key_size": 4096,
                    "key_ops": ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
                },
                "properties": {
                    "name": "app-tls-cert-key",
                    "id": "https://vault.vault.azure.net/keys/app-tls-cert-key/version123",
                    "attributes": {"enabled": True, "exportable": False},
                    "tags": {"owner": "security-team"},
                },
                "rotation_policy": {
                    "lifetime_actions": [{"time_after_create": "P180D"}],
                },
            }
        }

        conn = AzureKeyVaultConnector(
            name="azure-prod",
            config={
                "vault_url": "https://vault.vault.azure.net",
                "mock_keys": ["app-tls-cert-key"],
                "mock_key_details": mock_details,
            },
        )

        keys = conn.discover_all()
        assert len(keys) == 1
        key = keys[0]
        assert key.algorithm == "RSA-4096"
        assert key.size == 4096
        assert key.rotation["period_days"] == 180
        assert key.owner == "security-team"
        assert key.usage["is_exportable"] is False

    def test_vault_transit_connector(self):
        mock_details = {
            "payment-token-key": {
                "type": "aes256-gcm96",
                "latest_version": 3,
                "auto_rotate_period": 2592000,  # 30 days
                "deletion_allowed": False,
                "supports_encryption": True,
                "exportable": False,
            }
        }

        conn = VaultTransitConnector(
            name="vault-prod",
            config={
                "endpoint": "https://vault.enterprise.internal:8200",
                "mock_keys": ["payment-token-key"],
                "mock_key_details": mock_details,
            },
        )

        keys = conn.discover_all()
        assert len(keys) == 1
        key = keys[0]
        assert key.algorithm == "AES-256-GCM"
        assert key.rotation["period_days"] == 30
        assert key.rotation["version"] == "3"
        assert key.state == "Protected"
        assert key.usage["is_exportable"] is False

    def test_pkcs11_hsm_connector_zero_private_key_material(self):
        mock_details = {
            "slot-0-rsa-root": {
                "CKA_LABEL": "Root-CA-Key",
                "CKA_ID": "01020304",
                "CKA_KEY_TYPE": "CKK_RSA",
                "CKA_MODULUS_BITS": 4096,
                "CKA_EXTRACTABLE": False,
                "CKA_NEVER_EXTRACTABLE": True,
                "CKA_SIGN": True,
                "CKA_VERIFY": True,
                "CKA_TOKEN": True,
            }
        }

        conn = Pkcs11HsmConnector(
            name="thales-luna-hsm",
            config={
                "slot_id": 1,
                "token_label": "Production-Root-Token",
                "mock_keys": ["slot-0-rsa-root"],
                "mock_key_details": mock_details,
            },
        )

        role = conn.get_least_privilege_role_definition()
        assert "CKA_VALUE" in role["forbidden_attributes"]

        # Validate that requesting CKA_VALUE triggers violation
        val = conn.validate_least_privilege(["CKA_LABEL", "CKA_VALUE"])
        assert val["valid"] is False
        assert any("CKA_VALUE" in v for v in val["violations"])

        # Discover
        keys = conn.discover_all()
        assert len(keys) == 1
        key = keys[0]
        assert key.algorithm == "RSA-4096"
        assert key.size == 4096
        assert key.owner == "Production-Root-Token"
        assert "sign" in key.usage["operations"]
        assert key.usage["is_exportable"] is False

        # Attempt to inject CKA_VALUE must raise ProtectedKeyMaterialError
        poisoned_details = {
            "poisoned-key": {
                "CKA_LABEL": "Poisoned",
                "CKA_VALUE": "SECRET_BYTES_UNPROTECTED",
            }
        }
        poison_conn = Pkcs11HsmConnector(
            name="poison",
            config={"mock_keys": ["poisoned-key"], "mock_key_details": poisoned_details},
        )
        with pytest.raises(ProtectedKeyMaterialError, match="CRITICAL SECURITY VIOLATION"):
            poison_conn.describe_key("poisoned-key")

    def test_kms_discovery_service_and_cbom(self):
        service = KmsDiscoveryService()

        # Register AWS connector
        service.register_connector(
            AwsKmsConnector(
                name="aws-account-1",
                config={
                    "mock_keys": ["k1"],
                    "mock_key_details": {
                        "k1": {
                            "KeyMetadata": {
                                "Arn": "arn:aws:kms:us-east-1:1234:key/k1",
                                "KeySpec": "RSA_2048",
                                "KeyState": "Enabled",
                                "AWSAccountId": "1234",
                            },
                            "RotationStatus": {"KeyRotationEnabled": False},
                        }
                    },
                },
            )
        )

        # Register Vault connector
        service.register_connector(
            VaultTransitConnector(
                name="vault-1",
                config={
                    "mock_keys": ["k2"],
                    "mock_key_details": {
                        "k2": {
                            "type": "aes256-gcm96",
                            "auto_rotate_period": 2592000,
                        }
                    },
                },
            )
        )

        res = service.discover_all()
        assert res["total_count"] == 2
        assert len(res["errors"]) == 0

        # Summary check
        summary = service.get_summary(res["keys"])
        assert summary["total_keys"] == 2
        assert summary["by_provider"]["aws_kms"] == 1
        assert summary["by_provider"]["hashicorp_vault"] == 1
        assert summary["metrics"]["unrotated_count"] == 1  # k1 is not rotated

        # CBOM generation check
        cbom = service.to_cbom(res["keys"])
        assert cbom["bomFormat"] == "CycloneDX"
        assert cbom["specVersion"] == "1.6"
        assert len(cbom["components"]) == 2
        assert cbom["components"][0]["type"] == "cryptographic-asset"
        assert cbom["components"][0]["cryptoProperties"]["algorithm"] in ["RSA-2048", "AES-256-GCM"]
