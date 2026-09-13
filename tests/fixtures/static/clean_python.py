"""
Clean / Compliant Python Test Fixture for Cryptographic AST Detection (Phase 2.2)
"""

import hashlib
import secrets
import ssl
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import requests
import jwt

def secure_hashes(data):
    return hashlib.sha256(data).hexdigest()

def secure_asymmetric():
    return rsa.generate_private_key(public_exponent=65537, key_size=3072)

def secure_random_token():
    return secrets.token_hex(32)

def secure_aead(key, nonce, data):
    aesgcm = AESGCM(key)
    return aesgcm.encrypt(nonce, data, None)

def secure_network():
    r = requests.get("https://secure.service/api", verify=True)
    ctx = ssl.create_default_context()
    return r, ctx

def secure_jwt(token, pubkey):
    return jwt.decode(token, pubkey, algorithms=["RS256"], options={"verify_signature": True})
