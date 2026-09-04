// Legacy entry point retained for compatibility. Always use the hardened app
// so this path cannot accidentally start an unauthenticated, permissive-CORS API.
const app = require("../app");
const config = require("../config");

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`ECDAT Backend listening on port ${config.PORT}`);
  });
}

module.exports = app;
