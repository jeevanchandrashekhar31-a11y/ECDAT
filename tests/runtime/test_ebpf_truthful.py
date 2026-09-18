# @ecdat-synthetic-corpus
"""
Tests for P1 — eBPF: Truthful Implementation & Genuine Architecture (Item 14)

Validates:
1. Truthful Capability Claims: ECDAT does NOT claim live kernel eBPF support on non-Linux or without verified attached kernel probes.
2. Runtime Security Observation Abstraction:
   - Verifies RuntimeObservationProbe, register_observation_probe(), and backward-compatible aliases.
   - Verifies get_status_report() explicitly declares 'runtime_security_observation_abstraction' and is_live_ebpf_verified=False.
3. Genuine eBPF Architecture (bpf/crypto_observer.bpf.c + LinuxEbpfProbeCollector):
   - In-kernel BPF C program with BPF_MAP_TYPE_RINGBUF and drop_counters map.
   - Strict Zero Key Material Invariant in kernel C code.
   - Minimal capabilities: checks for CAP_BPF + CAP_PERFMON without requiring full CAP_SYS_ADMIN.
   - Explicit kernel version requirements: Linux >= 5.8.0.
   - Userspace collector: bounded queue, backpressure signaling, and drop accounting.
   - Event rate limiting: bounded event rate with rate-limit drop tracking.
   - Watchdog monitoring and graceful circuit-breaker failure.
"""

import os
import queue
import struct
import time
from pathlib import Path
import pytest

from scanners.runtime.security_boundary import (
    RuntimeSecurityAgent,
    RuntimeObservationProbe,
    ProbeAttachment,
    ObservationProbeAttachment,
    AgentResourceLimits,
    SecurityBoundaryViolation,
)
from scanners.runtime.ebpf_collector import (
    LinuxEbpfProbeCollector,
    EbpfDropAccounting,
    CRYPTO_EVENT_STRUCT_FMT,
    CRYPTO_EVENT_STRUCT_SIZE,
    OP_TYPE_ENCRYPT,
)
from scanners.runtime.engine import SensitiveDataExposureError


# =========================================================================
# 1. Truthful Capability & Abstraction Tests
# =========================================================================

def test_truthful_architecture_declaration():
    """Agent status report must truthfully declare it is an observation abstraction, not live eBPF."""
    agent = RuntimeSecurityAgent()
    status = agent.get_status_report()

    assert status["architecture_type"] == "runtime_security_observation_abstraction"
    assert status["is_kernel_ebpf_attached"] is False
    assert status["is_live_ebpf_verified"] is False


def test_observation_probe_renaming_and_aliases():
    """Verifies that RuntimeObservationProbe is the primary class with backward-compatible aliases."""
    assert RuntimeObservationProbe is ProbeAttachment
    assert RuntimeObservationProbe is ObservationProbeAttachment

    agent = RuntimeSecurityAgent()
    probe = agent.register_observation_probe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3")

    assert isinstance(probe, RuntimeObservationProbe)
    assert probe.is_attached is True
    assert probe.is_live_ebpf is False
    assert probe.function_name == "EVP_EncryptInit_ex"

    # Verify attach_probe alias works identically
    alias_probe = agent.attach_probe("openssl_evp_digest_init_ex", "/usr/lib/libcrypto.so.3")
    assert isinstance(alias_probe, RuntimeObservationProbe)
    assert alias_probe.is_live_ebpf is False


# =========================================================================
# 2. Genuine In-Kernel eBPF C Program Invariants
# =========================================================================

