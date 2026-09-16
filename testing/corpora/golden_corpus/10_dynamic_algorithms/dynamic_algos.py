"""
Category: Dynamically Selected Algorithms (Phase 22.3 Golden Corpus)
Contains algorithms selected at runtime via variables, configs, environment variables,
or string concatenation rather than direct compile-time constants.
"""

import os
import hashlib


def compute_dynamic_hash(data: bytes, custom_algo: str = None) -> str:
    """Algorithm selected from environment variable or argument."""
    # 1. Environment variable resolution
    algo_name = custom_algo or os.getenv("APPLICATION_HASH_ALGO", "sha256")

    # Dynamic dispatch via hashlib.new()
    hasher = hashlib.new(algo_name)
    hasher.update(data)
    return hasher.hexdigest()


def dispatch_by_security_level(data: bytes, level: str) -> str:
    """Algorithm chosen via table lookup."""
    algo_dispatch = {
        "fast": "md5",
        "medium": "sha1",
        "high": "sha256",
        "maximum": "sha512",
    }
    selected = algo_dispatch.get(level, "sha256")
    return hashlib.new(selected, data).hexdigest()


def compute_concatenated_algo(data: bytes) -> str:
    """Algorithm name built dynamically via string concatenation."""
    prefix = "sha"
    suffix = "512"
    full_name = prefix + suffix
    return hashlib.new(full_name, data).hexdigest()
