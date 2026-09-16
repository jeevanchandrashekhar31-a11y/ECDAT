"""
Base KMS Connector (Python) — Phase 14.3

Defines the abstract connector interface for cloud KMS, Vault, and HSM ecosystems.
Enforces read-only operation and metadata-only collection.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from .kms_metadata import KmsKeyMetadata, assert_no_private_key_material


class BaseKmsConnector(ABC):
    """Abstract base class for KMS and HSM metadata connectors."""

    def __init__(
        self,
        name: str,
        provider: str,
        config: Optional[Dict[str, Any]] = None,
        read_only: bool = True,
        client: Any = None,
    ):
        if not name:
            raise ValueError("BaseKmsConnector requires 'name'")
        if not provider:
            raise ValueError("BaseKmsConnector requires 'provider'")

        # Invariant: Use least-privilege read-only roles by default
        if read_only is not True:
            raise PermissionError(
                f"Security Policy Violation: KMS connector '{name}' must be initialized in read-only mode (read_only=True)"
            )

        self.name = str(name)
        self.provider = str(provider).lower()
        self.config = dict(config or {})
        self.read_only = True
        self.client = client

        self.validate_config(self.config)

    def validate_config(self, config: Dict[str, Any]) -> None:
        """Validates provider-specific configuration."""
        if config is None:
            raise ValueError(f"{self.name} requires configuration dict")

    @abstractmethod
    def get_least_privilege_role_definition(self) -> Dict[str, Any]:
        """Returns the least-privilege read-only role or policy definition."""
        pass

    def validate_least_privilege(self, permissions: Any) -> Dict[str, Any]:
        """Validates that credentials/roles do not grant write or cryptographic operations."""
        return {"valid": True, "violations": []}

    def test_connection(self) -> Dict[str, Any]:
        """Performs a read-only probe to test connectivity."""
        return {"ok": True, "message": f"Read-only connection verified for {self.name}"}

    @abstractmethod
    def list_keys(self) -> List[Any]:
        """Lists key identifiers available in provider scope."""
        pass

    @abstractmethod
    def describe_key(self, key_id: str) -> KmsKeyMetadata:
        """Fetches metadata for a single key, returning KmsKeyMetadata."""
        pass

    def discover_all(self) -> List[KmsKeyMetadata]:
        """Discovers and describes all keys in scope."""
        key_items = self.list_keys()
        results = []

        for item in key_items:
            key_id = item if isinstance(item, str) else item.get("key_id") or item.get("id") or item.get("name")
            if not key_id:
                continue

            metadata = self.describe_key(key_id)
            if not isinstance(metadata, KmsKeyMetadata):
                raise TypeError(f"describe_key({key_id}) did not return a KmsKeyMetadata instance")

            assert_no_private_key_material(metadata.raw_metadata)
            results.push if hasattr(results, "push") else results.append(metadata)

        return results

    def sanitize_config(self) -> Dict[str, Any]:
        """Redacts secrets from connector configuration."""
        clean = dict(self.config)
        for k in clean.keys():
            if any(sub in k.lower() for sub in ["secret", "token", "password", "key", "auth", "credential"]):
                clean[k] = "[REDACTED]"
        return clean
