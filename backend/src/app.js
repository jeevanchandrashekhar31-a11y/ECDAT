const express = require("express");
const config = require("./config");
const requestIdMiddleware = require("./middleware/request_id");
const {
  helmetMiddleware,
  corsMiddleware,
  requestLoggerMiddleware,
} = require("./middleware/security");
const { notFoundHandler, errorHandler } = require("./middleware/error_handler");
const { apiKeyAuthMiddleware } = require("./middleware/auth");

// Route modules
const healthRoutes = require("./routes/health");
const cbomRoutes = require("./routes/cbom");
const scansRoutes = require("./routes/scans");
const findingsRoutes = require("./routes/findings");
const assetsRoutes = require("./routes/assets");
const dashboardRoutes = require("./routes/dashboard");
const reportsRoutes = require("./routes/reports");
const scannerPipeline = require("./routes/scanner_pipeline");

const app = express();

// 1. Security & Standard Middleware
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// 2. Body Parser with configurable size limits
app.use(express.json({ limit: config.MAX_JSON_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_JSON_SIZE }));

// 3. Root and Top-Level Health Routes
app.use("/health", healthRoutes);

// 4. API-Key Authentication Middleware (protects write routes and optional read protection)
app.use(apiKeyAuthMiddleware);

// 5. Direct Scanner Pipeline Routes (root-level for /scan/* and /cbom/*)
app.use(scannerPipeline);

// 6. API v1 Router
const apiV1 = express.Router();
apiV1.use("/health", healthRoutes);
apiV1.use("/cboms", cbomRoutes);
apiV1.use("/cbom", cbomRoutes);
apiV1.use("/scans", scansRoutes);
apiV1.use("/findings", findingsRoutes);
apiV1.use("/assets", assetsRoutes);
apiV1.use("/dashboard", dashboardRoutes);
apiV1.use("/reports", reportsRoutes);
apiV1.use(scannerPipeline);

app.use("/api/v1", apiV1);

// 5. Centralized Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
