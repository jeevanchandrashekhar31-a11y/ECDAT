"""
ECDAT Production Security Configuration Guard (Python Engine) — Phase 24.3.

Enforces secure-by-default production invariants across Python scanners and tools:
1. Unsafe development settings must never silently become production defaults.
2. Fail startup when mandatory security configuration is missing.
3. Prohibits known development mock keys, localhost endpoints, and debug bypasses.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


class InsecureProductionConfigError(Exception):
    """Raised when an insecure development setting or flag is detected in production."""
    def __init__(self, message: str, violations: Optional[List[str]] = None):
        super().__init__(message)
        self.violations = violations or []


class MissingMandatorySecurityConfigError(InsecureProductionConfigError):
    """Raised when mandatory security configuration is missing in production."""
    def __init__(self, missing_keys: List[str]):
        msg = f"Mandatory security configuration is missing in production: {missing_keys}"
        super().__init__(msg, [f"Missing mandatory key: '{k}'" for k in missing_keys])
        self.missing_keys = missing_keys


class UnsafeDevelopmentDefaultDetectedError(InsecureProductionConfigError):
    """Raised when a development default secret or bypass flag is detected in production."""
    def __init__(self, unsafe_defaults: List[str]):
        msg = f"Unsafe development setting detected in production: {unsafe_defaults}"
        super().__init__(msg, [f"Unsafe development setting: '{d}'" for d in unsafe_defaults])
        self.unsafe_defaults = unsafe_defaults


KNOWN_INSECURE_DEV_SECRETS = {
    "ecdat-demo-admin-key-2026",
    "ecdat-dev-master-encryption-key",
    "change-this-local-api-key",
    "change-this-local-postgres-password",
    "change-this-production-password",
    "change-this-local-key",
    "dummy-secret-key-for-testing",
    "super-secure-jwt-signing-key-example",
    "secret",
    "password",
    "admin",
    "123456",
    "12345678",
    "default",
    "root",
    "test",
    "dev",
}

MANDATORY_PRODUCTION_KEYS = [
    "ECDAT_API_KEY",
    "DATA_ENCRYPTION_KEY",
]

PROHIBITED_DEV_FLAGS = [
    "ALLOW_DEV_BYPASS",
    "INSECURE_SKIP_VERIFY",
    "DISABLE_SECRETS_SCAN",
    "ALLOW_PLAINTEXT_COMMUNICATION",
    "MOCK_INSPECTION_MODE",
]


@dataclass
class ConfigValidationResult:
    is_production: bool
    passed: bool
    missing_keys: List[str] = field(default_factory=list)
    violations: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class ProductionConfigGuard:
    """Validates production environment configurations and halts insecure execution."""

    @staticmethod
    def is_known_dev_secret(val: Optional[str]) -> bool:
        if not val:
            return True
        clean = val.strip().lower()
        if clean in KNOWN_INSECURE_DEV_SECRETS:
            return True
        if clean.startswith("change-this-") or clean.startswith("dummy") or clean.startswith("mock") or clean.startswith("test-"):
            return True
        return False

    @classmethod
    def validate_environment(
        cls,
        env: Optional[Dict[str, str]] = None,
        require_production: bool = False,
    ) -> ConfigValidationResult:
        env_dict = env if env is not None else dict(os.environ)

        node_env = env_dict.get("NODE_ENV", "").lower()
        app_env = env_dict.get("APP_ENV", "").lower()
        ecdat_env = env_dict.get("ECDAT_ENV", "").lower()

        is_prod = require_production or ("production" in (node_env, app_env, ecdat_env))

        if not is_prod:
            return ConfigValidationResult(is_production=False, passed=True)

        missing_keys = []
        violations = []
        details = {}

        # 1. Mandatory keys check
        for k in MANDATORY_PRODUCTION_KEYS:
            val = env_dict.get(k)
            if not val or not val.strip():
                missing_keys.append(k)

        if missing_keys:
            raise MissingMandatorySecurityConfigError(missing_keys)

        # 2. Secret strength and dev default checks
        api_key = env_dict.get("ECDAT_API_KEY", "")
        if cls.is_known_dev_secret(api_key):
            violations.append("ECDAT_API_KEY is using a known development default or mock secret.")
        if len(api_key.strip()) < 32:
            violations.append(f"ECDAT_API_KEY must be at least 32 characters in production (provided: {len(api_key.strip())}).")

        dek = env_dict.get("DATA_ENCRYPTION_KEY", "")
        if cls.is_known_dev_secret(dek):
            violations.append("DATA_ENCRYPTION_KEY is using a known development key.")
        if len(dek.strip()) < 32:
            violations.append("DATA_ENCRYPTION_KEY must be a 256-bit key (at least 32 characters/bytes) in production.")

        # Database URL check if defined
        db_url = env_dict.get("DATABASE_URL", "")
        if db_url:
            if "localhost:5432" in db_url or "127.0.0.1:5432" in db_url or "postgres:postgres@" in db_url or "change-this-" in db_url:
                violations.append("DATABASE_URL cannot use localhost or default development credentials in production.")

        # 3. Prohibited development bypass flags
        for flag in PROHIBITED_DEV_FLAGS:
            flag_val = env_dict.get(flag, "").lower().strip()
            if flag_val in ("true", "1", "yes", "on"):
                violations.append(f"Prohibited development bypass flag '{flag}=true' is forbidden in production.")

        details["api_key_length"] = len(api_key)
        details["dek_length"] = len(dek)
        details["violations_count"] = len(violations)

        if violations:
            raise UnsafeDevelopmentDefaultDetectedError(violations)

        return ConfigValidationResult(
            is_production=True,
            passed=True,
            missing_keys=[],
            violations=[],
            details=details,
        )


def main():
    parser = argparse.ArgumentParser(description="ECDAT Production Security Configuration Guard")
    parser.add_argument("--env", default="production", help="Environment to validate (production/development)")
    args = parser.parse_args()

    is_prod_required = (args.env.lower() == "production")

    try:
        res = ProductionConfigGuard.validate_environment(require_production=is_prod_required)
        if not res.is_production:
            print(f">> [PRODUCTION CONFIG GUARD] Status: PASS (Non-Production Environment — Dev Settings Permitted)")
            sys.exit(0)
        print(f">> [PRODUCTION CONFIG GUARD] Status: PASS (Production Standard Enforced)")
        print(f"   API Key verified : Non-default, >= 32 chars")
        print(f"   Encryption Key   : 256-bit AES/ChaCha master key verified")
        print(f"   Dev flags        : All bypass flags disabled")
        sys.exit(0)
    except InsecureProductionConfigError as e:
        print(f">> [PRODUCTION CONFIG GUARD] FATAL: {e}")
        for v in e.violations:
            print(f"   - {v}")
        sys.exit(1)


if __name__ == "__main__":
    main()
