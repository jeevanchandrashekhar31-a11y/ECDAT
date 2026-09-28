import json
import re
from typing import Optional, Dict, Any

from scanners.binary_container.parsers.base import LanguageMetadataInfo

def parse_language_metadata(file_path: str, data: bytes) -> Optional[LanguageMetadataInfo]:
    """
    Safely extract language metadata from binary/archive files without executing them.
    Supports:
    - Go: Buildinfo scanning (extracts modules and versions)
    - Rust: Cargo auditable scanning (decompresses zlib payload)
    - Java: MANIFEST.MF inside JAR and constant pool heuristics
    Skipped:
    - .NET and Python wheels are skipped for now per requirements.
    """
    
    # Check for Go buildinfo
    if b"\xff Go buildinf:" in data:
        version_match = re.search(rb"go1\.[0-9]+(?:\.[0-9]+)?", data)
        version = version_match.group().decode('ascii') if version_match else "unknown"
        
        # Simple extraction of module paths (Go mod paths typically follow standard patterns)
        dependencies = {}
        # In a real scanner, we parse the varint pointers. For now, regex fallback
        mod_matches = re.findall(rb"(github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)\s+(v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9_.-]+)?)", data)
        for mod, ver in set(mod_matches):
            dependencies[mod.decode('ascii')] = ver.decode('ascii')
            
        return LanguageMetadataInfo(
            language="Go",
            version=version,
            dependencies=dependencies
        )
        
    # Check for Rust cargo auditable
    # Cargo-auditable embeds zlib-compressed JSON starting with specific headers
    rust_idx = data.find(b"CARGO_AUDIT_INFO")
    if rust_idx == -1:
        rust_idx = data.find(b".cargo-auditable")
        
    if rust_idx != -1:
        dependencies = {}
        try:
            import zlib
            # Naive brute-force scan for zlib streams in the vicinity (78 9c or 78 5e)
            for i in range(max(0, rust_idx - 1024), min(len(data) - 2, rust_idx + 4096)):
                if data[i:i+2] in (b'\x78\x9c', b'\x78\x5e', b'\x78\x01'):
                    try:
                        decomp = zlib.decompress(data[i:])
                        audit_data = json.loads(decomp.decode('utf-8'))
                        # audit_data is {"packages": [{"name": "...", "version": "..."}, ...]}
                        for pkg in audit_data.get('packages', []):
                            if 'name' in pkg and 'version' in pkg:
                                dependencies[pkg['name']] = pkg['version']
                        break
                    except Exception:
                        continue
        except Exception:
            pass
            
        return LanguageMetadataInfo(
            language="Rust",
            version=None,
            dependencies=dependencies
        )
        
    # Check for Java JAR/class
    if file_path.endswith('.jar') or file_path.endswith('.war'):
        try:
            import zipfile
            with zipfile.ZipFile(file_path, 'r') as z:
                manifest_content = ""
                if 'META-INF/MANIFEST.MF' in z.namelist():
                    manifest_content = z.read('META-INF/MANIFEST.MF').decode('utf-8', errors='ignore')
                
                # Scan for BouncyCastle / SunJCE / Conscrypt
                providers = []
                if 'BouncyCastle' in manifest_content or 'org.bouncycastle' in manifest_content:
                    providers.append("BouncyCastle")
                if 'org.conscrypt' in manifest_content:
                    providers.append("Conscrypt")
                
                # In real scenario we parse constant pools (.class) here for more deep inspection.
                # E.g. looking for 'javax/crypto/Cipher'
                for info in z.infolist():
                    if info.filename.endswith('.class') and info.file_size < 100000:
                        class_data = z.read(info)
                        if b'javax/crypto/Cipher' in class_data:
                            if "JCE" not in providers:
                                providers.append("JCE")
                                
                return LanguageMetadataInfo(
                    language="Java",
                    version=None,
                    dependencies={},
                    crypto_providers=providers
                )
        except Exception:
            pass
            
    # Check for Node package.json
    if file_path.endswith('package.json'):
        try:
            with open(file_path, 'r') as f:
                pkg = json.load(f)
                return LanguageMetadataInfo(
                    language="Node",
                    version=pkg.get('version', 'unknown'),
                    dependencies=pkg.get('dependencies', {})
                )
        except Exception:
            pass
            
    return None
