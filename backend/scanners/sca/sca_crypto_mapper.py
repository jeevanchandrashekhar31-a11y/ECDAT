import json
import os
from typing import List, Dict, Any
from dataclasses import dataclass, field
from scanners.sca.sbom_ingestion import NormalizedComponent

@dataclass
class CryptoLibraryCapability:
    component_id: str
    name: str
    version: str
    fips_validated: bool
    pqc_support: bool
    deprecated_algorithms: List[str]
    source_url: str
    is_transitive: bool = False

class CryptoLibraryMapper:
    def __init__(self, rules_path: str = None):
        if rules_path is None:
            rules_path = os.path.join(
                os.path.dirname(__file__), "..", "..", "..", "rules", "crypto_library_capabilities.json"
            )
        self.rules_path = rules_path
        self._load_rules()
        
    def _load_rules(self):
        with open(self.rules_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        self.knowledge_base = {}
        for pkg in data.get("packages", []):
            name = pkg["name"].lower()
            # In a real implementation we would parse the `versions` field properly.
            # For this Phase 3 we will simply map by name.
            self.knowledge_base[name] = pkg
            
    def map_capabilities(self, sbom: NormalizedSbom) -> List[CryptoLibraryCapability]:
        results = []
        
        # In CycloneDX, the root component is usually not listed in dependencies as a target.
        # Direct dependencies are those where 'from' is the root component. 
        # For simplicity in this heuristic, if a component is ONLY ever listed as 'to_ref' and never as 'from_ref' for the root, 
        # or we just rely on a set of direct targets from the root.
        
        # Let's find all 'from' refs to identify the root. The root is typically a component that is in from_ref but never in to_ref.
        all_to_refs = {rel.to_ref for rel in sbom.dependency_relationships}
        root_refs = {rel.from_ref for rel in sbom.dependency_relationships if rel.from_ref not in all_to_refs}
        
        # Direct dependencies are anything pointed to by a root_ref
        direct_deps = {rel.to_ref for rel in sbom.dependency_relationships if rel.from_ref in root_refs}
        
        for comp in sbom.components:
            # Simple matching on name for demonstration. 
            # In real implementations we match on purl or aliases.
            comp_name = comp.name.lower()
            is_transitive = comp.component_id not in direct_deps if sbom.dependency_relationships else False
            
            # Simple heuristic for bouncycastle
            if "bcprov" in comp_name:
                comp_name = "bouncycastle"
                
            if comp_name in self.knowledge_base:
                rule = self.knowledge_base[comp_name]
                caps = rule.get("capabilities", {})
                
                results.append(
                    CryptoLibraryCapability(
                        component_id=comp.component_id,
                        name=comp.name,
                        version=comp.version,
                        fips_validated=caps.get("fips_validated", False),
                        pqc_support=caps.get("pqc_support", False),
                        deprecated_algorithms=caps.get("deprecated_algorithms", []),
                        source_url=rule.get("source_url", ""),
                        is_transitive=is_transitive
                    )
                )
        return results
