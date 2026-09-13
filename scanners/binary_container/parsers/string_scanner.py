"""
ECDAT Binary String Scanner — Safe, Bounded Extraction of Crypto Strings
"""

import math
import re
from typing import List, Set, Tuple


CRYPTO_STRING_PATTERNS = [
    # Algorithms
    r"\b(?:AES(?:-128|-192|-256)?(?:-CBC|-GCM|-CTR|-ECB|-CFB|-OFB)?)\b",
    r"\b(?:RSA(?:-1024|-2048|-3072|-4096)?)\b",
    r"\b(?:ECDSA|ECDH|Ed25519|Ed448|X25519|X448)\b",
    r"\b(?:SHA(?:-?1|-?224|-?256|-?384|-?512|-?3(?:-224|-256|-384|-512)?))\b",
    r"\b(?:ChaCha20(?:-Poly1305)?|Poly1305|HMAC(?:-SHA256|-SHA512|-SHA1)?)\b",
    r"\b(?:Kyber(?:512|768|1024)?|ML-KEM(?:-512|-768|-1024)?|Dilithium|ML-DSA|Falcon|SPHINCS\+?)\b",
    r"\b(?:DES|3DES|TripleDES|RC4|Blowfish|Twofish)\b",
    r"\b(?:PBKDF2|bcrypt|scrypt|argon2(?:id|i|d)?)\b",
    # TLS & Protocol
    r"\b(?:TLSv1(?:\.[0-3])?|SSLv[23])\b",
    # Curves
    r"\b(?:secp256r1|secp384r1|secp521r1|secp256k1|prime256v1|curve25519)\b",
    # PEM Headers
    r"-----BEGIN (?:[A-Z0-9 ]+ )?(?:CERTIFICATE|PUBLIC KEY|PRIVATE KEY|ENCRYPTED PRIVATE KEY|X509 CRL)-----",
    # Crypto Library Banners
    r"(?:OpenSSL|BoringSSL|LibreSSL|mbedTLS|wolfSSL|libsodium|Botan|CommonCrypto)\s*[0-9]+(?:\.[0-9]+)*",
]

COMPILED_CRYPTO_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CRYPTO_STRING_PATTERNS]


def calculate_entropy(data: bytes) -> float:
    """Calculates Shannon entropy of a byte chunk (0.0 to 8.0)."""
    if not data:
        return 0.0
    freq = [0] * 256
    for b in data:
        freq[b] += 1
    entropy = 0.0
    data_len = len(data)
    for count in freq:
        if count > 0:
            p = count / data_len
            entropy -= p * math.log2(p)
    return entropy


def extract_bounded_strings(
    data: bytes,
    max_bytes: int = 10 * 1024 * 1024,
    max_strings: int = 5000,
    min_length: int = 4,
) -> Tuple[List[str], List[str]]:
    """
    Safely extracts ASCII and UTF-16LE printable strings within hard byte and count bounds.
    
    Returns:
        (all_extracted_strings, crypto_filtered_strings)
    """
    scan_chunk = data[:max_bytes] if len(data) > max_bytes else data
    extracted: List[str] = []
    seen: Set[str] = set()

    # 1. Extract ASCII strings
    ascii_pattern = re.compile(rb"[\x20-\x7e]{" + str(min_length).encode() + rb",}")
    for match in ascii_pattern.finditer(scan_chunk):
        if len(extracted) >= max_strings:
            break
        s = match.group().decode("ascii", errors="ignore").strip()
        if s and s not in seen:
            seen.add(s)
            extracted.append(s)

    # 2. Extract UTF-16LE strings if string quota remains
    if len(extracted) < max_strings:
        utf16_pattern = re.compile(rb"(?:[\x20-\x7e]\x00){" + str(min_length).encode() + rb",}")
        for match in utf16_pattern.finditer(scan_chunk):
            if len(extracted) >= max_strings:
                break
            try:
                s = match.group().decode("utf-16le", errors="ignore").strip()
                if s and s not in seen:
                    seen.add(s)
                    extracted.append(s)
            except Exception:
                continue

    # 3. Filter for crypto-relevant strings
    crypto_strings: List[str] = []
    for s in extracted:
        for pat in COMPILED_CRYPTO_PATTERNS:
            if pat.search(s):
                crypto_strings.append(s)
                break

    return extracted, crypto_strings
