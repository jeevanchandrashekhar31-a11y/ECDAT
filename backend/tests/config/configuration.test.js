const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  resolveSecret,
  sanitizeCredentialUrl,
  sanitizeConfigForLogging,
  validateConfig,
  InsecureProductionConfigError,
} = require("../../src/config/schema");

describe("Configuration Model & Production Security (Node.js)", () => {
  test("Secret reference resolution - env: prefix", () => {
    process.env.TEST_SECRET_VAR = "super_secret_value_123";
    const resolved = resolveSecret("env:TEST_SECRET_VAR");
    assert.equal(resolved, "super_secret_value_123");
    delete process.env.TEST_SECRET_VAR;
  });

  test("Secret reference resolution - file:// prefix", () => {
    const tmpFile = path.resolve(__dirname, "../../scratch_secret.txt");
    fs.writeFileSync(tmpFile, "file_based_secret_token_abc\n", "utf8");
    try {
      const resolved = resolveSecret(`file://${tmpFile}`);
      assert.equal(resolved, "file_based_secret_token_abc");
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test("Credential URL sanitization strips passwords", () => {
    const rawUrl = "postgresql://dbuser:supersecretpass123@prod-cluster.internal:5432/ecdat_prod";
    const sanitized = sanitizeCredentialUrl(rawUrl);

    assert.ok(!sanitized.includes("supersecretpass123"), "Password must be stripped");
    assert.ok(sanitized.includes("***"), "Password must be masked with ***");
    assert.ok(sanitized.includes("prod-cluster.internal:5432"));
  });

  test("Config logging sanitization masks all secrets and credentials", () => {
    const rawConfig = {
      PORT: 5000,
      ECDAT_API_KEY: "secret_api_key_456",
      DATABASE_URL: "postgresql://postgres:pass999@localhost:5432/ecdat",
      nested: {
        adminToken: "token_xyz",
        serviceName: "ecdat",
      },
    };

    const sanitized = sanitizeConfigForLogging(rawConfig);
    assert.equal(sanitized.PORT, 5000);
    assert.equal(sanitized.ECDAT_API_KEY, "***REDACTED***");
    assert.ok(!sanitized.DATABASE_URL.includes("pass999"));
    assert.equal(sanitized.nested.adminToken, "***REDACTED***");
    assert.equal(sanitized.nested.serviceName, "ecdat");
  });

  test("Fails startup on insecure production configuration", () => {
    const insecureProdConfig = {
      NODE_ENV: "production",
      PORT: 5000,
      ECDAT_API_KEY: "ecdat-demo-admin-key-2026", // default demo key
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ecdat", // default credentials
      CORS_ORIGIN: ["http://localhost:3000"], // localhost in prod
      REQUIRE_AUTH_FOR_READS: false, // unauthenticated reads in prod
    };

    assert.throws(
      () => {
        validateConfig(insecureProdConfig);
      },
      (err) => {
        assert.ok(err instanceof InsecureProductionConfigError);
        assert.ok(err.code === "ERR_CONFIG_INSECURE_PRODUCTION");
        assert.ok(err.violations.length >= 4, "Should report all 4 production violations");
        return true;
      }
    );
  });

  test("Passes validation with secure production settings", () => {
    const secureProdConfig = {
      NODE_ENV: "production",
      PORT: 5000,
      ECDAT_API_KEY: "prod_secure_random_key_k8s_9921471",
      DATABASE_URL: "postgresql://ecdat_app:p4ssw0rd99!@db-prod.internal:5432/ecdat",
      CORS_ORIGIN: ["https://dashboard.example.com"],
      REQUIRE_AUTH_FOR_READS: true,
    };

    assert.doesNotThrow(() => {
      validateConfig(secureProdConfig);
    });
  });
});
