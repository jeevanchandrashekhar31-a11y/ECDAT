"""
Category: Wrapper APIs (Phase 22.3 Golden Corpus)
Contains custom enterprise wrapper libraries and abstraction facades
delegating to underlying cryptographic libraries.
"""

import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class EnterpriseCryptoFacade:
    """Internal enterprise wrapper hiding direct crypto calls."""

    def __init__(self, key: bytes):
        # Wraps AESGCM 256-bit
        self._engine = AESGCM(key)
        self._default_hash = "sha256"

    def secure_storage_encrypt(self, record_payload: bytes, nonce: bytes) -> bytes:
        """Custom wrapper method delegating to AES-GCM."""
        return self._engine.encrypt(nonce, record_payload, None)

    def compute_integrity_checksum(self, buffer_data: bytes) -> str:
        """Custom wrapper method delegating to hashlib.sha256."""
        return hashlib.sha256(buffer_data).hexdigest()

    def generate_token_digest(self, token_str: str) -> str:
        """Custom wrapper method delegating to hashlib.sha384."""
        return hashlib.sha384(token_str.encode("utf-8")).hexdigest()
