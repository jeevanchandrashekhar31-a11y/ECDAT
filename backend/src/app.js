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
const sbomRoutes = require("./routes/sbom");
const certificatesRoutes = require("./routes/certificates");
const policyRoutes = require("./routes/policy");
const complianceRoutes = require("./routes/compliance");
const remediationRoutes = require("./routes/remediation");
const ciRoutes = require("./routes/ci");
const ticketingRoutes = require("./routes/ticketing");
const authRoutes = require("./routes/auth");
const kmsRoutes = require("./routes/kms");
const securityHardeningRoutes = require("./routes/security_hardening");
const tenancyRoutes = require("./routes/tenancy");
const graphRoutes = require("./routes/graph");
const auditRoutes = require("./routes/audit");
const siemRoutes = require("./routes/siem");
const metricsRoutes = require("./routes/metrics");
const telemetryRoutes = require("./routes/telemetry");
const { metricsMiddleware } = require("./metrics");
const {
  injectionProtectionMiddleware,
  excessiveDataExposureFilter,
  resourceExhaustionGuard,
} = require("./middleware/api_hardening");
const { csrfProtectionMiddleware } = require("./middleware/cookie_csrf");
const { tenantIsolationMiddleware } = require("./tenancy");
const { tlsEnforcementMiddleware } = require("./security/transit_security");
const { requestSizeLimitMiddleware } = require("./security/resource_governance");

const app = express();


// 1. Security & Standard Middleware
app.use(tlsEnforcementMiddleware());
app.use(requestSizeLimitMiddleware());
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use(requestLoggerMiddleware);
app.use(excessiveDataExposureFilter);

// 2. Body Parser with configurable size limits
app.use(express.json({ limit: config.MAX_JSON_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_JSON_SIZE }));

// 2.1 OWASP API Hardening Layer & CSRF Defense
app.use(injectionProtectionMiddleware);
app.use(resourceExhaustionGuard());
app.use(csrfProtectionMiddleware);

// 3. Root and Top-Level Health Routes (Public Liveness/Readiness Probes)
app.use("/health", healthRoutes);

// 4. API-Key Authentication Middleware (protects write routes, scanner routes, and optional read protection)
app.use(apiKeyAuthMiddleware);
app.use(tenantIsolationMiddleware);

// 4.1 Metrics & Observability Routes (GET is read telemetry; POST /record requires authentication)
app.use("/metrics", metricsRoutes);

// 5. Direct Scanner Pipeline Routes (root-level for /scan/* and /cbom/*)
app.use(scannerPipeline);
app.use("/sbom", sbomRoutes);
app.use("/telemetry", telemetryRoutes);

// 6. API v1 Router
const apiV1 = express.Router();
apiV1.use("/health", healthRoutes);
apiV1.use("/auth", authRoutes);
apiV1.use("/tenancy", tenancyRoutes);
apiV1.use("/cboms", cbomRoutes);
apiV1.use("/cbom", cbomRoutes);
apiV1.use("/sbom", sbomRoutes);
apiV1.use("/sboms", sbomRoutes);
apiV1.use("/scans", scansRoutes);
apiV1.use("/findings", findingsRoutes);
apiV1.use("/assets", assetsRoutes);
apiV1.use("/dashboard", dashboardRoutes);
apiV1.use("/graph", graphRoutes);
apiV1.use("/reports", reportsRoutes);
apiV1.use("/certificates", certificatesRoutes);
apiV1.use("/policy", policyRoutes);
apiV1.use("/compliance", complianceRoutes);
apiV1.use("/remediation", remediationRoutes);
apiV1.use("/ci", ciRoutes);
apiV1.use("/integrations/ticketing", ticketingRoutes);
apiV1.use("/integrations/kms", kmsRoutes);
apiV1.use("/security", securityHardeningRoutes);
apiV1.use("/audit", auditRoutes);
apiV1.use("/siem", siemRoutes);
apiV1.use("/metrics", metricsRoutes);
apiV1.use("/telemetry", telemetryRoutes);
apiV1.use(scannerPipeline);


app.use("/api/v1", apiV1);


// 5. Centralized Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
