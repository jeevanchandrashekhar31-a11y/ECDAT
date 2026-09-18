# @ecdat-synthetic-corpus
"""
Golden Corpus Fixture: 16_false_positives_and_negatives/false_negative_evasions.py
Category: 16_false_positives_and_negatives
Positive Fixture (evaluates scanner detection boundaries & known limitations)
Demonstrates indirect dispatch and dynamic mapping of cryptographic primitives:
- Function pointer tables: dispatch_table = {"h1": hashlib.sha256}
- Dynamic string lookup: hashlib.new("sha256")
- Wrapped cipher instantiation via helper function
"""

import hashlib

def dispatch_crypto_by_mode(mode: str, data: bytes):
    # Dynamic algorithm lookup via hashlib.new
    if mode == "fast":
        hasher = hashlib.new("sha256")
        hasher.update(data)
        return hasher.hexdigest()
    return None

class CryptoDispatchTable:
    def __init__(self):
        # Indirect dictionary dispatch table
        self.handlers = {
            "secure_digest": hashlib.sha512,
            "intermediate_digest": hashlib.sha384,
        }

    def execute_digest(self, tag: str, payload: bytes):
        handler = self.handlers.get(tag)
        if handler:
            return handler(payload).hexdigest()
        return None
