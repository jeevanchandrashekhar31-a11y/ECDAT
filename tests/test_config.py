"""
Unit tests for centralized configuration, secret references, and sanitization (Python).
"""

import os
from pathlib import Path
import pytest
from scanners.config import (
    ScannerConfig,
    resolve_secret,
    sanitize_credential_url,
    sanitize_config_for_logging,
)


def test_resolve_secret_env(monkeypatch):
    monkeypatch.setenv("TEST_SC_KEY", "secret_groq_abc123")
    val = resolve_secret("env:TEST_SC_KEY")
    assert val == "secret_groq_abc123"


def test_resolve_secret_file(tmp_path):
    f = tmp_path / "secret.txt"
    f.write_text("file_secret_999\n", encoding="utf-8")
    val = resolve_secret(f"file://{f}")
    assert val == "file_secret_999"


def test_sanitize_credential_url():
    url = "postgresql://myuser:secretpassword@pg.prod:5432/mydb"
    sanitized = sanitize_credential_url(url)
    assert "secretpassword" not in sanitized
    assert "***" in sanitized


def test_sanitize_config_for_logging():
    cfg = {
        "max_files": 100,
        "groq_api_key": "gsk_1234567890",
        "nested": {"db_password": "supersecretpassword"},
    }
    sanitized = sanitize_config_for_logging(cfg)
    assert sanitized["max_files"] == 100
    assert sanitized["groq_api_key"] == "***REDACTED***"
    assert sanitized["nested"]["db_password"] == "***REDACTED***"


def test_scanner_config_defaults():
    config = ScannerConfig()
    assert config.max_files > 0
    assert config.max_file_size_mb > 0
    sanitized = config.to_sanitized_dict()
    assert isinstance(sanitized, dict)
