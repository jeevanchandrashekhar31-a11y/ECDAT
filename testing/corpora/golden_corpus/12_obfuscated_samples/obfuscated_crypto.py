# @ecdat-synthetic-corpus
"""
Golden Corpus Fixture: 12_obfuscated_samples/obfuscated_crypto.py
Category: 12_obfuscated_samples
Demonstrates obfuscated, dynamic, and indirect cryptographic invocations:
- String concatenation of algorithm names: "m" + "d5" -> MD5
- Base64 encoded algorithm identifiers: "REVTLUVDQg==" -> DES-ECB
- Dynamic getattr lookup: getattr(hashlib, "s" + "ha1")
- Character code reconstruction: String from ASCII codes
"""

import base64
import hashlib

# 1. String concatenation of weak hash algorithm
def dynamic_weak_hash(data: bytes):
    algo_name = "m" + "d5"
    h = getattr(hashlib, algo_name)()
    h.update(data)
    return h.hexdigest()

# 2. Obfuscated SHA-1 via getattr
def get_sha1_hasher():
    part1 = "sha"
    part2 = "1"
    return getattr(hashlib, part1 + part2)()

# 3. Base64 decoded cipher algorithm string
def get_legacy_cipher():
    # Base64 for "DES"
    encoded_algo = b"REVTCg=="
    decoded = base64.b64decode(encoded_algo).decode().strip()
    return f"ciphers.algorithms.{decoded}"

# 4. Character code array reconstruction
def reconstruct_cipher():
    # ASCII codes for: R, C, 4
    chars = [82, 67, 52]
    algo = "".join(chr(c) for c in chars)
    return algo
