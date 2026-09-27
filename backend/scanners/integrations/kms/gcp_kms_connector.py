"""
GCP Cloud KMS Connector (Python) — Phase 14.3

Implements metadata collection for Google Cloud KMS.
Enforces least-privilege read-only role: roles/cloudkms.viewer
"""

from typing import Dict, Any, List, Optional
from .base_kms_connector import BaseKmsConnector
from .kms_metadata import KmsKeyMetadata

GCP_READ_ONLY_PERMISSIONS = [
    "cloudkms.cryptoKeys.list",
    "cloudkms.cryptoKeys.get",
    "cloudkms.cryptoKeyVersions.list",
    "cloudkms.cryptoKeyVersions.get",
    "cloudkms.keyRings.list",
    "cloudkms.keyRings.get",
]

GCP_DISALLOWED_PERMISSIONS = [
    "cloudkms.cryptoKeyVersions.useToEncrypt",
    "cloudkms.cryptoKeyVersions.useToDecrypt",
    "cloudkms.cryptoKeyVersions.useToSign",
    "cloudkms.cryptoKeyVersions.useToVerifyMac",
    "cloudkms.cryptoKeys.create",
    "cloudkms.cryptoKeys.update",
    "cloudkms.cryptoKeyVersions.destroy",
    "cloudkms.cryptoKeyVersions.restore",
]


class GcpKmsConnector(BaseKmsConnector):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None, client: Any = None):
        super().__init__(name=name, provider="gcp_kms", config=config, read_only=True, client=client)

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if "project_id" not in config:
            self.config["project_id"] = "gcp-project-default"

    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        return {
            "role": "roles/cloudkms.viewer",
            "title": "Cloud KMS Viewer",
            "description": "Read-only access to Cloud KMS metadata without encryption/decryption privileges.",
            "included_permissions": list(GCP_READ_ONLY_PERMISSIONS),
            "denied_permissions": list(GCP_DISALLOWED_PERMISSIONS),
        }

    def validate_least_privilege(self, permissions: Any) -> Dict[str, Any]:
        perm_list = permissions if isinstance(permissions, list) else permissions.get("permissions", [])
        violations = []

        for p in perm_list:
            if p in GCP_DISALLOWED_PERMISSIONS:
                violations.append(f"Violation: GCP permission '{p}' exceeds read-only least privilege requirement.")

        return {"valid": len(violations) == 0, "violations": violations}

    def list_keys(self) -> List[str]:
        if self.client and hasattr(self.client, "list_crypto_keys"):
            parent = f"projects/{self.config.get('project_id')}/locations/{self.config.get('location_id', 'global')}/keyRings/{self.config.get('key_ring_id', 'default')}"
            response = self.client.list_crypto_keys(parent=parent)
            return [k.name for k in response]
        return self.config.get("mock_keys", [])

    def describe_key(self, key_name: str) -> KmsKeyMetadata:
        crypto_key = None
        if self.client and hasattr(self.client, "get_crypto_key"):
            crypto_key = self.client.get_crypto_key(name=key_name)
        elif "mock_key_details" in self.config and key_name in self.config["mock_key_details"]:
            crypto_key = self.config["mock_key_details"][key_name]
        else:
            raise ValueError(f"GCP KMS: Key '{key_name}' not found or client unavailable")

        return self._map_to_kms_metadata(crypto_key)

    def _map_to_kms_metadata(self, crypto_key: Dict[str, Any]) -> KmsKeyMetadata:
        primary = crypto_key.get("primary", {})
        raw_algo = primary.get("algorithm") or crypto_key.get("purpose", "GOOGLE_SYMMETRIC_ENCRYPTION")
        algorithm, size = self._parse_algorithm_and_size(raw_algo)

        labels = crypto_key.get("labels", {})
        owner = labels.get("owner") or self.config.get("project_id", "GCP_PROJECT")

        period_days = None
        if "rotation_period" in crypto_key or "rotationPeriod" in crypto_key:
            raw_period = crypto_key.get("rotation_period") or crypto_key.get("rotationPeriod")
            try:
                seconds = int(str(raw_period).replace("s", ""))
                period_days = round(seconds / 86400)
            except Exception:
                period_days = None

        rotation = {
            "enabled": period_days is not None,
            "period_days": period_days,
            "last_rotated_at": None,
            "next_rotation_at": crypto_key.get("next_rotation_time") or crypto_key.get("nextRotationTime"),
            "version": primary.get("name", "1").split("/")[-1] if primary.get("name") else "1",
        }

        purpose = crypto_key.get("purpose", "ENCRYPT_DECRYPT")
        ops = ["sign", "verify"] if "SIGN" in str(purpose).upper() else ["encrypt", "decrypt"]

        usage = {
            "key_usage": purpose,
            "operations": ops,
            "origin": primary.get("protection_level") or primary.get("protectionLevel") or "GCP_KMS",
            "is_exportable": False,
        }

        return KmsKeyMetadata(
            key_id=crypto_key.get("name", "cryptoKey"),
            algorithm=algorithm,
            size=size,
            state=primary.get("state", "ENABLED"),
            owner=owner,
            rotation=rotation,
            usage=usage,
            provider="gcp_kms",
            description=f"GCP KMS Key: {crypto_key.get('name', '').split('/')[-1]}",
            raw_metadata=crypto_key,
        )

    def _parse_algorithm_and_size(self, raw: str):
        s = str(raw).upper()
        if "GOOGLE_SYMMETRIC" in s or "AES_256" in s:
            return "AES-256-GCM", 256
        if "AES_128" in s:
            return "AES-128-GCM", 128
        if "RSA_SIGN_PSS_2048" in s or "RSA_DECRYPT_OAEP_2048" in s:
            return "RSA-2048", 2048
        if "RSA_SIGN_PSS_3072" in s or "RSA_DECRYPT_OAEP_3072" in s:
            return "RSA-3072", 3072
        if "RSA_SIGN_PSS_4096" in s or "RSA_DECRYPT_OAEP_4096" in s:
            return "RSA-4096", 4096
        if "EC_SIGN_P256" in s:
            return "ECDSA-P256", 256
        if "EC_SIGN_P384" in s:
            return "ECDSA-P384", 384
        if "HMAC_SHA256" in s:
            return "HMAC-SHA256", 256
        return s, 256
