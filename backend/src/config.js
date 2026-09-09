const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

function getEnv(key, defaultValue = undefined, required = false) {
  const val = process.env[key];
  if (val === undefined || val === "") {
    if (required) {
      throw new Error(
        `Configuration Error: Environment variable '${key}' is required.`,
      );
    }
    return defaultValue;
  }
  return val;
}

function parseCorsOrigins(originStr) {
  if (!originStr || originStr.trim() === "") {
    return [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:5175",
    ];
  }
  const origins = originStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.includes("*")) {
    throw new Error(
      "Configuration Error: CORS_ORIGIN must name explicit origins; '*' is not permitted.",
    );
  }
  return origins;
}

function parsePositiveInt(key, defaultValue, maxValue) {
  const value = Number.parseInt(getEnv(key, String(defaultValue)), 10);
  if (!Number.isInteger(value) || value <= 0 || value > maxValue) {
    throw new Error(
      `Configuration Error: ${key} must be an integer between 1 and ${maxValue}.`,
    );
  }
  return value;
}

function parseBodySize(value) {
  const match = /^(\d+)(kb|mb)$/i.exec(value.trim());
  if (!match) {
    throw new Error(
      "Configuration Error: MAX_JSON_SIZE must use a whole-number kb or mb value.",
    );
  }
  const bytes =
    Number(match[1]) * (match[2].toLowerCase() === "mb" ? 1024 * 1024 : 1024);
  if (bytes < 1024 || bytes > 50 * 1024 * 1024) {
    throw new Error(
      "Configuration Error: MAX_JSON_SIZE must be between 1kb and 50mb.",
    );
  }
  return `${bytes}b`;
}

const nodeEnv = getEnv("NODE_ENV", "development");
const apiKey =
  nodeEnv === "production"
    ? getEnv("ECDAT_API_KEY", undefined, true)
    : getEnv("ECDAT_API_KEY", "ecdat-demo-admin-key-2026");

const config = {
  NODE_ENV: nodeEnv,
  PORT: parseInt(getEnv("PORT", "5000"), 10),
  MAX_JSON_SIZE: parseBodySize(getEnv("MAX_JSON_SIZE", "10mb")),
  MAX_UPLOAD_BYTES: parsePositiveInt(
    "MAX_UPLOAD_BYTES",
    10 * 1024 * 1024,
    50 * 1024 * 1024,
  ),
  UPLOAD_RATE_LIMIT: parsePositiveInt("UPLOAD_RATE_LIMIT", 60, 10000),
  CORS_ORIGIN: parseCorsOrigins(
    getEnv("CORS_ORIGIN", "http://localhost:3000,http://localhost:5173"),
  ),
  DATABASE_URL: getEnv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/ecdat",
  ),
  RULES_DIR: path.resolve(__dirname, "../../rules"),
  DEFAULT_POLICY_PROFILE: getEnv(
    "DEFAULT_POLICY_PROFILE",
    "internal_enterprise",
  ),
  DEFAULT_SCENARIO: getEnv("DEFAULT_SCENARIO", "baseline"),
  ECDAT_API_KEY: apiKey,
  REQUIRE_AUTH_FOR_READS: getEnv("REQUIRE_AUTH_FOR_READS", "false") === "true",
  REQUIRE_DATABASE_HEALTH:
    getEnv("REQUIRE_DATABASE_HEALTH", "false") === "true",
  VERSION: "1.0.0",
};

// Validate critical constraints
if (isNaN(config.PORT) || config.PORT <= 0 || config.PORT > 65535) {
  throw new Error(`Configuration Error: Invalid PORT '${process.env.PORT}'`);
}

module.exports = config;
