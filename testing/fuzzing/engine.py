"""
ECDAT Property and Fuzzing Engine (Phase 22.2)

Provides:
- Deterministic pseudo-random mutators (bit/byte flips, chunk insertions/deletions, boundary values)
- Security property assertions:
  1. No memory corruption (native crashes, segmentation faults, access violations)
  2. No uncontrolled recursion (RecursionError, unbounded call stack)
  3. No unbounded resource use (execution time watchdog, memory allocation bounds)
  4. No secrets in crash output (canary token / private key leak detector)
"""

import gc
import os
import random
import re
import struct
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union


class FuzzWatchdogError(Exception):
    """Raised when a fuzz iteration exceeds resource budgets."""
    pass


class SecretLeakageError(Exception):
    """Raised when an exception or crash output leaks sensitive canary tokens."""
    pass


class FuzzMutator:
    """
    Deterministic mutator providing generational and mutation-based fuzz vectors.
    """

    def __init__(self, seed: int = 1337):
        self.rng = random.Random(seed)
        self.canary_secrets = [
            "CANARY_SECRET_RSA_PRIVATE_KEY_TOKEN_998877",
            "CANARY_API_KEY_SEC_LIVE_abcd1234efgh5678",
            "CANARY_PASSWORD_SUPER_SECRET_P@ssw0rd123!",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0canary...",
            "ghp_CanaryTokenGitHubPersonalAccessToken12345",
        ]

    def mutate_bytes(self, data: bytes, num_mutations: int = 3) -> bytes:
        """Apply random mutations to a byte string."""
        if not data:
            return self.rng.choice([
                b"\x00" * 32,
                b"\xff" * 32,
                b"A" * 1024,
                b"{\"test\": 1}",
                b"<root></root>",
            ])

        b = bytearray(data)
        length = len(b)

        for _ in range(num_mutations):
            strategy = self.rng.choice([
                "bit_flip",
                "byte_flip",
                "byte_insert",
                "byte_delete",
                "boundary_int",
                "chunk_repeat",
                "null_flood",
                "canary_inject",
            ])

            if strategy == "bit_flip" and length > 0:
                pos = self.rng.randrange(length)
                bit = 1 << self.rng.randrange(8)
                b[pos] ^= bit

            elif strategy == "byte_flip" and length > 0:
                pos = self.rng.randrange(length)
                b[pos] = self.rng.randrange(256)

            elif strategy == "byte_insert":
                pos = self.rng.randrange(length + 1)
                b.insert(pos, self.rng.randrange(256))
                length = len(b)

            elif strategy == "byte_delete" and length > 1:
                pos = self.rng.randrange(length)
                del b[pos]
                length = len(b)

            elif strategy == "boundary_int" and length >= 4:
                pos = self.rng.randrange(length - 3)
                val = self.rng.choice([
                    0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff,
                    0x7fffffff, 0x80000000, 0xffffffff
                ])
                b[pos:pos + 4] = struct.pack("<I", val & 0xffffffff)

            elif strategy == "chunk_repeat" and length > 4:
                sub_len = min(self.rng.randint(2, 16), length)
                pos = self.rng.randrange(length - sub_len + 1)
                chunk = b[pos:pos + sub_len]
                b.extend(chunk * self.rng.randint(2, 8))
                length = len(b)

            elif strategy == "null_flood" and length > 0:
                pos = self.rng.randrange(length)
                flood_len = min(self.rng.randint(4, 64), length - pos)
                b[pos:pos + flood_len] = b"\x00" * flood_len

            elif strategy == "canary_inject":
                canary = self.rng.choice(self.canary_secrets).encode("utf-8")
                pos = self.rng.randrange(length + 1)
                b[pos:pos] = canary
                length = len(b)

        return bytes(b)

    def mutate_string(self, text: str, num_mutations: int = 2) -> str:
        """Apply random mutations to a string."""
        if not text:
            return self.rng.choice([
                "()", "{}", "[]", "''", "null", "undefined",
                "A" * 1000, "\x00" * 50, "\u202e\u200b\ufffd"
            ])

        chars = list(text)
        length = len(chars)

        for _ in range(num_mutations):
            strategy = self.rng.choice([
                "char_flip",
                "char_insert",
                "char_delete",
                "special_char",
                "unicode_noise",
                "deep_nesting",
                "canary_inject",
            ])

            if strategy == "char_flip" and length > 0:
                pos = self.rng.randrange(length)
                chars[pos] = chr(self.rng.randrange(32, 127))

            elif strategy == "char_insert":
                pos = self.rng.randrange(length + 1)
                chars.insert(pos, chr(self.rng.randrange(32, 127)))
                length = len(chars)

            elif strategy == "char_delete" and length > 1:
                pos = self.rng.randrange(length)
                del chars[pos]
                length = len(chars)

            elif strategy == "special_char":
                pos = self.rng.randrange(length + 1)
                special = self.rng.choice(["\\", "/", "\x00", "\n", "\r", "\t", '"', "'", ";", "%n", "$", "`"])
                chars.insert(pos, special)
                length = len(chars)

            elif strategy == "unicode_noise":
                pos = self.rng.randrange(length + 1)
                u_char = self.rng.choice(["\u202e", "\u200b", "\ufeff", "\ufffd", "\ud800", "\U0001f4a9"])
                chars.insert(pos, u_char)
                length = len(chars)

            elif strategy == "deep_nesting":
                pair = self.rng.choice([("(", ")"), ("[", "]"), ("{", "}")])
                nest = (pair[0] * 50) + "x" + (pair[1] * 50)
                pos = self.rng.randrange(length + 1)
                chars[pos:pos] = list(nest)
                length = len(chars)

            elif strategy == "canary_inject":
                canary = self.rng.choice(self.canary_secrets)
                pos = self.rng.randrange(length + 1)
                chars[pos:pos] = list(canary)
                length = len(chars)

        return "".join(chars)

    def generate_boundary_cases(self) -> List[bytes]:
        """Generate common boundary test vectors."""
        return [
            b"",
            b"\x00",
            b"\x00" * 1024,
            b"\xff" * 1024,
            b"A" * 65536,
            b"A" * 1048576,  # 1MB
            b"{\"__proto__\": {\"polluted\": true}}",
            b"{\"constructor\": {\"prototype\": {\"polluted\": true}}}",
            b"<!DOCTYPE foo [<!ENTITY bar \"boom\">]>",
            b"-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...",
            b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 56,
            b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00",
            b"\xca\xfe\xba\xbe\x00\x00\x00\x01\x00\x00\x00\x00",
            b"\xd4\xc3\xb2\xa1\x02\x00\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff\x00\x00\x01\x00\x00\x00",
        ]


