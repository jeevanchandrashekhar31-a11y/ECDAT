"""
ECDAT Runtime Discovery Package (Phase 6.1)
"""

from scanners.runtime.engine import (
    RuntimeCapabilityStatus,
    SensitiveDataExposureError,
    RuntimeCryptoEvent,
    KernelCapabilityChecker,
    RuntimeProbesCatalog,
    RuntimeObservationSubsystem,
    assert_metadata_only,
)
from scanners.runtime.security_boundary import (
    SecurityBoundaryViolation,
    KernelCompatibilityError,
    AgentResourceLimits,
    ProbeAttachment,
    BoundedEventBuffer,
    AgentWatchdog,
    KernelCompatibilityValidator,
    RuntimeSecurityAgent,
)

__all__ = [
    "RuntimeCapabilityStatus",
    "SensitiveDataExposureError",
    "RuntimeCryptoEvent",
    "KernelCapabilityChecker",
    "RuntimeProbesCatalog",
    "RuntimeObservationSubsystem",
    "assert_metadata_only",
    "SecurityBoundaryViolation",
    "KernelCompatibilityError",
    "AgentResourceLimits",
    "ProbeAttachment",
    "BoundedEventBuffer",
    "AgentWatchdog",
    "KernelCompatibilityValidator",
    "RuntimeSecurityAgent",
]
