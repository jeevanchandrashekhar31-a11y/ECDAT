import argparse
import sys
import json
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="ECDAT CBOM Merger (Phase 1)")
    parser.add_argument("cboms", nargs="+", help="Paths to CBOM JSON files to merge")
    parser.add_argument("--out-json", default="merged_cbom.json", help="Output merged JSON file")
    args = parser.parse_args()

    # Phase 1: Simple dictionary-based merge to ensure uniqueness of bom-refs.
    merged = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": [],
        "dependencies": []
    }
    
    seen_refs = set()
    
    for cbom_path in args.cboms:
        path = Path(cbom_path)
        if not path.exists():
            print(f"Warning: {path} not found.", file=sys.stderr)
            continue
            
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for comp in data.get("components", []):
                ref = comp.get("bom-ref")
                if ref and ref not in seen_refs:
                    merged["components"].append(comp)
                    seen_refs.add(ref)
            
            for dep in data.get("dependencies", []):
                merged["dependencies"].append(dep)
                
        except Exception as e:
            print(f"Error reading {path}: {e}", file=sys.stderr)

    Path(args.out_json).write_text(json.dumps(merged, indent=2), encoding="utf-8")
    print(f"Merged {len(args.cboms)} CBOMs into {args.out_json}")
    
if __name__ == "__main__":
    main()
