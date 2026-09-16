"""
Tests for ECDAT Production Security Configuration Guard (Phase 24.3).

Verifies:
1. Secure-by-default production configuration.
2. Unsafe development settings never silently become production defaults.
3. Startup fails when mandatory security configuration is missing.
4. Prohibited dev bypass flags trigger immediate validation failure.
"""

import os
import sys
import pytest
from unittest.mock import patch

from scanners.production_config_guard import (
    ProductionConfigGuard,
    InsecureProductionConfigError,
    MissingMandatorySecurityConfigError,
    UnsafeDevelopmentDefaultDetectedError,
    KNOWN_INSECURE_DEV_SECRETS,
    MANDATORY_PRODUCTION_KEYS,
    PROHIBITED_DEV_FLAGS,
)


VALID_PROD_API_KEY = "k8s-prod-cluster-api-key-ecdat-enterprise-sec-token-2026"
VALID_PROD_DEK = "k8s-prod-dek-aes256-master-encryption-key-entropy-token"
VALID_PROD_DB_URL = "postgresql://ecdat_svc:ProdP@ssw0rd991!@aurora-cluster.internal:5432/ecdat_prod?sslmode=verify-full"


class TestProductionConfigGuard:
    """Test suite for ProductionConfigGuard."""

    def test_non_production_environment_passes_by_default(self):
        """In development or test environments, production guard does not block execution."""
        env = {
            "NODE_ENV": "development",
            "APP_ENV": "local",
        }
        res = ProductionConfigGuard.validate_environment(env=env, require_production=False)
        assert res.is_production is False
        assert res.passed is True
        assert len(res.violations) == 0

    def test_missing_all_mandatory_keys_fails_startup(self):
        """In production, missing mandatory security keys must raise MissingMandatorySecurityConfigError."""
        prod_env = {
            "NODE_ENV": "production",
        }
        with pytest.raises(MissingMandatorySecurityConfigError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert isinstance(err, InsecureProductionConfigError)
        for key in MANDATORY_PRODUCTION_KEYS:
            assert key in err.missing_keys

    def test_missing_single_mandatory_key_fails(self):
        """Missing DATA_ENCRYPTION_KEY while API key is set fails."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": VALID_PROD_API_KEY,
            # DATA_ENCRYPTION_KEY missing
        }
        with pytest.raises(MissingMandatorySecurityConfigError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        assert "DATA_ENCRYPTION_KEY" in exc_info.value.missing_keys
        assert "ECDAT_API_KEY" not in exc_info.value.missing_keys

    @pytest.mark.parametrize("dev_key", [
        "ecdat-demo-admin-key-2026",
        "change-this-local-api-key",
        "dummy-secret-key-for-testing",
        "test-mock-secret",
        "password",
        "admin",
        "default",
    ])
    def test_known_dev_secrets_prohibited_in_production(self, dev_key):
        """Known development mock credentials must never silently become production defaults."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": dev_key,
            "DATA_ENCRYPTION_KEY": VALID_PROD_DEK,
        }
        with pytest.raises(UnsafeDevelopmentDefaultDetectedError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert any("ECDAT_API_KEY is using a known" in v for v in err.violations)

    def test_dev_master_encryption_key_prohibited_in_production(self):
        """Development fallback encryption key must be rejected in production."""
        prod_env = {
            "APP_ENV": "production",
            "ECDAT_API_KEY": VALID_PROD_API_KEY,
            "DATA_ENCRYPTION_KEY": "ecdat-dev-master-encryption-key",
        }
        with pytest.raises(UnsafeDevelopmentDefaultDetectedError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert any("DATA_ENCRYPTION_KEY is using a known" in v for v in err.violations)

    def test_short_api_key_rejected_in_production(self):
        """Keys shorter than 32 characters lack sufficient entropy for production discovery."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": "short-key-only-22-chars!",
            "DATA_ENCRYPTION_KEY": VALID_PROD_DEK,
        }
        with pytest.raises(UnsafeDevelopmentDefaultDetectedError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert any("ECDAT_API_KEY must be at least 32 characters" in v for v in err.violations)

    def test_localhost_database_url_rejected_in_production(self):
        """Database URLs targeting localhost or default dev credentials must be rejected."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": VALID_PROD_API_KEY,
            "DATA_ENCRYPTION_KEY": VALID_PROD_DEK,
            "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/ecdat",
        }
        with pytest.raises(UnsafeDevelopmentDefaultDetectedError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert any("DATABASE_URL cannot use localhost" in v for v in err.violations)

    @pytest.mark.parametrize("flag", PROHIBITED_DEV_FLAGS)
    def test_prohibited_dev_flags_fail_production_startup(self, flag):
        """Bypass and debug flags must never be enabled in production."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": VALID_PROD_API_KEY,
            "DATA_ENCRYPTION_KEY": VALID_PROD_DEK,
            flag: "true",
        }
        with pytest.raises(UnsafeDevelopmentDefaultDetectedError) as exc_info:
            ProductionConfigGuard.validate_environment(env=prod_env)

        err = exc_info.value
        assert any(flag in v for v in err.violations)

    def test_valid_production_configuration_passes(self):
        """A complete, hardened production configuration passes cleanly."""
        prod_env = {
            "NODE_ENV": "production",
            "ECDAT_API_KEY": VALID_PROD_API_KEY,
            "DATA_ENCRYPTION_KEY": VALID_PROD_DEK,
            "DATABASE_URL": VALID_PROD_DB_URL,
            "ALLOW_DEV_BYPASS": "false",
            "INSECURE_SKIP_VERIFY": "false",
        }
        res = ProductionConfigGuard.validate_environment(env=prod_env)
        assert res.is_production is True
        assert res.passed is True
        assert len(res.violations) == 0
        assert res.details["api_key_length"] >= 32
        assert res.details["dek_length"] >= 32

    def test_require_production_override_flag(self):
        """require_production forces validation even when NODE_ENV is not production."""
        empty_env = {}
        with pytest.raises(MissingMandatorySecurityConfigError):
            ProductionConfigGuard.validate_environment(env=empty_env, require_production=True)
