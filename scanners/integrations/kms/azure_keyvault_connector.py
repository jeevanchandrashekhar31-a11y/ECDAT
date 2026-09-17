"""
Azure Key Vault Connector (Python) — Phase 14.3

Implements metadata collection for Azure Key Vault.
Enforces least-privilege read-only role: Key Vault Crypto Viewer / Key Vault Reader.
"""

from typing import Dict, Any, List, Optional
import re
from .base_kms_connector import BaseKmsConnector
from .kms_metadata import KmsKeyMetadata

AZURE_READ_ONLY_ACTIONS = [
    "Microsoft.KeyVault/vaults/keys/read",
    "Microsoft.KeyVault/vaults/keys/read/action",
]

AZURE_DISALLOWED_ACTIONS = [
    "Microsoft.KeyVault/vaults/keys/encrypt/action",
    "Microsoft.KeyVault/vaults/keys/decrypt/action",
    "Microsoft.KeyVault/vaults/keys/sign/action",
    "Microsoft.KeyVault/vaults/keys/verify/action",
    "Microsoft.KeyVault/vaults/keys/wrap/action",
    "Microsoft.KeyVault/vaults/keys/unwrap/action",
    "Microsoft.KeyVault/vaults/keys/write",
    "Microsoft.KeyVault/vaults/keys/delete",
]


class AzureKeyVaultConnector(BaseKmsConnector):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None, client: Any = None):
        super().__init__(name=name, provider="azure_keyvault", config=config, read_only=True, client=client)

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if "vault_url" not in config:
            self.config["vault_url"] = "https://default.vault.azure.net"

    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        return {
            "role": "Key Vault Crypto Viewer",
            "description": "Read key metadata and properties without performing cryptographic actions.",
            "permissions": [
                {
                    "actions": ["Microsoft.KeyVault/vaults/keys/read"],
                    "dataActions": ["Microsoft.KeyVault/vaults/keys/read/action"],
                    "notDataActions": list(AZURE_DISALLOWED_ACTIONS),
                }
            ],
        }

    def validate_least_privilege(self, actions: Any) -> Dict[str, Any]:
        action_list = actions if isinstance(actions, list) else actions.get("actions", [])
        violations = []

        for act in action_list:
            if act in AZURE_DISALLOWED_ACTIONS:
                violations.append(f"Violation: Azure action '{act}' exceeds read-only least privilege requirement.")

        return {"valid": len(violations) == 0, "violations": violations}

    def list_keys(self) -> List[str]:
        if self.client and hasattr(self.client, "list_properties_of_keys"):
            return [p.name for p in self.client.list_properties_of_keys()]
        return self.config.get("mock_keys", [])

    def describe_key(self, key_name_or_id: str) -> KmsKeyMetadata:
        key_bundle = None
        rotation_policy = None

        if self.client and hasattr(self.client, "get_key"):
            key_bundle = self.client.get_key(key_name_or_id)
            if hasattr(self.client, "get_key_rotation_policy"):
                try:
                    rotation_policy = self.client.get_key_rotation_policy(key_name_or_id)
                except Exception:
                    rotation_policy = None
        elif "mock_key_details" in self.config and key_name_or_id in self.config["mock_key_details"]:
            mock = self.config["mock_key_details"][key_name_or_id]
            key_bundle = mock.get("key_bundle", mock)
            rotation_policy = mock.get("rotation_policy")
        else:
            raise ValueError(f"Azure Key Vault: Key '{key_name_or_id}' not found or client unavailable")

        return self._map_to_kms_metadata(key_bundle, rotation_policy)

    def _map_to_kms_metadata(
        self, key_bundle: Dict[str, Any], rotation_policy: Optional[Dict[str, Any]] = None
    ) -> KmsKeyMetadata:
        key = key_bundle.get("key", key_bundle)
        properties = key_bundle.get("properties", key_bundle)
        kty = str(key.get("kty", "RSA")).upper()
        crv = key.get("crv")
        key_size = key.get("key_size") or (2048 if "RSA" in kty else 256)

        algorithm, size = self._parse_algorithm(kty, crv, key_size)

        tags = properties.get("tags") or {}
        owner = tags.get("owner") or tags.get("Owner") or self.config.get("vault_url")

        attributes = properties.get("attributes") or properties or {}
        state = "Enabled" if attributes.get("enabled", True) else "Disabled"

        period_days = None
        if rotation_policy and "lifetime_actions" in rotation_policy:
            for act in rotation_policy.get("lifetime_actions", []):
                time_str = act.get("time_after_create") or act.get("time_before_expiry")
                if time_str:
                    match = re.search(r"P(\d+)D", time_str)
                    if match:
                        period_days = int(match.group(1))

        rotation = {
            "enabled": bool(rotation_policy or period_days),
            "period_days": period_days,
            "last_rotated_at": attributes.get("created"),
            "next_rotation_at": attributes.get("exp"),
            "version": properties.get("version")
            or (properties.get("id", "").split("/")[-1] if properties.get("id") else "1"),
        }

        key_ops = key.get("key_ops", ["encrypt", "decrypt"])
        usage = {
            "key_usage": "SIGN_VERIFY" if "sign" in key_ops else "ENCRYPT_DECRYPT",
            "operations": list(key_ops),
            "origin": "Azure Dedicated HSM" if "HSM" in kty else "Azure Key Vault",
            "is_exportable": bool(attributes.get("exportable", False)),
        }

        return KmsKeyMetadata(
            key_id=properties.get("id")
            or f"{self.config.get('vault_url')}/keys/{properties.get('name', 'key')}/{rotation['version']}",
            algorithm=algorithm,
            size=size,
            state=state,
            owner=owner,
            rotation=rotation,
            usage=usage,
            provider="azure_keyvault",
            description=f"Azure Key Vault: {properties.get('name', 'managed-key')}",
            raw_metadata={
                "key": {
                    "kid": key.get("kid"),
                    "kty": key.get("kty"),
                    "key_ops": key.get("key_ops"),
                    "key_size": key.get("key_size"),
                    "crv": key.get("crv"),
                },
                "properties": properties,
                "rotation_policy": rotation_policy,
            },
        )

    def _parse_algorithm(self, kty: str, crv: Optional[str], size: int):
        if "RSA" in kty:
            return f"RSA-{size or 2048}", size or 2048
        if "EC" in kty:
            if crv in ["P-256", "SECP256R1"]:
                return "ECDSA-P256", 256
            if crv == "P-384":
                return "ECDSA-P384", 384
            if crv == "P-521":
                return "ECDSA-P521", 521
            if crv == "SECP256K1":
                return "ECDSA-SECP256K1", 256
            return f"ECDSA-{crv or 'P256'}", size or 256
        if kty == "OCT":
            return f"AES-{size or 256}-GCM", size or 256
        return kty, size or 256
