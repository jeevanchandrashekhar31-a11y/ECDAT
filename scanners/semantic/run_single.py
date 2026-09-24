import os
import sys
import json
from semantic_discovery import SemanticDiscoveryEngine

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing file path argument"}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    os.environ["ECDAT_FORCE_LIVE_SEMANTIC"] = "1"
    engine = SemanticDiscoveryEngine()
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            source_code = f.read()
            
        findings = engine.run_scan(file_path, source_code)
        print(json.dumps({"findings": findings}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
        
if __name__ == "__main__":
    main()
