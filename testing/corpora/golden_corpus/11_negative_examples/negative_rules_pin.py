"""
Category: Negative Examples (Phase 30 Golden Corpus)
Contains ordinary non-cryptographic code that must produce ZERO cryptographic findings.
Specifically tests against potential false positive triggers:
- Variable names with 'key_size', 'buffer_size'
- Plain strings in configuration dictionaries
- Non-cryptographic hash functions
"""


def get_system_configuration():
    """Returns application configuration without cryptographic usage."""
    config = {
        "max_key_size_limit": 4096,
        "default_buffer_size": 1024,
        "backup_chunk_size": 512,
        "service_alias_name": "database_replica_primary",
        "hybrid_mode_flag": False,
        "connection_protocol": "HTTP/1.1",
    }
    return config


class MemoryCacheIndex:
    """Non-cryptographic memory cache with object hashing."""

    def __init__(self, capacity: int = 1000):
        self.capacity = capacity
        self.cache = {}

    def compute_hash_key(self, item: str) -> int:
        return hash(item)
