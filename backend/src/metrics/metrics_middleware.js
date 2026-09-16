/**
 * ECDAT Operational Metrics — Phase 18.3 Express Metrics Middleware
 *
 * Automatically records API latency and error rates across all endpoints.
 * Enforces route sanitization to prevent sensitive parameter or ID leaks in metrics.
 */

const { defaultMetricsCollector } = require("./metrics_collector");

function metricsMiddleware(req, res, next) {
  // Skip metrics endpoint itself to prevent observation bias
  const rawPath = req.originalUrl || req.url || "/";
  if (rawPath.startsWith("/metrics") || rawPath.startsWith("/health")) {
    return next();
  }

  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6);

    defaultMetricsCollector.recordHttpRequest(
      rawPath,
      req.method,
      res.statusCode,
      Number(durationMs.toFixed(2))
    );
  });

  next();
}

module.exports = {
  metricsMiddleware,
};
