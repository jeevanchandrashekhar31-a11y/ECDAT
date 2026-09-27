"""
ECDAT Incremental Scanner Cache (Phase 21.2)

Provides persistent, content-addressed caching for scanner findings.
Key Invariants:
- Zero Stale Results: Cache invalidates automatically if scan engine, policies,
  configurations, or dependencies drift.
- Thread-Safe: Synchronized reads and writes for concurrent worker pools.
- Content-Addressed: Keys incorporate file content SHA-256 + EnvironmentDigest.
"""

from dataclasses import asdict, dataclass, field
import datetime
import hashlib
import json
import os
from pathlib import Path
import threading
from typing import Any, Dict, List, Optional, Tuple

from scanners.common.fingerprint_engine import (
    FingerprintEngine,
    ScanFingerprints,
    compute_bytes_sha256,
)

DEFAULT_CACHE_DIR_NAME = ".ecdat_cache"


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    invalidations: int = 0
    total_entries: int = 0
    cache_size_bytes: int = 0
    hit_ratio_pct: float = 0.0
    stale_reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hits": self.hits,
            "misses": self.misses,
            "invalidations": self.invalidations,
            "total_entries": self.total_entries,
            "cache_size_bytes": self.cache_size_bytes,
            "hit_ratio_pct": round(self.hit_ratio_pct, 2),
            "stale_reasons": self.stale_reasons,
        }


class ScannerCache:
    """
    Persistent, thread-safe, content-addressed cache for incremental scanning.
    """

    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        target_root: Optional[Path] = None,
        config_dict: Optional[Dict[str, Any]] = None,
        enabled: bool = True,
    ):
        self.target_root = Path(target_root).resolve() if target_root else Path.cwd()
        self.cache_dir = Path(cache_dir).resolve() if cache_dir else self.target_root / DEFAULT_CACHE_DIR_NAME
        self.enabled = enabled
        self._lock = threading.Lock()

        self.fingerprint_engine = FingerprintEngine(self.target_root)
        self.config_dict = config_dict or {}

        self.stats = CacheStats()
        self.current_fingerprints: Optional[ScanFingerprints] = None
        self._memory_store: Dict[str, Dict[str, Any]] = {}
        self._manifest_path = self.cache_dir / "manifest.json"
        self._entries_dir = self.cache_dir / "entries"

        if self.enabled:
            self._initialize_cache()

    def _initialize_cache(self):
        """Prepares directory, generates current fingerprints, and validates staleness."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._entries_dir.mkdir(parents=True, exist_ok=True)

        self.current_fingerprints = self.fingerprint_engine.generate_composite_fingerprints(self.config_dict)

        if self._manifest_path.exists():
            try:
                with open(self._manifest_path, "r", encoding="utf-8") as f:
                    cached_manifest = json.load(f)

                cached_fps = cached_manifest.get("fingerprints", {})
                is_stale, reasons = FingerprintEngine.is_environment_stale(cached_fps, self.current_fingerprints)

                if is_stale:
                    # Invalidate stale cache
                    self.stats.invalidations += 1
                    self.stats.stale_reasons = reasons
                    self.clear()
                else:
                    # Load active memory index from manifest
                    self._memory_store = cached_manifest.get("entries", {})
                    self.stats.total_entries = len(self._memory_store)
            except Exception:
                self.clear()
        else:
            self._save_manifest()

    def _compute_entry_key(self, rel_path: str, file_hash: str) -> str:
        """Computes content-addressed cache key."""
        env_digest = self.current_fingerprints.environment_digest if self.current_fingerprints else "DEFAULT_ENV"
        h = hashlib.sha256()
        h.update(rel_path.replace("\\", "/").encode("utf-8"))
        h.update(file_hash.encode("utf-8"))
        h.update(env_digest.encode("utf-8"))
        return h.hexdigest()

    def get(self, rel_path: str, file_bytes: bytes) -> Optional[List[Dict[str, Any]]]:
        """
        Retrieves cached findings for a file if matching content-addressed key exists.
        Returns None on cache miss.
        """
        if not self.enabled or not self.current_fingerprints:
            self.stats.misses += 1
            self._update_ratio()
            return None

        file_hash = compute_bytes_sha256(file_bytes)
        cache_key = self._compute_entry_key(rel_path, file_hash)

        with self._lock:
            if cache_key in self._memory_store:
                entry = self._memory_store[cache_key]
                self.stats.hits += 1
                self._update_ratio()
                return entry.get("findings", [])

            # Secondary disk check
            entry_file = self._entries_dir / f"{cache_key}.json"
            if entry_file.exists():
                try:
                    with open(entry_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    self._memory_store[cache_key] = data
                    self.stats.hits += 1
                    self._update_ratio()
                    return data.get("findings", [])
                except Exception:
                    pass

            self.stats.misses += 1
            self._update_ratio()
            return None

    def put(self, rel_path: str, file_bytes: bytes, findings: List[Dict[str, Any]]):
        """
        Caches findings for a scanned file.
        """
        if not self.enabled or not self.current_fingerprints:
            return

        file_hash = compute_bytes_sha256(file_bytes)
        cache_key = self._compute_entry_key(rel_path, file_hash)

        entry = {
            "rel_path": rel_path.replace("\\", "/"),
            "file_hash": file_hash,
            "environment_digest": self.current_fingerprints.environment_digest,
            "findings": findings,
            "cached_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

        with self._lock:
            self._memory_store[cache_key] = entry
            self.stats.total_entries = len(self._memory_store)

            # Persist entry file asynchronously or chunked
            entry_file = self._entries_dir / f"{cache_key}.json"
            try:
                with open(entry_file, "w", encoding="utf-8") as f:
                    json.dump(entry, f, separators=(",", ":"))
            except OSError:
                pass

    def save(self):
        """Flushes cache index and manifest to disk."""
        if not self.enabled:
            return
        with self._lock:
            self._save_manifest()

    def _save_manifest(self):
        """Internal helper to write manifest."""
        manifest_data = {
            "version": "1.0",
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "fingerprints": self.current_fingerprints.to_dict() if self.current_fingerprints else {},
            "total_entries": len(self._memory_store),
            "entries": self._memory_store,
        }
        try:
            with open(self._manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, indent=2)
            self._update_disk_size()
        except OSError:
            pass

    def _update_ratio(self):
        """Recalculates cache hit ratio."""
        total = self.stats.hits + self.stats.misses
        if total > 0:
            self.stats.hit_ratio_pct = (self.stats.hits / total) * 100.0
        else:
            self.stats.hit_ratio_pct = 0.0

    def _update_disk_size(self):
        """Computes total storage footprint of the cache directory in bytes."""
        total = 0
        try:
            for root, _, files in os.walk(self.cache_dir):
                for f in files:
                    fp = Path(root) / f
                    total += fp.stat().st_size
        except OSError:
            pass
        self.stats.cache_size_bytes = total

    def clear(self):
        """Purges all cached entries and manifest."""
        with self._lock:
            self._memory_store.clear()
            self.stats.total_entries = 0
            if self._entries_dir.exists():
                for f in self._entries_dir.glob("*.json"):
                    try:
                        f.unlink(missing_ok=True)
                    except OSError:
                        pass
            if self._manifest_path.exists():
                try:
                    self._manifest_path.unlink(missing_ok=True)
                except OSError:
                    pass
            self._save_manifest()
