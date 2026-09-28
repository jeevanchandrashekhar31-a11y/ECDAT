import os
import pytest

def test_no_duplicate_scanners_directory():
    """
    Ensure that backend/scanners/scanners duplicate tree does not exist.
    """
    duplicate_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", "scanners", "scanners")
    assert not os.path.exists(duplicate_path), f"Duplicate tree found at {duplicate_path}! Please keep only one source of truth at backend/scanners/."
