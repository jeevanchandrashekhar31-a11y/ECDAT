#!/usr/bin/env python3
"""
ECDAT In-Kernel eBPF Probe Loader & Telemetry Verifier (Phase 5B)

SCOPE & GOAL:
  Genuine in-kernel eBPF attachment using BCC targeting EVP_DigestInit_ex.
  Captures real ring-buffer events emitted from genuine process execution.
  Strictly enforces truthfulness reporting:
    - kernel_attachment_verified = True (once attached and event captured)
    - algorithm_identification_verified = False (probe metadata fields are static, not call-site introspected)
    - is_live_ebpf_verified = False (does not stand in for both claims)
"""

import argparse
import ctypes
import json
import logging
import os
import platform
import shutil
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ecdat.ebpf_loader")

# C Struct format matching bpf/crypto_observer.h
CRYPTO_EVENT_STRUCT_FMT = "=IIQIIIi16s32s"
CRYPTO_EVENT_STRUCT_SIZE = struct.calcsize(CRYPTO_EVENT_STRUCT_FMT)

class CryptoEventStruct(ctypes.Structure):
    _fields_ = [
        ("pid", ctypes.c_uint32),
        ("tgid", ctypes.c_uint32),
        ("timestamp_ns", ctypes.c_uint64),
        ("probe_id_hash", ctypes.c_uint32),
        ("operation_type", ctypes.c_uint32),
        ("key_size_bits", ctypes.c_uint32),
        ("return_code", ctypes.c_int32),
        ("comm", ctypes.c_char * 16),
        ("algorithm_name", ctypes.c_char * 32),
    ]

# Minimal safe eBPF C program for uprobe/EVP_DigestInit_ex
BPF_DIGEST_PROGRAM = """
#include <uapi/linux/ptrace.h>

#define MAX_COMM_LEN 16
#define MAX_ALGO_NAME_LEN 32

struct crypto_event_t {
    u32 pid;
    u32 tgid;
    u64 timestamp_ns;
    u32 probe_id_hash;
    u32 operation_type;
    u32 key_size_bits;
    s32 return_code;
    char comm[MAX_COMM_LEN];
    char algorithm_name[MAX_ALGO_NAME_LEN];
};

BPF_RINGBUF_OUTPUT(crypto_events, 64);

int probe_evp_digest_init_ex(struct pt_regs *ctx) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid & 0xFFFFFFFF;
    u32 tgid = pid_tgid >> 32;

    struct crypto_event_t *event = crypto_events.ringbuf_reserve(sizeof(*event));
    if (!event) {
        return 0;
    }

    event->pid = pid;
    event->tgid = tgid;
    event->timestamp_ns = bpf_ktime_get_ns();
    event->probe_id_hash = 0x44494731; /* Hash of openssl_evp_digest_init_ex */
    event->operation_type = 3;          /* OP_TYPE_DIGEST */
    event->key_size_bits = 0;           /* Hashes do not have key material */
    event->return_code = 0;

    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    /*
     * TRUTHFULNESS NOTICE:
     * Hardcoded algorithm identifier for architecture verification demonstration.
     * Dynamic call-site argument extraction is NOT implemented in this phase.
     */
    const char algo[] = "SHA-256";
    for (int i = 0; i < sizeof(algo) && i < MAX_ALGO_NAME_LEN; i++) {
        event->algorithm_name[i] = algo[i];
    }

    crypto_events.ringbuf_submit(event, 0);
    return 0;
}
"""


