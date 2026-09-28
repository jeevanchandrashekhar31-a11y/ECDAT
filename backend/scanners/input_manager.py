import os
import shutil
import tempfile
import urllib.parse
from pathlib import Path
from typing import Optional

class InputManager:
    """Manages inputs for the scanner: local, zip/tar, git."""
    def __init__(self, max_size_bytes=1024*1024*500, max_depth=1):
        self.max_size_bytes = max_size_bytes
        self.max_depth = max_depth
        self.temp_dirs = []

    def fetch(self, target: str) -> str:
        """Returns a local directory path to scan."""
        if target.startswith("http://") or target.startswith("https://"):
            return self._fetch_git(target)
        if target.endswith(".zip") or target.endswith(".tar") or target.endswith(".tar.gz"):
            return self._fetch_archive(target)
        
        path = Path(target)
        if path.is_dir() or path.is_file():
            return str(path.absolute())
            
        raise ValueError(f"Unknown input target format: {target}")

    def _fetch_git(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ["http", "https"]:
            raise ValueError("Only http/https git URLs allowed")
            
        # Basic SSRF validation (prevent localhost/internal IP cloning)
        hostname = parsed.hostname or ""
        if hostname in ["localhost", "127.0.0.1", "0.0.0.0"] or hostname.startswith("10.") or hostname.startswith("192.168."):
            raise ValueError(f"Invalid host for git clone: {hostname}")

        temp_dir = tempfile.mkdtemp(prefix="ecdat_git_")
        self.temp_dirs.append(temp_dir)
        
        try:
            import pygit2
        except ImportError:
            raise RuntimeError("pygit2 is required for git cloning")
            
        callbacks = pygit2.RemoteCallbacks()
        # No credentials provided
        
        # Isolated clone with depth 1
        pygit2.clone_repository(
            url, 
            temp_dir, 
            callbacks=callbacks,
            depth=self.max_depth,
            init_submodules=False # Submodules off by default
        )
        return temp_dir
        
    def _fetch_archive(self, path: str) -> str:
        import tarfile
        import zipfile
        temp_dir = tempfile.mkdtemp(prefix="ecdat_archive_")
        self.temp_dirs.append(temp_dir)
        
        if path.endswith(".zip"):
            with zipfile.ZipFile(path, 'r') as zf:
                zf.extractall(temp_dir)
        else:
            with tarfile.open(path, 'r:*') as tf:
                # Basic protection against zip bombs/path traversal inside archive
                for member in tf.getmembers():
                    if member.name.startswith("/") or ".." in member.name:
                        continue
                    tf.extract(member, temp_dir)
                    
        return temp_dir

    def cleanup(self):
        for d in self.temp_dirs:
            try:
                shutil.rmtree(d, ignore_errors=True)
            except Exception:
                pass
