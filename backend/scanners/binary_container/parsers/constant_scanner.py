import struct
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

@dataclass
class CustomCryptoImplementation:
    algorithm: str
    primitive: str
    confidence: str
    offsets: List[int]
    evidence_type: str  # "constants", "magic_strings", "asn1_oid"

# Let's use simple byte searches for constants.
CRYPTO_CONSTANTS = {
    "AES_SBOX": b"\x63\x7c\x77\x7b\xf2\x6b\x6f\xc5\x30\x01\x67\x2b\xfe\xd7\xab\x76", # First 16 bytes of S-box
    "AES_INV_SBOX": b"\x52\x09\x6a\xd5\x30\x36\xa5\x38\xbf\x40\xa3\x9e\x81\xf3\xd7\xfb", # First 16 bytes of inverse S-box
    "SHA256_K": b"\x42\x8a\x2f\x98\x71\x37\x44\x91\xb5\xc0\xfb\xcf\xe9\xb5\xdb\xa5", # First 16 bytes (little-endian: 98 2f 8a 42 91 44 37 71 ...) or big-endian
    "SHA512_K": b"\x42\x8a\x2f\x98\xd7\x28\xae\x22\x71\x37\x44\x91\x23\xef\x65\xcd", # First 16 bytes
    "CHACHA20_MAGIC": b"expand 32-byte k", # 16 bytes
    "CURVE25519_PRIME": b"\xed\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\x7f", # 2^255 - 19 in little-endian
    "P256_PRIME": b"\xff\xff\xff\xff\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff", # 2^256 - 2^224 + 2^192 + 2^96 - 1
    # Add MD5, Keccak, ML-KEM NTT zetas, RSA/ECDSA OIDs
}

# Add both little-endian and big-endian variants for 32-bit/64-bit constants
SHA256_K_LE = struct.pack("<4I", 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5)
SHA256_K_BE = struct.pack(">4I", 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5)

def scan_constants(file_path: str, max_bytes: int = 100 * 1024 * 1024) -> List[CustomCryptoImplementation]:
    results = []
    
    patterns = {
        "AES S-box": {"algo": "AES", "type": "S-box", "bytes": CRYPTO_CONSTANTS["AES_SBOX"]},
        "AES Inverse S-box": {"algo": "AES", "type": "Inverse S-box", "bytes": CRYPTO_CONSTANTS["AES_INV_SBOX"]},
        "ChaCha20 Magic": {"algo": "ChaCha20", "type": "Magic String", "bytes": CRYPTO_CONSTANTS["CHACHA20_MAGIC"]},
        "SHA256 K (LE)": {"algo": "SHA-256", "type": "K Constants", "bytes": SHA256_K_LE},
        "SHA256 K (BE)": {"algo": "SHA-256", "type": "K Constants", "bytes": SHA256_K_BE},
        "Curve25519 Prime": {"algo": "Curve25519", "type": "Prime", "bytes": CRYPTO_CONSTANTS["CURVE25519_PRIME"]},
        "P-256 Prime": {"algo": "P-256", "type": "Prime", "bytes": CRYPTO_CONSTANTS["P256_PRIME"]},
        # Add RSA/ECDSA OIDs
        "RSA OID": {"algo": "RSA", "type": "ASN.1 OID", "bytes": b"\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01"},
        "ECDSA OID": {"algo": "ECDSA", "type": "ASN.1 OID", "bytes": b"\x2a\x86\x48\xce\x3d\x02\x01"},
        "ML-KEM 768 OID": {"algo": "ML-KEM", "type": "ASN.1 OID", "bytes": b"\x60\x86\x48\x01\x65\x03\x04\x03\x12"}, # Assuming standard OID
    }
    
    try:
        with open(file_path, 'rb') as f:
            data = f.read(max_bytes)
            
            for name, p in patterns.items():
                offset = data.find(p["bytes"])
                if offset != -1:
                    offsets = []
                    # find all occurrences
                    idx = offset
                    while idx != -1:
                        offsets.append(idx)
                        idx = data.find(p["bytes"], idx + 1)
                        if len(offsets) > 10: # Cap at 10 to avoid giant arrays
                            break
                            
                    # Fix thresholds: require at least 2 occurrences for constants, unless it's an OID.
                    if "OID" not in p["type"] and len(offsets) < 2:
                        continue
                        
                    results.append(CustomCryptoImplementation(
                        algorithm=p["algo"],
                        primitive=p["type"],
                        confidence="high" if len(p["bytes"]) >= 16 and (len(offsets) >= 2 or "OID" in p["type"]) else "medium",
                        offsets=offsets,
                        evidence_type="constants" if "OID" not in p["type"] else "asn1_oid"
                    ))
    except Exception as e:
        pass
        
    return results
