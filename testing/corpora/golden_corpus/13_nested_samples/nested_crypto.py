# @ecdat-synthetic-corpus
"""
Golden Corpus Fixture: 13_nested_samples/nested_crypto.py
Category: 13_nested_samples
Demonstrates cryptographic invocations located inside nested language constructs:
- Inner classes and metaclasses
- Deeply nested closures and factory functions
- Decorator definitions wrapping cipher execution
- Generator comprehensions and callback chains
"""

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
import hashlib

class OuterSecuritySubsystem:
    class InnerCryptoEngine:
        class AESContextManager:
            def __init__(self, key: bytes, iv: bytes):
                self.key = key
                self.iv = iv

            def get_cipher(self):
                # Deeply nested AES-256-GCM invocation
                algo = algorithms.AES(self.key)
                mode = modes.GCM(self.iv)
                return Cipher(algo, mode, backend=default_backend())

def crypto_factory_closure(algorithm_type: str):
    """Deep closure factory generating cryptographic handlers."""
    def digest_closure(data: bytes):
        def inner_execution():
            if algorithm_type == "sha384":
                return hashlib.sha384(data).hexdigest()
            elif algorithm_type == "sha512":
                return hashlib.sha512(data).hexdigest()
            return None
        return inner_execution()
    return digest_closure

def cryptographic_decorator(cipher_algo):
    """Decorator encapsulating cipher transformation."""
    def decorator(func):
        def wrapper(*args, **kwargs):
            # ChaCha20-Poly1305 invocation inside decorator
            from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
            cipher = ChaCha20Poly1305(kwargs.get("key", b"0" * 32))
            return func(*args, cipher=cipher, **kwargs)
        return wrapper
    return decorator
