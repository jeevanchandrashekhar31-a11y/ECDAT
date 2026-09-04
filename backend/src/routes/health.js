const express = require("express");
const config = require("../config");
const { isDbConnected } = require("../db/connection");

const router = express.Router();

/**
 * GET /health
 * Public health check endpoint reporting service availability, version, and uptime.
 */
router.get("/", async (req, res) => {
  const databaseConnected = await isDbConnected();
  const healthy = !config.REQUIRE_DATABASE_HEALTH || databaseConnected;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    service: "ecdat-backend",
    version: config.VERSION,
    environment: config.NODE_ENV,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: { database: databaseConnected ? "healthy" : "unavailable" },
  });
});

module.exports = router;
