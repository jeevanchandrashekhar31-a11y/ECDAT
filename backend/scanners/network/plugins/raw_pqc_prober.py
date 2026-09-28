import socket
import struct
import os
import logging
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)

class PqcGroup(int, Enum):
    # Standard elliptic curves
    X25519 = 0x001D
    SECP256R1 = 0x0017
    SECP384R1 = 0x0018
    # IETF drafts / final standard PQC hybrids
    X25519_MLKEM768 = 0x11EC
    SECP256R1_MLKEM768 = 0x11ED
    SECP384R1_MLKEM1024 = 0x11EE
    # Standalone ML-KEM
    MLKEM768 = 0x11F8
    MLKEM1024 = 0x11F9
    # Legacy Cloudflare draft
    X25519_KYBER768_DRAFT00 = 0x6399

HRR_RANDOM = bytes.fromhex("CF21AD74E59A6111BE1D8C021E65B891C2A211167ABB8C5E079E09E2C8A8339C")

def build_client_hello(group: PqcGroup) -> bytes:
    # 1. Extensions
    # supported_versions (0x002b): TLS 1.3 (0x0304)
    ext_versions = b"\x00\x2b\x00\x03\x02\x03\x04"
    
    # supported_groups (0x000a)
    ext_groups = b"\x00\x0a\x00\x04\x00\x02" + group.value.to_bytes(2, "big")
    
    # key_share (0x0033): empty key share! length 2, val 00 00
    ext_keyshare = b"\x00\x33\x00\x02\x00\x00"
    
    # signature_algorithms (0x000d)
    ext_sig = b"\x00\x0d\x00\x08\x00\x06\x04\x03\x08\x04\x04\x01"
    
    extensions = ext_versions + ext_groups + ext_keyshare + ext_sig
    extensions_len = len(extensions).to_bytes(2, "big")
    
    # 2. Cipher Suites
    ciphers = b"\x13\x01\x13\x02\x13\x03\x00\xff" # AES-128-GCM, AES-256-GCM, CHACHA20, EMPTY_RENEGOTIATION
    ciphers_len = len(ciphers).to_bytes(2, "big")
    
    # 3. ClientHello Payload
    client_version = b"\x03\x03"
    random_bytes = os.urandom(32)
    session_id = b"\x00" # length 0
    compression = b"\x01\x00" # length 1, null compression
    
    payload = client_version + random_bytes + session_id + ciphers_len + ciphers + compression + extensions_len + extensions
    
    # 4. Handshake Header
    msg_type = b"\x01" # ClientHello
    msg_len = len(payload).to_bytes(3, "big")
    handshake = msg_type + msg_len + payload
    
    # 5. Record Header
    rec_type = b"\x16" # Handshake
    rec_version = b"\x03\x01" # TLS 1.0 record version for max compatibility
    rec_len = len(handshake).to_bytes(2, "big")
    
    return rec_type + rec_version + rec_len + handshake

def parse_server_response(data: bytes, group: PqcGroup) -> bool:
    if len(data) < 5:
        return False
    
    rec_type = data[0]
    if rec_type == 0x15: # Alert
        return False
        
    if rec_type != 0x16: # Handshake
        return False
        
    rec_len = int.from_bytes(data[3:5], "big")
    if len(data) < 5 + rec_len:
        return False # Truncated
        
    handshake = data[5:5+rec_len]
    if len(handshake) < 4:
        return False
        
    msg_type = handshake[0]
    if msg_type != 0x02: # Not ServerHello
        return False
        
    if len(handshake) < 38:
        return False
        
    # Check ServerHello random
    random_bytes = handshake[6:38]
    if random_bytes == HRR_RANDOM:
        return True # HelloRetryRequest means the group is supported
        
    # If it's a native ServerHello (e.g. they somehow accepted an empty key share, or we parse extensions)
    # Technically if it's a ServerHello without HRR, and they didn't send an Alert, they might have picked our group
    # Let's search for the key_share extension in the ServerHello.
    # We will do a simple byte scan for the key_share extension (0x0033) followed by our group ID.
    group_bytes = group.value.to_bytes(2, "big")
    ext_header = b"\x00\x33"
    
    # Search for ext_header... this is hacky but effective for raw probing without a full ASN.1/TLS parser
    idx = handshake.find(ext_header)
    if idx != -1 and len(handshake) >= idx + 8:
        ext_len = int.from_bytes(handshake[idx+2:idx+4], "big")
        if ext_len >= 2:
            returned_group = handshake[idx+4:idx+6]
            if returned_group == group_bytes:
                return True
                
    return False

def probe_tls13_group(ip: str, port: int, group: PqcGroup, timeout: float = 2.0) -> bool:
    hello_bytes = build_client_hello(group)
    
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((ip, port))
        sock.sendall(hello_bytes)
        
        # Read response
        data = sock.recv(4096)
        sock.close()
        
        if not data:
            return False
            
        return parse_server_response(data, group)
    except Exception as e:
        logger.debug(f"PQC probe for {group.name} on {ip}:{port} failed: {e}")
        return False
