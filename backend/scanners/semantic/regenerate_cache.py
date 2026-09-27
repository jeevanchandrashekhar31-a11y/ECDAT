import os
import glob
import argparse
from semantic_discovery import SemanticDiscoveryEngine

def main():
    parser = argparse.ArgumentParser(description="Regenerate semantic analysis cache.")
    parser.add_argument("--demo-dataset", action="store_true", help="Run against demo dataset")
    args = parser.parse_args()
    
    # We force live execution so it actually calls the LLM and writes the cache
    os.environ["ECDAT_FORCE_LIVE_SEMANTIC"] = "1"
    
    if args.demo_dataset:
        dataset_dir = os.path.join(os.path.dirname(__file__), "..", "..", "examples", "real_target")
    else:
        dataset_dir = os.getcwd()
        
    engine = SemanticDiscoveryEngine()
    
    files = []
    # Collect some common source extensions
    for ext in ("*.c", "*.h", "*.py", "*.js", "*.ts", "*.java"):
        files.extend(glob.glob(os.path.join(dataset_dir, "**", ext), recursive=True))
        
    print(f"Regenerating cache for {len(files)} files in {dataset_dir}...")
    
    processed_count = 0
    for file_path in files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                source_code = f.read()
            # This triggers pre_filter and analyze_block, the latter will cache results
            findings = engine.run_scan(file_path, source_code)
            if findings:
                processed_count += 1
                print(f"Processed and cached {len(findings)} blocks in {file_path}")
        except Exception as e:
            # ignore parse errors or encoding issues on random files
            pass

    print(f"Cache regeneration complete. Processed {processed_count} files with crypto findings.")
    
if __name__ == "__main__":
    main()
