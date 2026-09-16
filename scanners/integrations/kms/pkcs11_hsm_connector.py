"""
PKCS#11 / Hardware Security Module (HSM) Connector (Python) — Phase 14.3

Implements metadata collection for PKCS#11 compliant HSMs.
CRITICAL INVARIANT: Never query or extract CKA_VALUE or private key material.
"""

from typing import Dict, Any, List, Optional
import urllib.parse
from .base_kms_connector import BaseKmsConnector
from .kms_metadata import KmsKeyMetadata, ProtectedKeyMaterialError

CKA_ALLOWED_ATTRIBUTES = [
    "CKA_CLASS",
    "CKA_KEY_TYPE",
    "CKA_LABEL",
    "CKA_ID",
    "CKA_MODULUS_BITS",
    "CKA_VALUE_LEN",
    "CKA_EXTRACTABLE",
    "CKA_NEVER_EXTRACTABLE",
    "CKA_SENSITIVE",
    "CKA_ALWAYS_SENSITIVE",
    "CKA_ENCRYPT",
    "CKA_DECRYPT",
    "CKA_SIGN",
    "CKA_VERIFY",
    "CKA_WRAP",
    "CKA_UNWRAP",
    "CKA_TOKEN",
]

CKA_FORBIDDEN_ATTRIBUTES = [
    "CKA_VALUE",
    "CKA_PRIVATE_EXPONENT",
    "CKA_PRIME_1",
    "CKA_PRIME_2",
    "CKA_EXPONENT_1",
    "CKA_EXPONENT_2",
    "CKA_COEFFICIENT",
    "CKA_VALUE_BITS",
]


class Pkcs11HsmConnector(BaseKmsConnector):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None, client: Any = None):
        super().__init__(name=name, provider="pkcs11_hsm", config=config, read_only=True, client=client)

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if "slot_id" not in config:
            self.config["slot_id"] = 0

    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        return {
            "session_type": "CKF_SERIAL_SESSION",
            "access_type": "ReadOnly (User/Public session)",
            "allowed_attributes": list(CKA_ALLOWED_ATTRIBUTES),
            "forbidden_attributes": list(CKA_FORBIDDEN_ATTRIBUTES),
            "description": "Least-privilege read-only PKCS#11 token session querying public descriptors only.",
        }

    def validate_least_privilege(self, attributes: Any) -> Dict[str, Any]:
        attr_list = attributes if isinstance(attributes, list) else []
        violations = []

        for a in attr_list:
            if str(a).upper() in CKA_FORBIDDEN_ATTRIBUTES:
                violations.append(f"Violation: Forbidden attribute '{a}' exposes protected cryptographic material.")

        return {"valid": len(violations) == 0, "violations": violations}

    def list_keys(self) -> List[str]:
        if self.client and hasattr(self.client, "find_objects"):
            objects = self.client.find_objects(slot_id=self.config.get("slot_id", 0))
            return [o.get("id") or o.get("label") for o in objects]
        return self.config.get("mock_keys", [])

    def describe_key(self, key_identifier: str) -> KmsKeyMetadata:
        raw_obj = None
        if self.client and hasattr(self.client, "get_attribute_values"):
            raw_obj = self.client.get_attribute_values(key_identifier, CKA_ALLOWED_ATTRIBUTES)
        elif "mock_key_details" in self.config and key_identifier in self.config["mock_key_details"]:
            raw_obj = self.config["mock_key_details"][key_identifier]
        else:
            raise ValueError(f"PKCS#11 HSM: Key object '{key_identifier}' not found")

        self._assert_no_hsm_private_material(raw_obj)
        return self._map_to_kms_metadata(key_identifier, raw_obj)

    def _assert_no_hsm_private_material(self, obj: Dict[str, Any]) -> None:
        if not isinstance(obj, dict):
            return
        for forbidden in CKA_FORBIDDEN_ATTRIBUTES:
            if forbidden in obj or forbidden.lower() in obj:
                raise ProtectedKeyMaterialError(
                    f"CRITICAL SECURITY VIOLATION: HSM attribute '{forbidden}' detected. ECDAT never extracts private key material!"
                )

    def _map_to_kms_metadata(self, key_identifier: str, raw_obj: Dict[str, Any]) -> KmsKeyMetadata:
        key_type = str(raw_obj.get("CKA_KEY_TYPE") or raw_obj.get("key_type") or "CKK_RSA").upper()
        modulus_bits = raw_obj.get("CKA_MODULUS_BITS") or raw_obj.get("modulus_bits")
        value_len = raw_obj.get("CKA_VALUE_LEN") or raw_obj.get("value_len")

        algorithm, size = self._parse_hsm_algorithm(key_type, modulus_bits, value_len)

        label = raw_obj.get("CKA_LABEL") or raw_obj.get("label") or key_identifier
        kid = raw_obj.get("CKA_ID") or raw_obj.get("id") or key_identifier
        slot_id = self.config.get("slot_id", 0)

        canonical_id = f"pkcs11:slot={slot_id};id={urllib.parse.quote(str(kid))};label={urllib.parse.quote(str(label))}"
        owner = self.config.get("token_label") or f"slot-{slot_id}"

        extractable = bool(raw_obj.get("CKA_EXTRACTABLE", raw_obj.get("extractable", False)))
        never_extractable = bool(raw_obj.get("CKA_NEVER_EXTRACTABLE", raw_obj.get("never_extractable", True)))

        ops = []
        if raw_obj.get("CKA_ENCRYPT") or raw_obj.get("CKA_DECRYPT"):
            ops.extend(["encrypt", "decrypt"])
        if raw_obj.get("CKA_SIGN") or raw_obj.get("CKA_VERIFY"):
            ops.extend(["sign", "verify"])
        if raw_obj.get("CKA_WRAP") or raw_obj.get("CKA_UNWRAP"):
            ops.extend(["wrapKey", "unwrapKey"])

        usage = {
            "key_usage": "SIGN_VERIFY" if "sign" in ops else "ENCRYPT_DECRYPT",
            "operations": ops or ["encrypt", "decrypt"],
            "origin": "Hardware Security Module (HSM)",
            "is_exportable": extractable and not never_extractable,
        }

        rotation = {
            "enabled": False,
            "period_days": None,
            "last_rotated_at": None,
            "next_rotation_at": None,
            "version": "1",
        }

        return KmsKeyMetadata(
            key_id=canonical_id,
            algorithm=algorithm,
            size=size,
            state="Active",
            owner=owner,
            rotation=rotation,
            usage=usage,
            provider="pkcs11_hsm",
            description=f"Hardware Security Module Token Key: {label}",
            raw_metadata={
                "slot_id": slot_id,
                "label": label,
                "id": kid,
                "key_type": key_type,
                "modulus_bits": modulus_bits,
                "extractable": extractable,
                "never_extractable": never_extractable,
                "token": raw_obj.get("CKA_TOKEN", True),
            },
        )

    def _parse_hsm_algorithm(self, key_type: str, modulus_bits: Optional[int], value_len: Optional[int]):
        kt = str(key_type).upper()
        if "RSA" in kt:
            bits = modulus_bits or 2048
            return f"RSA-{bits}", bits
        if "EC" in kt:
            return "ECDSA-P256", 256
        if "AES" in kt:
            bits = (value_len or 32) * 8
            return f"AES-{bits}-GCM", bits
        if "DES3" in kt or "3DES" in kt:
            return "3DES-EDE", 168
        return kt, modulus_bits or 256
