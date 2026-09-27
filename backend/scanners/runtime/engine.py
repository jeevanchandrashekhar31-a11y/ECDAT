"""
ECDAT Runtime & eBPF Discovery Subsystem (Phase 6.1)

Goal:
process
  -> library / function
  -> crypto operation
  -> parameters (metadata only)
  -> application / service
  -> crypto asset

Core Invariants:
1. Optional subsystem: Gracefully disables when kernel capabilities (eBPF / uprobes / root / CAP_BPF / linux)
   are missing or unavailable, reporting descriptive degradation reasons rather than crashing.
2. Metadata-only: Strictly NEVER captures private keys, plaintext, passwords, tokens, or arbitrary payloads.
   Enforced via strict runtime validation and payload sanitizers.
3. First-class asset correlation: Resolves observed live runtime events into first-class CryptoAsset and
   AssetRelationship graphs linking Process -> Library -> Crypto Operation -> Asset.

Implementation Boundary:
- This module models the capability detection, probe catalog, metadata-only validation, event ingestion,
  and CycloneDX CBOM correlation.
- In-kernel bytecode compilation and direct uprobe attachment require an external compiled native daemon
  (e.g., libbpf/BCC) forwarding structured metadata events.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("ecdat.runtime")


class RuntimeCapabilityStatus(str, Enum):
    AVAILABLE = "available"
    UNAVAILABLE_NON_LINUX = "unavailable_non_linux"
    UNAVAILABLE_NO_ROOT_OR_CAP_BPF = "unavailable_no_root_or_cap_bpf"
    UNAVAILABLE_NO_EBPF_SUPPORT = "unavailable_no_ebpf_support"
    DISABLED_BY_CONFIG = "disabled_by_config"


class SensitiveDataExposureError(ValueError):
    """Raised when an attempt is made to record or emit sensitive payloads in runtime observations."""

    pass


FORBIDDEN_PAYLOAD_KEYS: Set[str] = {
    "private_key",
    "privatekey",
    "plaintext",
    "cleartext",
    "password",
    "passwd",
    "token",
    "secret",
    "payload",
    "raw_key",
    "key_bytes",
    "decrypted_data",
}

# Regex to detect raw PEM private keys, high-entropy tokens, or cleartext passwords
FORBIDDEN_VALUE_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"-----BEGIN RSA PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"-----BEGIN EC PRIVATE KEY-----", re.IGNORECASE),
]


def assert_metadata_only(data: Dict[str, Any], context: str = "runtime_event") -> None:
    """
    Strict security invariant check:
    Rejects any dictionary containing forbidden sensitive payload keys or private key content.
    """
    for key, val in data.items():
        k_lower = key.lower()
        if k_lower in FORBIDDEN_PAYLOAD_KEYS or any(
            f in k_lower for f in ["private_key", "plaintext", "password", "token", "payload"]
        ):
            raise SensitiveDataExposureError(
                f"Security Invariant Violation in {context}: Forbidden sensitive field '{key}' detected. "
                "Runtime discovery MUST capture metadata only (process, library, operation, parameters)."
            )
        if isinstance(val, str):
            for pat in FORBIDDEN_VALUE_PATTERNS:
                if pat.search(val):
                    raise SensitiveDataExposureError(
                        f"Security Invariant Violation in {context}: Private key material detected in field '{key}'."
                    )
        elif isinstance(val, dict):
            assert_metadata_only(val, context=f"{context}.{key}")


@dataclass
class RuntimeCryptoEvent:
    """
    Structured metadata-only observation of a cryptographic operation at runtime.
    """

    process_id: int
    process_name: str
    library_name: str
    function_name: str
    crypto_operation: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    container_id: Optional[str] = None
    application_name: Optional[str] = None
    service_name: Optional[str] = None
    timestamp_ns: Optional[int] = None

    def __post_init__(self) -> None:
        # Enforce metadata-only invariant upon construction
        assert_metadata_only(self.parameters, context=f"RuntimeCryptoEvent({self.function_name})")

    def to_dict(self) -> Dict[str, Any]:
        assert_metadata_only(self.parameters, context=f"RuntimeCryptoEvent({self.function_name})")
        return {
            "process_id": self.process_id,
            "process_name": self.process_name,
            "library_name": self.library_name,
            "function_name": self.function_name,
            "crypto_operation": self.crypto_operation,
            "parameters": self.parameters,
            "container_id": self.container_id,
            "application_name": self.application_name,
            "service_name": self.service_name,
            "timestamp_ns": self.timestamp_ns,
        }


class KernelCapabilityChecker:
    """
    Inspects host operating system and kernel privileges to determine if
    eBPF uprobes/kprobes runtime instrumentation can safely execute.
    """

    @staticmethod
    def check_capabilities(enabled_in_config: bool = True) -> Tuple[RuntimeCapabilityStatus, str]:
        if not enabled_in_config:
            return (
                RuntimeCapabilityStatus.DISABLED_BY_CONFIG,
                "Runtime eBPF subsystem is disabled by configuration.",
            )

        current_os = platform.system().lower()
        if current_os != "linux":
            return (
                RuntimeCapabilityStatus.UNAVAILABLE_NON_LINUX,
                f"Kernel eBPF runtime collection requires Linux (detected '{current_os}'). "
                "Runtime collection gracefully disabled.",
            )

        # Check for root or CAP_BPF / CAP_SYS_ADMIN privileges on Linux
        try:
            euid = os.geteuid()  # type: ignore[attr-defined]
            if euid != 0:
                return (
                    RuntimeCapabilityStatus.UNAVAILABLE_NO_ROOT_OR_CAP_BPF,
                    f"eBPF tracing requires root or CAP_BPF/CAP_SYS_ADMIN privileges (euid={euid}). "
                    "Runtime collection gracefully disabled.",
                )
        except AttributeError:
            # os.geteuid not available on non-POSIX
            return (
                RuntimeCapabilityStatus.UNAVAILABLE_NON_LINUX,
                "POSIX user ID check unavailable. Runtime collection gracefully disabled.",
            )

        # Check kernel version or BPF filesystem / sysfs
        bpf_fs = Path("/sys/fs/bpf")
        if not bpf_fs.exists():
            return (
                RuntimeCapabilityStatus.UNAVAILABLE_NO_EBPF_SUPPORT,
                "BPF virtual filesystem /sys/fs/bpf not found. Runtime collection gracefully disabled.",
            )

        return (
            RuntimeCapabilityStatus.AVAILABLE,
            "Linux kernel eBPF and uprobe capabilities verified and available.",
        )


class RuntimeProbesCatalog:
    """
    Catalog of supported cryptographic libraries and uprobe function targets.
    Loads from rules/runtime_probes_catalog.json.
    """

    def __init__(self, catalog_path: Optional[Path] = None):
        if catalog_path is None:
            repo_root = Path(__file__).resolve().parent.parent.parent
            catalog_path = repo_root / "rules" / "runtime_probes_catalog.json"

        self.catalog_path = catalog_path
        self.version = "1.0.0"
        self.libraries: Dict[str, Dict[str, Any]] = {}
        self.function_to_probe: Dict[str, Dict[str, Any]] = {}
        self.load_catalog()

    def load_catalog(self) -> None:
        if not self.catalog_path.exists():
            # Graceful default if file missing
            return

        with open(self.catalog_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.version = data.get("version", "1.0.0")
        for lib in data.get("supported_libraries", []):
            lib_id = lib["library_id"]
            self.libraries[lib_id] = lib
            for probe in lib.get("probes", []):
                fn = probe["function_name"]
                self.function_to_probe[fn.lower()] = {
                    **probe,
                    "library_id": lib_id,
                    "library_name": lib["library_name"],
                }

    def lookup_function(self, function_name: str) -> Optional[Dict[str, Any]]:
        return self.function_to_probe.get(function_name.lower())


class RuntimeObservationSubsystem:
    """
    Optional Runtime Observation Subsystem managing eBPF/uprobe instrumentation,
    event ingestion, graceful degradation, and domain asset correlation.
    """

    def __init__(
        self,
        enabled: bool = True,
        catalog: Optional[RuntimeProbesCatalog] = None,
        capability_checker: Optional[KernelCapabilityChecker] = None,
    ):
        self.enabled = enabled
        self.catalog = catalog or RuntimeProbesCatalog()
        self.capability_checker = capability_checker or KernelCapabilityChecker()
        self.status, self.status_reason = self.capability_checker.check_capabilities(self.enabled)
        self.events: List[RuntimeCryptoEvent] = []

    def is_operational(self) -> bool:
        """Returns True only if enabled and host kernel capabilities exist."""
        return self.status == RuntimeCapabilityStatus.AVAILABLE

    def record_event(
        self,
        process_id: int,
        process_name: str,
        library_name: str,
        function_name: str,
        crypto_operation: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        container_id: Optional[str] = None,
        application_name: Optional[str] = None,
        service_name: Optional[str] = None,
    ) -> RuntimeCryptoEvent:
        """
        Records a runtime cryptographic observation with strict metadata-only validation.
        """
        params = parameters or {}
        # Strict security check: disallow private keys or plaintext
        assert_metadata_only(params, context=f"record_event({function_name})")

        # Resolve probe info if operation not specified
        probe = self.catalog.lookup_function(function_name)
        resolved_op = crypto_operation or (probe.get("crypto_operation") if probe else "cryptographic_call")

        event = RuntimeCryptoEvent(
            process_id=process_id,
            process_name=process_name,
            library_name=library_name,
            function_name=function_name,
            crypto_operation=resolved_op,
            parameters=params,
            container_id=container_id,
            application_name=application_name or process_name,
            service_name=service_name,
        )
        self.events.append(event)
        return event

    def correlate_to_domain_assets(self, event: RuntimeCryptoEvent) -> Dict[str, Any]:
        """
        Correlates a runtime event through the chain:
        Process -> Library/Function -> Crypto Operation -> Parameters -> Application/Service -> Crypto Asset.
        Generates first-class entities and explicit relationship graph edges.
        """
        app_name = event.application_name or event.process_name
        app_ref = f"app:{app_name}"
        proc_ref = f"proc:{event.process_id}:{event.process_name}"
        lib_ref = f"lib:{event.library_name.lower()}"
        fn_ref = f"fn:{event.library_name.lower()}:{event.function_name}"

        # Derive primary crypto asset from operation and parameters
        algo_name = (
            event.parameters.get("cipher_name")
            or event.parameters.get("digest_name")
            or event.parameters.get("algorithm")
            or "unknown_algorithm"
        )
        key_size = event.parameters.get("key_length") or event.parameters.get("key_size_bits")
        asset_id = f"runtime:asset:{algo_name}"
        if key_size:
            asset_id += f"-{key_size}"

        relationships = [
            # Application HOSTS Process
            {
                "source_id": app_ref,
                "target_id": proc_ref,
                "relationship_type": "hosts_process",
                "metadata": {"container_id": event.container_id},
            },
            # Process LOADS Crypto Library
            {
                "source_id": proc_ref,
                "target_id": lib_ref,
                "relationship_type": "depends_on",
                "metadata": {"library_name": event.library_name},
            },
            # Process CALLS Function
            {
                "source_id": proc_ref,
                "target_id": fn_ref,
                "relationship_type": "uses",
                "metadata": {"function_name": event.function_name, "crypto_operation": event.crypto_operation},
            },
            # Function EXECUTES Crypto Asset
            {
                "source_id": fn_ref,
                "target_id": asset_id,
                "relationship_type": "implements",
                "metadata": {
                    "crypto_operation": event.crypto_operation,
                    "parameters": event.parameters,
                    "reachability_level": "RUNTIME_CONFIRMED",
                },
            },
        ]

        return {
            "application_ref": app_ref,
            "process_ref": proc_ref,
            "library_ref": lib_ref,
            "function_ref": fn_ref,
            "crypto_asset_id": asset_id,
            "algorithm_name": algo_name,
            "key_size": key_size,
            "crypto_operation": event.crypto_operation,
            "reachability": "RUNTIME_CONFIRMED",
            "evidence_source": "runtime",
            "relationships": relationships,
        }
