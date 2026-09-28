import os
import pytest
from scanners.sca.sca_engine import SCAEngine

def test_sca_engine_syft_wrapper(tmp_path):
    # Create a mock package.json to test lockfile parsing logic
    package_json = tmp_path / "package.json"
    package_json.write_text('{"name": "test", "dependencies": {"jsonwebtoken": "^9.0.0"}}')
    package_lock = tmp_path / "package-lock.json"
    package_lock.write_text('{"name": "test", "lockfileVersion": 3, "packages": {"node_modules/jsonwebtoken": {"version": "9.0.0"}}}')
    
    engine = SCAEngine()
    
    # Run the wrapper
    sbom = engine.generate_sbom(str(tmp_path))
    
    # Assert Syft parsed the file and we ingested it correctly
    assert sbom is not None
    assert sbom.component_count > 0
    assert any(c.name == "jsonwebtoken" for c in sbom.components)
