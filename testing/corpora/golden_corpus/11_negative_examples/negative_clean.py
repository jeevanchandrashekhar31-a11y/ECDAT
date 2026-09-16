"""
Category: Negative Examples (Phase 22.3 Golden Corpus)
Contains ordinary non-cryptographic code that must produce ZERO cryptographic findings.
Specifically tests against common false positive triggers:
- Python built-in hash() object hashing (hash table index, not crypto)
- Variable names containing substrings like 'des', 'md5', 'rsa' (e.g. description, design_factor)
- Strings in comments explaining historical concepts without executing them
- Non-cryptographic pseudo-random number generators used for simulations
- Dictionary keys referencing column names in a database
"""

import math
import random


class GeometryCalculator:
    """Non-cryptographic geometry calculations."""

    def __init__(self, description: str = "Standard 2D Geometry Model"):
        # 'description' contains 'des' substring - MUST NOT trigger DES algorithm finding
        self.description = description
        self.design_factor = 1.618  # contains 'des'
        self.cache = {}

    def compute_object_hash(self, obj: tuple) -> int:
        """Uses Python built-in hash() for in-memory dictionary indexing."""
        # Built-in hash() is NOT cryptographic
        return hash(obj)

    def simulate_monte_carlo(self, iterations: int = 1000) -> float:
        """Standard non-security pseudo-random simulation."""
        inside_circle = 0
        for _ in range(iterations):
            x = random.random()
            y = random.random()
            if x * x + y * y <= 1.0:
                inside_circle += 1
        return (4.0 * inside_circle) / iterations


def process_database_metadata():
    """References legacy column names as pure data strings."""
    schema_mapping = {
        "md5_checksum_column": "file_hash_v1",
        "sha1_digest_column": "file_hash_v2",
        "rsa_key_owner_id": 42,
    }
    return schema_mapping
