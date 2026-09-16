"""
Category: Weak Algorithms (Phase 22.3 Golden Corpus)
Contains deprecated and cryptographically broken algorithms:
- MD5 (Collision vulnerable digest)
- SHA-1 (Theoretical & practical collision vulnerable)
- DES (Small 56-bit key space)
- 3DES / Triple-DES (Sweet32 64-bit block collision)
- RC4 / ARC4 (Biased keystream stream cipher)
- Blowfish (64-bit block cipher)
- AES in ECB mode (Pattern leakage due to deterministic block ciphering)
"""

import hashlib
from Crypto.Cipher import DES, DES3, ARC4, Blowfish, AES


def insecure_hashing(data: bytes):
    """Computes MD5 and SHA-1 hashes."""
    md5_hash = hashlib.md5(data).hexdigest()
    sha1_hash = hashlib.sha1(data).hexdigest()
    return md5_hash, sha1_hash


def insecure_ciphers(plaintext: bytes):
    """Demonstrates legacy broken symmetric ciphers."""
    # DES (56-bit key)
    des_cipher = DES.new(b"12345678", DES.MODE_ECB)
    des_out = des_cipher.encrypt(plaintext[:8])

    # 3DES / Triple-DES
    des3_cipher = DES3.new(b"1234567812345678", DES3.MODE_CBC, iv=b"12345678")
    des3_out = des3_cipher.encrypt(plaintext[:8])

    # RC4
    rc4_cipher = ARC4.new(b"rc4_secret_key")
    rc4_out = rc4_cipher.encrypt(plaintext)

    # Blowfish
    bf_cipher = Blowfish.new(b"blowfish_key", Blowfish.MODE_ECB)
    bf_out = bf_cipher.encrypt(plaintext[:8])

    # AES in ECB Mode (Insecure block mode)
    ecb_cipher = AES.new(b"0123456789abcdef0123456789abcdef", AES.MODE_ECB)
    ecb_out = ecb_cipher.encrypt(plaintext[:16])

    return des_out, des3_out, rc4_out, bf_out, ecb_out
