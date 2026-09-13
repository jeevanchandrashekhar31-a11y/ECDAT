"""
ECDAT Scanners Centralized Configuration & Sanitization (Python)
Typed configuration with Pydantic, environment overrides, secret reference resolution,
and credential URL sanitization.
"""

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urlunparse
from pydantic import BaseModel, Field


def resolve_secret(value: Optional[str]) -> Optional[str]:
    """Resolves secret references: file://, env:, or raw string."""
    if not value or not isinstance(value, str):
        return value

    trimmed = value.strip()
    if trimmed.startswith("file://"):
        filepath = Path(trimmed[7:])
        if not filepath.exists():
            raise FileNotFoundError(f"Secret file not found: {filepath}")
        return filepath.read_text(encoding="utf-8").strip()

    if trimmed.startswith("env:"):
        env_var = trimmed[4:]
        env_val = os.environ.get(env_var)
        if env_val is None:
            raise KeyError(f"Secret env var '{env_var}' not set")
        return env_val.strip()

    return trimmed


def sanitize_credential_url(url_str: str) -> str:
    """Strips passwords and sensitive credentials from URLs."""
    if not url_str or not isinstance(url_str, str):
        return url_str
    try:
        parsed = urlparse(url_str)
        if parsed.password:
            netloc = f"{parsed.username}:***@{parsed.hostname}"
            if parsed.port:
                netloc += f":{parsed.port}"
            return urlunparse(parsed._replace(netloc=netloc))
        return url_str
    except Exception:
        return re.sub(r"://([^:]+):[^@]+@", r"://\1:***@", url_str)


def sanitize_config_for_logging(data: Dict[str, Any]) -> Dict[str, Any]:
    """Deep masks secrets and credentials for safe logging."""
    sanitized = {}
    secret_patterns = re.compile(r"(key|secret|password|token|auth)", re.IGNORECASE)

    for k, v in data.items():
        if isinstance(v, dict):
            sanitized[k] = sanitize_config_for_logging(v)
        elif isinstance(v, str) and ("://" in v and "@" in v):
            sanitized[k] = sanitize_credential_url(v)
        elif secret_patterns.search(k):
            sanitized[k] = "***REDACTED***" if v else v
        else:
            sanitized[k] = v
    return sanitized


class ScannerConfig(BaseModel):
    """Centralized typed configuration for ECDAT Scanners."""

    environment: str = Field(default_factory=lambda: os.environ.get("ECDAT_ENV", "development"))
    max_file_size_mb: int = Field(default_factory=lambda: int(os.environ.get("ECDAT_MAX_FILE_SIZE_MB", "10")))
    max_files: int = Field(default_factory=lambda: int(os.environ.get("ECDAT_MAX_FILES", "1000")))
    timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("ECDAT_TIMEOUT_SECONDS", "300")))
    llm_verify: bool = Field(default_factory=lambda: os.environ.get("ECDAT_LLM_VERIFY", "false").lower() == "true")
    llm_model: str = Field(default_factory=lambda: os.environ.get("ECDAT_LLM_MODEL", "llama3-8b-8192"))
    groq_api_key: Optional[str] = Field(default_factory=lambda: resolve_secret(os.environ.get("GROQ_API_KEY")))

    def to_sanitized_dict(self) -> Dict[str, Any]:
        return sanitize_config_for_logging(self.model_dump())


def get_scanner_config() -> ScannerConfig:
    return ScannerConfig()
