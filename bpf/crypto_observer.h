/* SPDX-License-Identifier: (LGPL-2.1 OR BSD-2-Clause) */
/* Copyright (c) 2026 Enterprise Cryptographic Discovery and Assessment Tool (ECDAT) */
#ifndef __CRYPTO_OBSERVER_H
#define __CRYPTO_OBSERVER_H

#define MAX_COMM_LEN 16
#define MAX_ALGO_NAME_LEN 32

/* Cryptographic Operation Types */
#define OP_TYPE_ENCRYPT    1
#define OP_TYPE_DECRYPT    2
#define OP_TYPE_DIGEST     3
#define OP_TYPE_HANDSHAKE  4
#define OP_TYPE_SIGN       5
#define OP_TYPE_VERIFY     6

/*
 * BPF Ring Buffer Telemetry Event
 *
 * CRITICAL SECURITY INVARIANT:
 * Strictly metadata only. No private keys, key material, plaintext, passwords,
 * or encrypted payloads are EVER captured or transmitted in this struct.
 */
struct crypto_event_t {
    __u32 pid;
    __u32 tgid;
    __u64 timestamp_ns;
    __u32 probe_id_hash;
    __u32 operation_type;
    __u32 key_size_bits;
    __s32 return_code;
    char comm[MAX_COMM_LEN];
    char algorithm_name[MAX_ALGO_NAME_LEN];
};

/* Drop Accounting Statistics (passed via BPF Array Map) */
struct ebpf_drop_stats_t {
    __u64 ringbuf_drops;
    __u64 queue_drops;
    __u64 rate_limit_drops;
    __u64 error_drops;
};

#endif /* __CRYPTO_OBSERVER_H */
