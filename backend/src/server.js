const app = require("./app");
const config = require("./config");
const { loadAndValidateAllRules } = require("./risk_engine");

function startServer() {
  console.log("====================================================");
  console.log("  ECDAT Backend — Enterprise Cryptographic Discovery ");
  console.log("====================================================");
  console.log(`Starting ECDAT backend in [${config.NODE_ENV}] mode...`);

  // 1. Startup validation: ensure rules and schemas conform
  try {
    console.log(`Loading and validating rulesets from: ${config.RULES_DIR}`);
    const rules = loadAndValidateAllRules(config.RULES_DIR);
    console.log(
      `✓ Rulesets successfully verified: ${Object.keys(rules).join(", ")}`,
    );
  } catch (err) {
    console.error("\n❌ FATAL: Ruleset validation failed at startup.");
    console.error(err.message);
    process.exit(1);
  }

  // 2. Initialize default local user if empty
  try {
    const { defaultLocalAuthManager } = require("./identity/password_auth");
    if (!defaultLocalAuthManager.getUser("admin")) {
      defaultLocalAuthManager.registerUser({
        username: "admin",
        email: "admin@ecdat.local",
        password: "ComplexSecurePass2026!",
        roles: ["admin"],
        tenantId: "default-tenant",
      });
      console.log("✓ Initialized local user: admin");
    }
  } catch (err) {
    console.warn("Notice: Local user initialization skipped:", err.message);
  }

  // 3. Start HTTP Server
  const server = app.listen(config.PORT, () => {
    console.log(
      `✓ ECDAT API Server listening on http://localhost:${config.PORT}`,
    );
    console.log(`✓ Health check: http://localhost:${config.PORT}/health`);
    console.log(`✓ API v1 Base:  http://localhost:${config.PORT}/api/v1\n`);
  });

  // 3. Graceful Shutdown Handlers
  function handleShutdown(signal) {
    console.log(
      `\nReceived ${signal}. Shutting down HTTP server gracefully...`,
    );
    server.close(() => {
      console.log("HTTP server closed. Exiting process.");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Forcefully terminating process after timeout.");
      process.exit(1);
    }, 5000);
  }

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
