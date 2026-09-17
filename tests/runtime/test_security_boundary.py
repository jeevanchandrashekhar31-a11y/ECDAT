"""
Unit and Integration Tests for Phase 6.2: eBPF Security Boundary & Dedicated Agent

Validates:
1. Strict allowlist probe enforcement: Rejects un-allowlisted or arbitrary probes.
2. Kernel compatibility checks: Minimum kernel version (>= 5.8) and virtual filesystem.
3. Resource limits and bounded event buffers: Bounded capacity, oldest drop on overflow.
4. Input validation and metadata-only: Trips circuit breaker upon sensitive payload attempt.
5. Watchdog and health monitoring: Heartbeats and failure callback triggers.
6. Clean probe detachment on shutdown or error.
7. Acceptance criterion: A compromised observed application sending forbidden data trips the agent
   circuit breaker and detaches probes WITHOUT compromising the control plane.
"""

import time
import pytest
from scanners.runtime.security_boundary import (
    AgentResourceLimits,
    AgentWatchdog,
    BoundedEventBuffer,
    KernelCompatibilityValidator,
    ProbeAttachment,
    RuntimeSecurityAgent,
    SecurityBoundaryViolation,
)
from scanners.runtime.engine import SensitiveDataExposureError


class TestStrictAllowlistProbes:
    """Validates that only probes declared in rules/runtime_probes_catalog.json are allowed."""

    def test_attach_allowlisted_probe_succeeds(self):
        agent = RuntimeSecurityAgent()
        attachment = agent.attach_probe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3")
        assert attachment.is_attached is True
        assert attachment.function_name == "EVP_EncryptInit_ex"
        assert attachment.probe_id in agent.attached_probes

    def test_attach_unauthorized_probe_rejected(self):
        agent = RuntimeSecurityAgent()
        with pytest.raises(SecurityBoundaryViolation) as exc_info:
            agent.attach_probe("arbitrary_kernel_probe_999", "/usr/lib/libc.so.6")
        assert "is NOT in the allowlisted runtime probes catalog" in str(exc_info.value)
        assert len(agent.attached_probes) == 0


class TestKernelCompatibilityChecks:
    """Validates minimum kernel version check and BPF filesystem requirement."""

    def test_parse_kernel_version(self):
        assert KernelCompatibilityValidator.parse_kernel_version("5.15.0-89-generic") == (5, 15, 0)
        assert KernelCompatibilityValidator.parse_kernel_version("6.5.0") == (6, 5, 0)
        assert KernelCompatibilityValidator.parse_kernel_version("4.18.0") == (4, 18, 0)

    def test_validate_kernel_version_rejections(self, monkeypatch):
        monkeypatch.setattr("platform.system", lambda: "Linux")
        monkeypatch.setattr("platform.release", lambda: "4.15.0-generic")
        is_compat, reason = KernelCompatibilityValidator.validate_kernel(min_version="5.8.0")
        assert is_compat is False
        assert "below minimum requirement" in reason

    def test_validate_kernel_on_non_linux(self, monkeypatch):
        monkeypatch.setattr("platform.system", lambda: "Windows")
        is_compat, reason = KernelCompatibilityValidator.validate_kernel()
        assert is_compat is False
        assert "requires linux" in reason.lower()


class TestResourceLimitsAndBoundedBuffer:
    """Validates bounded buffer behavior under high throughput or event burst."""

    def test_bounded_buffer_drops_oldest_on_overflow(self):
        buffer = BoundedEventBuffer(capacity=5)
        for i in range(10):
            buffer.push({"index": i, "parameters": {"cipher_name": "AES"}})

        assert buffer.size() == 5
        assert buffer.dropped_count == 5
        assert buffer.total_enqueued == 10

        batch = buffer.pop_batch(max_batch=10)
        assert len(batch) == 5
        # Oldest dropped, indices 5..9 remain
        assert batch[0]["index"] == 5
        assert batch[-1]["index"] == 9

    def test_agent_rate_limiting(self):
        limits = AgentResourceLimits(max_events_per_second=10)
        agent = RuntimeSecurityAgent(limits=limits)

        enqueued = 0
        for _ in range(25):
            success = agent.ingest_raw_event(
                {
                    "function_name": "EVP_EncryptInit_ex",
                    "parameters": {"cipher_name": "AES-256-GCM"},
                }
            )
            if success:
                enqueued += 1

        assert enqueued == 10  # Capped at max_events_per_second


class TestInputValidationAndCompromisedAppProtection:
    """
    Acceptance Criterion:
    A compromised application being observed must not automatically compromise the ECDAT control plane.
    """

    def test_compromised_app_sensitive_payload_trips_circuit_breaker(self):
        agent = RuntimeSecurityAgent()
        agent.attach_probe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3")
        assert len(agent.attached_probes) == 1

        # Malicious / compromised app emits raw private key
        malicious_event = {
            "function_name": "EVP_EncryptInit_ex",
            "parameters": {
                "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y18V...",
            },
        }

        with pytest.raises(SensitiveDataExposureError):
            agent.ingest_raw_event(malicious_event)

        # Invariant check:
        # 1. Circuit breaker tripped
        assert agent.circuit_breaker_tripped is True
        assert "Sensitive data exposure attempt" in str(agent.circuit_breaker_reason)
        # 2. All probes cleanly detached
        assert len(agent.attached_probes) == 0
        # 3. Subsequent event ingestion or probe attachment is refused
        assert agent.ingest_raw_event({"parameters": {"cipher_name": "AES"}}) is False
        with pytest.raises(SecurityBoundaryViolation):
            agent.attach_probe("openssl_evp_digest_init_ex", "/usr/lib/libcrypto.so.3")


class TestWatchdogAndCleanDetach:
    """Validates heartbeat monitoring, watchdog timeout, and clean detach."""

    def test_watchdog_detects_stall(self):
        callback_called = False

        def on_fail():
            nonlocal callback_called
            callback_called = True

        watchdog = AgentWatchdog(timeout_seconds=0.1, on_failure_callback=on_fail)
        watchdog.heartbeat()
        assert watchdog.check_health() is True

        time.sleep(0.15)
        assert watchdog.check_health() is False
        assert watchdog.is_healthy is False
        assert callback_called is True

    def test_clean_detach_probes(self):
        agent = RuntimeSecurityAgent()
        agent.attach_probe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3")
        agent.attach_probe("openssl_evp_digest_init_ex", "/usr/lib/libcrypto.so.3")
        assert len(agent.attached_probes) == 2

        detached_count = agent.detach_all_probes()
        assert detached_count == 2
        assert len(agent.attached_probes) == 0

        status = agent.get_status_report()
        assert status["attached_probes_count"] == 0
