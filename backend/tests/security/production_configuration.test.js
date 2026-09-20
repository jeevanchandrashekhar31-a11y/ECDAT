// @ecdat-synthetic-corpus
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateProductionSecurity,
  InsecureProductionConfigError,
  MissingMandatorySecurityConfigError,
  UnsafeDevelopmentDefaultDetectedError,
  MANDATORY_PRODUCTION_KEYS,
  PROHIBITED_DEV_FLAGS,
} = require("../../src/config/production_guard");

const { validateConfig } = require("../../src/config/schema");

// ecdat:synthetic-fixture
const VALID_PROD_CONFIG = {
  NODE_ENV: "production",
  PORT: 5000,
  ECDAT_API_KEY: "k8s-prod-cluster-api-key-ecdat-enterprise-sec-token-2026",
  DATABASE_URL: "postgresql://ecdat_svc:ProdP@ssw0rd991!@aurora-cluster.internal:5432/ecdat_prod?sslmode=verify-full",
  DATA_ENCRYPTION_KEY: "k8s-prod-dek-aes256-master-encryption-key-entropy-token",
  JWT_SECRET: "k8s-prod-jwt-secret-signing-key-high-entropy-production-32",
  CORS_ORIGIN: ["https://console.ecdat.corp", "https://api.ecdat.corp"],
  REQUIRE_AUTH_FOR_READS: true,
  DATABASE_SSL: true,
  DATABASE_SSL_REJECT_UNAUTHORIZED: true,
};

describe("Production Security Configuration Guard (Phase 24.3)", () => {
  test("Non-production environment passes by default", () => {
    const devConfig = {
      NODE_ENV: "development",
      PORT: 5000,
      ECDAT_API_KEY: "dev-test-key-for-local-testing-only",
    };
    const res = validateProductionSecurity(devConfig, { NODE_ENV: "development" });
    assert.equal(res.isProduction, false);
    assert.equal(res.passed, true);
    assert.doesNotThrow(() => validateConfig(devConfig));
  });

  test("Missing mandatory security configuration fails startup immediately", () => {
    const emptyProdConfig = {
      NODE_ENV: "production",
      PORT: 5000,
    };

    assert.throws(
      () => validateProductionSecurity(emptyProdConfig, {}),
      (err) => {
        assert.ok(err instanceof MissingMandatorySecurityConfigError);
        assert.equal(err.code, "ERR_CONFIG_MANDATORY_MISSING");
        for (const key of MANDATORY_PRODUCTION_KEYS) {
          assert.ok(
            err.missingKeys.includes(key),
            `Expected missing key '${key}' in error`
          );
        }
        return true;
      }
    );
  });

  test("Unsafe demo API key is rejected in production", () => {
    const config = {
      ...VALID_PROD_CONFIG,
      ECDAT_API_KEY: "change-this-local-api-key",
    };

    assert.throws(
      () => validateProductionSecurity(config, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.equal(err.code, "ERR_CONFIG_UNSAFE_DEV_DEFAULT");
        assert.ok(
          err.violations.some((v) => v.includes("ECDAT_API_KEY")),
          "Should report insecure API key"
        );
        return true;
      }
    );
  });

  test("Short API key (< 32 chars) is rejected for insufficient entropy", () => {
    const config = {
      ...VALID_PROD_CONFIG,
      ECDAT_API_KEY: "short-key-only-20-chars!",
    };

    assert.throws(
      () => validateProductionSecurity(config, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(
          err.violations.some((v) => v.includes("at least 32 characters")),
          "Should enforce 32+ character API key"
        );
        return true;
      }
    );
  });

  test("Localhost and default credentials in DATABASE_URL are rejected", () => {
    const config = {
      ...VALID_PROD_CONFIG,
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ecdat",
    };

    assert.throws(
      () => validateProductionSecurity(config, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(
          err.violations.some((v) => v.includes("DATABASE_URL cannot use localhost")),
          "Should reject localhost/default dev database"
        );
        return true;
      }
    );
  });

  test("Development master encryption key fallback is rejected", () => {
    const config = {
      ...VALID_PROD_CONFIG,
      DATA_ENCRYPTION_KEY: "ecdat-dev-master-encryption-key",
    };

    assert.throws(
      () => validateProductionSecurity(config, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(
          err.violations.some((v) => v.includes("DATA_ENCRYPTION_KEY")),
          "Should reject dev master encryption key"
        );
        return true;
      }
    );
  });

  test("Wildcard '*' and loopback CORS origins are prohibited in production", () => {
    const wildcardConfig = {
      ...VALID_PROD_CONFIG,
      CORS_ORIGIN: ["*"],
    };
    assert.throws(
      () => validateProductionSecurity(wildcardConfig, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(err.violations.some((v) => v.includes("wildcard '*'")));
        return true;
      }
    );

    const localhostCorsConfig = {
      ...VALID_PROD_CONFIG,
      CORS_ORIGIN: ["http://localhost:3000"],
    };
    assert.throws(
      () => validateProductionSecurity(localhostCorsConfig, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(err.violations.some((v) => v.includes("development loopback")));
        return true;
      }
    );

    const insecureHttpConfig = {
      ...VALID_PROD_CONFIG,
      CORS_ORIGIN: ["http://insecure-domain.example.com"],
    };
    assert.throws(
      () => validateProductionSecurity(insecureHttpConfig, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(err.violations.some((v) => v.includes("HTTPS protocol")));
        return true;
      }
    );
  });

  test("Unauthenticated reads REQUIRE_AUTH_FOR_READS=false are prohibited in production", () => {
    const unauthConfig = {
      ...VALID_PROD_CONFIG,
      REQUIRE_AUTH_FOR_READS: false,
    };
    assert.throws(
      () => validateProductionSecurity(unauthConfig, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(err.violations.some((v) => v.includes("REQUIRE_AUTH_FOR_READS=true")));
        return true;
      }
    );
  });

  test("Plaintext database traffic DATABASE_SSL=false is prohibited in production", () => {
    const unencryptedDbConfig = {
      ...VALID_PROD_CONFIG,
      DATABASE_SSL: false,
    };
    assert.throws(
      () => validateProductionSecurity(unencryptedDbConfig, {}),
      (err) => {
        assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
        assert.ok(err.violations.some((v) => v.includes("DATABASE_SSL=true")));
        return true;
      }
    );
  });

  test("Prohibited development bypass flags fail production startup", () => {
    for (const flag of PROHIBITED_DEV_FLAGS) {
      const devBypassEnv = { [flag]: "true" };
      assert.throws(
        () => validateProductionSecurity(VALID_PROD_CONFIG, devBypassEnv),
        (err) => {
          assert.ok(err instanceof UnsafeDevelopmentDefaultDetectedError);
          assert.ok(
            err.violations.some((v) => v.includes(flag)),
            `Flag ${flag} must be flagged as violation`
          );
          return true;
        },
        `Expected flag '${flag}=true' to fail startup in production`
      );
    }
  });

  test("Hardened production configuration passes validation cleanly", () => {
    const res = validateProductionSecurity(VALID_PROD_CONFIG, { NODE_ENV: "production" });
    assert.equal(res.isProduction, true);
    assert.equal(res.passed, true);
    assert.equal(res.violations.length, 0);

    assert.doesNotThrow(() => validateConfig(VALID_PROD_CONFIG));
  });
});
