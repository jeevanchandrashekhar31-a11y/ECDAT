"""
KMS & HSM Key Metadata Model & Invariants — Phase 14.3

Enforces the 7 required metadata dimensions:
1. key identifier
2. algorithm
3. size/parameters
4. state
5. rotation metadata
6. owner
7. usage metadata

CRITICAL SECURITY INVARIANT:
"Never extract protected private key material."
Enforces strict runtime assertions prohibiting private key bytes, exponents, seeds,
or raw secret material.
"""

from typing import Dict, Any, Optional, Union, List
import copy

FORBIDDEN_PRIVATE_KEY_FIELDS = frozenset(
    {
        "privatekey",
        "private_key",
        "d",
        "p",
        "q",
        "dp",
        "dq",
        "qi",
        "rawkey",
        "raw_key",
        "secretbytes",
        "secret_bytes",
        "secretmaterial",
        "secret_material",
        "privatekeybytes",
        "private_key_bytes",
        "seed",
        "masterkey",
        "master_key",
        "keymaterial",
        "key_material",
    }
)


class ProtectedKeyMaterialError(Exception):
    """Raised when any protected private or raw secret key material is detected."""

    pass


def assert_no_private_key_material(obj: Any, path: str = "") -> None:
    """Runtime invariant guard ensuring zero private key material is present."""
    if not isinstance(obj, dict):
        return

    for key, value in obj.items():
        normalized = str(key).lower().replace("-", "").replace("_", "")
        if normalized in FORBIDDEN_PRIVATE_KEY_FIELDS:
            full_path = f"{path}.{key}" if path else str(key)
            raise ProtectedKeyMaterialError(
                f"CRITICAL SECURITY VIOLATION: Private key material detected in field '{full_path}'. "
                "ECDAT collects metadata only!"
            )
        if isinstance(value, dict):
            assert_no_private_key_material(value, f"{path}.{key}" if path else str(key))
        elif isinstance(value, (list, tuple)):
            for idx, item in enumerate(value):
                if isinstance(item, dict):
                    assert_no_private_key_material(item, f"{path}.{key}[{idx}]")


def sanitize_metadata(obj: Any) -> Any:
    """Recursively redacts forbidden private key fields."""
    if not isinstance(obj, dict):
        return obj

    cleaned = {}
    for k, v in obj.items():
        normalized = str(k).lower().replace("-", "").replace("_", "")
        if normalized in FORBIDDEN_PRIVATE_KEY_FIELDS:
            cleaned[k] = "[REDACTED_PROTECTED_MATERIAL]"
        elif isinstance(v, dict):
            cleaned[k] = sanitize_metadata(v)
        elif isinstance(v, list):
            cleaned[k] = [sanitize_metadata(item) if isinstance(item, dict) else item for item in v]
        else:
            cleaned[k] = v
    return cleaned


class KmsKeyMetadata:
    """Standardized metadata representation for KMS and HSM managed keys."""

    def __init__(
        self,
        key_id: str,
        algorithm: str,
        size: Union[int, str],
        state: str,
        owner: str,
        rotation: Optional[Dict[str, Any]] = None,
        usage: Optional[Dict[str, Any]] = None,
        provider: str = "unknown",
        description: str = "",
        raw_metadata: Optional[Dict[str, Any]] = None,
    ):
        if not key_id:
            raise ValueError("KmsKeyMetadata requires non-empty 'key_id'")
        if not algorithm:
            raise ValueError("KmsKeyMetadata requires non-empty 'algorithm'")
        if size is None:
            raise ValueError("KmsKeyMetadata requires 'size' (key length or curve parameters)")
        if not state:
            raise ValueError("KmsKeyMetadata requires non-empty 'state'")
        if not owner:
            raise ValueError("KmsKeyMetadata requires non-empty 'owner'")

        raw_meta = raw_metadata or {}
        # Enforce strict invariant
        assert_no_private_key_material(raw_meta)

        self.key_id = str(key_id)
        self.algorithm = str(algorithm).upper()
        self.size = size if isinstance(size, int) else str(size)
        self.state = str(state)
        self.owner = str(owner)
        self.provider = str(provider).lower()
        self.description = str(description or "")

        rot = rotation or {}
        self.rotation = {
            "enabled": bool(rot.get("enabled", False)),
            "period_days": int(rot["period_days"]) if rot.get("period_days") is not None else None,
            "last_rotated_at": str(rot["last_rotated_at"]) if rot.get("last_rotated_at") else None,
            "next_rotation_at": str(rot["next_rotation_at"]) if rot.get("next_rotation_at") else None,
            "version": str(rot.get("version", "1")),
        }

        usg = usage or {}
        self.usage = {
            "key_usage": str(usg.get("key_usage", "ENCRYPT_DECRYPT")),
            "operations": list(usg.get("operations", ["encrypt", "decrypt"])),
            "origin": str(usg.get("origin", "KMS")),
            "is_exportable": bool(usg.get("is_exportable", False)),
        }

        self.raw_metadata = sanitize_metadata(raw_meta)

    def to_cbom_component(self) -> Dict[str, Any]:
        """Converts key metadata into CycloneDX CBOM component."""
        try:
            key_len = int(self.size)
        except (ValueError, TypeError):
            key_len = 0

        return {
            "type": "cryptographic-asset",
            "bom-ref": f"cbom:{self.provider}:{self.key_id}",
            "name": self.key_id,
            "description": self.description or f"{self.provider.upper()} Managed Key ({self.algorithm})",
            "cryptoProperties": {
                "assetType": "key",
                "algorithm": self.algorithm,
                "keyLength": key_len,
                "state": self.state,
                "provider": self.provider,
                "rotationEnabled": self.rotation["enabled"],
                "rotationPeriodDays": self.rotation["period_days"],
                "owner": self.owner,
                "keyUsage": self.usage["key_usage"],
                "isExportable": self.usage["is_exportable"],
            },
            "properties": [
                {"name": "ecdat:kms:provider", "value": self.provider},
                {"name": "ecdat:kms:key_id", "value": self.key_id},
                {"name": "ecdat:kms:owner", "value": self.owner},
                {"name": "ecdat:kms:rotation_enabled", "value": str(self.rotation["enabled"]).lower()},
                {"name": "ecdat:kms:state", "value": self.state},
            ],
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key_id": self.key_id,
            "algorithm": self.algorithm,
            "size": self.size,
            "state": self.state,
            "rotation": self.rotation,
            "owner": self.owner,
            "usage": self.usage,
            "provider": self.provider,
            "description": self.description,
            "raw_metadata": self.raw_metadata,
        }