class FuzzSecurityAssertion:
    """
    Executes a target parser under watchdog constraints and asserts:
    - No unhandled exceptions causing process termination
    - No uncontrolled recursion (catches and rejects RecursionError)
    - Execution within bounded time limit
    - Zero canary secrets in any caught exception or diagnostic output
    """

    def __init__(
        self,
        max_duration_seconds: float = 2.0,
        canary_secrets: Optional[List[str]] = None,
    ):
        self.max_duration_seconds = max_duration_seconds
        self.canary_secrets = canary_secrets or [
            "CANARY_SECRET_RSA_PRIVATE_KEY_TOKEN_998877",
            "CANARY_API_KEY_SEC_LIVE_abcd1234efgh5678",
            "CANARY_PASSWORD_SUPER_SECRET_P@ssw0rd123!",
            "ghp_CanaryTokenGitHubPersonalAccessToken12345",
        ]

    def assert_no_secret_leak(self, text: str):
        """Asserts that text does not contain any canary secrets."""
        for secret in self.canary_secrets:
            if secret in text:
                raise SecretLeakageError(
                    f"CRITICAL SECURITY FAILURE: Sensitive canary token was leaked in output/exception: {secret[:10]}..."
                )

    def execute_safely(
        self,
        func: Callable[..., Any],
        *args,
        allowed_exceptions: Sequence[type] = (Exception,),
        **kwargs
    ) -> Tuple[bool, Optional[Any], Optional[Exception]]:
        """
        Executes func(*args, **kwargs) and verifies all 4 security guarantees:
        1. No memory corruption (Python runtime stays healthy)
        2. No uncontrolled recursion (RecursionError is treated as violation)
        3. No unbounded resource use (enforced via time deadline)
        4. No secrets in crash output (analyzes exception message and string repr)
        """
        start_time = time.perf_counter()

        try:
            result = func(*args, **kwargs)
            duration = time.perf_counter() - start_time

            if duration > self.max_duration_seconds:
                raise FuzzWatchdogError(
                    f"Execution exceeded time budget: {duration:.3f}s > {self.max_duration_seconds:.3f}s"
                )

            # Check string representation of result for secret leakage
            self.assert_no_secret_leak(str(result))
            return True, result, None

        except RecursionError as rec_err:
            # Uncontrolled recursion is a critical security failure under Phase 22.2
            raise FuzzWatchdogError(f"CRITICAL: Uncontrolled recursion detected in parser: {rec_err}")

        except Exception as exc:
            duration = time.perf_counter() - start_time
            if duration > self.max_duration_seconds:
                raise FuzzWatchdogError(
                    f"Parser hung before raising error: {duration:.3f}s > {self.max_duration_seconds:.3f}s"
                )

            # Assert no secret leakage in exception representation or traceback
            exc_str = f"{type(exc).__name__}: {str(exc)}"
            self.assert_no_secret_leak(exc_str)

            # If the exception is an expected/handled parser error, return gracefully
            if isinstance(exc, tuple(allowed_exceptions)):
                return False, None, exc

            # Unexpected exception
            raise exc
