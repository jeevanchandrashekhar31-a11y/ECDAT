import json
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.scanners.migration_planner import (
    AssetClassification, MoscaResult, generate_roadmap
)

def load_cbom_and_generate(cbom_path):
    with open(cbom_path, "r") as f:
        cbom = json.load(f)
        
    classifications = []
    components = cbom.get("components", [])
    total_assets = len(components)
    
    for c in components:
        # Extract properties
        props = {p.get("name"): p.get("value") for p in c.get("properties", [])}
        
        algo = props.get("ecdat:algorithm", "UNKNOWN")
        if algo == "UNKNOWN":
            continue
            
        evidence = c.get("evidence", {})
        occurrences = evidence.get("occurrences", [])
        
        if not occurrences:
            continue
            
        occurrences_by_context = {}
        guarded_occurrences = 0
        sample_locations = []
        
        for occ in occurrences:
            loc = occ.get("location")
            if loc:
                file_path = loc.split(":")[0] if ":" in loc else loc
                if "test" in file_path.lower():
                    occurrences_by_context["test"] = occurrences_by_context.get("test", 0) + 1
                else:
                    occurrences_by_context["production"] = occurrences_by_context.get("production", 0) + 1
                sample_locations.append(f"{loc}:{occ.get('line')}")
        
        file_count = len(set(loc.split(":")[0] for loc in sample_locations if ":" in loc))
        
        # Pull MOSCA (or mock if not in CBOM directly)
        mosca_status = props.get("ecdat:mosca_status", "UNKNOWN")
        mosca_margin = float(props.get("ecdat:mosca_margin_years", 0.0))
        mosca_vuln = mosca_status in ["AT_RISK", "CRITICAL"]
        mosca_res = MoscaResult(margin_years=mosca_margin, quantum_vulnerable=mosca_vuln, status=mosca_status)
        
        # Classification
        classification = AssetClassification(
            id=c.get("bom-ref", "ref"),
            algorithm=algo,
            total_occurrences=len(occurrences),
            file_count=file_count,
            occurrences_by_context=occurrences_by_context,
            guarded_occurrences=guarded_occurrences,
            reachable_by_default=True,
            reachable_rationale="no build configuration found; assuming reachable (unverified)",
            is_library=True,
            public_api_surface=True,
            downstream_consumer_count=None,
            base_severity=props.get("severity", "high").lower(),
            confidence_level=props.get("confidence", "high").lower(),
            mosca=mosca_res,
            sample_locations=sample_locations,
            single_call_site_wraps_all_uses=False,
            data_sensitivity="unknown"
        )
        
        classifications.append(classification)
        
    # Group by algorithm for simplicity in this run, just aggregating the stats to generate 1 entry per algo
    # In reality the components *are* the assets.
    
    # We will pick one classification per requested algorithm for demonstration
    algorithms_of_interest = ["DES", "MD5", "RSA", "ECDH", "RC4"]
    filtered_classifications = []
    seen_algos = set()
    for c in classifications:
        if c.algorithm in algorithms_of_interest and c.algorithm not in seen_algos:
            filtered_classifications.append(c)
            seen_algos.add(c.algorithm)
            
    roadmap = generate_roadmap(filtered_classifications, total_assets)
    
    print(json.dumps(roadmap, indent=2))
    
if __name__ == "__main__":
    if os.path.exists("final_cbom.json"):
        load_cbom_and_generate("final_cbom.json")
    else:
        print("final_cbom.json not found")
