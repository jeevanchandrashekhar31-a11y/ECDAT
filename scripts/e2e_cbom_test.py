import sys
import os
import json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from scanners.filesystem.filesystem_scanner import FilesystemScanner
from scanners.filesystem.models import FilesystemAssetType
from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property
from cyclonedx.validation.json import JsonValidator
from cyclonedx.schema import SchemaVersion
from scanners.cbom_mapping import serialize_cbom, validate_cbom_json

def main():
    scanner = FilesystemScanner(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'benchmarks', 'config_golden_corpus')))
    result = scanner.scan()
    print(f"Scanned {len(result.assets)} config assets.")
    
    bom = Bom()
    
    for idx, asset in enumerate(result.assets):
        comp = Component(
            type=ComponentType.APPLICATION,
            name=f"Config-{idx}",
            bom_ref=asset.asset_id or f"cfg-{idx}",
        )
        comp.properties.add(Property(name="ecdat:file_path", value=asset.file_path))
        if asset.asset_type == FilesystemAssetType.CRYPTO_CONFIG:
            comp.properties.add(Property(name="ecdat:asset_type", value="CRYPTO_CONFIG"))
            
        if asset.metadata and "config_settings" in asset.metadata:
            for k, v in asset.metadata["config_settings"].items():
                comp.properties.add(Property(name=f"ecdat:setting:{k}", value=v))
                
        bom.components.add(comp)
        
    serialized = serialize_cbom(bom, spec_version="1.7")
    
    validator = JsonValidator(SchemaVersion.V1_7)
    err = validator.validate_str(serialized)
    if err:
        print("CBOM Validation failed:", err)
        sys.exit(1)
        
    print("CBOM Validates correctly against CycloneDX 1.7 schema!")
    
    with open("e2e_config_cbom.json", "w") as f:
        f.write(serialized)
    print("Wrote CBOM to e2e_config_cbom.json")

if __name__ == "__main__":
    main()
