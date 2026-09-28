import json
import os
import pytest

def test_crypto_library_capabilities_has_citations():
    rules_dir = os.path.join(os.path.dirname(__file__), "..", "..", "rules")
    filepath = os.path.join(rules_dir, "crypto_library_capabilities.json")
    
    assert os.path.exists(filepath), f"{filepath} does not exist"
    
    with open(filepath, "r") as f:
        data = json.load(f)
        
    assert "packages" in data
    for pkg in data["packages"]:
        name = pkg.get("name", "Unknown")
        assert "source_url" in pkg, f"Package {name} is missing a source_url citation"
        assert pkg["source_url"].strip() != "", f"Package {name} has an empty source_url citation"
