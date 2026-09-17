"""
KMS & HSM Discovery Service (Python) — Phase 14.3

Registry, discovery orchestration, CBOM generation, and fleet analysis for KMS/HSM keys.
"""

from typing import Dict, Any, List, Optional
import uuid
import datetime
from .kms_metadata import KmsKeyMetadata
from .base_kms_connector import BaseKmsConnector


class KmsDiscoveryService:
    def __init__(self):
        self.connectors: Dict[str, BaseKmsConnector] = {}

    def register_connector(self, connector: BaseKmsConnector) -> BaseKmsConnector:
        if not isinstance(connector, BaseKmsConnector):
            raise TypeError("Connector must inherit from BaseKmsConnector")
        if connector.name in self.connectors:
            raise ValueError(f"Connector with name '{connector.name}' already registered")
        self.connectors[connector.name] = connector
        return connector

    def get_connector(self, name: str) -> Optional[BaseKmsConnector]:
        return self.connectors.get(name)

    def unregister_connector(self, name: str) -> bool:
        return self.connectors.pop(name, None) is not None

    def list_connectors(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": c.name,
                "provider": c.provider,
                "read_only": c.read_only,
                "config": c.sanitize_config(),
                "least_privilege_role": c.get_least_privilege_role_definition(),
            }
            for c in self.connectors.values()
        ]

    def discover_all(self, filter_opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        filters = filter_opts or {}
        targets = list(self.connectors.values())

        if filters.get("connector_name"):
            targets = [c for c in targets if c.name == filters["connector_name"]]
        if filters.get("provider"):
            targets = [c for c in targets if c.provider == str(filters["provider"]).lower()]

        all_keys: List[KmsKeyMetadata] = []
        errors: List[Dict[str, Any]] = []

        for connector in targets:
            try:
                keys = connector.discover_all()
                all_keys.extend(keys)
            except Exception as e:
                errors.append(
                    {
                        "connector_name": connector.name,
                        "provider": connector.provider,
                        "error": str(e),
                    }
                )

        return {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "total_count": len(all_keys),
            "keys": all_keys,
            "errors": errors,
        }

    def to_cbom(self, keys: Optional[List[Any]] = None) -> Dict[str, Any]:
        key_list = keys or []
        components = [
            k.to_cbom_component() if isinstance(k, KmsKeyMetadata) else KmsKeyMetadata(**k).to_cbom_component()
            for k in key_list
        ]

        return {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "serialNumber": f"urn:uuid:{uuid.uuid4()}",
            "version": 1,
            "metadata": {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "tools": {
                    "components": [
                        {
                            "type": "application",
                            "name": "ECDAT-KMS-Discovery-Engine",
                            "version": "1.0.0",
                            "vendor": "ECDAT",
                        }
                    ]
                },
                "properties": [
                    {"name": "ecdat:module", "value": "cloud_kms_hsm_metadata"},
                    {"name": "ecdat:extraction_policy", "value": "metadata_only_read_only"},
                ],
            },
            "components": components,
        }

    def get_summary(self, keys: Optional[List[KmsKeyMetadata]] = None) -> Dict[str, Any]:
        key_list = keys or []
        by_provider: Dict[str, int] = {}
        by_algorithm: Dict[str, int] = {}
        by_state: Dict[str, int] = {}

        unrotated_count = 0
        exportable_count = 0
        weak_key_count = 0

        for key in key_list:
            by_provider[key.provider] = by_provider.get(key.provider, 0) + 1
            by_algorithm[key.algorithm] = by_algorithm.get(key.algorithm, 0) + 1
            by_state[key.state] = by_state.get(key.state, 0) + 1

            if not key.rotation.get("enabled"):
                unrotated_count += 1

            if key.usage.get("is_exportable"):
                exportable_count += 1

            try:
                num_size = int(key.size)
            except Exception:
                num_size = 256

            if ("RSA" in key.algorithm and num_size < 2048) or "3DES" in key.algorithm or "DES" in key.algorithm:
                weak_key_count += 1

        return {
            "total_keys": len(key_list),
            "by_provider": by_provider,
            "by_algorithm": by_algorithm,
            "by_state": by_state,
            "metrics": {
                "unrotated_count": unrotated_count,
                "exportable_count": exportable_count,
                "weak_key_count": weak_key_count,
            },
        }


default_kms_discovery_service = KmsDiscoveryService()
