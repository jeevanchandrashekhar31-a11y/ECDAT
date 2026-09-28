import json
import subprocess
import tempfile
import os
from typing import Optional
from scanners.sca.sbom_ingestion import ingest_sbom, NormalizedSbom

class SCAEngine:
    def __init__(self):
        pass
        
    def generate_sbom(self, target_dir: str) -> Optional[NormalizedSbom]:
        """
        Runs syft on the target directory and parses the output as a NormalizedSbom.
        """
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp_file:
            tmp_path = tmp_file.name
            
        try:
            # Run syft and output as cyclonedx-json
            cmd = ["syft", "scan", f"dir:{target_dir}", "-o", f"cyclonedx-json={tmp_path}"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            
            if result.returncode != 0:
                print(f"Syft error: {result.stderr}")
                return None
                
            with open(tmp_path, "r", encoding="utf-8") as f:
                content = json.load(f)
                
            return ingest_sbom(content)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
