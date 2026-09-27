"""
ECDAT KMS & HSM Integrations Package — Phase 14.3
"""

from .kms_metadata import (
    KmsKeyMetadata,
    ProtectedKeyMaterialError,
    FORBIDDEN_PRIVATE_KEY_FIELDS,
    assert_no_private_key_material,
    sanitize_metadata,
)
from .base_kms_connector import BaseKmsConnector
from .aws_kms_connector import AwsKmsConnector, AWS_READ_ONLY_ACTIONS, AWS_DISALLOWED_ACTIONS
from .gcp_kms_connector import GcpKmsConnector, GCP_READ_ONLY_PERMISSIONS, GCP_DISALLOWED_PERMISSIONS
from .azure_keyvault_connector import (
    AzureKeyVaultConnector,
    AZURE_READ_ONLY_ACTIONS,
    AZURE_DISALLOWED_ACTIONS,
)
from .vault_transit_connector import (
    VaultTransitConnector,
    VAULT_ALLOWED_CAPABILITIES,
    VAULT_DISALLOWED_CAPABILITIES,
)
from .pkcs11_hsm_connector import (
    Pkcs11HsmConnector,
    CKA_ALLOWED_ATTRIBUTES,
    CKA_FORBIDDEN_ATTRIBUTES,
)
from .kms_discovery_service import KmsDiscoveryService, default_kms_discovery_service

__all__ = [
    "KmsKeyMetadata",
    "ProtectedKeyMaterialError",
    "FORBIDDEN_PRIVATE_KEY_FIELDS",
    "assert_no_private_key_material",
    "sanitize_metadata",
    "BaseKmsConnector",
    "AwsKmsConnector",
    "AWS_READ_ONLY_ACTIONS",
    "AWS_DISALLOWED_ACTIONS",
    "GcpKmsConnector",
    "GCP_READ_ONLY_PERMISSIONS",
    "GCP_DISALLOWED_PERMISSIONS",
    "AzureKeyVaultConnector",
    "AZURE_READ_ONLY_ACTIONS",
    "AZURE_DISALLOWED_ACTIONS",
    "VaultTransitConnector",
    "VAULT_ALLOWED_CAPABILITIES",
    "VAULT_DISALLOWED_CAPABILITIES",
    "Pkcs11HsmConnector",
    "CKA_ALLOWED_ATTRIBUTES",
    "CKA_FORBIDDEN_ATTRIBUTES",
    "KmsDiscoveryService",
    "default_kms_discovery_service",
]
