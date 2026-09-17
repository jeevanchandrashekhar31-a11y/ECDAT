"""
AWS KMS Connector (Python) — Phase 14.3

Implements metadata collection for AWS Key Management Service (AWS KMS).
Enforces least-privilege read-only IAM roles:
  - kms:ListKeys
  - kms:DescribeKey
  - kms:GetKeyRotationStatus
  - kms:ListResourceTags
"""

import re
from typing import Dict, Any, List, Optional
from .base_kms_connector import BaseKmsConnector
from .kms_metadata import KmsKeyMetadata

AWS_READ_ONLY_ACTIONS = [
    "kms:ListKeys",
    "kms:DescribeKey",
    "kms:GetKeyRotationStatus",
    "kms:ListResourceTags",
    "kms:ListAliases",
]

AWS_DISALLOWED_ACTIONS = [
    "kms:Decrypt",
    "kms:Encrypt",
    "kms:ReEncrypt*",
    "kms:GenerateDataKey*",
    "kms:Sign",
    "kms:Verify",
    "kms:GetSecretValue",
    "kms:ScheduleKeyDeletion",
    "kms:DisableKey",
    "kms:Create*",
    "kms:Put*",
    "kms:Update*",
]


class AwsKmsConnector(BaseKmsConnector):
    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None, client: Any = None):
        super().__init__(name=name, provider="aws_kms", config=config, read_only=True, client=client)

    def validate_config(self, config: Dict[str, Any]) -> None:
        super().validate_config(config)
        if "region" not in config:
            self.config["region"] = "us-east-1"

    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        return {
            "version": "2012-10-17",
            "statement": [
                {
                    "Sid": "ECDATKmsReadOnlyMetadataAccess",
                    "Effect": "Allow",
                    "Action": list(AWS_READ_ONLY_ACTIONS),
                    "Resource": "*",
                },
                {
                    "Sid": "ECDATDenyCryptographicAndDestructiveActions",
                    "Effect": "Deny",
                    "Action": list(AWS_DISALLOWED_ACTIONS),
                    "Resource": "*",
                },
            ],
            "description": "Least-privilege read-only role for cryptographic metadata discovery in AWS KMS.",
        }

    def validate_least_privilege(self, actions: Any) -> Dict[str, Any]:
        action_list = actions if isinstance(actions, list) else actions.get("actions", [])
        violations = []

        for act in action_list:
            lower = act.lower()
            for dis in AWS_DISALLOWED_ACTIONS:
                pattern = dis.lower().replace("*", ".*")
                if re.match(f"^{pattern}$", lower):
                    violations.append(
                        f"Violation: Disallowed action '{act}' violates least-privilege read-only requirement."
                    )

        return {"valid": len(violations) == 0, "violations": violations}

    def list_keys(self) -> List[str]:
        if self.client and hasattr(self.client, "list_keys"):
            response = self.client.list_keys()
            keys = response.get("Keys", [])
            return [k.get("KeyId") or k.get("KeyArn") for k in keys]
        return self.config.get("mock_keys", [])

    def describe_key(self, key_id: str) -> KmsKeyMetadata:
        key_metadata = None
        rotation_status = {"KeyRotationEnabled": False}
        tags = []

        if self.client and hasattr(self.client, "describe_key"):
            desc_res = self.client.describe_key(KeyId=key_id)
            key_metadata = desc_res.get("KeyMetadata", {})

            if hasattr(self.client, "get_key_rotation_status"):
                try:
                    rotation_status = self.client.get_key_rotation_status(KeyId=key_id)
                except Exception:
                    rotation_status = {"KeyRotationEnabled": False}

            if hasattr(self.client, "list_resource_tags"):
                try:
                    tag_res = self.client.list_resource_tags(KeyId=key_id)
                    tags = tag_res.get("Tags", [])
                except Exception:
                    tags = []
        elif "mock_key_details" in self.config and key_id in self.config["mock_key_details"]:
            mock = self.config["mock_key_details"][key_id]
            key_metadata = mock.get("KeyMetadata", mock)
            rotation_status = mock.get("RotationStatus", {"KeyRotationEnabled": False})
            tags = mock.get("Tags", [])
        else:
            raise ValueError(f"AWS KMS: Key '{key_id}' not found or client unavailable")

        return self._map_to_kms_metadata(key_metadata, rotation_status, tags)

    def _map_to_kms_metadata(
        self, key_meta: Dict[str, Any], rotation_status: Dict[str, Any], tags: List[Dict[str, Any]]
    ) -> KmsKeyMetadata:
        spec = key_meta.get("KeySpec") or key_meta.get("CustomerMasterKeySpec") or "SYMMETRIC_DEFAULT"
        algorithm, size = self._parse_algorithm_and_size(spec)

        owner = None
        for tag in tags:
            k = tag.get("TagKey") or tag.get("Key", "")
            if k.lower() == "owner":
                owner = tag.get("TagValue") or tag.get("Value")
                break

        owner = owner or key_meta.get("AWSAccountId") or self.config.get("account_id") or "AWS_ACCOUNT"
        state = key_meta.get("KeyState") or ("Enabled" if key_meta.get("Enabled") else "Disabled")

        enabled = bool(rotation_status.get("KeyRotationEnabled", False))
        rotation = {
            "enabled": enabled,
            "period_days": 365 if enabled else None,
            "last_rotated_at": rotation_status.get("LastRotationDate"),
            "next_rotation_at": rotation_status.get("NextRotationDate"),
            "version": key_meta.get("KeyId", "1"),
        }

        key_usage = key_meta.get("KeyUsage", "ENCRYPT_DECRYPT")
        ops = ["sign", "verify"] if key_usage == "SIGN_VERIFY" else ["encrypt", "decrypt"]

        usage = {
            "key_usage": key_usage,
            "operations": ops,
            "origin": key_meta.get("Origin", "AWS_KMS"),
            "is_exportable": False,
        }

        return KmsKeyMetadata(
            key_id=key_meta.get("Arn") or key_meta.get("KeyId"),
            algorithm=algorithm,
            size=size,
            state=state,
            owner=owner,
            rotation=rotation,
            usage=usage,
            provider="aws_kms",
            description=key_meta.get("Description") or f"AWS KMS Key ({algorithm})",
            raw_metadata={
                "KeyMetadata": key_meta,
                "RotationStatus": rotation_status,
                "Tags": tags,
            },
        )

    def _parse_algorithm_and_size(self, spec: str):
        s = str(spec).upper()
        if "SYMMETRIC" in s or s == "AES_256":
            return "AES-256-GCM", 256
        if "RSA_2048" in s:
            return "RSA-2048", 2048
        if "RSA_3072" in s:
            return "RSA-3072", 3072
        if "RSA_4096" in s:
            return "RSA-4096", 4096
        if "ECC_NIST_P256" in s:
            return "ECDSA-P256", 256
        if "ECC_NIST_P384" in s:
            return "ECDSA-P384", 384
        if "ECC_NIST_P521" in s:
            return "ECDSA-P521", 521
        if "ECC_SECG_P256K1" in s:
            return "ECDSA-SECP256K1", 256
        if "HMAC_256" in s:
            return "HMAC-SHA256", 256
        return s, 256
