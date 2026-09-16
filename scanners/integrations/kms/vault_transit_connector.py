"""
HashiCorp Vault Transit Engine Connector (Python) — Phase 14.3

Implements metadata collection for HashiCorp Vault Transit Secrets Engine.
Enforces read-only capabilities: ["read", "list"]
"""

from typing import Dict, Any, List, Optional
from .base_kms_connector import BaseKmsConnector
from .kms_metadata import KmsKeyMetadata

VAULT_ALLOWED_CAPABILITIES = ["read", "list"]
VAULT_DISALLOWED_CAPABILITIES = ["create", "update", "delete", "sudo"]


class VaultTransitConnector(BaseKmsConnector):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None, client: Any = None):
        super().__init__(name=name, provider="hashicorp_vault", config=config, read_only=True, client=client)

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if "endpoint" not in config:
            self.config["endpoint"] = "http://127.0.0.1:8200"
        if "mount_path" not in config:
            self.config["mount_path"] = "transit"

    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        mount = self.config.get("mount_path", "transit")
        return {
            "name": "ecdat-vault-transit-reader",
            "policy_hcl": f'path "{mount}/keys" {{\n  capabilities = ["list"]\n}}\npath "{mount}/keys/*" {{\n  capabilities = ["read"]\n}}\n',
            "allowed_capabilities": list(VAULT_ALLOWED_CAPABILITIES),
            "denied_capabilities": list(VAULT_DISALLOWED_CAPABILITIES),
            "description": "Least-privilege HashiCorp Vault policy granting read-only key metadata access.",
        }

    def validate_least_privilege(self, capabilities: Any) -> Dict[str, Any]:
        caps = capabilities if isinstance(capabilities, list) else capabilities.get("capabilities", [])
        violations = []

        for c in caps:
            if str(c).lower() in VAULT_DISALLOWED_CAPABILITIES:
                violations.append(f"Violation: Vault capability '{c}' exceeds read-only least privilege requirement.")

        return {"valid": len(violations) == 0, "violations": violations}

    def list_keys(self) -> List[str]:
        if "mock_keys" in self.config:
            return self.config["mock_keys"]
        if self.client and hasattr(self.client, "secrets") and hasattr(self.client.secrets, "transit"):
            res = self.client.secrets.transit.list_keys(mount_point=self.config.get("mount_path", "transit"))
            return res.get("data", {}).get("keys", [])
        return []

    def describe_key(self, key_name: str) -> KmsKeyMetadata:
        if "mock_key_details" in self.config and key_name in self.config["mock_key_details"]:
            return self._map_to_kms_metadata(key_name, self.config["mock_key_details"][key_name])

        if self.client and hasattr(self.client, "secrets") and hasattr(self.client.secrets, "transit"):
            res = self.client.secrets.transit.read_key(name=key_name, mount_point=self.config.get("mount_path", "transit"))
            return self._map_to_kms_metadata(key_name, res.get("data", res))

        raise ValueError(f"Vault describe_key('{key_name}') failed: client unavailable")

    def _map_to_kms_metadata(self, key_name: str, vault_data: Dict[str, Any]) -> KmsKeyMetadata:
        raw_type = str(vault_data.get("type", "aes256-gcm96")).lower()
        algorithm, size = self._parse_vault_algorithm(raw_type)

        mount = self.config.get("mount_path", "transit")
        key_id = f"{mount}/keys/{key_name}"

        period_days = None
        auto_rotate = vault_data.get("auto_rotate_period")
        if auto_rotate:
            try:
                sec = int(auto_rotate)
                if sec > 0:
                    period_days = round(sec / 86400)
            except Exception:
                period_days = None

        rotation = {
            "enabled": bool(period_days and period_days > 0),
            "period_days": period_days,
            "last_rotated_at": None,
            "next_rotation_at": None,
            "version": str(vault_data.get("latest_version", 1)),
        }

        state = "Active" if vault_data.get("deletion_allowed", False) else "Protected"
        owner = self.config.get("namespace") or self.config.get("endpoint", "vault")

        supports_encryption = vault_data.get("supports_encryption", True)
        supports_signing = vault_data.get("supports_signing", False)

        ops = []
        if supports_encryption:
            ops.extend(["encrypt", "decrypt"])
        if supports_signing:
            ops.extend(["sign", "verify"])
        if vault_data.get("supports_derivation"):
            ops.append("derive_key")

        usage = {
            "key_usage": "SIGN_VERIFY" if supports_signing else "ENCRYPT_DECRYPT",
            "operations": ops or ["encrypt", "decrypt"],
            "origin": "HashiCorp Vault Transit",
            "is_exportable": bool(vault_data.get("exportable", False)),
        }

        return KmsKeyMetadata(
            key_id=key_id,
            algorithm=algorithm,
            size=size,
            state=state,
            owner=owner,
            rotation=rotation,
            usage=usage,
            provider="hashicorp_vault",
            description=f"HashiCorp Vault Transit Key: {key_name}",
            raw_metadata=vault_data,
        )

    def _parse_vault_algorithm(self, key_type: str):
        t = str(key_type).lower()
        if "aes256" in t:
            return "AES-256-GCM", 256
        if "aes128" in t:
            return "AES-128-GCM", 128
        if "chacha20" in t:
            return "CHACHA20-POLY1305", 256
        if "rsa-2048" in t:
            return "RSA-2048", 2048
        if "rsa-3072" in t:
            return "RSA-3072", 3072
        if "rsa-4096" in t:
            return "RSA-4096", 4096
        if "ecdsa-p256" in t:
            return "ECDSA-P256", 256
        if "ecdsa-p384" in t:
            return "ECDSA-P384", 384
        if "ed25519" in t:
            return "ED25519", 256
        return t.upper(), 256
