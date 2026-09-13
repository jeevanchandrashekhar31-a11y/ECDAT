"""
Vulnerable Python Test Fixture for Cryptographic AST Detection (Phase 2.2)
"""

import hashlib
import hmac
import random
import ssl
from cryptography.hazmat.primitives.asymmetric import rsa, dsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import serialization
from Crypto.Cipher import DES, AES
import requests
import jwt
import boto3

# 1. Hardcoded Private Key & Symmetric Key
HARDCODED_KEY_PEM = """-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y3d8...TEST_DUMMY_KEY_MATERIAL...IDAQABAoIBAQC
-----END RSA PRIVATE KEY-----"""

aes_key = b"0123456789abcdef"

# 2. Weak Hash & HMAC
def compute_hashes(data):
    h1 = hashlib.md5(data).hexdigest()
    h2 = hashlib.sha1(data).hexdigest()
    h3 = hashlib.new("md5")
    h4 = hmac.new(b"secret", data, digestmod="md5")
    return h1, h2, h3, h4

# 3. Weak Asymmetric Key Sizes (via Semantic Constant Resolution)
def generate_weak_keys():
    k_size = 1024
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=k_size)
    dsa_key = dsa.generate_private_key(key_size=1024)
    return rsa_key, dsa_key

# 4. Weak Ciphers and Insecure Modes (TripleDES, DES, ECB)
def run_weak_ciphers(plaintext):
    cipher1 = Cipher(algorithms.TripleDES(b"123456781234567812345678"), modes.ECB())
    cipher2 = DES.new(b"12345678", DES.MODE_ECB)
    return cipher1, cipher2

# 5. Disabled Certificate Validation & Insecure TLS
def insecure_network():
    r = requests.get("https://api.internal/data", verify=False)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return r, ctx

# 6. Insecure Randomness for Security Tokens
def generate_auth_token():
    nonce = random.randint(100000, 999999)
    session_token = random.random()
    return nonce, session_token

# 7. Insecure JWT Verification
def parse_jwt(token):
    payload = jwt.decode(token, verify=False)
    none_payload = jwt.decode(token, algorithms=["none"])
    return payload, none_payload

# 8. Cloud SDK KMS Weak Key
def create_cloud_keys():
    kms = boto3.client("kms")
    return kms.create_key(KeySpec="RSA_1024")

# 9. Unsafe Key Loading
def load_key(data):
    return serialization.load_pem_private_key(data, password=None)
