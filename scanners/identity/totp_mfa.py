"""
RFC 6238 TOTP Multi-Factor Authentication Engine (Python) — Phase 15.2

Implements:
- RFC 6238 Time-based One-Time Password (TOTP)
- RFC 4226 Dynamic Truncation
- RFC 4648 Base32 Secret Encoding / Decoding
- otpauth:// URI generator compatible with Google Authenticator / Authy / YubiKey
- Cryptographically secure single-use backup recovery codes
"""

import base64
import hashlib
import hmac
import os
import struct
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote


BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def base32_encode(buffer: bytes) -> str:
    bits = 0
    val = 0
    output = []
    for byte in buffer:
        val = (val << 8) | byte
        bits += 8
        while bits >= 5:
            output.append(BASE32_ALPHABET[(val >> (bits - 5)) & 31])
            bits -= 5
    if bits > 0:
        output.append(BASE32_ALPHABET[(val << (5 - bits)) & 31])
    return "".join(output)


def base32_decode(base32_str: str) -> bytes:
    clean = base32_str.upper().replace(" ", "").replace("=", "").replace("-", "")
    bits = 0
    val = 0
    bytes_out = bytearray()
    for char in clean:
        idx = BASE32_ALPHABET.find(char)
        if idx == -1:
            raise ValueError(f"Invalid base32 character '{char}'")
        val = (val << 5) | idx
        bits += 5
        if bits >= 8:
            bytes_out.append((val >> (bits - 8)) & 255)
            bits -= 8
    return bytes(bytes_out)


class MfaTotpEngine:
    """
    Standard RFC 6238 TOTP engine with backup code support.
    """

    def __init__(
        self,
        step_seconds: int = 30,
        digits: int = 6,
        algorithm: str = "sha1",
        issuer: str = "ECDAT",
    ):
        self.step_seconds = step_seconds
        self.digits = digits
        self.algorithm = algorithm.lower()
        self.issuer = issuer

    def generate_secret(self, account_name: str = "user@enterprise.internal") -> Dict[str, Any]:
        secret_bytes = os.urandom(20)  # 160-bit key
        secret_base32 = base32_encode(secret_bytes)

        enc_issuer = quote(self.issuer)
        enc_account = quote(account_name)
        otpauth_uri = (
            f"otpauth://totp/{enc_issuer}:{enc_account}?"
            f"secret={secret_base32}&issuer={enc_issuer}&algorithm={self.algorithm.upper()}&"
            f"digits={self.digits}&period={self.step_seconds}"
        )

        return {
            "secret": secret_base32,
            "otpAuthUri": otpauth_uri,
            "issuer": self.issuer,
            "accountName": account_name,
            "digits": self.digits,
            "period": self.step_seconds,
        }

    def generate_code(self, secret_base32: str, timestamp: Optional[float] = None) -> str:
        if timestamp is None:
            timestamp = time.time()
        key = base32_decode(secret_base32)
        counter = int(timestamp // self.step_seconds)
        counter_bytes = struct.pack(">Q", counter)

        digestmod = hashlib.sha1 if self.algorithm == "sha1" else hashlib.sha256
        hm = hmac.new(key, counter_bytes, digestmod).digest()

        offset = hm[-1] & 0x0F
        binary = struct.unpack(">I", hm[offset : offset + 4])[0] & 0x7FFFFFFF
        code_int = binary % (10**self.digits)
        return str(code_int).zfill(self.digits)

    def verify_code(
        self,
        secret_base32: str,
        user_code: str,
        window: int = 1,
        timestamp: Optional[float] = None,
    ) -> bool:
        if not secret_base32 or not user_code:
            return False

        clean_code = str(user_code).strip()
        if len(clean_code) != self.digits:
            return False

        if timestamp is None:
            timestamp = time.time()

        current_counter = int(timestamp // self.step_seconds)
        for offset in range(-window, window + 1):
            step_time = (current_counter + offset) * self.step_seconds
            expected_code = self.generate_code(secret_base32, step_time)
            if hmac.compare_digest(clean_code, expected_code):
                return True

        return False

    def generate_backup_codes(self, count: int = 8) -> Tuple[List[str], List[str]]:
        plain_codes = []
        hashed_codes = []

        for _ in range(count):
            p1 = os.urandom(2).hex().upper()
            p2 = os.urandom(2).hex().upper()
            p3 = os.urandom(2).hex().upper()
            code = f"{p1}-{p2}-{p3}"
            h = hashlib.sha256(code.encode("utf-8")).hexdigest()
            plain_codes.append(code)
            hashed_codes.append(h)

        return plain_codes, hashed_codes

    def verify_and_consume_backup_code(
        self,
        candidate_code: str,
        stored_hashes: List[str],
    ) -> Tuple[bool, List[str]]:
        if not candidate_code or not stored_hashes:
            return False, list(stored_hashes or [])

        clean = candidate_code.strip().upper()
        cand_hash = hashlib.sha256(clean.encode("utf-8")).hexdigest()

        match_idx = -1
        for idx, h in enumerate(stored_hashes):
            if hmac.compare_digest(h, cand_hash):
                match_idx = idx
                break

        if match_idx == -1:
            return False, list(stored_hashes)

        remaining = list(stored_hashes)
        remaining.pop(match_idx)
        return True, remaining
