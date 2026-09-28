import json
import os
import tempfile
from typing import List, Dict, Any, Optional

from scanners.binary_container.parsers.worker_pool import WorkerIsolatedBinaryAnalyzer
from scanners.common.archive_guard import ArchiveSecurityGuard

class ContainerScanner:
    def __init__(self):
        self.analyzer = WorkerIsolatedBinaryAnalyzer()
        
    def scan_image_tarball(self, tar_path: str) -> Dict[str, Any]:
        """
        Scans an OCI/Docker image tarball layer by layer without executing it.
        Uses ArchiveSecurityGuard to protect against path traversal and decomp bombs.
        """
        results = {
            "image": os.path.basename(tar_path),
            "layers": [],
            "package_manager_findings": []
        }
        
        # We need allow_nested=True for the root tar because it contains layer.tar files
        guard = ArchiveSecurityGuard(allow_nested=True)
        
        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                guard.extract(tar_path, temp_dir)
            except Exception as e:
                import logging
                logging.warning(f"Failed to safely extract image tarball {tar_path}: {e}")
                return results
                
            manifest_path = os.path.join(temp_dir, 'manifest.json')
            if not os.path.exists(manifest_path):
                return results
                
            try:
                with open(manifest_path, 'r') as f:
                    manifest = json.load(f)
            except Exception:
                return results
                
            if not manifest:
                return results
                
            layers = manifest[0].get('Layers', [])
            
            for layer_path in layers:
                full_layer_path = os.path.join(temp_dir, os.path.normpath(layer_path))
                if not os.path.exists(full_layer_path):
                    continue
                    
                layer_results = self._scan_layer(full_layer_path)
                results["layers"].append({
                    "layer_digest": layer_path.replace('/layer.tar', '').replace('.tar', ''),
                    "findings": layer_results
                })
                
        return results

    def _scan_layer(self, layer_tar_path: str) -> List[Dict[str, Any]]:
        findings = []
        guard = ArchiveSecurityGuard(allow_nested=False) # The layer itself shouldn't necessarily have nested containers
        
        with tempfile.TemporaryDirectory() as layer_temp_dir:
            try:
                guard.extract(layer_tar_path, layer_temp_dir)
            except Exception as e:
                import logging
                logging.warning(f"Layer extraction failed securely: {e}")
                return findings
                
            # Scan files in the extracted layer
            for root, _, files in os.walk(layer_temp_dir):
                for file_name in files:
                    file_path = os.path.join(root, file_name)
                    rel_path = os.path.relpath(file_path, layer_temp_dir)
                    
                    if rel_path == os.path.normpath('var/lib/dpkg/status'):
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                findings.append({"type": "dpkg_status", "content_preview": f.read(200)})
                        except Exception:
                            pass
                            
                    elif rel_path == os.path.normpath('lib/apk/db/installed'):
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                findings.append({"type": "apk_installed", "content_preview": f.read(200)})
                        except Exception:
                            pass
                            
                    elif rel_path.startswith('bin' + os.sep) or rel_path.startswith('usr' + os.sep + 'bin' + os.sep) or rel_path.startswith('usr' + os.sep + 'lib' + os.sep) or rel_path.endswith('.so'):
                        # Stub for real binary scanning
                        pass
                        
        return findings