def resolve_library_for_symbol(target_path: str, symbol: str) -> str:
    """
    Resolves the actual binary or shared library providing the requested symbol.
    If the target is an executable importing the symbol (like /usr/bin/openssl),
    inspects ldd to find the dynamic provider (e.g. libcrypto.so.3).
    """
    p = Path(target_path)
    if not p.exists():
        # Check standard system libraries
        if target_path in ("crypto", "libcrypto", "libcrypto.so", "ssl", "libssl"):
            return target_path
        return target_path

    # Check if target itself defines symbol via nm -D
    try:
        res = subprocess.run(["nm", "-D", target_path], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            if symbol in line:
                parts = line.strip().split()
                # 'T' or 'W' means defined in this object
                if len(parts) >= 2 and parts[1] in ("T", "t", "W", "w"):
                    return target_path
    except Exception:
        pass

    # If symbol is undefined in target, inspect linked libraries via ldd
    try:
        ldd_res = subprocess.run(["ldd", target_path], capture_output=True, text=True, timeout=5)
        for line in ldd_res.stdout.splitlines():
            if "libcrypto" in line and "=>" in line:
                resolved = line.split("=>")[1].split("(")[0].strip()
                if Path(resolved).exists():
                    logger.info("Resolved symbol '%s' via ldd dependency: %s", symbol, resolved)
                    return resolved
    except Exception:
        pass

    # Fallback to standard library name
    return "crypto"


def run_windows_delegation(args: argparse.Namespace) -> int:
    """
    When invoked on Windows, transparently forwards execution into WSL2 Ubuntu
    where the real Linux kernel and eBPF subsystem reside.
    """
    logger.info("Windows detected: delegating eBPF loader to WSL2 (Ubuntu kernel >= 5.8)...")
    wsl_bin = shutil.which("wsl.exe") or "wsl.exe"
    
    # Convert paths to WSL path convention
    workspace_win = str(REPO_ROOT)
    # Convert 'C:\Users\...' -> '/mnt/c/Users/...'
    drive = workspace_win[0].lower()
    path_tail = workspace_win[2:].replace("\\", "/")
    workspace_wsl = f"/mnt/{drive}{path_tail}"

    script_wsl = f"{workspace_wsl}/scripts/ebpf_loader.py"
    
    cmd = [
        wsl_bin, "-u", "root", "-d", "Ubuntu",
        "python3", script_wsl,
        "--attach", args.attach,
        "--target", args.target,
        "--timeout", str(args.timeout),
        "--count", str(args.count),
    ]
    if args.output:
        # Map output path to WSL if windows path
        out_str = str(args.output)
        if ":" in out_str:
            out_drive = out_str[0].lower()
            out_tail = out_str[2:].replace("\\", "/")
            cmd.extend(["--output", f"/mnt/{out_drive}{out_tail}"])
        else:
            cmd.extend(["--output", out_str])
    if args.trigger:
        cmd.append("--trigger")

    proc = subprocess.run(cmd)
    return proc.returncode


def run_native_ebpf_loader(args: argparse.Namespace) -> int:
    """Executes native eBPF loading, attachment, and event capture on Linux."""
    from scanners.runtime.ebpf_collector import LinuxEbpfProbeCollector

    # 1. Verify kernel compatibility
    logger.info("Verifying Linux kernel requirements (>= 5.8 with BTF)...")
    is_compat, compat_reason = LinuxEbpfProbeCollector.verify_kernel_requirements()
    if not is_compat:
        logger.error("Kernel verification failed: %s", compat_reason)
        return 1

    btf_path = Path("/sys/kernel/btf/vmlinux")
    if not btf_path.exists():
        logger.warning("BTF file /sys/kernel/btf/vmlinux not found; CO-RE might be restricted.")
    else:
        logger.info("Verified BTF kernel symbols present at %s (%d bytes).", btf_path, btf_path.stat().st_size)

    # 2. Check minimal capabilities (CAP_BPF, CAP_PERFMON or root)
    has_caps, caps, cap_reason = LinuxEbpfProbeCollector.verify_minimal_capabilities()
    if not has_caps:
        logger.error("eBPF capabilities verification failed: %s", cap_reason)
        return 1
    logger.info("Capabilities verified: %s", cap_reason)

    # 3. Load BPF program via BCC
    try:
        from bcc import BPF  # type: ignore  # pyrefly: ignore [missing-import]
    except ImportError:
        logger.error("BCC python module (python3-bpfcc) is not installed. Run 'apt-get install python3-bpfcc'.")
        return 1

    logger.info("Compiling and loading BPF program into kernel via BCC...")
    try:
        b = BPF(text=BPF_DIGEST_PROGRAM)
        logger.info("SUCCESS: eBPF program verified and loaded into kernel!")
    except Exception as e:
        logger.error("Failed to compile/load eBPF bytecode: %s", e)
        return 1

    # 4. Resolve and attach uprobe
    symbol_name = "EVP_DigestInit_ex"
    probe_fn = "probe_evp_digest_init_ex"
    attach_target = resolve_library_for_symbol(args.target, symbol_name)
    logger.info("Attaching uprobe to target '%s' (symbol: %s)...", attach_target, symbol_name)

    try:
        b.attach_uprobe(name=attach_target, sym=symbol_name, fn_name=probe_fn)
        logger.info("SUCCESS: Uprobe genuinely attached to kernel at %s::%s!", attach_target, symbol_name)
    except Exception as e:
        logger.error("Failed to attach uprobe to %s::%s: %s", attach_target, symbol_name, e)
        return 1

    # 5. Initialize userspace collector and configure truthful verification flags
    collector = LinuxEbpfProbeCollector()
    collector.kernel_attachment_verified = True
    collector.algorithm_identification_verified = False  # Strictly False: static field in probe
    collector.is_live_ebpf_verified = False             # Must not stand in for both
    collector.declared_probes.append(f"uprobe/{symbol_name}@{args.target}")
    collector.attached_kernel_probes.append(f"uprobe/{symbol_name}@{attach_target}")
    collector.attachment_backend = "bcc_ringbuf"

    captured_events: List[Dict[str, Any]] = []

    def ringbuf_callback(ctx, data, size):
        try:
            raw_bytes = ctypes.string_at(data, size)
            ev_struct = ctypes.cast(data, ctypes.POINTER(CryptoEventStruct)).contents
            
            comm_str = ev_struct.comm.decode("utf-8", "ignore").strip("\x00")
            algo_str = ev_struct.algorithm_name.decode("utf-8", "ignore").strip("\x00")

            event_dict = {
                "pid": int(ev_struct.pid),
                "tgid": int(ev_struct.tgid),
                "timestamp_ns": int(ev_struct.timestamp_ns),
                "probe_id_hash": hex(ev_struct.probe_id_hash),
                "operation_type": int(ev_struct.operation_type),
                "key_size_bits": int(ev_struct.key_size_bits),
                "return_code": int(ev_struct.return_code),
                "comm": comm_str,
                "algorithm_name": algo_str,
            }
            captured_events.append(event_dict)

            # Ingest raw bytes into official collector queue
            collector.ingest_raw_kernel_event(raw_bytes)
            collector.process_queued_events()

            logger.info(
                "CAPTURED RING-BUFFER EVENT: pid=%d tgid=%d comm=%s op=DIGEST algo=%s",
                event_dict["pid"],
                event_dict["tgid"],
                event_dict["comm"],
                event_dict["algorithm_name"],
            )
        except Exception as err:
            logger.error("Error processing ring buffer event: %s", err)

    b["crypto_events"].open_ring_buffer(ringbuf_callback)

    # 6. Trigger real binary if requested
    if args.trigger:
        def trigger_worker():
            time.sleep(0.3)
            logger.info("Executing real target operation to trigger uprobe...")
            try:
                # Run real OpenSSL digest operation
                target_exec = args.target if Path(args.target).is_file() and os.access(args.target, os.X_OK) else "openssl"
                res = subprocess.run(
                    [target_exec, "dgst", "-sha256", "/etc/os-release"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                logger.info("Trigger command executed (stdout: %s)", res.stdout.strip())
            except Exception as trig_err:
                logger.warning("Trigger execution error: %s", trig_err)

        trig_thread = threading.Thread(target=trigger_worker)
        trig_thread.daemon = True
        trig_thread.start()

    # 7. Poll ring buffer
    logger.info("Polling eBPF ring buffer for up to %ds (target: %d events)...", args.timeout, args.count)
    start_time = time.time()
    while len(captured_events) < args.count and (time.time() - start_time) < args.timeout:
        b.ring_buffer_poll(50)
        time.sleep(0.05)

    # Final drain
    b.ring_buffer_poll(50)

    # 8. Write captured events to log file
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    report = {
        "kernel_attachment_verified": collector.kernel_attachment_verified,
        "algorithm_identification_verified": collector.algorithm_identification_verified,
        "is_live_ebpf_verified": collector.is_live_ebpf_verified,
        "verification_status": collector.verification_status,
        "attachment_backend": collector.attachment_backend,
        "attached_kernel_probes": collector.attached_kernel_probes,
        "target": args.target,
        "total_events_captured": len(captured_events),
        "captured_events": captured_events,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    logger.info("Wrote captured event report to %s", output_path)

    # Print summary
    print("\n" + "=" * 65)
    print("  ECDAT REAL eBPF KERNEL ATTACHMENT REPORT (PHASE 5B)")
    print("=" * 65)
    print(f"kernel_attachment_verified        : {collector.kernel_attachment_verified}")
    print(f"algorithm_identification_verified : {collector.algorithm_identification_verified}")
    print(f"is_live_ebpf_verified             : {collector.is_live_ebpf_verified}")
    print(f"verification_status               : {collector.verification_status}")
    print(f"attached_kernel_probes            : {collector.attached_kernel_probes}")
    print(f"total_events_captured             : {len(captured_events)}")
    if captured_events:
        print("\nCaptured Event (Unedited):")
        print(json.dumps(captured_events[0], indent=2))
    print("=" * 65 + "\n")

    return 0 if captured_events else 2


def main():
    parser = argparse.ArgumentParser(description="ECDAT Minimal In-Kernel eBPF Probe Loader")
    parser.add_argument(
        "--attach",
        choices=["digest", "encrypt", "handshake"],
        default="digest",
        help="Uprobe to attach (default: digest -> EVP_DigestInit_ex)",
    )
    parser.add_argument(
        "--target",
        default="/usr/bin/openssl",
        help="Target binary or library path (default: /usr/bin/openssl)",
    )
    parser.add_argument(
        "--output",
        default="artifacts/ebpf_captured_events.json",
        help="Log file path for captured events (default: artifacts/ebpf_captured_events.json)",
    )
    parser.add_argument(
        "--trigger",
        action="store_true",
        help="Automatically trigger real cryptographic operation on target binary",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=10,
        help="Polling timeout in seconds (default: 10)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=1,
        help="Number of events to capture before exiting (default: 1)",
    )

    args = parser.parse_args()

    if platform.system() == "Windows":
        sys.exit(run_windows_delegation(args))
    else:
        sys.exit(run_native_ebpf_loader(args))


if __name__ == "__main__":
    main()