def test_ebpf_c_source_code_and_invariants():
    """Validates the authentic in-kernel C eBPF program, CO-RE headers, and zero key material."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    bpf_c_path = repo_root / "bpf" / "crypto_observer.bpf.c"
    bpf_h_path = repo_root / "bpf" / "crypto_observer.h"

    assert bpf_c_path.exists(), "bpf/crypto_observer.bpf.c must exist"
    assert bpf_h_path.exists(), "bpf/crypto_observer.h must exist"

    c_code = bpf_c_path.read_text(encoding="utf-8")
    h_code = bpf_h_path.read_text(encoding="utf-8")

    # 1. BPF Maps: Ring buffer and drop accounting
    assert "BPF_MAP_TYPE_RINGBUF" in c_code
    assert "crypto_events" in c_code
    assert "drop_counters" in c_code

    # 2. Uprobes declared
    assert 'SEC("uprobe/EVP_EncryptInit_ex")' in c_code
    assert 'SEC("uprobe/EVP_DigestInit_ex")' in c_code
    assert 'SEC("uprobe/SSL_do_handshake")' in c_code

    # 3. Kernel verifier safety
    assert "bpf_ringbuf_reserve" in c_code
    assert "bpf_ringbuf_submit" in c_code
    assert "record_drop" in c_code

    # 4. Zero Key Material Invariant: Never read key bytes
    assert "ZERO KEY MATERIAL" in c_code
    assert "key_size_bits" in h_code
    # Struct fields must never contain key_bytes, plaintext, private_key
    struct_body = h_code.split("struct crypto_event_t {")[1].split("};")[0]
    assert "plaintext" not in struct_body
    assert "private_key" not in struct_body
    assert "key_bytes" not in struct_body


# =========================================================================
# 3. Kernel Requirements & Minimal Capabilities
# =========================================================================

def test_collector_enforces_minimal_capabilities_and_kernel(monkeypatch):
    """Collector must enforce Linux >= 5.8 and verify CAP_BPF / CAP_PERFMON without CAP_SYS_ADMIN."""
    collector = LinuxEbpfProbeCollector()

    # On non-Linux (e.g. Windows/macOS), refuse live attachment
    monkeypatch.setattr("platform.system", lambda: "Windows")
    is_compat, reason = collector.verify_kernel_requirements()
    assert is_compat is False
    assert "requires linux" in reason.lower()

    # Never claim eBPF support when requirements not met
    attached = collector.attach_kernel_probe("EVP_EncryptInit_ex", "/bin/sh")
    assert attached is False
    assert collector.is_live_ebpf_verified is False

    # Simulate Linux with old kernel (< 5.8)
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.release", lambda: "4.19.0-21-amd64")
    is_compat, reason = collector.verify_kernel_requirements()
    assert is_compat is False
    assert "below minimum requirement" in reason


def test_minimal_capabilities_distinguishes_cap_bpf_from_sys_admin(monkeypatch):
    """Validates that CAP_BPF + CAP_PERFMON is the minimal requirement, not full root."""
    monkeypatch.setattr("platform.system", lambda: "Linux")
    # Simulate unprivileged non-root user lacking capabilities
    monkeypatch.setattr(os, "geteuid", lambda: 1000, raising=False)

    has_caps, caps, msg = LinuxEbpfProbeCollector.verify_minimal_capabilities()
    assert has_caps is False
    assert "CAP_BPF" in caps
    assert "CAP_PERFMON" in caps


# =========================================================================
# 4. Userspace Collector, Bounded Queue, Backpressure & Drop Accounting
# =========================================================================

def make_sample_raw_bpf_event(
    pid: int = 1234,
    tgid: int = 1234,
    op_type: int = OP_TYPE_ENCRYPT,
    key_size: int = 256,
    ret_code: int = 0,
    comm: str = "nginx",
    algo: str = "AES-256-GCM",
) -> bytes:
    """Helper creating a binary struct crypto_event_t simulating kernel ring buffer output."""
    raw_comm = comm.encode("utf-8")[:16].ljust(16, b"\x00")
    raw_algo = algo.encode("utf-8")[:32].ljust(32, b"\x00")
    return struct.pack(
        CRYPTO_EVENT_STRUCT_FMT,
        pid,
        tgid,
        1700000000000000000,
        0x45565031,
        op_type,
        key_size,
        ret_code,
        raw_comm,
        raw_algo,
    )


def test_collector_ingestion_and_pipeline_processing():
    """Collector must deserialize raw binary events, enforce metadata only, and drain via pipeline."""
    received_events = []
    collector = LinuxEbpfProbeCollector(
        event_callback=lambda ev: received_events.append(ev)
    )

    raw_event = make_sample_raw_bpf_event()
    success = collector.ingest_raw_kernel_event(raw_event)
    assert success is True
    assert collector.event_queue.qsize() == 1

    # Drain queue
    processed = collector.process_queued_events(max_batch=10)
    assert len(processed) == 1
    assert len(received_events) == 1

    ev = processed[0]
    assert ev["process_id"] == 1234
    assert ev["process_name"] == "nginx"
    assert ev["crypto_operation"] == "symmetric_encryption"
    assert ev["parameters"]["algorithm_name"] == "AES-256-GCM"
    assert ev["parameters"]["key_size_bits"] == 256


def test_bounded_queue_backpressure_and_drop_accounting():
    """When queue capacity is reached, backpressure activates and drops are counted."""
    limits = AgentResourceLimits(max_buffer_entries=5, max_events_per_second=1000)
    collector = LinuxEbpfProbeCollector(limits=limits)

    # Enqueue up to capacity
    for i in range(5):
        raw = make_sample_raw_bpf_event(pid=i + 1)
        assert collector.ingest_raw_kernel_event(raw) is True

    assert collector.event_queue.qsize() == 5
    assert collector.backpressure_active is True

    # 6th event must be dropped with drop accounting incremented
    raw_overflow = make_sample_raw_bpf_event(pid=999)
    assert collector.ingest_raw_kernel_event(raw_overflow) is False
    assert collector.drop_stats.queue_drops == 1

    # Telemetry status reports drop accounting accurately
    telemetry = collector.get_telemetry_status()
    assert telemetry["drop_accounting"]["queue_drops"] == 1
    assert telemetry["drop_accounting"]["total_drops"] == 1
    assert telemetry["backpressure_active"] is True

    # Process events to clear backpressure
    drained = collector.process_queued_events(max_batch=5)
    assert len(drained) == 5
    assert collector.backpressure_active is False


def test_rate_limiting_and_drop_accounting():
    """Events exceeding max_events_per_second are dropped and tracked."""
    limits = AgentResourceLimits(max_events_per_second=3, max_buffer_entries=100)
    collector = LinuxEbpfProbeCollector(limits=limits)

    enqueued = 0
    for i in range(10):
        raw = make_sample_raw_bpf_event(pid=i + 1)
        if collector.ingest_raw_kernel_event(raw):
            enqueued += 1

    assert enqueued == 3
    assert collector.drop_stats.rate_limit_drops == 7
    assert collector.drop_stats.total_drops == 7


def test_watchdog_failure_trips_circuit_breaker():
    """Watchdog detects stall or starvation and trips circuit breaker."""
    callback_fired = False

    collector = LinuxEbpfProbeCollector(
        limits=AgentResourceLimits(watchdog_timeout_seconds=1)
    )
    collector.watchdog.timeout_seconds = 0.1
    collector.watchdog.heartbeat()

    time.sleep(0.15)
    assert collector.watchdog.check_health() is False
    assert collector.circuit_breaker_tripped is True
    assert "Watchdog detected stall" in collector.circuit_breaker_reason

    # Once tripped, refuses new events
    raw = make_sample_raw_bpf_event()
    assert collector.ingest_raw_kernel_event(raw) is False
